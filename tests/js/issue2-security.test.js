import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import * as security from '../../extension/security.js';
import * as preparation from '../../extension/preparation-policy.js';

const source = (await readFile(new URL('../../extension/background.js', import.meta.url), 'utf8')).replace(/^import[^\n]+\n/gm, '');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const config = { consent: true, apiKey: 'synthetic-not-a-real-key', model: 'test-model', targetLanguage: 'Simplified Chinese' };
const request = { type: 'MLT_TRANSLATE', requestId: 'request1', imageUrl: 'https://reader.example.com/image.png', width: 800, height: 160 };
function harness({ fetchImpl = async () => new Response(new Uint8Array([1, 2]), { headers: { 'content-type': 'image/png' } }), sendImpl, storageGate = Promise.resolve(), permissions = async () => true } = {}) {
  const store = {}, sent = [], scripts = [], tabMessages = [], accesses = [];
  let listener, permissionRemoved, tabRemoved, tabUpdated;
  const id = 'test-extension';
  const chrome = {
    runtime: { id, getURL: p => `chrome-extension://${id}/${p}`, onMessage: { addListener: fn => { listener = fn; } }, sendMessage: async message => { sent.push(message); const result = sendImpl ? await sendImpl(message) : { ok: true, regions: [], translations: [] }; return message.type === 'MODEL_STATUS' && result.model === undefined ? { ...result, model: { phase: 'ready' } } : result; } },
    storage: { session: {
      setAccessLevel: async value => { accesses.push(value); await storageGate; },
      get: async key => key === null ? structuredClone(store) : ({ [key]: structuredClone(store[key]) }),
      set: async values => { Object.assign(store, structuredClone(values)); },
      remove: async key => { delete store[key]; }, clear: async () => { for (const key of Object.keys(store)) delete store[key]; },
    } },
    offscreen: { hasDocument: async () => true, createDocument: async () => {} },
    tabs: { get: async tabId => ({ id: tabId, url: 'https://reader.example.com/chapter', incognito: false }), sendMessage: async (...args) => { tabMessages.push(args); }, onRemoved: { addListener: fn => { tabRemoved = fn; } }, onUpdated: { addListener: fn => { tabUpdated = fn; } } },
    permissions: { contains: permissions, onRemoved: { addListener: fn => { permissionRemoved = fn; } } },
    scripting: { executeScript: async args => { scripts.push(args); } },
  };
  vm.runInNewContext(source, { ...security, ...preparation, structuredClone, chrome, crypto: webcrypto, fetch: fetchImpl, URL, DOMException, AbortController, setTimeout, clearTimeout, btoa, console });
  const ui = { id, url: `chrome-extension://${id}/options.html` };
  const page = { id, url: 'https://reader.example.com/chapter', tab: { id: 1, url: 'https://reader.example.com/chapter' }, frameId: 0 };
  const send = (message, sender = ui) => new Promise(resolve => { const accepted = listener(message, sender, resolve); if (accepted !== true) resolve(undefined); });
  const enable = async () => {
    assert.equal((await send({ type: 'MLT_UI_CONFIGURE', settings: config })).ok, true);
    assert.equal((await send({ type: 'MLT_UI_ENABLE', tabId: 1 })).ok, true);
  };
  return { send, ui, page, enable, store, sent, scripts, tabMessages, accesses, chrome, revoke: () => permissionRemoved(), removeTab: id => tabRemoved(id), navigate: (id, url) => tabUpdated(id, { url }) };
}

const localSettings = { prepareEnabled: true, prepareBudget: 2, remotePrefetchEnabled: false, remotePrefetchBudget: 0, detectorMode: 'regions' };
const localRequest = (id = 'local1') => ({ ...request, type: 'MLT_PREPARE', requestId: id });
const enableLocal = h => h.send({ type: 'MLT_UI_ENABLE', tabId: 1, settings: localSettings });

test('本地准备不需要模型配置或模型权限，执行器仅收到 PREPARE', async () => {
  const checks = [];
  const h = harness({ permissions: async value => { checks.push(value); return !value.origins.some(origin => origin.includes('openai')); } });
  assert.equal((await enableLocal(h)).ok, true);
  assert.equal((await h.send(localRequest(), h.page)).ok, true);
  assert.equal(h.store.settings, undefined); assert.equal(h.store['tab:1'].prepareRemaining, 1);
  assert.equal(h.sent.some(m => ['RUN', 'CONFIGURE'].includes(m.type)), false);
  assert.equal(h.sent.filter(m => m.type === 'PREPARE').length, 1);
  assert.equal(checks.some(value => value.origins.some(origin => origin.includes('openai'))), false);
});

test('默认本地和远端预取关闭，网页不能扩展授权或伪造检测模式', async () => {
  let fetches = 0; const h = harness({ fetchImpl: async () => { fetches++; throw new Error('unexpected'); } });
  await h.enable();
  for (const message of [localRequest(), { ...request, prefetch: true }, { ...request, purpose: 'prefetch' }, { ...request, purpose: 'visible' }, { ...request, detectorMode: 'whole-image' }]) {
    assert.equal((await h.send({ ...message, settings: localSettings, prepareRemaining: 99, remoteRemaining: 99 }, h.page)).ok, false);
  }
  assert.equal(fetches, 0); assert.equal(h.sent.some(m => ['RUN', 'PREPARE'].includes(m.type)), false);
});

test('并发准备请求原子扣减预算，失败后不自动恢复预算', async () => {
  let fetches = 0; const h = harness({ fetchImpl: async () => { fetches++; throw new Error('synthetic network failure'); } });
  assert.equal((await enableLocal(h)).ok, true);
  const results = await Promise.all(Array.from({ length: 5 }, (_, i) => h.send(localRequest(`attempt${i}`), h.page)));
  assert.ok(results.every(result => result.ok === false)); assert.equal(fetches, 2); assert.equal(h.store['tab:1'].prepareRemaining, 0);
  assert.equal((await h.send(localRequest('extra'), h.page)).ok, false); assert.equal(fetches, 2);
});

test('远端预取必须有独立开关与预算，手动请求不冒用预取预算', async () => {
  const h = harness(); await h.enable();
  await h.send({ type: 'MLT_UI_ENABLE', tabId: 1, settings: { ...localSettings, remotePrefetchEnabled: true, remotePrefetchBudget: 1 } });
  assert.equal((await h.send({ ...request, purpose: 'prefetch' }, h.page)).ok, true);
  assert.equal((await h.send({ ...request, requestId: 'twice', purpose: 'prefetch' }, h.page)).ok, false);
  assert.equal((await h.send({ ...request, requestId: 'manual', purpose: 'manual' }, h.page)).ok, true);
  assert.equal(h.sent.filter(m => m.type === 'RUN').length, 2); assert.equal(h.store['tab:1'].remoteRemaining, 0);
});

test('本地准备时清空会取消晚到结果并暂停授权，不恢复预算或配置', async () => {
  const started = deferred(), release = deferred();
  const h = harness({ sendImpl: async message => { if (message.type === 'PREPARE') { started.resolve(); await release.promise; } return { ok: true }; } });
  await enableLocal(h); const pending = h.send(localRequest(), h.page); await started.promise;
  assert.equal((await h.send({ type: 'MLT_UI_CLEAR' })).ok, true); release.resolve();
  assert.equal((await pending).error.code, 'CANCELLED'); assert.equal(h.store['tab:1'].paused, true);
  assert.equal(h.store['tab:1'].prepareRemaining, 1); assert.equal(h.store.settings, undefined);
  assert.equal((await h.send(localRequest('afterclear'), h.page)).ok, false);
  assert.equal(h.sent.filter(m => m.type === 'PREPARE').length, 1);
});

test('暂停和关闭本地准备均阻止后续工作，重新启用才重新授权', async () => {
  const h = harness(); await enableLocal(h);
  assert.equal((await h.send({ type: 'MLT_UI_PAUSE', tabId: 1 })).ok, true);
  assert.equal((await h.send(localRequest(), h.page)).ok, false);
  await enableLocal(h); assert.equal((await h.send(localRequest(), h.page)).ok, true);
  assert.equal((await h.send({ type: 'MLT_UI_DISABLE', tabId: 1 })).ok, true);
  assert.equal((await h.send(localRequest('disabled'), h.page)).ok, false);
  assert.equal(h.store['tab:1'], undefined);
});

test('同源章节导航使旧准备授权失效，伪造发送页不能沿用', async () => {
  const h = harness(); await enableLocal(h);
  const moved = { ...h.page, url: 'https://reader.example.com/next', tab: { ...h.page.tab, url: 'https://reader.example.com/next' } };
  assert.equal((await h.send(localRequest(), moved)).ok, false);
  h.navigate(1, moved.url); await tick();
  assert.equal(h.store['tab:1'], undefined); assert.equal((await h.send(localRequest(), h.page)).ok, false);
  assert.equal(h.sent.some(m => m.type === 'CANCEL_TAB'), true);
});

test('本地准备每次获取前检查图片权限，撤权不能恢复页面授权', async () => {
  let allowed = true; const h = harness({ permissions: async () => allowed }); await enableLocal(h);
  allowed = false; assert.equal((await h.send(localRequest(), h.page)).ok, false);
  h.revoke(); await tick(); allowed = true;
  assert.equal((await h.send(localRequest('revoked'), h.page)).ok, false);
  assert.equal(h.sent.some(m => m.type === 'PREPARE'), false);
});

test('准备设置限制预算与模式，未启用开关不能被真值字符串绕过', () => {
  for (const value of [{ prepareBudget: 21 }, { prepareBudget: 0 }, { prepareBudget: 1.5 }, { remotePrefetchBudget: -1 }, { detectorMode: 'unknown' }, null]) assert.throws(() => preparation.preparationSettings(value));
  const settings = preparation.preparationSettings({ prepareEnabled: 'true', remotePrefetchEnabled: 'true' });
  assert.equal(settings.prepareEnabled, false); assert.equal(settings.remotePrefetchEnabled, false);
});

test('页面暂停只能由同扩展顶层内容脚本发起，并阻止后续准备', async () => {
  const h = harness(); await enableLocal(h);
  for (const sender of [{ ...h.page, id: 'other' }, { ...h.page, frameId: 1 }]) assert.equal((await h.send({ type: 'MLT_PAUSE_PAGE' }, sender)).ok, false);
  assert.equal(h.store['tab:1'].paused, false);
  assert.equal((await h.send({ type: 'MLT_PAUSE_PAGE' }, h.page)).ok, true);
  assert.equal(h.store['tab:1'].paused, true);
  assert.equal((await h.send(localRequest(), h.page)).ok, false);
  assert.equal(h.sent.some(m => m.type === 'PREPARE'), false);
});

test('清空与新准备同时到达时不会在清空之后恢复处理', async () => {
  const h = harness(); await enableLocal(h);
  const clear = h.send({ type: 'MLT_UI_CLEAR' });
  const pending = h.send(localRequest(), h.page);
  assert.equal((await clear).ok, true); assert.equal((await pending).ok, false);
  assert.equal(h.store['tab:1'].paused, true);
  assert.equal(h.sent.some(m => m.type === 'PREPARE'), false);
});

test('关闭标签页与预算存储交错时不会恢复旧授权或返回准备结果', async () => {
  const h = harness(); await enableLocal(h);
  const entered = deferred(), release = deferred(); const save = h.chrome.storage.session.set;
  h.chrome.storage.session.set = async values => {
    if (values['tab:1']?.prepareRemaining === 1) { entered.resolve(); await release.promise; }
    return save(values);
  };
  const pending = h.send(localRequest(), h.page); await entered.promise;
  h.removeTab(1); release.resolve();
  assert.equal((await pending).ok, false); await tick();
  assert.equal(h.store['tab:1'], undefined);
});

test('旧章节的延迟暂停请求不能暂停当前章节授权', async () => {
  const h = harness(); await enableLocal(h);
  const oldPage = { ...h.page, url: 'https://reader.example.com/old', tab: { ...h.page.tab, url: 'https://reader.example.com/old' } };
  assert.equal((await h.send({ type: 'MLT_PAUSE_PAGE' }, oldPage)).ok, false);
  assert.equal(h.store['tab:1'].paused, false);
  assert.equal((await h.send(localRequest(), h.page)).ok, true);
});

test('模型下载仅可信UI可发起且需两个固定来源权限，不能注入下载URL', async () => {
  let granted = false; const checks = [];
  const h = harness({ permissions: async args => { checks.push(args.origins); return granted; } });
  assert.equal((await h.send({ type: 'MLT_UI_MODEL_DOWNLOAD' }, h.page)).ok, false);
  assert.equal((await h.send({ type: 'MLT_UI_MODEL_DOWNLOAD' })).ok, false);
  assert.equal(h.sent.some(m => m.type === 'MODEL_DOWNLOAD'), false);
  granted = true;
  assert.equal((await h.send({ type: 'MLT_UI_MODEL_DOWNLOAD', url: 'https://evil.invalid/model', apiKey: 'private' })).ok, true);
  assert.deepEqual(Array.from(checks.at(-1)), ['https://huggingface.co/*', 'https://cas-bridge.xethub.hf.co/*']);
  const forwarded = h.sent.find(m => m.type === 'MODEL_DOWNLOAD'); assert.deepEqual(Object.keys(forwarded).sort(), ['target', 'type']);
  assert.equal((await h.send({ type: 'MLT_UI_MODEL_CANCEL' })).ok, true);
  assert.equal(h.sent.at(-1).type, 'MODEL_CANCEL');
});

test('模型未就绪时禁止区域模式授权，整图OCR仍可独立启用', async () => {
  const h = harness({ sendImpl: async message => ({ ok: true, ...(message.type === 'MODEL_STATUS' ? { model: { phase: 'loading' } } : {}) }) });
  assert.equal((await enableLocal(h)).ok, false); assert.equal(h.store['tab:1'], undefined); assert.equal(h.scripts.length, 0);
  assert.equal((await h.send({ type: 'MLT_UI_ENABLE', tabId: 1, settings: { ...localSettings, detectorMode: 'whole-image' } })).ok, true);
  assert.equal(h.store['tab:1'].preparation.detectorMode, 'whole-image');
  assert.equal(h.sent.some(m => m.type === 'MODEL_DOWNLOAD'), false);
});

test('模型状态查询不要求下载权限也不发起下载，网页不能查询或取消', async () => {
  const h = harness({ permissions: async () => false });
  for (const type of ['MLT_UI_MODEL_STATUS', 'MLT_UI_MODEL_CANCEL']) assert.equal((await h.send({ type }, h.page)).ok, false);
  assert.equal((await h.send({ type: 'MLT_UI_MODEL_STATUS' })).ok, true);
  assert.equal(h.sent.length, 1); assert.equal(h.sent[0].type, 'MODEL_STATUS');
});
