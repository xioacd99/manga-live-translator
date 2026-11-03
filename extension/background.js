import {validateImageRequest, publicHttpUrl, readBoundedImage, toBase64, safeError} from './security.js';
let creating; let mutations=Promise.resolve(); let generation=0; const fetches=new Map();
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
async function settings(){return (await chrome.storage.session.get('settings')).settings;}
async function getGrant(tabId){return (await chrome.storage.session.get(`tab:${tabId}`))[`tab:${tabId}`];}
async function handle(message,sender) {
  await storageReady;
  if(!message||typeof message!=='object')throw new Error('Invalid message.');
  if(message.type.startsWith('MLT_UI_')) {
    if(!trustedUi(sender))throw new Error('Trusted extension UI required.');
    if(message.type==='MLT_UI_CONFIGURE') {
      const s=message.settings;
      if(!s||s.consent!==true||typeof s.apiKey!=='string'||s.apiKey.length<10||s.apiKey.length>512||typeof s.model!=='string'||!/^[\w.:-]{1,100}$/.test(s.model)||typeof s.targetLanguage!=='string'||s.targetLanguage.length>80)throw new Error('Check the settings and consent checkbox.');
      const old=await settings();
      invalidate();
      const config={apiKey:s.apiKey,model:s.model,targetLanguage:s.targetLanguage||'Simplified Chinese',sourceLanguage:'English',accountNamespace:old?.apiKey===s.apiKey?old.accountNamespace:crypto.randomUUID(),context:typeof s.context==='string'?s.context.slice(0,4000):'',glossary:typeof s.glossary==='string'?s.glossary.slice(0,4000):'',consent:true};
      await callExecutor({type:'CONFIGURE',settings:config});
      await chrome.storage.session.set({settings:config});
      return {ok:true};
    }
    if(message.type==='MLT_UI_STATUS') {
      const s=await settings(); return {ok:true,configured:!!s,model:s?.model||'',targetLanguage:s?.targetLanguage||'Simplified Chinese'};
    }
    if(message.type==='MLT_UI_CLEAR') {invalidate();await callExecutor({type:'CLEAR'});return {ok:true};}
    if(message.type==='MLT_UI_FORGET') {invalidate();await chrome.storage.session.clear();await callExecutor({type:'FORGET'});return {ok:true};}
    if(message.type==='MLT_UI_ENABLE') {
      const s=await settings(); if(!s)throw new Error('Configure the provider first.');
      const tab=await chrome.tabs.get(message.tabId); if(tab.incognito)throw new Error('Incognito is not supported.');
      const origin=publicHttpUrl(tab.url).origin;
      const imageOrigins=[origin,...(message.imageOrigins||[]).map(v=>publicHttpUrl(v).origin)];
      if(imageOrigins.length>6)throw new Error('Enable at most five additional image hosts.');
      for(const host of [...imageOrigins,'https://api.openai.com'])if(!await chrome.permissions.contains({origins:[`${host}/*`]}))throw new Error('Grant the requested host permissions first.');
      await chrome.storage.session.set({[`tab:${tab.id}`]:{origin,imageOrigins:[...new Set(imageOrigins)]}});
      await callExecutor({type:'ENSURE_CONFIG',settings:s});
      await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});
      await chrome.tabs.sendMessage(tab.id,{type:'MLT_ENABLE',auto:message.auto===true});return {ok:true};
    }
    if(message.type==='MLT_UI_DISABLE') {
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
  if(message.type==='MLT_CANCEL') {fetches.get(id)?.controller.abort();await callExecutor({type:'CANCEL',id});return {ok:true};}
  if(message.type!=='MLT_TRANSLATE')throw new Error('Unknown operation.');
  const grant=await getGrant(sender.tab.id); const image=validateImageRequest(message,sender,grant);
  if(fetches.has(id)||fetches.size>=16)throw new Error('Request queue is full.');
  const startedGeneration=generation; const controller=new AbortController(); fetches.set(id,{controller,tabId:sender.tab.id});
  const timer=setTimeout(()=>controller.abort(),120000);
  try {
    const config=await settings();if(!config)throw new Error('Provider is not configured.');
    if(!await chrome.permissions.contains({origins:[`${image.origin}/*`,'https://api.openai.com/*']}))throw new Error('Permission was revoked.');
    const response=await fetch(image.href,{credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal,cache:'no-cache'});
    const {bytes,mime}=await readBoundedImage(response,controller.signal); controller.signal.throwIfAborted();
    if(startedGeneration!==generation)throw new DOMException('Session changed','AbortError');
    await callExecutor({type:'ENSURE_CONFIG',settings:config},{signal:controller.signal,expectedGeneration:startedGeneration}); controller.signal.throwIfAborted();
    const abort=()=>{chrome.runtime.sendMessage({target:'executor',type:'CANCEL',id}).catch(()=>{});};controller.signal.addEventListener('abort',abort,{once:true});
    try { return await callExecutor({type:'RUN',id,tabId:sender.tab.id,imageBase64:toBase64(bytes),mime,namespace:grant.origin,corrections:message.corrections},{signal:controller.signal,expectedGeneration:startedGeneration}); }
    finally {controller.signal.removeEventListener('abort',abort);}
  } finally {clearTimeout(timer);fetches.delete(id);}
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(message?.target==='executor')return;
  if(typeof message?.type!=='string'||!message.type.startsWith('MLT_'))return;
  const operation=message.type.startsWith('MLT_UI_')?mutate(()=>handle(message,sender)):handle(message,sender);
  operation.then(reply,error=>reply({ok:false,error:safeError(error)}));return true;
});
chrome.tabs.onRemoved.addListener(tabId=>{chrome.storage.session.remove(`tab:${tabId}`);for(const entry of fetches.values())if(entry.tabId===tabId)entry.controller.abort();chrome.runtime.sendMessage({target:'executor',type:'CANCEL_TAB',tabId}).catch(()=>{});});
chrome.permissions.onRemoved.addListener(()=>{invalidate();mutate(async()=>{await chrome.storage.session.remove('settings');await callExecutor({type:'FORGET'});}).catch(()=>{});});
