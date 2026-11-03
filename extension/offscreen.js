import {createPipeline,BoundedQueue} from '../packages/core/index.js';
import {createOcrAdapter} from './adapters/ocr.js';
import {createOpenAiAdapter,OPENAI_ENDPOINT,PROMPT_VERSION,SCHEMA_VERSION} from './adapters/openai.js';
import {MAX_IMAGE_BYTES,MAX_PIXELS,safeError} from './security.js';
import {inspectImage} from './image-dimensions.js';
const decodes=new BoundedQueue({concurrency:1,maxQueue:15});
const recognition=new BoundedQueue({concurrency:1,maxQueue:15});
let config=null; let pipeline=null; const jobs=new Map();
const makeOcr=()=>createOcrAdapter({workerPath:chrome.runtime.getURL('vendor/worker.min.js'),corePath:chrome.runtime.getURL('vendor/core'),langPath:chrome.runtime.getURL('vendor/lang')});
let ocr=makeOcr();
function reset(next) {
  for(const job of jobs.values())job.controller.abort(); jobs.clear();
  if(config&&next&&config.accountNamespace===next.accountNamespace){config=next;return;}
  pipeline?.clear();config=next; pipeline=next?createPipeline({ocr:input=>recognition.run(()=>ocr.recognize(input),{signal:input.signal}),translate:createOpenAiAdapter({apiKey:next.apiKey}),cacheOptions:{maxEntries:128,maxBytes:8*1024*1024,ttlMs:30*60*1000}}):null;
}
async function handle(m) {
  if(m.type==='CONFIGURE'){reset(m.settings);return {ok:true};}
  if(m.type==='ENSURE_CONFIG'){if(config?.accountNamespace!==m.settings.accountNamespace)reset(m.settings);else config=m.settings;return {ok:true};}
  if(m.type==='FORGET'){reset(null);await ocr.dispose();ocr=makeOcr();return {ok:true};}
  if(m.type==='CLEAR'){for(const job of jobs.values())job.controller.abort();pipeline?.clear();return {ok:true};}
  if(m.type==='CANCEL'){jobs.get(m.id)?.controller.abort();return {ok:true};}
  if(m.type==='CANCEL_TAB'){for(const job of jobs.values())if(job.tabId===m.tabId)job.controller.abort();return {ok:true};}
  if(m.type==='METRICS')return {ok:true,metrics:pipeline?.diagnostics()||{}};
  if(m.type!=='RUN'||!pipeline||!config)throw new Error('Configure translation first.');
  if(jobs.size>=16||jobs.has(m.id)||typeof m.imageBase64!=='string'||m.imageBase64.length>Math.ceil(MAX_IMAGE_BYTES*4/3)+4)throw new Error('Image queue or size limit.');
  const controller=new AbortController(); const job={controller,tabId:m.tabId};jobs.set(m.id,job);
  const active=pipeline;const current=config;let bitmap;
  try {
    const bytes=Uint8Array.from(atob(m.imageBase64),c=>c.charCodeAt(0));
    const declared=inspectImage(bytes,m.mime);
    const {width,height}=await decodes.run(async()=>{
      controller.signal.throwIfAborted();
      const decoded=await createImageBitmap(new Blob([bytes],{type:m.mime}));
      try {
        controller.signal.throwIfAborted();
        if(decoded.width!==declared.width||decoded.height!==declared.height||decoded.width*decoded.height>MAX_PIXELS)throw new Error('Decoded dimensions differ from validated header.');
        return {width:decoded.width,height:decoded.height};
      } finally {decoded.close();}
    },{signal:controller.signal});
    const started=performance.now();
    const result=await active.run({imageBytes:bytes,width,height,namespace:m.namespace,ocrConfig:{engine:'tesseract.js-6.0.1',language:'eng',model:'4.0.0_best_int',preprocessing:'original-v1'},sourceEdits:m.corrections||{},translation:{sourceLanguage:'English',targetLanguage:current.targetLanguage,provider:'openai',endpoint:OPENAI_ENDPOINT,accountNamespace:current.accountNamespace,model:current.model,modelRevision:'configured-alias',promptVersion:PROMPT_VERSION,schemaVersion:SCHEMA_VERSION,context:current.context||'',glossary:current.glossary||'',style:'Natural faithful manga dialogue',generation:{max_completion_tokens:4096}}},{signal:controller.signal});
    controller.signal.throwIfAborted();
    const byId=new Map(result.translations.map(r=>[r.regionId,r.text]));
    return {ok:true,result:{width,height,regions:result.regions.map(r=>({id:r.regionId,text:r.sourceText,translation:byId.get(r.regionId),box:r.bbox,confidence:r.confidence}))},metrics:{...active.diagnostics(),durationMs:Math.round(performance.now()-started)}};
  } finally {bitmap?.close();if(jobs.get(m.id)===job)jobs.delete(m.id);}
}
chrome.runtime.onMessage.addListener((m,sender,reply)=>{
  if(m?.target!=='executor'||sender.id!==chrome.runtime.id||sender.tab||sender.url && sender.url!==chrome.runtime.getURL('background.js'))return;
  handle(m).then(reply,error=>reply({ok:false,error:safeError(error)}));return true;
});
