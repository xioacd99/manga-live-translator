import {validateImageRequest, publicHttpUrl, readBoundedImage, toBase64, safeError,validateTranslationSettings,validateLocalOcrSettings,LOCAL_OCR_ORIGIN_PERMISSION} from './security.js';
import {preparationSettings,reserveRequest} from './preparation-policy.js';
let creating; let mutations=Promise.resolve(); let generation=0; const fetches=new Map();
const tabFences=new Map();
function tabFence(tabId){if(!tabFences.has(tabId))tabFences.set(tabId,{cancelled:false});return tabFences.get(tabId);}
function cancelTab(tabId){const fence=tabFences.get(tabId);if(fence)fence.cancelled=true;tabFences.delete(tabId);for(const entry of fetches.values())if(entry.tabId===tabId)entry.controller.abort();}
function invalidate(){generation++;for(const entry of fetches.values())entry.controller.abort();}
const storageReady=chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
function mutate(work){const result=mutations.then(work);mutations=result.catch(()=>{});return result;}
async function executor() {
  if(await chrome.offscreen.hasDocument())return;
  if(!creating) creating=chrome.offscreen.createDocument({url:'offscreen.html',reasons:['WORKERS','BLOBS'],justification:'Run local OCR in a packaged worker and decode user-selected image blobs.'}).finally(()=>creating=null);
  await creating;
}
async function callExecutor(payload,{signal,expectedGeneration}={}) { await executor(); signal?.throwIfAborted(); if(expectedGeneration!==undefined&&expectedGeneration!==generation)throw new DOMException('Session changed','AbortError'); const r=await chrome.runtime.sendMessage({...payload,target:'executor'}); signal?.throwIfAborted(); if(expectedGeneration!==undefined&&expectedGeneration!==generation)throw new DOMException('Session changed','AbortError'); if(!r?.ok)throw new Error(r?.error?.message||'Executor unavailable.'); return r; }
function trustedUi(sender) { return sender.id===chrome.runtime.id && ['popup.html','options.html'].some(p=>sender.url===chrome.runtime.getURL(p)); }
async function pauseGrants(reset=true) {
  const stored=await chrome.storage.session.get(null);
  for(const [key,grant] of Object.entries(stored))if(key.startsWith('tab:')) {
    await chrome.storage.session.set({[key]:{...grant,paused:true}});
    await chrome.tabs.sendMessage(Number(key.slice(4)),{type:'MLT_PAUSE',reset,invalidate:!reset}).catch(()=>{});
  }
}
async function localSettings(){return (await chrome.storage.session.get('localSettings')).localSettings;}
const providerOrigin=s=>s?.provider==='openai'?'https://api.openai.com':'https://api.deepseek.com';
async function ensureExecutor(){const expectedGeneration=generation;const [remote,local]=await Promise.all([settings(),localSettings()]);return callExecutor({type:'ENSURE_CONFIG',settings:remote||null,localSettings:local||null},{expectedGeneration});}
async function settings(){return (await chrome.storage.session.get('settings')).settings;}
async function getGrant(tabId){return (await chrome.storage.session.get(`tab:${tabId}`))[`tab:${tabId}`];}
async function handle(message,sender) {
  await storageReady;
  if(!message||typeof message!=='object')throw new Error('Invalid message.');
  if(message.type.startsWith('MLT_UI_')) {
    if(!trustedUi(sender))throw new Error('Trusted extension UI required.');
    if(['MLT_UI_MODEL_STATUS','MLT_UI_MODEL_CANCEL','MLT_UI_MODEL_DOWNLOAD'].includes(message.type)){
      const expectedGeneration=generation;
      if(!await localSettings()){if(message.type==='MLT_UI_MODEL_STATUS')return {ok:true,model:{phase:'idle',loaded:0,total:null}};throw new Error('请先配置本地 OCR 服务。');}
      if(!await chrome.permissions.contains({origins:[LOCAL_OCR_ORIGIN_PERMISSION]}))throw new Error('请授予本地服务权限。');
      await ensureExecutor();return callExecutor({type:message.type.replace('MLT_UI_','')},{expectedGeneration});
    }
    if(message.type==='MLT_UI_LOCAL_CONFIGURE'){
      const next=validateLocalOcrSettings(message.settings);
      if(!await chrome.permissions.contains({origins:[LOCAL_OCR_ORIGIN_PERMISSION]}))throw new Error('请授予本地服务权限。');
      invalidate();await pauseGrants();await chrome.storage.session.set({localSettings:next});await ensureExecutor();return {ok:true};
    }
    if(message.type==='MLT_UI_CONFIGURE') {
      const s=validateTranslationSettings(message.settings),old=await settings();
      if(!await chrome.permissions.contains({origins:[`${providerOrigin(s)}/*`]}))throw new Error('请授予翻译服务权限。');
      invalidate();await pauseGrants(!(old?.apiKey===s.apiKey&&old?.provider===s.provider));
      const config={...s,sourceLanguage:'English',accountNamespace:old?.apiKey===s.apiKey&&old?.provider===s.provider?old.accountNamespace:crypto.randomUUID()};
      await chrome.storage.session.set({settings:config});await ensureExecutor();return {ok:true};
    }
    if(message.type==='MLT_UI_STATUS') {
      const s=await settings(),l=await localSettings(); return {ok:true,configured:!!s,provider:s?.provider||'deepseek',model:s?.model||'',targetLanguage:s?.targetLanguage||'Simplified Chinese',context:s?.context||'',glossary:s?.glossary||'',localConfigured:!!l,localOcr:l?{endpoint:l.localOcr.endpoint,enabled:l.localOcr.enabled}:undefined,readingDirection:l?.readingDirection||'ltr'};
    }
    if(message.type==='MLT_UI_CLEAR') {invalidate();await pauseGrants();await callExecutor({type:'CLEAR'});return {ok:true};}
    if(message.type==='MLT_UI_FORGET') {invalidate();await pauseGrants();await chrome.storage.session.clear();await callExecutor({type:'FORGET'});return {ok:true};}
    if(message.type==='MLT_UI_ENABLE') {
      const s=await settings();const l=await localSettings();if(!l)throw new Error('请先配置 Python 本地 OCR 服务。'); const preparation=preparationSettings(message.settings);
      if(!s&&(message.auto===true||preparation.remotePrefetchEnabled))throw new Error('Configure the provider before remote translation.');
      {await ensureExecutor();const status=await callExecutor({type:'MODEL_STATUS'});if(status.model?.phase!=='ready')throw new Error('请先下载并准备本地 OCR 和气泡模型。');}
      const tab=await chrome.tabs.get(message.tabId); if(tab.incognito)throw new Error('Incognito is not supported.');
      const origin=publicHttpUrl(tab.url).origin;
      const imageOrigins=[origin,...(message.imageOrigins||[]).map(v=>publicHttpUrl(v).origin)];
      if(imageOrigins.length>6)throw new Error('Enable at most five additional image hosts.');
      for(const host of [...imageOrigins,...(s?[providerOrigin(s)]:[]),'http://127.0.0.1'])if(!await chrome.permissions.contains({origins:[`${host}/*`]}))throw new Error('Grant the requested host permissions first.');
      await chrome.storage.session.set({[`tab:${tab.id}`]:{origin,pageUrl:tab.url.split('#')[0],imageOrigins:[...new Set(imageOrigins)],preparation,prepareRemaining:preparation.prepareBudget,remoteRemaining:preparation.remotePrefetchBudget,auto:message.auto===true,paused:false}});
      await ensureExecutor();
      await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});
      await chrome.tabs.sendMessage(tab.id,{type:'MLT_ENABLE',auto:message.auto===true,settings:preparation});return {ok:true};
    }
    if(message.type==='MLT_UI_PAUSE') {
      cancelTab(message.tabId);
      const grant=await getGrant(message.tabId);if(grant)await chrome.storage.session.set({[`tab:${message.tabId}`]:{...grant,paused:true}});
      await chrome.tabs.sendMessage(message.tabId,{type:'MLT_PAUSE'}).catch(()=>{});
      for(const entry of fetches.values())if(entry.tabId===message.tabId)entry.controller.abort();
      await callExecutor({type:'CANCEL_TAB',tabId:message.tabId});return {ok:true};
    }
    if(message.type==='MLT_UI_DISABLE') {
      cancelTab(message.tabId);
      await chrome.storage.session.remove(`tab:${message.tabId}`);
      await chrome.tabs.sendMessage(message.tabId,{type:'MLT_DISABLE'}).catch(()=>{});
      for(const [id,entry] of fetches)if(entry.tabId===message.tabId){entry.controller.abort();fetches.delete(id);}
      await callExecutor({type:'CANCEL_TAB',tabId:message.tabId}); return {ok:true};
    }
    if(message.type==='MLT_UI_METRICS')return callExecutor({type:'METRICS'});
    throw new Error('Unknown UI operation.');
  }
  if(sender.id!==chrome.runtime.id||!sender.tab||sender.frameId!==0)throw new Error('Invalid sender.');
  const id=`${sender.tab.id}:${message.requestId}`;
  if(message.type==='MLT_PAUSE_PAGE') {
    await mutate(async()=>{const grant=await getGrant(sender.tab.id);if(grant?.pageUrl!==sender.url.split('#')[0])throw new Error('Stale page pause.');cancelTab(sender.tab.id);if(grant)await chrome.storage.session.set({[`tab:${sender.tab.id}`]:{...grant,paused:true}});});
    for(const entry of fetches.values())if(entry.tabId===sender.tab.id)entry.controller.abort();
    await callExecutor({type:'CANCEL_TAB',tabId:sender.tab.id});return {ok:true};
  }
  if(message.type==='MLT_CANCEL') {fetches.get(id)?.controller.abort();await callExecutor({type:'CANCEL',id});return {ok:true};}
  if(!['MLT_TRANSLATE','MLT_PREPARE'].includes(message.type))throw new Error('Unknown operation.');
  const startedGeneration=generation; const fence=tabFence(sender.tab.id);
  const grant=await mutate(async()=>{
    if(startedGeneration!==generation||fence.cancelled)throw new DOMException('Session changed','AbortError');
    const current=await getGrant(sender.tab.id);validateImageRequest(message,sender,current);
    if(current.pageUrl && (sender.url.split('#')[0]!==current.pageUrl || sender.tab.url.split('#')[0]!==current.pageUrl))throw new Error('Page changed; enable it again.');
    const next=reserveRequest(current,message);await chrome.storage.session.set({[`tab:${sender.tab.id}`]:next});return next;
  });
  if(startedGeneration!==generation||fence.cancelled)throw new DOMException('Session changed','AbortError');
  const image=validateImageRequest(message,sender,grant); const localOnly=message.type==='MLT_PREPARE';
  if(fetches.has(id)||fetches.size>=16)throw new Error('Request queue is full.');
  const controller=new AbortController(); fetches.set(id,{controller,tabId:sender.tab.id});
  const timer=setTimeout(()=>controller.abort(),120000);
  try {
    const config=await settings();if(!localOnly&&!config)throw new Error('Provider is not configured.');
    if(!await chrome.permissions.contains({origins:[`${image.origin}/*`,'http://127.0.0.1/*',...(localOnly?[]:[`${providerOrigin(config)}/*`])]}))throw new Error('Permission was revoked.');
    const response=await fetch(image.href,{credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal,cache:'no-cache'});
    const {bytes,mime}=await readBoundedImage(response,controller.signal); controller.signal.throwIfAborted();
    if(startedGeneration!==generation||fence.cancelled)throw new DOMException('Session changed','AbortError');
    await callExecutor({type:'ENSURE_CONFIG',settings:config||null,localSettings:await localSettings()||null},{signal:controller.signal,expectedGeneration:startedGeneration}); controller.signal.throwIfAborted();
    const abort=()=>{chrome.runtime.sendMessage({target:'executor',type:'CANCEL',id}).catch(()=>{});};controller.signal.addEventListener('abort',abort,{once:true});
    try { return await callExecutor({type:localOnly?'PREPARE':'RUN',detectorMode:grant.preparation.detectorMode,id,tabId:sender.tab.id,imageBase64:toBase64(bytes),mime,namespace:grant.origin,corrections:message.corrections},{signal:controller.signal,expectedGeneration:startedGeneration}); }
    finally {controller.signal.removeEventListener('abort',abort);}
  } finally {clearTimeout(timer);if(fetches.get(id)?.controller===controller)fetches.delete(id);}
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(message?.target==='executor')return;
  if(typeof message?.type!=='string'||!message.type.startsWith('MLT_'))return;
  const readOnly=['MLT_UI_STATUS','MLT_UI_MODEL_STATUS','MLT_UI_METRICS'].includes(message.type);
  const operation=message.type.startsWith('MLT_UI_')&&!readOnly?mutate(()=>handle(message,sender)):handle(message,sender);
  operation.then(reply,error=>reply({ok:false,error:safeError(error)}));return true;
});
chrome.tabs.onRemoved.addListener(tabId=>{cancelTab(tabId);mutate(async()=>{await chrome.storage.session.remove(`tab:${tabId}`);cancelTab(tabId);await callExecutor({type:'CANCEL_TAB',tabId});}).catch(()=>{});});
chrome.permissions.onRemoved.addListener(()=>{invalidate();mutate(async()=>{await pauseGrants();await chrome.storage.session.remove(['settings','localSettings']);await callExecutor({type:'FORGET'});}).catch(()=>{});});

// 同源页面导航也使旧授权失效，不能把站点授权当作每个新章节的预处理同意。
chrome.tabs.onUpdated?.addListener((tabId,change)=>{if(!change.url)return;cancelTab(tabId);mutate(async()=>{const grant=await getGrant(tabId);if(grant&&change.url.split('#')[0]!==grant.pageUrl){await chrome.storage.session.remove(`tab:${tabId}`);for(const entry of fetches.values())if(entry.tabId===tabId)entry.controller.abort();await callExecutor({type:'CANCEL_TAB',tabId});}}).catch(()=>{});});
