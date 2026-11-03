import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createPipeline, BoundedQueue } from '../../packages/core/index.js';
import { safeError } from '../../extension/security.js';

const source = (await readFile(new URL('../../extension/offscreen.js', import.meta.url), 'utf8')).replace(/^import[^\n]*\n/gm, '');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const bitmap = () => ({ width: 10, height: 10, close() {} });
const settings = accountNamespace => ({ accountNamespace, apiKey: 'synthetic-not-a-key', model: 'test-model', targetLanguage: 'Chinese' });
const run = id => ({ type: 'RUN', id, tabId: 1, imageBase64: 'AQ==', mime: 'image/png', namespace: 'https://reader.example.com' });
function harness({ decode = async () => bitmap(), recognize = async () => ({ regions: [] }), translate } = {}) {
  let listener;
  const scope = vm.createContext({
    createPipeline, BoundedQueue, createRegionDetector: () => ({ detect: async () => ({ regions: [], detectorRevision: 'test-v1' }) }), DETECTOR_REVISION: 'test-v1', createOcrAdapter: () => ({ recognize, dispose: async () => {} }),
    createOpenAiAdapter: () => translate || (async request => ({ translations: request.regions.map(r => ({ regionId: r.regionId, text: 'Synthetic translation' })) })),
    OPENAI_ENDPOINT: 'https://api.openai.com/v1/chat/completions', PROMPT_VERSION: 'test-1', SCHEMA_VERSION: 'test-1', MAX_IMAGE_BYTES: 4194304, MAX_PIXELS: 16000000,
    safeError, inspectImage: () => ({ width: 10, height: 10 }), createImageBitmap: decode,
    chrome: { runtime: { id: 'test', getURL: p => `chrome-extension://test/${p}`, onMessage: { addListener: fn => { listener = fn; } } } },
    Uint8Array, atob, Blob, AbortController, performance,
  });
  vm.runInContext(source, scope);
  const send = message => new Promise(resolve => listener({ ...message, target: 'executor' }, { id: 'test', url: 'chrome-extension://test/background.js' }, resolve));
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
