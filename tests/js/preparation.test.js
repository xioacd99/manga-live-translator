import test from 'node:test';
import assert from 'node:assert/strict';
import { createPipeline, detectionKey, ocrKey, validateDetectionResult } from '../../packages/core/index.js';
const geometry = { regionId: 'bubble_0', bbox: { x: 2, y: 3, width: 30, height: 20 }, confidence: 0.7, readingOrder: 0 };
const detected = () => ({ regions: [structuredClone(geometry)], detectorRevision: 'fixture-v1', experimental: true });
const recognized = () => ({ regions: [{ ...structuredClone(geometry), sourceText: 'Hello' }] });
const input = () => ({ imageBytes: new Uint8Array([1, 2, 3]), width: 100, height: 100, namespace: 'test:site',
  detectionConfig: { revision: 'fixture-v1', threshold: 120 }, ocrConfig: { cropVersion: 1 },
  translation: { sourceLanguage: 'en', targetLanguage: 'zh', provider: 'fixture', endpoint: 'https://example.invalid', accountNamespace: 'test', model: 'fixture', context: 'scene' } });
function setup(options = {}) {
  return createPipeline({ detect: async () => detected(), ocr: async () => recognized(),
    translate: async request => ({ translations: request.regions.map(region => ({ regionId: region.regionId, text: '你好' })) }), ...options });
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function until(check) { for (let n = 0; n < 100; n++) { if (check()) return; await tick(); } throw new Error('Condition not reached'); }

test('准备仅运行检测与 OCR，不要求翻译配置或适配器', async () => {
  let received;
  const pipeline = createPipeline({ detect: async () => detected(), ocr: async args => { received = args; return recognized(); } });
  const request = input(); delete request.translation;
  const result = await pipeline.prepare(request);
  assert.equal(result.regions[0].sourceText, 'Hello'); assert.equal(result.translations, undefined);
  assert.deepEqual(received.config.regions, [geometry]); assert.equal(received.config.detectorRevision, 'fixture-v1');
  assert.equal(pipeline.diagnostics().translationCalls, 0);
  await assert.rejects(pipeline.run(request), /Translation adapter/);
});

test('准备、正式翻译与热重放复用同一检测和 OCR 缓存', async () => {
  const pipeline = setup(); const prepared = await pipeline.prepare(input());
  prepared.detection.regions[0].bbox.x = 999; prepared.regions[0].sourceText = 'poison';
  const run = await pipeline.run(input()); await pipeline.run(input());
  assert.equal(run.regions[0].sourceText, 'Hello'); assert.equal(run.detection.regions[0].bbox.x, 2);
  const d = pipeline.diagnostics();
  for (const kind of ['detection', 'ocr']) { assert.equal(d[kind + 'Calls'], 1); assert.equal(d[kind + 'Hits'], 2); assert.equal(d[kind + 'Entries'], 1); }
  assert.equal(d.translationCalls, 1); assert.equal(d.preparationCalls, 1);
});

test('上下文不影响检测与 OCR；检测修订和阈值失效两层，裁剪修订仅失效 OCR', async () => {
  const pipeline = setup(); await pipeline.run(input());
  await pipeline.run({ ...input(), translation: { ...input().translation, context: 'new scene' } });
  assert.equal(pipeline.diagnostics().detectionCalls, 1); assert.equal(pipeline.diagnostics().ocrCalls, 1);
  await pipeline.prepare({ ...input(), detectionConfig: { ...input().detectionConfig, revision: 'fixture-v2' } });
  await pipeline.prepare({ ...input(), detectionConfig: { ...input().detectionConfig, threshold: 121 } });
  await pipeline.prepare({ ...input(), ocrConfig: { cropVersion: 2 } });
  assert.equal(pipeline.diagnostics().detectionCalls, 3); assert.equal(pipeline.diagnostics().ocrCalls, 4);
});

test('检测键隔离图片、尺寸和命名空间，OCR 键包含实际几何', async () => {
  const base = { imageHash: 'hash', width: 100, height: 100, namespace: 'a', detectionConfig: { threshold: 120, revision: 1 } };
  const key = await detectionKey(base);
  assert.equal(key, await detectionKey({ ...base, detectionConfig: { revision: 1, threshold: 120 } }));
  for (const change of [{ imageHash: 'other' }, { width: 99 }, { height: 99 }, { namespace: 'b' }, { detectionConfig: { revision: 2 } }]) assert.notEqual(key, await detectionKey({ ...base, ...change }));
  const ocrBase = { ...base, ocrConfig: { cropVersion: 1 }, detection: detected() };
  const changed = detected(); changed.regions[0].bbox.x++;
  assert.notEqual(await ocrKey(ocrBase), await ocrKey({ ...ocrBase, detection: changed }));
});

test('禁用检测保留旧适配器行为，显式启用缺失的检测器报错', async () => {
  let called = 0; const pipeline = setup({ detect: undefined, ocr: async () => { called++; return recognized(); } });
  const request = input(); delete request.detectionConfig;
  await pipeline.prepare(request); await pipeline.prepare({ ...request, detectionConfig: { enabled: false, revision: 5 } });
  assert.equal(called, 1); assert.equal(pipeline.diagnostics().detectionCalls, 0);
  await assert.rejects(pipeline.prepare(input()), /Detection adapter/);
});

test('检测配置、原图与识别配置在异步操作前快照，适配器修改不会污染身份', async () => {
  const pipeline = setup({ detect: async args => { args.imageBytes[0] = 99; args.config.threshold = 999; return detected(); },
    ocr: async args => { assert.equal(args.imageBytes[0], 1); args.config.regions[0].bbox.x = 99; return recognized(); } });
  const request = input(); const pending = pipeline.prepare(request);
  request.detectionConfig.threshold = 222; request.ocrConfig.cropVersion = 3; request.imageBytes[0] = 88;
  const first = await pending, second = await pipeline.prepare(input());
  assert.equal(first.detectionKey, second.detectionKey); assert.equal(first.ocrKey, second.ocrKey); assert.equal(second.detection.regions[0].bbox.x, 2);
  assert.equal(pipeline.diagnostics().detectionCalls, 1);
});

test('非法、越界、重复和带文本的检测框均不能入缓存', async () => {
  const bad = [
    { ...detected(), regions: [{ ...geometry, sourceText: 'not allowed' }] },
    { ...detected(), regions: [{ ...geometry, bbox: { ...geometry.bbox, width: 1000 } }] },
    { ...detected(), regions: [{ ...geometry, bbox: { ...geometry.bbox, x: NaN } }] },
    { ...detected(), regions: [{ ...geometry, confidence: 2 }] },
    { ...detected(), regions: [geometry, geometry] },
    { ...detected(), regions: Array(257).fill(geometry) },
    { ...detected(), detectorRevision: '' }, { ...detected(), secret: 'not allowed' }
  ];
  for (const result of bad) {
    assert.throws(() => validateDetectionResult(result, { width: 100, height: 100 }));
    const pipeline = setup({ detect: async () => result });
    await assert.rejects(pipeline.prepare(input())); await assert.rejects(pipeline.prepare(input()));
    assert.equal(pipeline.diagnostics().detectionEntries, 0); assert.equal(pipeline.diagnostics().detectionCalls, 2); assert.equal(pipeline.diagnostics().ocrCalls, 0);
  }
});

test('准备与翻译共享检测任务，取消一个订阅者不终止另一个', async () => {
  const gate = deferred(); let shared;
  const pipeline = setup({ detect: async ({ signal }) => { shared = signal; await gate.promise; return detected(); } });
  const controller = new AbortController();
  const first = pipeline.prepare(input(), { signal: controller.signal }); const failure = assert.rejects(first, { name: 'AbortError' });
  const second = pipeline.run(input()); await until(() => pipeline.diagnostics().detectionCoalesced === 1);
  controller.abort(); await failure; assert.equal(shared.aborted, false); gate.resolve(); await second;
  assert.equal(pipeline.diagnostics().detectionCalls, 1); assert.equal(pipeline.diagnostics().ocrCalls, 1);
});

test('全部取消后忽略取消的检测结果不得迟写缓存或触发 OCR', async () => {
  const gate = deferred(); let started = false;
  const pipeline = setup({ detect: async () => { started = true; await gate.promise; return detected(); } });
  const controller = new AbortController(); const pending = pipeline.prepare(input(), { signal: controller.signal });
  const failure = assert.rejects(pending, { name: 'AbortError' }); await until(() => started);
  controller.abort(); await failure; gate.resolve(); await tick();
  assert.equal(pipeline.diagnostics().detectionEntries, 0); assert.equal(pipeline.diagnostics().ocrCalls, 0);
});

test('清空后新任务不加入旧检测任务，旧任务不能恢复任何缓存层', async () => {
  const gate = deferred(); let calls = 0;
  const pipeline = setup({ detectionConcurrency: 2, detect: async () => { if (++calls === 1) await gate.promise; return detected(); } });
  const old = pipeline.run(input()); await until(() => calls === 1); pipeline.clear();
  await pipeline.prepare(input()); assert.equal(calls, 2); gate.resolve(); await old;
  const d = pipeline.diagnostics(); assert.equal(d.detectionEntries, 1); assert.equal(d.ocrEntries, 1); assert.equal(d.translationEntries, 0); assert.equal(d.detectionCoalesced, 0);
});

test('检测失败可重试，排队受限，清空期间的晚到准备结果不缓存', async () => {
  let fail = true; const retry = setup({ detect: async () => { if (fail) throw new Error('fixture failure'); return detected(); } });
  await assert.rejects(retry.prepare(input()), /fixture failure/); fail = false; await retry.prepare(input()); assert.equal(retry.diagnostics().detectionCalls, 2);
  const gate = deferred(); const pipeline = setup({ maxQueue: 0, detect: async () => { await gate.promise; return detected(); } });
  const first = pipeline.prepare(input()); await until(() => pipeline.diagnostics().detectionCalls === 1);
  await assert.rejects(pipeline.prepare({ ...input(), namespace: 'other' }), { name: 'QueueFullError' });
  pipeline.clear(); gate.resolve(); await first;
  assert.equal(pipeline.diagnostics().detectionEntries, 0); assert.equal(pipeline.diagnostics().ocrEntries, 0);
});
