import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenAiAdapter, OPENAI_ENDPOINT } from '../../extension/adapters/openai.js';
import { createOcrAdapter } from '../../extension/adapters/ocr.js';

const request = { provider: 'openai', model: 'gpt-4.1-mini', sourceLanguage: 'en', targetLanguage: 'zh-CN', regions: [{ regionId: 'r1', sourceText: 'Hello' }, { regionId: 'r2', sourceText: 'World' }] };
const response = translations => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ translations }) } }] }));
const valid = [{ regionId: 'r2', text: '世界' }, { regionId: 'r1', text: '你好' }];

test('OpenAI adapter uses fixed endpoint, strict schema, explicit data and exact ordered IDs', async () => {
  let calls = 0;
  const translate = createOpenAiAdapter({ apiKey: 'test-only', fetchImpl: async (url, init) => {
    calls++;
    assert.equal(url, OPENAI_ENDPOINT);
    assert.equal(init.redirect, 'error');
    const body = JSON.parse(init.body);
    assert.equal(body.store, false);
    assert.equal(body.response_format.json_schema.strict, true);
    assert.equal(JSON.parse(body.messages[1].content).regions[0].sourceText, 'Hello');
    assert.equal(body.tools, undefined);
    return response(valid);
  } });
  assert.deepEqual(await translate(request), { translations: [valid[1], valid[0]] });
  assert.equal(calls, 1);
});

test('OpenAI rejects missing, duplicate, extra and malformed mappings', async () => {
  for (const entries of [valid.slice(1), [valid[0], valid[0]], [...valid, { regionId: 'r3', text: 'x' }], [{ regionId: 'r1', text: 42 }, valid[0]]]) {
    const translate = createOpenAiAdapter({ apiKey: 'test-only', fetchImpl: async () => response(entries) });
    await assert.rejects(translate(request), { code: 'INVALID_RESPONSE' });
  }
});

test('provider errors are redacted and never automatically retried', async () => {
  let calls = 0;
  const translate = createOpenAiAdapter({ apiKey: 'secret-value', fetchImpl: async () => { calls++; throw new Error('secret-value private manga'); } });
  await assert.rejects(translate(request), error => error.code === 'NETWORK' && !/secret-value|private manga/.test(error.message));
  assert.equal(calls, 1);
  await assert.rejects(translate({ ...request, endpoint: 'https://evil.example' }), { code: 'CONFIGURATION' });
  assert.equal(calls, 1);
});

test('timeout and cancellation abort provider fetch; no retries', async () => {
  const fetchImpl = (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  const translate = createOpenAiAdapter({ apiKey: 'test-only', fetchImpl, timeoutMs: 5 });
  await assert.rejects(translate(request), { code: 'TIMEOUT' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(translate(request, { signal: controller.signal }), { name: 'AbortError' });
});

test('empty regions skip provider and response budget rejects excessive output', async () => {
  let calls = 0;
  const translate = createOpenAiAdapter({ apiKey: 'test-only', fetchImpl: async () => { calls++; return new Response('x'.repeat(262145)); } });
  assert.deepEqual(await translate({ ...request, regions: [] }), { translations: [] });
  assert.equal(calls, 0);
  await assert.rejects(translate(request), { code: 'INVALID_RESPONSE' });
});

const paths = { workerPath: '/bundled/worker.js', corePath: '/bundled/core', langPath: '/bundled/lang' };
test('OCR uses packaged paths, explicit blocks, stable original-space regions and releases worker', async () => {
  let terminated = 0;
  const adapter = createOcrAdapter({ ...paths, createWorkerImpl: async (lang, oem, options) => {
    assert.equal(lang, 'eng'); assert.equal(oem, 1); assert.equal(options.workerBlobURL, false); assert.equal(options.cacheMethod, 'none');
    return { setParameters: async () => {}, terminate: async () => { terminated++; }, recognize: async (_, __, output) => {
      assert.equal(output.blocks, true);
      return { data: { blocks: [{ paragraphs: [{ text: 'Hello\n', bbox: { x0: 10, y0: 20, x1: 100, y1: 50 }, confidence: 92 }] }] } };
    } };
  } });
  const result = await adapter.recognize({ imageBytes: new Uint8Array([1]), width: 200, height: 100 });
  assert.deepEqual(result.regions[0], { regionId: 'r1', sourceText: 'Hello', sourceRevision: 0, readingOrder: 0, bbox: { x: 10, y: 20, width: 90, height: 30 }, confidence: 0.92 });
  await adapter.dispose(); assert.equal(terminated, 1);
});

test('OCR rejects remote paths and unbounded dimensions before spawning', async () => {
  assert.throws(() => createOcrAdapter({ ...paths, corePath: 'https://cdn.example' }));
  const adapter = createOcrAdapter({ ...paths, createWorkerImpl: () => { throw new Error('must not spawn'); } });
  await assert.rejects(adapter.recognize({ width: 100000, height: 100000 }));
  await adapter.dispose();
});

test('OCR cancellation terminates active worker and permits a fresh retry', async () => {
  let spawned = 0, terminated = 0, started;
  const ready = new Promise(resolve => { started = resolve; });
  const adapter = createOcrAdapter({ ...paths, createWorkerImpl: async () => {
    spawned++;
    return { setParameters: async () => {}, terminate: async () => { terminated++; }, recognize: async () => {
      if (spawned === 1) { started(); return new Promise(() => {}); }
      return { data: { blocks: [] } };
    } };
  } });
  const controller = new AbortController();
  const promise = adapter.recognize({ imageBytes: new Uint8Array([1]), width: 100, height: 100, signal: controller.signal });
  await ready; controller.abort();
  await assert.rejects(promise, { name: 'AbortError' });
  assert.equal(terminated, 1);
  assert.deepEqual(await adapter.recognize({ imageBytes: new Uint8Array([1]), width: 100, height: 100 }), { regions: [] });
  assert.equal(spawned, 2);
  await adapter.dispose();
});

test('OCR abort and dispose both await shared asynchronous worker termination', async () => {
  let finishTermination, started, spawned = 0, settled = false;
  const terminated = new Promise(resolve => { finishTermination = resolve; });
  const ready = new Promise(resolve => { started = resolve; });
  const adapter = createOcrAdapter({ ...paths, createWorkerImpl: async () => {
    spawned++;
    return { setParameters: async () => {}, terminate: () => terminated, recognize: async () => { started(); return new Promise(() => {}); } };
  } });
  const controller = new AbortController();
  const input = { imageBytes: new Uint8Array([1]), width: 100, height: 100 };
  const pending = adapter.recognize({ ...input, signal: controller.signal }).catch(error => { settled = true; return error; });
  await ready; controller.abort();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false, 'recognition retains the resource slot until termination');
  await assert.rejects(adapter.recognize(input), /one active recognition/);
  let disposed = false;
  const disposing = adapter.dispose().then(() => { disposed = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(disposed, false);
  assert.equal(spawned, 1);
  finishTermination();
  assert.equal((await pending).name, 'AbortError'); await disposing;
  assert.equal(disposed, true);
});

test('OCR cancellation while setting parameters never dispatches recognize afterward', async () => {
  let finishParameters, started, calls = 0;
  const parameters = new Promise(resolve => { finishParameters = resolve; });
  const ready = new Promise(resolve => { started = resolve; });
  const adapter = createOcrAdapter({ ...paths, createWorkerImpl: async () => ({
    setParameters: async () => { started(); await parameters; }, terminate: async () => {},
    recognize: async () => { calls++; return { data: { blocks: [] } }; },
  }) });
  const controller = new AbortController();
  const pending = adapter.recognize({ imageBytes: new Uint8Array([1]), width: 100, height: 100, signal: controller.signal });
  await ready; controller.abort(); await assert.rejects(pending, { name: 'AbortError' });
  finishParameters(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 0); await adapter.dispose();
});
