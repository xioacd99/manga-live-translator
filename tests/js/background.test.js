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
function harness({ fetchImpl = async () => new Response(new Uint8Array([1, 2]), { headers: { 'content-type': 'image/png' } }), sendImpl, storageGate = Promise.resolve() } = {}) {
  const store = {}, sent = [], scripts = [], tabMessages = [], accesses = [];
  let listener, permissionRemoved, tabRemoved;
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
    tabs: { get: async tabId => ({ id: tabId, url: 'https://reader.example.com/chapter', incognito: false }), sendMessage: async (...args) => { tabMessages.push(args); }, onRemoved: { addListener: fn => { tabRemoved = fn; } } },
    permissions: { contains: async () => true, onRemoved: { addListener: fn => { permissionRemoved = fn; } } },
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
  return { send, ui, page, enable, store, sent, scripts, tabMessages, accesses, chrome, revoke: () => permissionRemoved(), removeTab: id => tabRemoved(id) };
}

test('background accepts settings only from exact trusted extension UI', async () => {
  const h = harness();
  for (const sender of [h.page, { ...h.ui, id: 'other-extension' }, { ...h.ui, url: `${h.ui.url}?spoof=1` }, { ...h.ui, url: 'https://reader.example.com/options.html' }]) {
    const result = await h.send({ type: 'MLT_UI_CONFIGURE', settings: config }, sender);
    assert.equal(result.ok, false);
    assert.deepEqual(h.store, {});
    assert.equal(h.sent.length, 0);
  }
  assert.equal((await h.send({ type: 'MLT_UI_CONFIGURE', settings: config })).ok, true);
  assert.equal(h.store.settings.apiKey, config.apiKey);
  const status = await h.send({ type: 'MLT_UI_STATUS' });
  assert.equal(status.configured, true);
  assert.equal(JSON.stringify(status).includes(config.apiKey), false);
  assert.equal(h.accesses[0].accessLevel, 'TRUSTED_CONTEXTS');
});

test('background waits for trusted-only session storage initialization', async () => {
  const gate = deferred(); const h = harness({ storageGate: gate.promise });
  const pending = h.send({ type: 'MLT_UI_CONFIGURE', settings: config });
  await tick(); assert.equal(h.sent.length, 0); assert.deepEqual(h.store, {});
  gate.resolve(); assert.equal((await pending).ok, true);
});

test('background config and forget mutations serialize; forget clears credentials and grants', async () => {
  const configured = deferred(), release = deferred();
  const h = harness({ sendImpl: async message => { if (message.type === 'CONFIGURE') { configured.resolve(); await release.promise; } return { ok: true }; } });
  const pendingConfig = h.send({ type: 'MLT_UI_CONFIGURE', settings: config });
  await configured.promise;
  const pendingForget = h.send({ type: 'MLT_UI_FORGET' });
  await tick(); assert.equal(h.sent.some(m => m.type === 'FORGET'), false);
  release.resolve(); assert.equal((await pendingConfig).ok, true); assert.equal((await pendingForget).ok, true);
  assert.deepEqual(h.store, {});
  assert.deepEqual(h.sent.map(m => m.type), ['CONFIGURE', 'FORGET']);
  assert.equal((await h.send({ type: 'MLT_UI_STATUS' })).configured, false);
});

test('background requires provider for automatic translation and rejects forged content senders', async () => {
  let fetches = 0; const h = harness({ fetchImpl: async () => { fetches++; throw new Error('not expected'); } });
  assert.equal((await h.send({ type: 'MLT_UI_ENABLE', tabId: 1, auto: true })).ok, false);
  await h.enable();
  assert.equal(h.scripts.length, 1); assert.equal(h.store['tab:1'].origin, 'https://reader.example.com');
  assert.equal(JSON.stringify(h.tabMessages).includes(config.apiKey), false);
  for (const sender of [{ ...h.page, id: 'foreign' }, { ...h.page, frameId: 1 }, { ...h.page, url: 'https://evil.example.com/' }, { ...h.page, tab: { id: 2, url: h.page.url } }]) {
    assert.equal((await h.send(request, sender)).ok, false);
  }
  assert.equal(fetches, 0);
});

test('clear during delayed image fetch aborts and never sends RUN after late response', async () => {
  const started = deferred(), response = deferred(); let fetchSignal;
  const h = harness({ fetchImpl: async (_, options) => { fetchSignal = options.signal; started.resolve(); return response.promise; } });
  await h.enable();
  const pending = h.send(request, h.page); await started.promise;
  assert.equal((await h.send({ type: 'MLT_UI_CLEAR' })).ok, true);
  assert.equal(fetchSignal.aborted, true);
  response.resolve(new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } }));
  const result = await pending; assert.equal(result.ok, false); assert.equal(result.error.code, 'CANCELLED');
  assert.equal(h.sent.some(m => m.type === 'RUN'), false);
});

test('forget during executor preparation prevents stale RUN and leaves no credentials', async () => {
  const started = deferred(), release = deferred(); let block = false;
  const h = harness({ sendImpl: async message => { if (block && message.type === 'ENSURE_CONFIG') { started.resolve(); await release.promise; } return { ok: true }; } });
  await h.enable(); block = true;
  const pending = h.send(request, h.page); await started.promise;
  assert.equal((await h.send({ type: 'MLT_UI_FORGET' })).ok, true); release.resolve();
  const result = await pending; assert.equal(result.ok, false); assert.equal(result.error.code, 'CANCELLED');
  assert.deepEqual(h.store, {}); assert.equal(h.sent.some(m => m.type === 'RUN'), false);
});

test('permission removal aborts active fetch, forgets provider and prevents stale execution', async () => {
  const started = deferred(), response = deferred(); let fetchSignal;
  const h = harness({ fetchImpl: async (_, options) => { fetchSignal = options.signal; started.resolve(); return response.promise; } });
  await h.enable(); const pending = h.send(request, h.page); await started.promise;
  h.revoke(); await tick(); assert.equal(fetchSignal.aborted, true); assert.equal(h.store.settings, undefined);
  assert.ok(h.sent.some(m => m.type === 'FORGET'));
  response.resolve(new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } }));
  assert.equal((await pending).error.code, 'CANCELLED'); assert.equal(h.sent.some(m => m.type === 'RUN'), false);
});

test('late successful RUN response after clear cannot escape the generation fence', async () => {
  const started = deferred(), release = deferred();
  const h = harness({ sendImpl: async message => { if (message.type === 'RUN') { started.resolve(); await release.promise; } return { ok: true, regions: [], translations: [] }; } });
  await h.enable();
  const pending = h.send(request, h.page); await started.promise;
  assert.equal((await h.send({ type: 'MLT_UI_CLEAR' })).ok, true);
  release.resolve();
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'CANCELLED');
});

test('disable removes page grant and cancels its active image fetch', async () => {
  const started = deferred(), response = deferred(); let fetchSignal;
  const h = harness({ fetchImpl: async (_, options) => { fetchSignal = options.signal; started.resolve(); return response.promise; } });
  await h.enable(); const pending = h.send(request, h.page); await started.promise;
  assert.equal((await h.send({ type: 'MLT_UI_DISABLE', tabId: 1 })).ok, true);
  assert.equal(h.store['tab:1'], undefined); assert.equal(fetchSignal.aborted, true);
  assert.ok(h.sent.some(m => m.type === 'CANCEL_TAB' && m.tabId === 1));
  response.resolve(new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } }));
  assert.equal((await pending).error.code, 'CANCELLED');
  assert.equal((await h.send({ ...request, requestId: 'new' }, h.page)).ok, false);
});

test('configure rotates account namespace only when key changes', async () => {
  const h = harness();
  await h.send({ type: 'MLT_UI_CONFIGURE', settings: config });
  const first = h.store.settings.accountNamespace;
  await h.send({ type: 'MLT_UI_CONFIGURE', settings: { ...config, model: 'other-model' } });
  assert.equal(h.store.settings.accountNamespace, first);
  await h.send({ type: 'MLT_UI_CONFIGURE', settings: { ...config, apiKey: 'another-synthetic-key' } });
  assert.notEqual(h.store.settings.accountNamespace, first);
});
