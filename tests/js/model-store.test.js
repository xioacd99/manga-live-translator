import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createModelStore, DETECTOR_MODEL } from '../../extension/model-store.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const fixture = () => new Uint8Array(DETECTOR_MODEL.bytes).fill(7);
const digestBytes = hex => Uint8Array.from(hex.match(/../g), value => parseInt(value, 16)).buffer;
// 替身仅验证下载器的状态机；真实模型哈希仍由生产 WebCrypto 校验。
const syntheticCrypto = { subtle: { digest: async (_name, bytes) => digestBytes(bytes[0] === 7 ? DETECTOR_MODEL.sha256 : '00'.repeat(32)) } };
function fakeIDB({ quota = false } = {}) {
  const records = new Map();
  let writes = 0;
  const db = {
    objectStoreNames: { contains: () => true }, close() {},
    transaction() {
      const staged = new Map(records); let aborted = false;
      const tx = {
        abort() { aborted = true; queueMicrotask(() => tx.onabort?.()); },
        objectStore() {
          const operation = fn => {
            const request = {};
            queueMicrotask(() => {
              if (aborted) return;
              try { request.result = fn(); request.onsuccess?.(); }
              catch (error) { request.error = tx.error = error; aborted = true; request.onerror?.(); tx.onerror?.(); return; }
              queueMicrotask(() => {
                if (aborted) return;
                records.clear(); for (const [key, value] of staged) records.set(key, value);
                tx.oncomplete?.();
              });
            });
            return request;
          };
          return {
            get: key => operation(() => structuredClone(staged.get(key))),
            delete: key => operation(() => staged.delete(key)),
            put: (value, key) => operation(() => {
              if (quota) throw new DOMException('满了', 'QuotaExceededError');
              writes++; staged.set(key, structuredClone(value)); return key;
            }),
          };
        },
      };
      return tx;
    },
  };
  return { records, get writes() { return writes; }, open() {
    const request = { result: db }; queueMicrotask(() => request.onsuccess?.()); return request;
  } };
}
function response(bytes = fixture(), { length = String(DETECTOR_MODEL.bytes), url = DETECTOR_MODEL.url } = {}) {
  const headers = new Headers(); if (length !== null) headers.set('content-length', length);
  let offset = 0;
  return { ok: true, headers, url, body: new ReadableStream({ pull(controller) {
    if (offset >= bytes.length) { controller.close(); return; }
    const end = Math.min(bytes.length, offset + 1024 * 1024);
    controller.enqueue(bytes.slice(offset, end)); offset = end;
  } }) };
}
function harness(options = {}) {
  const indexedDBImpl = options.indexedDBImpl || fakeIDB();
  let calls = 0, lastOptions;
  const store = createModelStore({ indexedDBImpl, cryptoImpl: syntheticCrypto,
    fetchImpl: async (url, init) => { calls++; assert.equal(url, DETECTOR_MODEL.url); lastOptions = init; return response(); }, ...options });
  return { store, indexedDBImpl, get calls() { return calls; }, get lastOptions() { return lastOptions; } };
}

test('未授权和仅检查缓存绝不下载；授权首次使用后校验并持久化', async () => {
  const h = harness();
  assert.equal(await h.store.hasCached(), false);
  await assert.rejects(h.store.get(), { code: 'MODEL_DOWNLOAD_REQUIRED' });
  await assert.rejects(h.store.get({ downloadAllowed: 'true' }), { code: 'MODEL_DOWNLOAD_REQUIRED' });
  assert.equal(h.calls, 0);
  const progress = [];
  const bytes = await h.store.get({ downloadAllowed: true, onProgress: event => progress.push(event) });
  assert.equal(bytes.length, DETECTOR_MODEL.bytes);
  assert.deepEqual(progress.map(event => event.phase).filter((value, index, values) => value !== values[index - 1]), ['checking', 'downloading', 'verifying', 'ready']);
  const downloads = progress.filter(event => event.phase === 'downloading');
  assert.equal(downloads[0].total, null);
  assert.equal(downloads[1].total, DETECTOR_MODEL.bytes);
  assert.equal(downloads.at(-1).loaded, DETECTOR_MODEL.bytes);
  assert.equal(h.lastOptions.credentials, 'omit');
  assert.equal(h.lastOptions.referrerPolicy, 'no-referrer');
  assert.equal(h.indexedDBImpl.writes, 1);
  const restarted = harness({ indexedDBImpl: h.indexedDBImpl });
  assert.equal(await restarted.store.hasCached(), true);
  bytes[0] = 0;
  assert.equal((await restarted.store.get())[0], 7);
  assert.equal(restarted.calls, 0);
});

test('缺少 Content-Length 只报告真实字节，不能展示假百分比', async () => {
  const h = harness({ fetchImpl: async () => response(fixture(), { length: null }) });
  const events = [];
  await h.store.get({ downloadAllowed: true, onProgress: value => events.push(value) });
  assert.ok(events.every(event => event.total === null));
  assert.equal(events.at(-1).loaded, DETECTOR_MODEL.bytes);
});

test('并发请求共享下载，取消单个调用者不影响其他调用者', async () => {
  const h = harness(), controller = new AbortController();
  const first = h.store.get({ downloadAllowed: true, signal: controller.signal });
  const failure = assert.rejects(first, { code: 'CANCELLED' });
  const second = h.store.get({ downloadAllowed: true });
  controller.abort();
  await failure; assert.equal((await second).length, DETECTOR_MODEL.bytes);
  assert.equal(h.calls, 1);
});

test('所有调用者取消后中断流，重试从头下载且不保存半成品', async () => {
  let firstSignal, starts = 0, cancelled = 0;
  const h = harness({ fetchImpl: async (_url, { signal }) => {
    starts++; firstSignal ||= signal;
    if (starts > 1) return response();
    return { ok: true, headers: new Headers(), url: DETECTOR_MODEL.url,
      body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([7])); }, cancel() { cancelled++; } }) };
  } });
  const controller = new AbortController();
  const pending = h.store.get({ downloadAllowed: true, signal: controller.signal });
  const failure = assert.rejects(pending, { code: 'CANCELLED' });
  await tick(); controller.abort(); await failure; await tick();
  assert.equal(firstSignal.aborted, true); assert.equal(cancelled, 1);
  assert.equal(h.indexedDBImpl.records.size, 0);
  await h.store.get({ downloadAllowed: true });
  assert.equal(starts, 2); assert.equal(h.indexedDBImpl.writes, 1);
});

test('损坏缓存会删除，没有下载授权时不自动重试', async () => {
  const h = harness();
  h.indexedDBImpl.records.set(DETECTOR_MODEL.cacheKey, { sha256: DETECTOR_MODEL.sha256, bytes: new Uint8Array(DETECTOR_MODEL.bytes) });
  assert.equal(await h.store.hasCached(), false);
  assert.equal(h.indexedDBImpl.records.size, 0); assert.equal(h.calls, 0);
  await h.store.get({ downloadAllowed: true }); assert.equal(h.calls, 1);
});

for (const [name, make, code] of [
  ['错误长度头', () => response(fixture(), { length: '2' }), 'MODEL_SIZE_MISMATCH'],
  ['流超过固定模型大小', () => response(new Uint8Array(DETECTOR_MODEL.bytes + 1)), 'MODEL_SIZE_MISMATCH'],
  ['下载不完整', () => response(new Uint8Array(20)), 'MODEL_SIZE_MISMATCH'],
  ['哈希错误', () => response(new Uint8Array(DETECTOR_MODEL.bytes)), 'MODEL_HASH_MISMATCH'],
  ['不可信重定向', () => response(fixture(), { url: 'https://attacker.example/model' }), 'MODEL_DOWNLOAD_ORIGIN'],
  ['非 HTTPS 重定向', () => response(fixture(), { url: 'http://huggingface.co/model' }), 'MODEL_DOWNLOAD_ORIGIN'],
]) test(`${name}不会写入缓存或自动重试`, async () => {
  let calls = 0;
  const h = harness({ fetchImpl: async () => { calls++; return make(); } });
  await assert.rejects(h.store.get({ downloadAllowed: true }), { code });
  assert.equal(h.indexedDBImpl.records.size, 0); assert.equal(calls, 1);
});

test('真实 SHA-256 校验拒绝大小正确但内容不正确的模型', async () => {
  const h = harness({ cryptoImpl: webcrypto });
  await assert.rejects(h.store.get({ downloadAllowed: true }), { code: 'MODEL_HASH_MISMATCH' });
  assert.equal(h.indexedDBImpl.writes, 0);
});

test('空间不足明确失败，不以临时内存结果冒充持久缓存成功', async () => {
  const h = harness({ indexedDBImpl: fakeIDB({ quota: true }) });
  await assert.rejects(h.store.get({ downloadAllowed: true }), { code: 'MODEL_CACHE_QUOTA' });
  assert.equal(h.indexedDBImpl.records.size, 0);
});

test('展示回调抛错不影响下载，预先取消的请求不触发联网', async () => {
  const h = harness(), controller = new AbortController(); controller.abort();
  await assert.rejects(h.store.get({ downloadAllowed: true, signal: controller.signal }), { code: 'CANCELLED' });
  assert.equal(h.calls, 0);
  await h.store.get({ downloadAllowed: true, onProgress() { throw new Error('界面异常'); } });
  assert.equal(h.calls, 1);
});

test('校验阶段取消不提交缓存，后续明确重试可以重新下载', async () => {
  const controller = new AbortController();
  const h = harness();
  await assert.rejects(h.store.get({ downloadAllowed: true, signal: controller.signal, onProgress(event) {
    if (event.phase === 'verifying') controller.abort();
  } }), { code: 'CANCELLED' });
  await tick(); assert.equal(h.indexedDBImpl.writes, 0);
  await h.store.get({ downloadAllowed: true }); assert.equal(h.calls, 2);
});

test('网络失败不自动重试，明确重试不复用已失败任务', async () => {
  let calls = 0;
  const h = harness({ fetchImpl: async () => { if (++calls === 1) throw new Error('离线'); return response(); } });
  await assert.rejects(h.store.get({ downloadAllowed: true }), { code: 'MODEL_DOWNLOAD_FAILED' });
  assert.equal(calls, 1);
  await h.store.get({ downloadAllowed: true }); assert.equal(calls, 2);
});

test('只读检查不加入正在进行的下载，不把未提交数据当作已缓存', async () => {
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  const h = harness({ fetchImpl: async () => { await hold; return response(); } });
  const pending = h.store.get({ downloadAllowed: true });
  await tick(); assert.equal(await h.store.hasCached(), false);
  release(); await pending; assert.equal(await h.store.hasCached(), true);
});

test('存储不可用时明确失败，不偷偷退回每次联网下载', async () => {
  const h = harness({ indexedDBImpl: null });
  await assert.rejects(h.store.get({ downloadAllowed: true }), { code: 'MODEL_CACHE_UNAVAILABLE' });
  assert.equal(h.calls, 0);
});
