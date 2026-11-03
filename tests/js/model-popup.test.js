import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {preparationSettings} from '../../extension/content/scheduler.js';
const source = (await readFile(new URL('../../extension/popup.js', import.meta.url), 'utf8')).replace(/^import .*;\n/, '');
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(initial = {phase: 'idle', loaded: 0, total: null}) {
  const elements = new Map(), sends = [], permissions = [], timers = new Map(), listeners = new Map();
  let timerId = 0, model = initial, permission = true;
  const element = id => {
    if (!elements.has(id)) elements.set(id, {textContent: '', disabled: false, checked: false, hidden: false, value: id === 'prepareBudget' ? '8' : id === 'remoteBudget' ? '0' : '', removeAttribute(name) { delete this[name]; }});
    return elements.get(id);
  };
  const context = vm.createContext({preparationSettings, document: {getElementById: element}, window: {addEventListener(type, fn) { listeners.set(type, fn); }},
    setTimeout(fn, ms) { timers.set(++timerId, {fn, ms}); return timerId; }, clearTimeout(id) { timers.delete(id); },
    chrome: {tabs: {query: async () => [{id: 1, url: 'https://reader.example/chapter'}]}, permissions: {request(args) { permissions.push(args); return Promise.resolve(permission); }}, runtime: {
      openOptionsPage() {}, async sendMessage(message) { sends.push(message); if (message.type === 'MLT_UI_MODEL_STATUS') return {ok: true, model}; if (message.type === 'MLT_UI_STATUS') return {ok: true, configured: false}; return {ok: true}; },
    }}, URL, console});
  vm.runInContext(source, context);
  return {element, sends, permissions, timers, listeners, setModel(next) { model = next; }, denyPermission() { permission = false; }, async poll(next) { model = next; const timer = [...timers].find(([, value]) => value.ms === 1000); assert.ok(timer); timers.delete(timer[0]); await timer[1].fn(); }};
}
test('模型下载默认不执行，区域启用需就绪，整图模式不需要模型或提供商', async () => {
  const h = harness(); await tick();
  assert.equal(h.sends.some(message => message.type === 'MLT_UI_MODEL_DOWNLOAD'), false);
  await h.element('enable').onclick();
  assert.match(h.element('status').textContent, /下载并准备模型/);
  assert.equal(h.permissions.length, 0);
  h.element('wholeImage').checked = true;
  await h.element('enable').onclick();
  const request = h.sends.find(message => message.type === 'MLT_UI_ENABLE');
  assert.equal(request.settings.detectorMode, 'whole-image');
  assert.equal(request.settings.prepareEnabled, false);
});
test('用户点击先请求指定下载权限，权限被拒不启动，重试只发送下载命令', async () => {
  const h = harness(); await tick();
  await h.element('modelDownload').onclick();
  assert.deepEqual([...h.permissions[0].origins], ['https://huggingface.co/*', 'https://cas-bridge.xethub.hf.co/*']);
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
