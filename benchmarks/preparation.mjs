import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {createPipeline} from '../packages/core/index.js';
// 仅测调度和缓存的可重复工作负载；固定延迟替身不代表真实模型或设备性能。
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const samples=12, readCount=8;
const input=i=>({imageBytes:new Uint8Array([i+1]),width:100,height:100,namespace:'synthetic-preparation',
 detectionConfig:{detectorRevision:'mock-v1'},ocrConfig:{revision:'mock-v1'},
 translation:{sourceLanguage:'en',targetLanguage:'zh',provider:'fixture',endpoint:'https://example.invalid',accountNamespace:'fixture',model:'mock'}});
const rows=[];
for(const mode of ['off','local','remote']) {
 const counts={detection:0,ocr:0,llm:0};const events=[];
 const pipeline=createPipeline({detect:async()=>{counts.detection++;await delay(2);return {detectorRevision:'mock-v1',regions:[]};},
 ocr:async ({imageBytes})=>{counts.ocr++;await delay(3);return {regions:[{regionId:'r1',sourceText:`Synthetic text ${imageBytes[0]}`,readingOrder:0,bbox:{x:1,y:1,width:20,height:10}}]};},
 translate:async r=>{counts.llm++;await delay(4);return {translations:r.regions.map(x=>({regionId:x.regionId,text:'模拟译文'}))};}});
 const start=performance.now();
 if(mode!=='off')for(let i=0;i<samples;i++)await pipeline[mode==='local'?'prepare':'run'](input(i));
 const preparedAt=performance.now(), before={...counts};
 for(let i=0;i<readCount;i++){const t=performance.now();await pipeline.run(input(i));events.push(performance.now()-t);}
 events.sort((a,b)=>a-b);const m=pipeline.diagnostics();
 if(mode==='local'){assert.equal(before.llm,0);assert.equal(counts.ocr,samples);}
 if(mode==='remote')assert.equal(counts.llm,samples);
 rows.push({mode,prepared:mode==='off'?0:samples,read:readCount,usefulPrepared:mode==='off'?0:readCount,
 usefulPrefetchRatio:mode==='off'?null:readCount/samples,unreadPrepared:mode==='off'?0:samples-readCount,
 preparationMs:preparedAt-start,readableWaitMs:{p50:events[3],p95:events[7]},totalWorkloadMs:performance.now()-start,
 adapterCalls:counts,extraLlmCallsComparedWithNoPreparation:counts.llm-readCount,cache:m,
 estimatedEncodedInputBytes:samples,memory:'Not a browser heap/decoded image measurement; stage caches bounded by default 8 MiB each',
 denominators:'stage Hits/Lookups; coalesced waits are separate. Useful prefetch=actually read prepared images/all prepared images.'});
}
console.log(JSON.stringify({generatedAt:new Date().toISOString(),conditions:{samples,readCount,network:'none',adapters:'fixed-delay synthetic',retries:0,percentile:'nearest rank',limits:'No real comic quality, paid API cost, M4 or browser memory conclusion.'},rows},null,2));
