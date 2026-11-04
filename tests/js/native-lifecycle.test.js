import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {createNativeOcrLifecycle, LOCAL_OCR_NATIVE_HOST} from '../../extension/native-ocr.js';
import {createLocalOcrAdapter} from '../../extension/adapters/local-ocr.js';
import * as security from '../../extension/security.js';
import * as preparation from '../../extension/preparation-policy.js';

const source=(await readFile(new URL('../../extension/background.js',import.meta.url),'utf8')).replace(/^import[^\n]+\n/gm,'');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const managed={localOcr:{mode:'managed',enabled:true,consent:true},readingDirection:'rtl'};
const manual={localOcr:{endpoint:'http://127.0.0.1:8787',token:'synthetic-manual-token-123456789012345',enabled:true,consent:true},readingDirection:'ltr'};
const ready={type:'ready',endpoint:'http://127.0.0.1:45678',token:'synthetic-ephemeral-token-123456789012345'};
function event(){const listeners=new Set();return {addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn),emit:(...args)=>{for(const fn of [...listeners])fn(...args);}};}
function port(onPost=()=>{}){return {onMessage:event(),onDisconnect:event(),sent:[],closed:false,postMessage(value){if(this.closed)throw new Error('Port closed');this.sent.push(value);onPost(this,value);},disconnect(){this.closed=true;this.onDisconnect.emit();}};}
function harness({persisted={},session={},permission=true,autoReady=false,modelPhase='ready'}={}){
  const store=structuredClone(session),local=structuredClone(persisted),sent=[],ports=[],trace=[],scripts=[],tabMessages=[],accesses=[];
  const storage=target=>({setAccessLevel:async value=>{accesses.push({target:target===store?'session':'local',...value});},get:async key=>key===null?structuredClone(target):{[key]:structuredClone(target[key])},set:async values=>Object.assign(target,structuredClone(values)),remove:async keys=>{for(const key of Array.isArray(keys)?keys:[keys])delete target[key];},clear:async()=>{for(const key of Object.keys(target))delete target[key];}});
  let normalWindows=[{id:1,type:'normal'}];
  const onMessage=event(),onRemoved=event(),permissionRemoved=event();
  const chrome={
    runtime:{id:'test-extension',getURL:path=>`chrome-extension://test-extension/${path}`,onMessage,connectNative(name){trace.push('connect');assert.equal(name,LOCAL_OCR_NATIVE_HOST);const next=port((p,value)=>{trace.push(`native:${value.type}`);if(value.type==='start'&&autoReady)queueMicrotask(()=>p.onMessage.emit({...ready,token:ready.token+ports.length}));});ports.push(next);return next;},sendMessage:async message=>{sent.push(message);trace.push(message.type);return {ok:true,...(message.type==='MODEL_STATUS'?{model:{phase:modelPhase}}:{})};}},
    storage:{session:storage(store),local:storage(local)},
    windows:{getAll:async()=>structuredClone(normalWindows),onRemoved,onCreated:event()},
    offscreen:{hasDocument:async()=>true,createDocument:async()=>{}},
    tabs:{get:async id=>({id,url:'https://reader.example.com/chapter',incognito:false}),sendMessage:async(...args)=>tabMessages.push(args),onRemoved:event(),onUpdated:event()},
    permissions:{contains:async()=>permission,onRemoved:permissionRemoved},
    scripting:{executeScript:async args=>scripts.push(args)},
  };
  vm.runInNewContext(source,{...security,...preparation,createNativeOcrLifecycle,chrome,crypto:webcrypto,structuredClone,URL,DOMException,AbortController,setTimeout,clearTimeout,btoa,console});
  const ui={id:chrome.runtime.id,url:chrome.runtime.getURL('options.html')};
  const send=(message,sender=ui)=>new Promise(resolve=>onMessage.emit(message,sender,resolve));
  return {chrome,store,local,sent,ports,trace,scripts,tabMessages,accesses,send,async configure(value=managed){const result=await send({type:'MLT_UI_LOCAL_CONFIGURE',settings:value});assert.equal(result.ok,true);},enable:()=>send({type:'MLT_UI_ENABLE',tabId:1}),revoke(){permission=false;permissionRemoved.emit({permissions:['nativeMessaging']});},closeWindows(windows=[]){normalWindows=windows;onRemoved.emit(1);},setWindows(windows){normalWindows=windows;},setPermission(value){permission=value;}};
}

test('原生端口并发启动复用一次握手，停止同时发送 stop 与断开，迟到 ready 不复活',async()=>{
  const p=port();let count=0;
  const lifecycle=createNativeOcrLifecycle({runtime:{connectNative:name=>{assert.equal(name,LOCAL_OCR_NATIVE_HOST);count++;return p;}}});
  const first=lifecycle.start(),second=lifecycle.start();assert.equal(first,second);assert.equal(count,1);
  p.onMessage.emit(ready);assert.deepEqual(await first,{endpoint:ready.endpoint,token:ready.token});
  lifecycle.stop();assert.equal(lifecycle.phase,'stopped');assert.equal(p.closed,true);assert.deepEqual(p.sent,[{type:'start'},{type:'stop'}]);
  p.onMessage.emit(ready);assert.equal(lifecycle.credentials,null);
});

test('宿主握手超时、非法响应与安装缺失给出固定提示且不自动重连',async()=>{
  for(const response of [{...ready,endpoint:'https://evil.example.com'}, {...ready,endpoint:ready.endpoint+'/'}, {...ready,token:'short'}, {...ready,extra:'ignored'}, {type:'error',message:'private path /secret'}]){
    const p=port();let disconnects=0;const lifecycle=createNativeOcrLifecycle({runtime:{connectNative:()=>p},onDisconnected:()=>disconnects++});
    const pending=lifecycle.start();p.onMessage.emit(response);
    await assert.rejects(pending,error=>error.code==='LOCAL_NATIVE_PROTOCOL');assert.equal(lifecycle.phase,'stopped');assert.equal(disconnects,1);assert.equal(p.closed,true);
  }
  let timeout;const p=port();const lifecycle=createNativeOcrLifecycle({runtime:{connectNative:()=>p},timers:{setTimeout:fn=>{timeout=fn;return 1;},clearTimeout(){}}});
  const pending=lifecycle.start();timeout();await assert.rejects(pending,error=>error.code==='LOCAL_NATIVE_TIMEOUT');assert.equal(p.sent.length,1);
  const unavailable=createNativeOcrLifecycle({runtime:{connectNative(){throw new Error('private installation path');}}});
  await assert.rejects(unavailable.start(),error=>error.code==='LOCAL_NATIVE_UNAVAILABLE'&&!error.message.includes('private'));
});

test('配置与状态轮询不启动宿主，持久存储只有经验证的管理选择、方向和同意',async()=>{
  const h=harness();await h.configure({...managed,localOcr:{...managed.localOcr,endpoint:ready.endpoint,token:ready.token},apiKey:'do-not-save'});
  for(let i=0;i<3;i++)assert.equal((await h.send({type:'MLT_UI_MODEL_STATUS'})).model.phase,'stopped');
  assert.equal(h.ports.length,0);assert.equal(h.sent.some(message=>message.type==='MODEL_STATUS'),false);
  assert.deepEqual(h.local,{managedLocalSettings:managed});assert.deepEqual(h.store.localSettings,managed);
  assert.ok(h.accesses.some(value=>value.target==='local'&&value.accessLevel==='TRUSTED_CONTEXTS'));
  assert.equal(JSON.stringify(await h.send({type:'MLT_UI_STATUS'})).includes(ready.token),false);
});

test('重启只恢复非敏感管理设置，不恢复令牌或启动；撤销的权限不恢复授权',async()=>{
  const h=harness({persisted:{managedLocalSettings:managed}});
  const status=await h.send({type:'MLT_UI_STATUS'});assert.equal(status.localConfigured,true);assert.equal(status.localOcr.phase,'stopped');assert.equal(h.ports.length,0);
  assert.equal(h.store.settings,undefined);assert.deepEqual(h.store.localSettings,managed);
  const revoked=harness({persisted:{managedLocalSettings:managed},permission:false});
  assert.equal((await revoked.send({type:'MLT_UI_STATUS'})).localConfigured,false);assert.deepEqual(revoked.local,{});
});

test('启用先启动本机再检查模型；缺权重不注入页面或自动下载',async()=>{
  const h=harness({autoReady:true,modelPhase:'idle'});await h.configure();
  const response=await h.enable();assert.equal(response.error.code,'LOCAL_MODELS_REQUIRED');assert.match(response.error.message,/下载并准备模型/);
  assert.ok(h.trace.indexOf('native:start')<h.trace.indexOf('MODEL_STATUS'));
  assert.equal(h.sent.some(message=>message.type==='MODEL_DOWNLOAD'),false);assert.equal(h.scripts.length,0);assert.equal(h.store['tab:1'],undefined);
  assert.equal(JSON.stringify(h.store).includes(ready.token),false);assert.equal(JSON.stringify(h.local).includes(ready.token),false);
  await h.send({type:'MLT_UI_FORGET'});
});

test('两个启用请求串行共享宿主，实际适配器使用宿主分配的端口与令牌',async()=>{
  const h=harness({autoReady:true});await h.configure();
  const results=await Promise.all([h.enable(),h.enable()]);assert.ok(results.every(result=>result.ok));assert.equal(h.ports.length,1);assert.equal(h.scripts.length,2);
  const resolved=h.sent.findLast(message=>message.type==='ENSURE_CONFIG'&&message.localSettings).localSettings;
  assert.equal(resolved.localOcr.mode,undefined);assert.equal(resolved.readingDirection,'rtl');
  let request;
  const adapter=createLocalOcrAdapter({...resolved.localOcr,fetchImpl:async(url,options)=>{request={url,options};return new Response(JSON.stringify({ready:true}),{headers:{'content-type':'application/json'}});}});
  assert.equal((await adapter.status()).ready,true);assert.equal(request.url,ready.endpoint+'/status');assert.equal(request.options.headers.Authorization,`Bearer ${ready.token}1`);
  assert.equal(JSON.stringify(h.tabMessages).includes(ready.token),false);assert.equal(JSON.stringify(await h.send({type:'MLT_UI_STATUS'})).includes(ready.token),false);
  await h.send({type:'MLT_UI_FORGET'});
});

for(const action of ['forget','revoke','close','configure'])test(`握手等待期间 ${action} 立即断开，排队启用与迟到 ready 不恢复旧进程`,async()=>{
  const h=harness();await h.configure();const pending=h.enable();const queued=h.enable();await tick();assert.equal(h.ports.length,1);
  const old=h.ports[0];let done;
  if(action==='forget')done=h.send({type:'MLT_UI_FORGET'});
  if(action==='revoke')h.revoke();
  if(action==='close')h.closeWindows([{id:2,type:'popup'}]);
  if(action==='configure')done=h.send({type:'MLT_UI_LOCAL_CONFIGURE',settings:manual});
  await tick();assert.equal(old.closed,true);old.onMessage.emit(ready);
  assert.equal((await pending).error.code,'CANCELLED');assert.equal((await queued).error.code,'CANCELLED');
  if(done)assert.equal((await done).ok,true);await tick();
  assert.equal(h.ports.length,1);assert.equal(h.scripts.length,0);assert.equal(h.store['tab:1'],undefined);
  assert.equal(h.sent.some(message=>message.localSettings?.localOcr?.token===ready.token),false);
  if(action==='forget'||action==='revoke'){assert.deepEqual(h.local,{});assert.equal(h.store.localSettings,undefined);}
  if(action==='close')assert.deepEqual(h.local,{managedLocalSettings:managed});
});

test('还剩普通窗口时不停止，最后普通窗口关闭即使仍有弹窗也停止',async()=>{
  const h=harness({autoReady:true});await h.configure();assert.equal((await h.enable()).ok,true);
  h.closeWindows([{id:2,type:'normal'}]);await tick();assert.equal(h.ports[0].closed,false);
  h.closeWindows([{id:3,type:'popup'}]);await tick();assert.equal(h.ports[0].closed,true);assert.equal(h.store['tab:1'].paused,true);
  assert.equal(h.sent.findLast(message=>message.type==='ENSURE_CONFIG').localSettings,null);
  assert.equal((await h.send({type:'MLT_UI_MODEL_STATUS'})).model.phase,'stopped');assert.equal(h.ports.length,1);
});

test('意外断线清除执行器旧凭据并暂停页面，状态查询不重启；再次点击建立新连接',async()=>{
  const h=harness({autoReady:true});await h.configure();assert.equal((await h.enable()).ok,true);
  h.ports[0].onDisconnect.emit();await tick();assert.equal(h.store['tab:1'].paused,true);assert.equal(h.sent.findLast(message=>message.type==='ENSURE_CONFIG').localSettings,null);
  await h.send({type:'MLT_UI_MODEL_STATUS'});assert.equal(h.ports.length,1);
  assert.equal((await h.enable()).ok,true);assert.equal(h.ports.length,2);
  assert.equal(h.sent.findLast(message=>message.type==='ENSURE_CONFIG').localSettings.localOcr.token,ready.token+'2');
  await h.send({type:'MLT_UI_FORGET'});
});

test('主动模型下载可启动宿主，取消与状态绝不启动；普通窗口不存在时拒绝启动',async()=>{
  const h=harness({autoReady:true});await h.configure();
  await h.send({type:'MLT_UI_MODEL_CANCEL'});assert.equal(h.ports.length,0);
  assert.equal((await h.send({type:'MLT_UI_MODEL_DOWNLOAD'})).ok,true);assert.equal(h.ports.length,1);assert.equal(h.sent.filter(message=>message.type==='MODEL_DOWNLOAD').length,1);
  await h.send({type:'MLT_UI_FORGET'});
  const closed=harness();await closed.configure();closed.setWindows([]);assert.equal((await closed.enable()).error.code,'LOCAL_OCR_STOPPED');assert.equal(closed.ports.length,0);
});

test('手动模式保留原端口，从不 connectNative 或关闭外部服务；缺少 native 权限不配置管理模式',async()=>{
  const h=harness();await h.configure(manual);assert.equal((await h.enable()).ok,true);assert.equal(h.ports.length,0);
  h.closeWindows();await tick();assert.equal(h.ports.length,0);assert.deepEqual(h.local,{});
  await h.send({type:'MLT_UI_FORGET'});assert.equal(h.sent.some(message=>message.type==='MODEL_CANCEL'),false);
  const denied=harness({permission:false});const result=await denied.send({type:'MLT_UI_LOCAL_CONFIGURE',settings:managed});assert.equal(result.error.code,'LOCAL_NATIVE_PERMISSION');assert.deepEqual(denied.store,{});assert.deepEqual(denied.local,{});
});

test('网页不能启动宿主；未授权远程自动翻译也不启动',async()=>{
  const h=harness();await h.configure();
  const page={id:h.chrome.runtime.id,url:'https://reader.example.com/chapter',tab:{id:1},frameId:0};
  assert.equal((await h.send({type:'MLT_UI_ENABLE',tabId:1},page)).ok,false);assert.equal((await h.send({type:'MLT_UI_MODEL_DOWNLOAD'},page)).ok,false);
  assert.equal((await h.send({type:'MLT_UI_ENABLE',tabId:1,auto:true})).ok,false);assert.equal(h.ports.length,0);
});


test('管理设置切换时权限检查失败仍清除已停止服务的执行器凭据和页面活动状态',async()=>{
  const h=harness({autoReady:true});await h.configure();assert.equal((await h.enable()).ok,true);
  h.setPermission(false);
  const response=await h.send({type:'MLT_UI_LOCAL_CONFIGURE',settings:manual});
  assert.equal(response.error.code,'LOCAL_NATIVE_PERMISSION');assert.equal(h.ports[0].closed,true);
  assert.equal(h.store['tab:1'].paused,true);assert.equal(h.sent.findLast(message=>message.type==='ENSURE_CONFIG').localSettings,null);
  assert.equal((await h.send({type:'MLT_UI_STATUS'})).localOcr.phase,'stopped');
});


test('关窗查询迟到时忽略过期空快照，不能关闭新窗口刚启动的宿主',async()=>{
  const h=harness({autoReady:true});await h.configure();
  const getAll=h.chrome.windows.getAll;let resolveOld;let hold=true;
  h.chrome.windows.getAll=options=>{if(hold){hold=false;return new Promise(resolve=>{resolveOld=resolve;});}return getAll(options);};
  h.closeWindows([]);
  h.setWindows([{id:2,type:'normal'}]);h.chrome.windows.onCreated.emit({id:2,type:'normal'});
  assert.equal((await h.enable()).ok,true);assert.equal(h.ports.length,1);
  resolveOld([]);await tick();
  assert.equal(h.ports[0].closed,false);assert.equal(h.store['tab:1'].paused,false);
  await h.send({type:'MLT_UI_FORGET'});
});

test('多个关窗查询交错时只有最新查询可停止；旧的非空结果不能恢复连接',async()=>{
  const h=harness({autoReady:true});await h.configure();await h.enable();
  const replies=[];h.chrome.windows.getAll=()=>new Promise(resolve=>replies.push(resolve));
  h.closeWindows([{id:2,type:'normal'}]);h.closeWindows([]);
  replies[1]([]);await tick();assert.equal(h.ports[0].closed,true);
  replies[0]([{id:2,type:'normal'}]);await tick();
  assert.equal(h.ports[0].closed,true);assert.equal(h.ports.length,1);assert.equal(h.store['tab:1'].paused,true);
});
