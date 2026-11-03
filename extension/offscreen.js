import {createPipeline,BoundedQueue} from '../packages/core/index.js';
import * as ort from 'onnxruntime-web/wasm';
import {createPretrainedRegionDetector,PRETRAINED_DETECTOR_REVISION} from './adapters/pretrained-regions.js';
import {createModelStore} from './model-store.js';
import {createOcrAdapter} from './adapters/ocr.js';
import {createOpenAiAdapter,OPENAI_ENDPOINT,PROMPT_VERSION,SCHEMA_VERSION} from './adapters/openai.js';
import {MAX_IMAGE_BYTES,MAX_PIXELS,safeError} from './security.js';
import {inspectImage} from './image-dimensions.js';
const decodes=new BoundedQueue({concurrency:1,maxQueue:15});
const detection=new BoundedQueue({concurrency:1,maxQueue:15});
const recognition=new BoundedQueue({concurrency:1,maxQueue:15});
let config=null; let pipeline=null; const jobs=new Map();
const makeOcr=()=>createOcrAdapter({workerPath:chrome.runtime.getURL('vendor/worker.min.js'),corePath:chrome.runtime.getURL('vendor/core'),langPath:chrome.runtime.getURL('vendor/lang')});
let ocr=makeOcr();
const modelStore=createModelStore();
let modelState={phase:'idle',loaded:0,total:null};let modelTask=null,modelController=null,modelChecked=false,modelDownloadPending=false;
const makeDetector=()=>createPretrainedRegionDetector({ort,wasmPaths:chrome.runtime.getURL('vendor/ort/'),loadModel:({signal}={})=>modelStore.get({downloadAllowed:false,signal})});
let detector=makeDetector();
function modelProgress(value){modelState={...value};}
function beginModel(downloadAllowed=false){
  if(modelTask){if(downloadAllowed)modelDownloadPending=true;return;}
  modelChecked=true;modelController=new AbortController();const controller=modelController;
  modelTask=(async()=>{
    try {
      await modelStore.get({downloadAllowed,signal:controller.signal,onProgress:modelProgress});
      controller.signal.throwIfAborted();modelState={phase:'loading',loaded:11120765,total:11120765};
      await detection.run(()=>detector.load({signal:controller.signal}),{signal:controller.signal});controller.signal.throwIfAborted();
      modelState={phase:'ready',loaded:11120765,total:11120765};
    } catch(error) {
      modelState={phase:controller.signal.aborted?'cancelled':error.code==='MODEL_DOWNLOAD_REQUIRED'?'idle':'error',loaded:0,total:null,error:controller.signal.aborted?'已取消。重新下载时从头开始，完整已验证缓存仍可复用。':error.code==='MODEL_DOWNLOAD_REQUIRED'?undefined:'模型准备失败，请检查网络、存储空间或重试。'};
    } finally {if(modelController===controller){modelTask=null;modelController=null;if(modelDownloadPending){modelDownloadPending=false;beginModel(true);}}}
  })();
}

function reset(next) {
  for(const job of jobs.values())job.controller.abort(); jobs.clear();
  if(config&&next&&config.accountNamespace===next.accountNamespace){config=next;return;}
  pipeline?.clear();config=next; pipeline=createPipeline({detect:input=>detection.run(()=>detector.detect(input),{signal:input.signal}),ocr:input=>recognition.run(()=>ocr.recognize(input),{signal:input.signal}),translate:next?createOpenAiAdapter({apiKey:next.apiKey}):async()=>{throw new Error('Provider is not configured.');},cacheOptions:{maxEntries:128,maxBytes:8*1024*1024,ttlMs:30*60*1000}});
}
async function handle(m) {
  if(m.type==='MODEL_STATUS'){if(!modelChecked)beginModel(false);return {ok:true,model:modelState};}
  if(m.type==='MODEL_DOWNLOAD'){beginModel(true);return {ok:true,model:modelState};}
  if(m.type==='MODEL_CANCEL'){modelDownloadPending=false;modelController?.abort();if(modelTask)modelState={...modelState,phase:'cancelling'};return {ok:true,model:modelState};}

  if(m.type==='CONFIGURE'){reset(m.settings);return {ok:true};}
  if(m.type==='ENSURE_CONFIG'){if(!pipeline||config?.accountNamespace!==m.settings?.accountNamespace)reset(m.settings);else config=m.settings;return {ok:true};}
  if(m.type==='FORGET'){modelDownloadPending=false;modelController?.abort();reset(null);await ocr.dispose();ocr=makeOcr();return {ok:true};}
  if(m.type==='CLEAR'){for(const job of jobs.values())job.controller.abort();pipeline?.clear();return {ok:true};}
  if(m.type==='CANCEL'){jobs.get(m.id)?.controller.abort();return {ok:true};}
  if(m.type==='CANCEL_TAB'){for(const job of jobs.values())if(job.tabId===m.tabId)job.controller.abort();return {ok:true};}
  if(m.type==='METRICS')return {ok:true,metrics:pipeline?.diagnostics()||{}};
  if(!['RUN','PREPARE'].includes(m.type)||!pipeline||(m.type==='RUN'&&!config))throw new Error('Configure translation first.');
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
    const localOnly=m.type==='PREPARE';
    const result=await active[localOnly?'prepare':'run']({imageBytes:bytes,width,height,namespace:m.namespace,ocrConfig:{engine:'tesseract.js-6.0.1',language:'eng',model:'4.0.0_best_int',preprocessing:'original-v1',regionMode:m.detectorMode==='whole-image'?'whole-image':'regions-only'},detectionConfig:m.detectorMode==='whole-image'?undefined:{detectorRevision:PRETRAINED_DETECTOR_REVISION,algorithm:'pretrained-comic-rtdetr-wasm',cropRevision:'original-rectangle-v1'},sourceEdits:m.corrections||{},translation:localOnly?undefined:{sourceLanguage:'English',targetLanguage:current.targetLanguage,provider:'openai',endpoint:OPENAI_ENDPOINT,accountNamespace:current.accountNamespace,model:current.model,modelRevision:'configured-alias',promptVersion:PROMPT_VERSION,schemaVersion:SCHEMA_VERSION,context:current.context||'',glossary:current.glossary||'',style:'Natural faithful manga dialogue',generation:{max_completion_tokens:4096}}},{signal:controller.signal});
    controller.signal.throwIfAborted();
    const byId=new Map((result.translations||[]).map(r=>[r.regionId,r.text]));
    return {ok:true,prepared:localOnly,result:{width,height,prepared:localOnly,detection:result.detection,regions:result.regions.map(r=>({id:r.regionId,text:r.sourceText,translation:byId.get(r.regionId)||'',box:r.bbox,confidence:r.confidence}))},metrics:{...active.diagnostics(),durationMs:Math.round(performance.now()-started)}};
  } finally {bitmap?.close();if(jobs.get(m.id)===job)jobs.delete(m.id);}
}
chrome.runtime.onMessage.addListener((m,sender,reply)=>{
  if(m?.target!=='executor'||sender.id!==chrome.runtime.id||sender.tab||sender.url && sender.url!==chrome.runtime.getURL('background.js'))return;
  handle(m).then(reply,error=>reply({ok:false,error:safeError(error)}));return true;
});
