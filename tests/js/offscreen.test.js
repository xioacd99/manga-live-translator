import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createPipeline, BoundedQueue } from '../../packages/core/index.js';
import { safeError } from '../../extension/security.js';
import { createOpenAiAdapter, OPENAI_ENDPOINT } from '../../extension/adapters/openai.js';

const source = (await readFile(new URL('../../extension/offscreen.js', import.meta.url), 'utf8')).replace(/^import[^\n]*\n/gm, '');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const bitmap = () => ({ width: 10, height: 10, close() {} });
const settings = accountNamespace => ({ accountNamespace, apiKey: 'synthetic-not-a-key', model: 'test-model', targetLanguage: 'Chinese' });
const run = id => ({ type: 'RUN', id, tabId: 1, imageBase64: 'AQ==', mime: 'image/png', namespace: 'https://reader.example.com' });
function harness({ decode = async () => bitmap(), recognize = async () => ({ regions: [] }), translate, modelGet = async () => new Uint8Array([1]), modelLoad = async () => {}, detect = async () => ({ regions: [], detectorRevision: 'test-v1' }) } = {}) {
  let listener;
  const scope = vm.createContext({
    createPipeline, BoundedQueue, ort: {}, createModelStore: () => ({ get: modelGet }), createPretrainedRegionDetector: () => ({ detect, load: modelLoad, dispose: async () => {} }), PRETRAINED_DETECTOR_REVISION: 'test-v1', createOcrAdapter: () => ({ recognize, dispose: async () => {} }),
    createOpenAiAdapter: () => translate || (async request => ({ translations: request.regions.map(r => ({ regionId: r.regionId, text: 'Synthetic translation' })) })),
    OPENAI_ENDPOINT: 'https://api.openai.com/v1/chat/completions', PROMPT_VERSION: 'test-1', SCHEMA_VERSION: 'test-1', MAX_IMAGE_BYTES: 4194304, MAX_PIXELS: 16000000,
    safeError, inspectImage: () => ({ width: 10, height: 10 }), createImageBitmap: decode,
    chrome: { runtime: { id: 'test', getURL: p => `chrome-extension://test/${p}`, onMessage: { addListener: fn => { listener = fn; } } } },
    Uint8Array, atob, Blob, AbortController, DOMException, performance,
  });
  vm.runInContext(source, scope);
  const send = (message, sender = { id: 'test', url: 'chrome-extension://test/background.js' }) => new Promise(resolve => { if (listener({ ...message, target: 'executor' }, sender, resolve) !== true) resolve(undefined); });
  return { send, tracked: id => vm.runInContext(`jobs.has(${JSON.stringify(id)})`, scope) };
}

test('old decode cleanup does not delete a same-ID replacement after configure', async () => {
  const first = deferred(), second = deferred(); let decodes = 0;
  const h = harness({ decode: () => (++decodes === 1 ? first.promise : second.promise) });
  await h.send({ type: 'CONFIGURE', settings: settings('same') });
  const old = h.send(run('1:reused')); await tick();
  await h.send({ type: 'CONFIGURE', settings: settings('same') });
  const replacement = h.send(run('1:reused')); await tick();
  assert.equal(h.tracked('1:reused'), true);
  first.resolve(bitmap()); assert.equal((await old).error.code, 'CANCELLED'); await tick();
  assert.equal(decodes, 2); assert.equal(h.tracked('1:reused'), true, 'old finally must preserve new job identity');
  await h.send({ type: 'CANCEL', id: '1:reused' }); second.resolve(bitmap());
  assert.equal((await replacement).error.code, 'CANCELLED');
});

test('account replacement queues OCR until the prior worker finishes cancellation cleanup', async () => {
  const started = deferred(), termination = deferred(); let active = false, busyFailures = 0, calls = 0;
  const h = harness({ recognize: async ({ signal }) => {
    if (active) { busyFailures++; throw new Error('OCR adapter allows one active recognition.'); }
    active = true; calls++;
    try {
      if (calls === 1) {
        started.resolve();
        await new Promise((resolve, reject) => signal.addEventListener('abort', () => { termination.promise.then(() => reject(new DOMException('Cancelled', 'AbortError'))); }, { once: true }));
      }
      return { regions: [] };
    } finally { active = false; }
  } });
  await h.send({ type: 'CONFIGURE', settings: settings('first') });
  const old = h.send(run('1:old')); await started.promise;
  await h.send({ type: 'CONFIGURE', settings: settings('second') });
  const replacement = h.send(run('1:new')); await tick(); await tick();
  const observedFailures = busyFailures;
  termination.resolve();
  assert.equal((await old).error.code, 'CANCELLED');
  const result = await replacement;
  assert.equal(observedFailures, 0, 'shared OCR resource queue must span account-specific pipelines');
  assert.equal(result.ok, true); assert.equal(calls, 2);
});

test('执行器未配置模型时可准备，配置模型后准备仍不调用远端适配器', async () => {
  let ocrCalls = 0, translationCalls = 0;
  const h = harness({ recognize: async () => { ocrCalls++; return { regions: [{ regionId: 'r1', bbox: { x: 0, y: 0, width: 5, height: 5 }, sourceText: 'Hello', readingOrder: 0 }] }; },
    translate: async () => { translationCalls++; throw new Error('Preparation must not call provider'); } });
  await h.send({ type: 'ENSURE_CONFIG', settings: null });
  const first = await h.send({ ...run('1:local'), type: 'PREPARE' });
  assert.equal(first.ok, true); assert.equal(first.prepared, true); assert.equal(first.result.regions[0].translation, '');
  assert.equal((await h.send(run('1:remote'))).ok, false);
  await h.send({ type: 'CONFIGURE', settings: settings('configured') });
  assert.equal((await h.send({ ...run('1:prepared'), type: 'PREPARE' })).ok, true);
  assert.equal(ocrCalls, 2); assert.equal(translationCalls, 0);
});

test('执行器清理中断本地准备，晚到解码不恢复识别缓存', async () => {
  const gate = deferred(); let ocrCalls = 0;
  const h = harness({ decode: () => gate.promise, recognize: async () => { ocrCalls++; return { regions: [] }; } });
  await h.send({ type: 'ENSURE_CONFIG', settings: null });
  const pending = h.send({ ...run('1:local'), type: 'PREPARE' }); await tick();
  await h.send({ type: 'CLEAR' }); gate.resolve(bitmap());
  assert.equal((await pending).error.code, 'CANCELLED'); assert.equal(ocrCalls, 0);
  const metrics = await h.send({ type: 'METRICS' }); assert.equal(metrics.metrics.detectionEntries, 0); assert.equal(metrics.metrics.ocrEntries, 0);
});

async function until(check) { for (let i = 0; i < 100; i++) { if (await check()) return; await tick(); } throw new Error('Condition not reached'); }

test('模型状态仅检查缓存，只有会话加载完成才报告可用', async () => {
  const loading = deferred(); const calls = [];
  const h = harness({ modelGet: async args => { calls.push(args.downloadAllowed); return new Uint8Array([1]); }, modelLoad: () => loading.promise });
  await h.send({ type: 'MODEL_STATUS' }); await tick();
  assert.deepEqual(calls, [false]); assert.equal((await h.send({ type: 'MODEL_STATUS' })).model.phase, 'loading');
  loading.resolve(); await until(async () => (await h.send({ type: 'MODEL_STATUS' })).model.phase === 'ready');
  assert.deepEqual(calls, [false]);
});

test('未缓存模型的状态查询不下载，检查中明确下载请求不会被丢弃', async () => {
  const checking = deferred(); const calls = [];
  const h = harness({ modelGet: async ({ downloadAllowed }) => {
    calls.push(downloadAllowed);
    if (!downloadAllowed) { await checking.promise; throw Object.assign(new Error('missing'), { code: 'MODEL_DOWNLOAD_REQUIRED' }); }
    return new Uint8Array([1]);
  } });
  await h.send({ type: 'MODEL_STATUS' }); await h.send({ type: 'MODEL_DOWNLOAD' });
  assert.deepEqual(calls, [false]); checking.resolve();
  await until(async () => (await h.send({ type: 'MODEL_STATUS' })).model.phase === 'ready');
  assert.deepEqual(calls, [false, true]);
});

test('模型下载取消阻止晚到ready，明确重试才重新下载', async () => {
  const download = deferred(); let signal, calls = 0, loads = 0;
  const h = harness({ modelGet: async args => { signal = args.signal; calls++; if (calls === 1) await download.promise; return new Uint8Array([1]); }, modelLoad: async () => { loads++; } });
  await h.send({ type: 'MODEL_DOWNLOAD' }); await h.send({ type: 'MODEL_CANCEL' }); assert.equal(signal.aborted, true);
  download.resolve(); await until(async () => (await h.send({ type: 'MODEL_STATUS' })).model.phase === 'cancelled');
  assert.equal(calls, 1); assert.equal(loads, 0);
  await h.send({ type: 'MODEL_DOWNLOAD' }); await until(async () => (await h.send({ type: 'MODEL_STATUS' })).model.phase === 'ready');
  assert.equal(calls, 2); assert.equal(loads, 1);
});

test('忘记设置中断模型下载且不恢复排队中的明确下载意图', async () => {
  const checking = deferred(); const signals = [], calls = [];
  const h = harness({ modelGet: async args => { calls.push(args.downloadAllowed); signals.push(args.signal); await checking.promise; return new Uint8Array([1]); } });
  await h.send({ type: 'MODEL_STATUS' }); await h.send({ type: 'MODEL_DOWNLOAD' }); await h.send({ type: 'FORGET' });
  assert.equal(signals[0].aborted, true); checking.resolve();
  await until(async () => (await h.send({ type: 'MODEL_STATUS' })).model.phase === 'cancelled');
  assert.deepEqual(calls, [false]);
});

test('网页与其他扩展不能直接调用模型管理执行器', async () => {
  let gets = 0; const h = harness({ modelGet: async () => { gets++; return new Uint8Array([1]); } });
  for (const sender of [{ id: 'other' }, { id: 'test', tab: { id: 1 } }, { id: 'test', url: 'https://reader.example.com/' }]) {
    for (const type of ['MODEL_STATUS', 'MODEL_DOWNLOAD', 'MODEL_CANCEL']) assert.equal(await h.send({ type }, sender), undefined);
  }
  assert.equal(gets, 0);
});

test('账号切换时新检测等待旧不可中断推理结束，不争用同一会话', async () => {
  const started = deferred(), done = deferred(); let active = false, calls = 0, busyFailures = 0;
  const h = harness({ detect: async ({ signal }) => {
    if (active) { busyFailures++; throw new Error('Detector busy'); }
    active = true; calls++;
    try {
      if (calls === 1) { started.resolve(); await done.promise; signal.throwIfAborted(); }
      return { regions: [], detectorRevision: 'test-v1' };
    } finally { active = false; }
  } });
  await h.send({ type: 'CONFIGURE', settings: settings('first') }); const old = h.send(run('1:old')); await started.promise;
  await h.send({ type: 'CONFIGURE', settings: settings('second') }); const replacement = h.send(run('1:new'));
  await tick(); await tick(); assert.equal(busyFailures, 0); done.resolve();
  assert.equal((await old).error.code, 'CANCELLED'); assert.equal((await replacement).ok, true); assert.equal(calls, 2);
});

test('检测与OCR结果只将文本及翻译配置交给LLM，不传图片、框或模型权重', async () => {
  let request;
  const h = harness({ recognize: async () => ({ regions: [{ regionId: 'r1', bbox: { x: 0, y: 0, width: 5, height: 5 }, sourceText: 'Hello', readingOrder: 0 }] }),
    translate: async value => { request = value; return { translations: [{ regionId: 'r1', text: '你好' }] }; } });
  await h.send({ type: 'CONFIGURE', settings: settings('first') }); assert.equal((await h.send(run('1:text'))).ok, true);
  assert.deepEqual(Object.keys(request.regions[0]).sort(), ['readingOrder', 'regionId', 'sourceRevision', 'sourceText']);
  for (const forbidden of ['imageBytes', 'imageBase64', 'imageUrl', 'bbox', 'detection', 'modelBytes']) assert.equal(Object.hasOwn(request, forbidden), false);
  assert.equal(request.regions[0].sourceText, 'Hello');
});

test('真实文本适配器的HTTP请求仅含对白JSON，不含图片或多模态内容', async () => {
  const outgoing = [];
  const translate = createOpenAiAdapter({ apiKey: 'synthetic-not-a-key', fetchImpl: async (url, init) => {
    outgoing.push({ url, init });
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ translations: [{ regionId: 'r1', text: '你好' }] }) } }] }));
  } });
  const h = harness({ translate, recognize: async () => ({ regions: [{ regionId: 'r1', bbox: { x: 0, y: 0, width: 5, height: 5 }, sourceText: 'Hello', readingOrder: 0 }] }) });
  await h.send({ type: 'CONFIGURE', settings: settings('first') });
  await h.send({ ...run('1:prepare'), type: 'PREPARE' }); assert.equal(outgoing.length, 0);
  assert.equal((await h.send(run('1:translate'))).ok, true); assert.equal(outgoing.length, 1);
  assert.equal(outgoing[0].url, OPENAI_ENDPOINT);
  const body = JSON.parse(outgoing[0].init.body);
  assert.ok(body.messages.every(message => typeof message.content === 'string'));
  const payload = JSON.parse(body.messages[1].content);
  assert.deepEqual(Object.keys(payload).sort(), ['context', 'glossary', 'regions', 'sourceLanguage', 'style', 'targetLanguage']);
  assert.deepEqual(payload.regions, [{ regionId: 'r1', sourceText: 'Hello' }]);
  assert.equal(outgoing[0].init.redirect, 'error'); assert.equal(outgoing[0].init.credentials, 'omit');
});
