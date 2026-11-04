import {createPipeline,BoundedQueue} from '../packages/core/index.js';
import {createLocalOcrAdapter,LOCAL_ADAPTER_REVISION} from './adapters/local-ocr.js';
import {createDeepSeekAdapter,DEEPSEEK_ENDPOINT,PROMPT_VERSION as DEEPSEEK_PROMPT,SCHEMA_VERSION as DEEPSEEK_SCHEMA} from './adapters/deepseek.js';
import {createOpenAiAdapter,OPENAI_ENDPOINT,PROMPT_VERSION,SCHEMA_VERSION} from './adapters/openai.js';
import {analyzeRegionBackground} from './content/typesetting.js';
import {MAX_IMAGE_BYTES,MAX_PIXELS,safeError} from './security.js';
import {inspectImage} from './image-dimensions.js';
const decodes=new BoundedQueue({concurrency:1,maxQueue:15});
const nativeJobs=new BoundedQueue({concurrency:1,maxQueue:15});
let config=null,local=null,pipeline=null,adapter=null;const jobs=new Map();
function reset(next,nextLocal){
  const changed=JSON.stringify([config,local])!==JSON.stringify([next,nextLocal]);
  if(!changed&&pipeline)return;
  for(const job of jobs.values())job.controller.abort();jobs.clear();
  const sameAdapters=pipeline&&(!config||config?.accountNamespace===next?.accountNamespace&&config?.provider===next?.provider)&&JSON.stringify(local?.localOcr)===JSON.stringify(nextLocal?.localOcr);
  config=next;local=nextLocal;if(sameAdapters)return;pipeline?.clear();adapter=local?.localOcr?.enabled?createLocalOcrAdapter(local.localOcr):null;
  const boundAdapter=adapter;
  pipeline=adapter?createPipeline({detect:input=>nativeJobs.run(()=>boundAdapter.detect(input),{signal:input.signal}),ocr:input=>nativeJobs.run(()=>boundAdapter.recognize(input),{signal:input.signal}),translate:(request,options)=>{const current=config;if(!current||current.accountNamespace!==request.accountNamespace)throw new Error('翻译账户已变更。');return (current.provider==='openai'?createOpenAiAdapter:createDeepSeekAdapter)({apiKey:current.apiKey})(request,options);},cacheOptions:{maxEntries:128,maxBytes:8*1024*1024,ttlMs:30*60*1000}}):null;
}
function modelState(value){
  const download=value.download||{};const raw=download.state||value.state;
  const phase=value.ready&&value.detectorReady?'ready':(['downloading','verifying','loading','cancelled','cancelling','error'].includes(raw)?raw:'idle');
  return {phase,loaded:download.bytesDownloaded||0,total:download.bytesTotal||null,revision:value.modelRevision||value.engineRevision,error:phase==='error'?'本地模型准备失败，请检查服务终端和磁盘空间。':undefined};
}
async function handle(m){
  if(['CONFIGURE','ENSURE_CONFIG'].includes(m.type)){reset(m.settings||null,m.localSettings||null);return {ok:true};}
  if(m.type==='FORGET'){reset(null,null);return {ok:true};}
  if(m.type==='CLEAR'){for(const job of jobs.values())job.controller.abort();pipeline?.clear();return {ok:true};}
  if(m.type==='CANCEL'){jobs.get(m.id)?.controller.abort();return {ok:true};}
  if(m.type==='CANCEL_TAB'){for(const job of jobs.values())if(job.tabId===m.tabId)job.controller.abort();return {ok:true};}
  if(m.type==='METRICS')return {ok:true,metrics:pipeline?.diagnostics()||{}};
  if(['MODEL_STATUS','MODEL_DOWNLOAD','MODEL_CANCEL'].includes(m.type)){
    if(!adapter)return {ok:true,model:{phase:'idle',loaded:0,total:null,error:'请先配置 Python 本地服务。'}};
    const result=await adapter[m.type==='MODEL_DOWNLOAD'?'download':m.type==='MODEL_CANCEL'?'cancel':'status']();return {ok:true,model:modelState(result)};
  }
  if(!['RUN','PREPARE'].includes(m.type)||!pipeline||(m.type==='RUN'&&!config))throw new Error('请先配置本地服务和所需翻译服务。');
  if(jobs.size>=16||jobs.has(m.id)||typeof m.imageBase64!=='string'||m.imageBase64.length>Math.ceil(MAX_IMAGE_BYTES*4/3)+4)throw new Error('图片队列或大小超过预算。');
  const controller=new AbortController();const job={controller,tabId:m.tabId};jobs.set(m.id,job);
  const active=pipeline,current=config,currentLocal=local,currentAdapter=adapter;
  try{
    const bytes=Uint8Array.from(atob(m.imageBase64),c=>c.charCodeAt(0));const declared=inspectImage(bytes,m.mime);
    const {width,height}=declared; if(width*height>MAX_PIXELS)throw new Error('图片尺寸超过预算。');
    const status=await currentAdapter.status({signal:controller.signal});if(!status.ready||(m.detectorMode!=='whole-image'&&!status.detectorReady)||typeof (status.modelRevision||status.engineRevision)!=='string')throw new Error('本地模型尚未就绪。');
    const started=performance.now(),localOnly=m.type==='PREPARE';
    const provider=current?.provider||'deepseek';
    const result=await active[localOnly?'prepare':'run']({imageBytes:bytes,width,height,namespace:m.namespace,
      ocrConfig:{engine:LOCAL_ADAPTER_REVISION,modelRevision:status.modelRevision||status.engineRevision,language:'English',preprocessing:'native-medium1536-v1',regionMode:'whole-image'},
      detectionConfig:m.detectorMode==='whole-image'?undefined:{detectorRevision:status.detectorRevision||status.modelRevision||status.engineRevision,algorithm:'native-rtdetr-bubble-rgb640-score05'},
      groupingConfig:{enabled:true,readingDirection:currentLocal.readingDirection||'ltr'},sourceEdits:m.corrections||{},
      translation:localOnly?undefined:{sourceLanguage:'English',targetLanguage:current.targetLanguage,provider,endpoint:provider==='openai'?OPENAI_ENDPOINT:DEEPSEEK_ENDPOINT,accountNamespace:current.accountNamespace,model:current.model,modelRevision:'configured-alias',promptVersion:provider==='openai'?PROMPT_VERSION:DEEPSEEK_PROMPT,schemaVersion:provider==='openai'?SCHEMA_VERSION:DEEPSEEK_SCHEMA,context:current.context||'',glossary:current.glossary||'',style:'Natural faithful manga dialogue',generation:{max_completion_tokens:4096}}},{signal:controller.signal});
    controller.signal.throwIfAborted();
    const renderings=await decodes.run(async()=>{
      const bitmap=await createImageBitmap(new Blob([bytes],{type:m.mime}));
      try{controller.signal.throwIfAborted();if(bitmap.width!==width||bitmap.height!==height)throw new Error('解码尺寸不符。');const canvas=new OffscreenCanvas(width,height);const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0);const pixels=ctx.getImageData(0,0,width,height);return result.regions.map(region=>analyzeRegionBackground(pixels,region));}finally{bitmap.close();}
    },{signal:controller.signal});
    controller.signal.throwIfAborted();
    const byId=new Map((result.translations||[]).map(r=>[r.regionId,r.text]));
    return {ok:true,prepared:localOnly,result:{width,height,prepared:localOnly,detection:result.detection,grouping:result.grouping,regions:result.regions.map((r,i)=>({id:r.regionId,text:r.sourceText,translation:byId.get(r.regionId)||'',box:r.bbox,confidence:r.confidence,lines:r.lines,lineIds:r.lineIds,bubbleId:r.bubbleId,bubbleBox:r.bubbleBox,rendering:renderings[i]}))},metrics:{...active.diagnostics(),durationMs:Math.round(performance.now()-started)}};
  }finally{if(jobs.get(m.id)===job)jobs.delete(m.id);}
}
chrome.runtime.onMessage.addListener((m,sender,reply)=>{if(m?.target!=='executor'||sender.id!==chrome.runtime.id||sender.tab||sender.url&&sender.url!==chrome.runtime.getURL('background.js'))return;handle(m).then(reply,error=>reply({ok:false,error:safeError(error)}));return true;});
