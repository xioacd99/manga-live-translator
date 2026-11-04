import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {preparationSettings} from '../../extension/content/scheduler.js';
const source = (await readFile(new URL('../../extension/popup.js', import.meta.url), 'utf8')).replace(/^import .*;\n/, '');
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(initial = {phase: 'idle', loaded: 0, total: null}, {mode='manual',configured=false,permissionRequest,sendMessage}={}) {
  const elements = new Map(), sends = [], permissions = [], timers = new Map(), listeners = new Map();
  let timerId = 0, model = initial, permission = true;
  const element = id => {
    if (!elements.has(id)) elements.set(id, {textContent: '', disabled: false, checked: false, hidden: false, value: id === 'prepareBudget' ? '8' : id === 'remoteBudget' ? '0' : '', removeAttribute(name) { delete this[name]; }});
    return elements.get(id);
  };
  const context = vm.createContext({preparationSettings, document: {getElementById: element}, window: {addEventListener(type, fn) { listeners.set(type, fn); }},
    setTimeout(fn, ms) { timers.set(++timerId, {fn, ms}); return timerId; }, clearTimeout(id) { timers.delete(id); },
    chrome: {tabs: {query: async () => [{id: 1, url: 'https://reader.example/chapter'}]}, permissions: {request(args) { permissions.push(args); return permissionRequest ? permissionRequest(args) : Promise.resolve(permission); }}, runtime: {
      openOptionsPage() {}, async sendMessage(message) { sends.push(message); if (message.type === 'MLT_UI_MODEL_STATUS') return {ok: true, model}; if (message.type === 'MLT_UI_STATUS') return {ok: true, configured, localConfigured:true, localOcr:{mode}}; return sendMessage ? sendMessage(message) : {ok: true}; },
    }}, URL, console});
  vm.runInContext(source, context);
  return {element, sends, permissions, timers, listeners, setModel(next) { model = next; }, denyPermission() { permission = false; }, async poll(next) { model = next; const timer = [...timers].find(([, value]) => value.ms === 1000); assert.ok(timer); timers.delete(timer[0]); await timer[1].fn(); }};
}
test('模型下载默认不执行，整图与气泡模式均需本地模型就绪，但不要求远端提供商', async () => {
  const h = harness(); await tick();
  assert.equal(h.sends.some(message => message.type === 'MLT_UI_MODEL_DOWNLOAD'), false);
  await h.element('enable').onclick();
  assert.match(h.element('status').textContent, /下载并准备模型/);
  assert.equal(h.permissions.length, 0);
  h.element('wholeImage').checked = true;
  await h.poll({phase:'ready',loaded:100,total:100});
  await h.element('enable').onclick();
  const request = h.sends.find(message => message.type === 'MLT_UI_ENABLE');
  assert.equal(request.settings.detectorMode, 'whole-image');
  assert.equal(request.settings.prepareEnabled, false);
});
test('用户点击先请求指定下载权限，权限被拒不启动，重试只发送下载命令', async () => {
  const h = harness(); await tick();
  await h.element('modelDownload').onclick();
  assert.deepEqual([...h.permissions[0].origins], ['http://127.0.0.1/*']);
  assert.equal(h.sends.filter(message => message.type === 'MLT_UI_MODEL_DOWNLOAD').length, 1);
  const denied = harness(); await tick(); denied.denyPermission();
  await denied.element('modelDownload').onclick();
  assert.equal(denied.sends.some(message => message.type === 'MLT_UI_MODEL_DOWNLOAD'), false);
  assert.match(denied.element('status').textContent, /未授予/);
});
test('已知总量显示字节百分比，未知总量取消确定进度，不把下载完成当作模型就绪', async () => {
  const h = harness(); await tick();
  await h.poll({phase: 'downloading', loaded: 500, total: 1000});
  assert.match(h.element('modelStatus').textContent, /50%/);
  assert.equal(h.element('modelProgress').value, 500);
  assert.equal(h.element('modelProgress').max, 1000);
  await h.poll({phase: 'downloading', loaded: 600, total: null});
  assert.match(h.element('modelStatus').textContent, /大小未知/);
  assert.equal(h.element('modelProgress').value, undefined);
  for (const phase of ['checking', 'verifying', 'loading', 'cancelling']) {
    await h.poll({phase, loaded: 1000, total: 1000});
    assert.equal(h.element('modelDownload').disabled, true);
    assert.equal(h.element('modelCancel').disabled, phase === 'cancelling');
    await h.element('enable').onclick();
    assert.equal(h.sends.some(message => message.type === 'MLT_UI_ENABLE'), false);
  }
  await h.poll({phase: 'ready', loaded: 1000, total: 1000});
  assert.equal(h.element('modelProgress').hidden, true);
  await h.element('enable').onclick();
  assert.equal(h.sends.some(message => message.type === 'MLT_UI_ENABLE'), true);
});
test('错误、取消可重试，关闭面板停止轮询且不自行取消后台下载', async () => {
  const h = harness(); await tick();
  await h.poll({phase: 'error', error: '校验失败'});
  assert.match(h.element('modelStatus').textContent, /校验失败/);
  assert.match(h.element('modelDownload').textContent, /重试/);
  assert.equal(h.element('modelProgress').hidden, true);
  await h.poll({phase: 'loading', loaded: 100, total: 100});
  await h.element('modelCancel').onclick();
  assert.equal(h.sends.filter(message => message.type === 'MLT_UI_MODEL_CANCEL').length, 1);
  assert.match(h.element('modelStatus').textContent, /已取消/);
  assert.equal(h.element('modelDownload').disabled, false);
  h.listeners.get('pagehide')();
  assert.equal(h.timers.size, 0);
  assert.equal(h.sends.filter(message => message.type === 'MLT_UI_MODEL_CANCEL').length, 1);
});


test('管理模式忽略停止或过时模型状态，点击时同步请求本机权限再启用', async () => {
  for (const phase of ['stopped','idle','error','checking']) {
    const h = harness({phase},{mode:'managed',configured:true}); await tick();
    h.element('auto').checked = true;
    const pending = h.element('enable').onclick();
    assert.equal(h.permissions.length,1);
    assert.deepEqual([...h.permissions[0].permissions],['nativeMessaging']);
    await pending;
    assert.equal(h.sends.filter(message=>message.type==='MLT_UI_ENABLE').length,1);
    assert.equal(h.sends.find(message=>message.type==='MLT_UI_ENABLE').auto,true);
    assert.equal(h.sends.some(message=>message.type==='MLT_UI_MODEL_DOWNLOAD'),false);
  }
});

test('管理模式准备模型也显式申请本机权限，拒绝不会发启动命令', async () => {
  const h = harness({phase:'stopped'},{mode:'managed'}); await tick();
  await h.element('modelDownload').onclick();
  assert.deepEqual([...h.permissions[0].permissions],['nativeMessaging']);
  assert.equal(h.sends.filter(message=>message.type==='MLT_UI_MODEL_DOWNLOAD').length,1);
  const denied = harness({phase:'stopped'},{mode:'managed'}); await tick();denied.denyPermission();
  await denied.element('enable').onclick();
  assert.equal(denied.sends.some(message=>message.type==='MLT_UI_ENABLE'),false);
  assert.match(denied.element('status').textContent,/未授予/);
});

test('启用点击等待权限时重复点击不重复请求；失败后允许用户重试', async () => {
  let allow;const permission = new Promise(resolve=>{allow=resolve;});
  const h = harness({phase:'stopped'},{mode:'managed',permissionRequest:()=>permission,sendMessage:async()=>({ok:false,error:{message:'请先安装本机宿主'}})}); await tick();
  const first=h.element('enable').onclick();await h.element('enable').onclick();
  assert.equal(h.permissions.length,1);assert.equal(h.element('enable').disabled,true);
  allow(true);await first;
  assert.equal(h.sends.filter(message=>message.type==='MLT_UI_ENABLE').length,1);
  assert.match(h.element('status').textContent,/请先安装/);assert.equal(h.element('enable').disabled,false);
  await h.element('enable').onclick();assert.equal(h.permissions.length,2);
});

test('手动模式点击不请求本机通信权限', async () => {
  const h = harness({phase:'ready'});await tick();
  await h.element('enable').onclick();assert.equal(h.permissions[0].permissions,undefined);
  await h.element('modelDownload').onclick();assert.equal(h.permissions[1].permissions,undefined);
});
