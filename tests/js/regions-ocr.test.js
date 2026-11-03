import test from 'node:test';
import assert from 'node:assert/strict';
import { createOcrAdapter, mergeOcrRegions } from '../../extension/adapters/ocr.js';
import { createWorker } from 'tesseract.js';
import { createEnglishBitmap } from '../fixtures/generated-english.js';

const paths = { workerPath: '/bundled/worker.js', corePath: '/bundled/core', langPath: '/bundled/lang' };
const input = { imageBytes: new Uint8Array([1]), width: 200, height: 100 };
const crop = { bbox: { x: 30, y: 20, width: 100, height: 50 }, confidence: 0.6 };
const paragraph = (text, x0 = 40, y0 = 30, confidence = 90) => ({ text, bbox: { x0, y0, x1: x0 + 40, y1: y0 + 15 }, confidence });
function mock(recognize) {
  return createOcrAdapter({ ...paths, createWorkerImpl: async () => ({ setParameters: async () => {}, terminate: async () => {}, recognize: async (_, options) => ({ data: { blocks: [{ paragraphs: await recognize(options) }] } }) }) });
}

test('默认局部 OCR 后整图补漏，重复区域合并且气泡外文字保留', async () => {
  const calls = [];
  const adapter = mock(options => {
    calls.push(options);
    return options.rectangle ? [paragraph('Hello')] : [paragraph('Outside', 140, 75), paragraph('Hello')];
  });
  try {
    const result = await adapter.recognize({ ...input, config: { regions: [crop, crop] } });
    assert.deepEqual(calls, [{ rectangle: { left: 30, top: 20, width: 100, height: 50 } }, {}]);
    assert.deepEqual(result.regions.map(r => [r.sourceText, r.bbox.x, r.readingOrder]), [['Hello', 40, 0], ['Outside', 140, 1]]);
  } finally { await adapter.dispose(); }
});

test('整图显式选择、异常框、无框和低置信度检测直接整图回退', async () => {
  for (const config of [
    { regionMode: 'whole-image', regions: [crop] },
    { regionMode: 'regions-only', regions: [] },
    { regionMode: 'regions-only', regions: [{ ...crop, confidence: 0.1 }] },
    { regionMode: 'regions-only', regions: [{ ...crop, bbox: { ...crop.bbox, x: -1 } }] },
    { regionMode: 'regions-only', regions: Array(33).fill(crop) },
  ]) {
    const calls = [], adapter = mock(options => { calls.push(options); return []; });
    try { await adapter.recognize({ ...input, config }); assert.deepEqual(calls, [{}]); }
    finally { await adapter.dispose(); }
  }
});

test('实验局部模式遇到空识别或低置信度 OCR 也整图回退', async () => {
  for (const output of [[], [paragraph('Hello', 40, 30, 10)]]) {
    const calls = [], adapter = mock(options => { calls.push(options); return output; });
    try {
      await adapter.recognize({ ...input, config: { regionMode: 'regions-only', regions: [crop] } });
      assert.equal(calls.length, 2); assert.deepEqual(calls[1], {});
    } finally { await adapter.dispose(); }
  }
});

test('跨气泡相同对白保留，整图合并段落不会留下重复短段落', () => {
  const r = (sourceText, x, width) => ({ sourceText, bbox: { x, y: 10, width, height: 20 } });
  assert.equal(mergeOcrRegions([r('Hello', 10, 40), r('Hello', 80, 40)]).length, 2);
  const merged = mergeOcrRegions([r('HELLO', 10, 40), r('WORLD', 60, 40), r('HELLO WORLD', 10, 90)]);
  assert.equal(merged.length, 1); assert.equal(merged[0].sourceText, 'HELLO WORLD');
});

test('裁剪识别期间取消后不启动整图补漏', async () => {
  const controller = new AbortController(); let calls = 0;
  const adapter = mock(() => { calls++; controller.abort(); return [paragraph('Hello')]; });
  try {
    await assert.rejects(adapter.recognize({ ...input, config: { regions: [crop] }, signal: controller.signal }), { name: 'AbortError' });
    assert.equal(calls, 1);
  } finally { await adapter.dispose(); }
});

test('真实打包 Tesseract rectangle 返回原图坐标，低置信度结果回退整图', { timeout: 30000 }, async () => {
  const root = new URL('../../node_modules/', import.meta.url).pathname;
  const captures = [];
  const adapter = createOcrAdapter({ workerPath: `${root}tesseract.js/src/worker-script/node/index.js`, corePath: `${root}tesseract.js-core`, langPath: `${root}@tesseract.js-data/eng/4.0.0_best_int`, createWorkerImpl: async (...args) => {
    const worker = await createWorker(...args), recognize = worker.recognize.bind(worker);
    worker.recognize = async (...input) => { const output = await recognize(...input); captures.push({ options: input[1], data: output.data }); return output; };
    return worker;
  } });
  try {
    const result = await adapter.recognize({ ...createEnglishBitmap(), config: { regionMode: 'regions-only', regions: [{ bbox: { x: 390, y: 20, width: 330, height: 110 }, confidence: 0.8 }] } });
    assert.equal(result.regions.length, 1);
    assert.equal(result.regions[0].sourceText, 'HELLO WORLD');
    assert.equal(captures.length, 2);
    assert.deepEqual(captures[0].options.rectangle, { left: 390, top: 20, width: 330, height: 110 });
    const actualCrop = captures[0].data.blocks.flatMap(b => b.paragraphs)[0];
    assert.deepEqual(actualCrop.bbox, { x0: 410, y0: 40, x1: 700, y1: 110 });
    assert.ok(actualCrop.confidence < 50);
    assert.deepEqual(captures[1].options, {});
  } finally { await adapter.dispose(); }
});
