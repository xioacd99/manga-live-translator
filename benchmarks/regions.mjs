// 独立绘制的几何夹具，无漫画、字体或下载模型；数据仅用于回归，不代表漫画准确率。
import { performance } from 'node:perf_hooks';
import { detectRegionsFromRgba, DETECTOR_REVISION } from '../extension/adapters/regions.js';
import { createOcrAdapter } from '../extension/adapters/ocr.js';
import { createWorker } from 'tesseract.js';
import { createEnglishBitmap } from '../tests/fixtures/generated-english.js';

function sample(name, draw) {
  const width = 320, height = 240, data = new Uint8ClampedArray(width * height * 4).fill(255), expected = [];
  const rect = (x, y, w, h, value) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      const p = (yy * width + xx) * 4; data[p] = data[p + 1] = data[p + 2] = value;
    }
  };
  const frame = (x, y, w, h, truth = true) => {
    rect(x, y, w, h, 0); rect(x + 2, y + 2, w - 4, h - 4, 255);
    rect(x + 18, y + 20, 5, 15, 0); rect(x + 29, y + 20, 5, 15, 0);
    if (truth) expected.push({ x: x + 2, y: y + 2, width: w - 4, height: h - 4 });
  };
  draw({ rect, frame, expected }); return { name, data, width, height, expected };
}
const samples = [
  sample('封闭矩形气泡', ({ frame }) => { frame(20, 20, 100, 70); frame(160, 120, 100, 70); }),
  sample('旁白框', ({ frame }) => frame(20, 20, 280, 65)),
  sample('无边框对白', ({ rect, expected }) => { rect(30, 30, 5, 15, 0); rect(40, 30, 5, 15, 0); expected.push({ x: 30, y: 30, width: 15, height: 15 }); }),
  sample('无文字白页', () => {}),
  sample('断裂异常边框', ({ frame, rect }) => { frame(20, 20, 100, 70); rect(20, 20, 4, 70, 255); }),
  sample('多列气泡', ({ frame }) => { frame(180, 20, 100, 70); frame(20, 20, 100, 70); frame(180, 120, 100, 70); frame(20, 120, 100, 70); }),
  sample('框内图案非文字误检', ({ frame }) => frame(20, 20, 100, 70, false)),
];
const iou = (a, b) => {
  const intersection = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return intersection / (a.width * a.height + b.width * b.height - intersection);
};
const rows = samples.map(input => {
  const times = []; let output;
  for (let i = 0; i < 25; i++) { const start = performance.now(); output = detectRegionsFromRgba(input); times.push(performance.now() - start); }
  times.sort((a, b) => a - b);
  const unused = new Set(input.expected.map((_, i) => i)); let matched = 0, sumIoU = 0;
  for (const region of output.regions) {
    const best = [...unused].map(i => [i, iou(region.bbox, input.expected[i])]).sort((a, b) => b[1] - a[1])[0];
    if (best?.[1] >= 0.5) { unused.delete(best[0]); matched++; sumIoU += best[1]; }
  }
  return { name: input.name, expected: input.expected.length, detected: output.regions.length, truePositive: matched, falsePositive: output.regions.length - matched, falseNegative: unused.size,
    precision: output.regions.length ? matched / output.regions.length : null, recall: input.expected.length ? matched / input.expected.length : null,
    matchedMeanIoU: matched ? sumIoU / matched : null, p50Ms: +times[12].toFixed(3), p95Ms: +times[23].toFixed(3),
    boxes: output.regions.map(r => r.bbox), fallbackReason: output.fallbackReason ?? null };
});
const root = new URL('../node_modules/', import.meta.url).pathname, captures = [];
const adapter = createOcrAdapter({ workerPath: `${root}tesseract.js/src/worker-script/node/index.js`, corePath: `${root}tesseract.js-core`, langPath: `${root}@tesseract.js-data/eng/4.0.0_best_int`, createWorkerImpl: async (...args) => {
  const worker = await createWorker(...args), recognize = worker.recognize.bind(worker);
  worker.recognize = async (...args) => {
    const start = performance.now(), output = await recognize(...args);
    captures.push({ rectangle: args[1]?.rectangle ?? null, ms: +(performance.now() - start).toFixed(3), paragraphs: (output.data.blocks ?? []).flatMap(b => b.paragraphs ?? []).map(p => ({ text: p.text.trim(), confidence: p.confidence, bbox: p.bbox })) });
    return output;
  }; return worker;
} });
let ocr;
try {
  const input = createEnglishBitmap(), start = performance.now();
  const baseline = await adapter.recognize(input), baselineWithStartupMs = +(performance.now() - start).toFixed(3);
  const cropStart = performance.now();
  const cropWithFallback = await adapter.recognize({ ...input, config: { regionMode: 'regions-only', regions: [{ bbox: { x: 390, y: 20, width: 330, height: 110 }, confidence: 0.8 }] } });
  ocr = { baselineWithStartupMs, warmCropWithFallbackMs: +(performance.now() - cropStart).toFixed(3), baseline, cropWithFallback, actualCalls: captures };
} finally { await adapter.dispose(); }
const tp = rows.reduce((s, r) => s + r.truePositive, 0), fp = rows.reduce((s, r) => s + r.falsePositive, 0), fn = rows.reduce((s, r) => s + r.falseNegative, 0);
console.log(JSON.stringify({ detectorRevision: DETECTOR_REVISION, node: process.version, platform: `${process.platform}/${process.arch}`, samplePixels: 320 * 240, repetitions: 25,
  aggregate: { truePositive: tp, falsePositive: fp, falseNegative: fn, precision: tp / (tp + fp), recall: tp / (tp + fn) },
  calculatedBufferBytes: { light: 1048576, queue: 4194304, rgbaInput: 4194304, totalIncludingInput: 9437184 },
  rows, ocr, limits: '仅自制合成回归；计时非 M4、真实漫画或真实网站性能；缓冲大小是计算上限而非进程峰值实测。' }, null, 2));
