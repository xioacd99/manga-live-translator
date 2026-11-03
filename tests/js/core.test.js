import test from 'node:test';
import assert from 'node:assert/strict';
import { createPipeline, BoundedCache, BoundedQueue, SingleFlight, canonicalize, sha256, validateTranslationResult, validateRegions } from '../../packages/core/index.js';
const region = {regionId:'r1',bbox:{x:0,y:0,width:10,height:10},sourceText:'Hello!',readingOrder:0};
const input = () => ({imageBytes:new Uint8Array([1,2,3]),width:100,height:100,namespace:'profile:site',ocrConfig:{engine:'fixture',revision:1},translation:{sourceLanguage:'en',targetLanguage:'zh-Hans',provider:'test',endpoint:'https://example.invalid/v1',accountNamespace:'a',model:'fixture',context:'previous scene',generation:{temperature:0}}});
function setup(options={}) {
 const calls={ocr:0,translate:0};
 const pipeline=createPipeline({ocr:async()=>{calls.ocr++;return {regions:[region]};},translate:async request=>{calls.translate++;return {translations:request.regions.map(r=>({regionId:r.regionId,text:'你好'}))};},...options});
 return {pipeline,calls};
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
async function until(predicate) { for(let n=0;n<100;n++){if(predicate())return;await tick();}throw new Error('Condition not reached'); }

test('canonical keys preserve content and SHA-256 matches known digest',async()=>{
 assert.equal(canonicalize({z:1,a:{b:2,a:1}}),canonicalize({a:{a:1,b:2},z:1}));
 assert.notEqual(canonicalize('Hi!'),canonicalize('Hi! '));
 assert.throws(()=>canonicalize({x:undefined}));
 assert.equal(await sha256(new TextEncoder().encode('abc')),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
test('warm repeat has zero extra OCR or translation calls; values cannot poison cache',async()=>{
 const {pipeline,calls}=setup(); const first=await pipeline.run(input()); first.regions[0].sourceText='poison';first.translations[0].text='poison';
 const second=await pipeline.run(input()); assert.equal(second.regions[0].sourceText,'Hello!');assert.equal(second.translations[0].text,'你好');assert.deepEqual(calls,{ocr:1,translate:1});
});
test('all effective translation changes miss only translation',async()=>{
 const {pipeline,calls}=setup();await pipeline.run(input());
 const changes={context:'other scene',model:'other',accountNamespace:'b',endpoint:'https://other.invalid',provider:'other',sourceLanguage:'ja',targetLanguage:'fr',glossary:{Hello:'bonjour'},glossaryRevision:2,style:'formal',generation:{temperature:1},promptVersion:2,schemaVersion:2,modelRevision:2,adapterRevision:2};
 for(const [key,value] of Object.entries(changes)){const next=input();next.translation[key]=value;await pipeline.run(next);}
 assert.equal(calls.ocr,1);assert.equal(calls.translate,1+Object.keys(changes).length);
});
test('source edits reuse OCR and change effective source; unknown edits fail',async()=>{
 const {pipeline,calls}=setup(); await pipeline.run(input());
 const edit={...input(),sourceEdits:{r1:'Goodbye'}};const result=await pipeline.run(edit);await pipeline.run(edit);
 assert.equal(result.regions[0].sourceText,'Goodbye');assert.deepEqual(calls,{ocr:1,translate:2});
 await assert.rejects(pipeline.run({...input(),sourceEdits:{missing:'x'}}),/unknown region/);
});
test('namespace and changed bytes isolate OCR; changed OCR config invalidates OCR',async()=>{
 const {pipeline,calls}=setup();await pipeline.run(input());await pipeline.run({...input(),namespace:'incognito:site'});await pipeline.run({...input(),imageBytes:new Uint8Array([1,2,4])});await pipeline.run({...input(),ocrConfig:{engine:'fixture',revision:2}});
 assert.equal(calls.ocr,4);assert.equal(calls.translate,2); // Identical effective text may reuse within a scope.
});
test('invalid translation and OCR results never enter cache',async()=>{
 let count=0;const {pipeline}=setup({translate:async()=>{count++;return {translations:[{regionId:'wrong',text:'x'}]};}});
 await assert.rejects(pipeline.run(input()));await assert.rejects(pipeline.run(input()));assert.equal(count,2);assert.equal(pipeline.diagnostics().translationEntries,0);
 let ocrCount=0;const bad=setup({ocr:async()=>{ocrCount++;return {regions:[{...region,bbox:{x:0,y:0,width:1000,height:1}}]};}}).pipeline;
 await assert.rejects(bad.run(input()));await assert.rejects(bad.run(input()));assert.equal(ocrCount,2);
});
test('translation schema rejects missing duplicate extra and oversized output',()=>{
 for(const translations of [[],[{regionId:'x',text:'x'}],[{regionId:'r1',text:'x'},{regionId:'r1',text:'x'}],[{regionId:'r1',text:'x'.repeat(8193)}],[{regionId:'r1',text:'x',html:'bad'}]])assert.throws(()=>validateTranslationResult({translations},[region]));
 assert.throws(()=>validateRegions([{...region,confidence:1.1}]));assert.throws(()=>validateRegions([region,region]));
});
test('single-flight cancellation of one subscriber preserves other',async()=>{
 const flight=new SingleFlight(), gate=deferred();let calls=0,shared;
 const work=signal=>{calls++;shared=signal;return gate.promise;};const a=new AbortController();
 const first=flight.run('key',work,{signal:a.signal});const firstRejected=assert.rejects(first,{name:'AbortError'});const second=flight.run('key',work);
 await tick();a.abort();await firstRejected;assert.equal(shared.aborted,false);gate.resolve({ok:true});assert.deepEqual(await second,{ok:true});assert.equal(calls,1);
});
test('last cancelled subscriber aborts work; a replacement creates fresh flight',async()=>{
 const flight=new SingleFlight(), gate=deferred();const a=new AbortController();let shared;
 const first=flight.run('key',signal=>{shared=signal;return gate.promise;},{signal:a.signal});const rejection=assert.rejects(first,{name:'AbortError'});
 await tick();a.abort();await rejection;assert.equal(shared.aborted,true);assert.deepEqual(await flight.run('key',async()=>({fresh:true})),{fresh:true});gate.resolve({old:true});
});
test('pipeline coalesces concurrent calls and independent cancellation',async()=>{
 const gate=deferred();let calls=0;const {pipeline}=setup({ocr:async()=>{calls++;await gate.promise;return {regions:[region]};}});const a=new AbortController();
 const first=pipeline.run(input(),{signal:a.signal});const rejection=assert.rejects(first,{name:'AbortError'});const second=pipeline.run(input());await until(()=>calls===1);await tick();a.abort();await rejection;gate.resolve();await second;assert.equal(calls,1);
});
test('all subscribers cancelled cannot cache late adapter output',async()=>{
 const gate=deferred();let signal;const {pipeline}=setup({ocr:async args=>{signal=args.signal;await gate.promise;return {regions:[region]};}});const a=new AbortController();
 const first=pipeline.run(input(),{signal:a.signal});const rejection=assert.rejects(first,{name:'AbortError'});await until(()=>signal);a.abort();await rejection;assert.equal(signal.aborted,true);gate.resolve();await tick();assert.equal(pipeline.diagnostics().ocrEntries,0);
});
test('clear fences both stages of old in-flight pipeline',async()=>{
 const gate=deferred();let started=false;const {pipeline}=setup({ocr:async()=>{started=true;await gate.promise;return {regions:[region]};}});
 const pending=pipeline.run(input());await until(()=>started);pipeline.clear();gate.resolve();await pending;
 assert.equal(pipeline.diagnostics().ocrEntries,0);assert.equal(pipeline.diagnostics().translationEntries,0);
 await pipeline.run(input());assert.equal(pipeline.diagnostics().ocrEntries,1);assert.equal(pipeline.diagnostics().translationEntries,1);
});
test('clear during translation does not repopulate translation cache',async()=>{
 const gate=deferred();let started=false;const {pipeline}=setup({translate:async()=>{started=true;await gate.promise;return {translations:[{regionId:'r1',text:'x'}]};}});
 const pending=pipeline.run(input());await until(()=>started);pipeline.clear();gate.resolve();await pending;assert.equal(pipeline.diagnostics().translationEntries,0);
});
test('cache TTL LRU byte bounds and generation fence',()=>{
 let time=0;const cache=new BoundedCache({maxEntries:2,maxBytes:100,ttlMs:10,now:()=>time});cache.set('a',1);cache.set('b',2);assert.equal(cache.get('a'),1);cache.set('c',3);assert.equal(cache.get('b'),undefined);assert.equal(cache.set('huge','x'.repeat(200)),false);time=10;assert.equal(cache.size,0);
 const generation=cache.generation;cache.clear();assert.equal(cache.set('late',true,generation),false);
});
test('queue bounds active and queued jobs, removes cancelled queued item',async()=>{
 const queue=new BoundedQueue({concurrency:1,maxQueue:1}),gate=deferred();const first=queue.run(()=>gate.promise);const a=new AbortController();const second=queue.run(async()=>2,{signal:a.signal});const rejection=assert.rejects(second,{name:'AbortError'});
 await assert.rejects(queue.run(async()=>3),{name:'QueueFullError'});assert.equal(queue.active,1);assert.equal(queue.pending.length,1);a.abort();await rejection;assert.equal(queue.pending.length,0);gate.resolve(1);assert.equal(await first,1);await tick();assert.equal(queue.active,0);
});
test('canonical encoding rejects sparse arrays instead of colliding with empty arrays',()=>{
 assert.throws(()=>canonicalize(new Array(1)),/JSON/);
});
test('single flight preserves even falsy rejection reasons',async()=>{
 const flight=new SingleFlight();let caught=false;
 await flight.run('falsy',async()=>{throw null;}).catch(error=>{caught=true;assert.equal(error,null);});assert.equal(caught,true);
});
test('diagnostics count actual lookups, misses and coalesced subscribers separately',async()=>{
 const ocrGate=deferred(),translationGate=deferred();let ocrStarted=0,translationStarted=0;
 const {pipeline}=setup({ocr:async()=>{ocrStarted++;await ocrGate.promise;return {regions:[region]};},translate:async()=>{translationStarted++;await translationGate.promise;return {translations:[{regionId:'r1',text:'x'}]};}});
 const first=pipeline.run(input()),second=pipeline.run(input());
 await until(()=>pipeline.diagnostics().ocrCoalesced===1);ocrGate.resolve();
 await until(()=>pipeline.diagnostics().translationCoalesced===1);translationGate.resolve();await Promise.all([first,second]);await pipeline.run(input());
 const d=pipeline.diagnostics();
 for(const kind of ['ocr','translation']){
   assert.equal(d[kind+'Lookups'],3);assert.equal(d[kind+'Hits'],1);assert.equal(d[kind+'Misses'],2);assert.equal(d[kind+'Coalesced'],1);assert.equal(d[kind+'Calls'],1);
   assert.equal(d[kind+'Lookups'],d[kind+'Hits']+d[kind+'Misses']);
 }
 assert.equal(ocrStarted,1);assert.equal(translationStarted,1);
 pipeline.clear();const after=pipeline.diagnostics();assert.equal(after.ocrLookups,3);assert.equal(after.ocrEntries,0);
});
test('requests after clear never join a previous generation flight',async()=>{
 const gate=deferred();let calls=0;
 const {pipeline}=setup({ocrConcurrency:2,ocr:async()=>{calls++;if(calls===1)await gate.promise;return {regions:[region]};}});
 const old=pipeline.run(input());await until(()=>calls===1);pipeline.clear();await pipeline.run(input());assert.equal(calls,2);gate.resolve();await old;
 assert.equal(pipeline.diagnostics().ocrCoalesced,0);assert.equal(pipeline.diagnostics().ocrEntries,1);
});
test('cancelling every coalesced subscriber aborts once and caches nothing',async()=>{
 const gate=deferred();let sharedSignal,abortEvents=0;
 const {pipeline}=setup({ocr:async({signal})=>{sharedSignal=signal;signal.addEventListener('abort',()=>abortEvents++);await gate.promise;return {regions:[region]};}});
 const a=new AbortController(),b=new AbortController();
 const first=pipeline.run(input(),{signal:a.signal}),second=pipeline.run(input(),{signal:b.signal});
 const failures=[assert.rejects(first,{name:'AbortError'}),assert.rejects(second,{name:'AbortError'})];
 await until(()=>pipeline.diagnostics().ocrCoalesced===1);a.abort();assert.equal(sharedSignal.aborted,false);b.abort();await Promise.all(failures);assert.equal(abortEvents,1);
 gate.resolve();await tick();assert.equal(pipeline.diagnostics().ocrEntries,0);assert.equal(pipeline.diagnostics().translationCalls,0);
});
test('run snapshots caller bytes and configuration before asynchronous hashing',async()=>{
 const {pipeline,calls}=setup();const request=input();const pending=pipeline.run(request);
 request.imageBytes[0]=99;request.translation.context='mutated';request.ocrConfig.revision=100;
 const first=await pending,second=await pipeline.run(input());assert.equal(first.ocrKey,second.ocrKey);assert.equal(first.translationKey,second.translationKey);assert.deepEqual(calls,{ocr:1,translate:1});
});
