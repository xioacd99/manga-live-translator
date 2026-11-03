import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegionDetector, detectRegionsFromRgba, DETECTOR_REVISION } from '../../extension/adapters/regions.js';

function fixture() {
  const width = 160, height = 100, data = new Uint8ClampedArray(width * height * 4).fill(255);
  const rect = (x, y, w, h, color) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      const p = (yy * width + xx) * 4;
      data[p] = data[p + 1] = data[p + 2] = color;
    }
  };
  rect(10, 10, 60, 50, 0); rect(12, 12, 56, 46, 255); rect(25, 25, 6, 15, 0);
  rect(90, 30, 60, 50, 0); rect(92, 32, 56, 46, 255); rect(105, 45, 6, 15, 0);
  return { data, width, height, rect };
}

test('封闭亮色气泡提取、位置与阅读顺序来自实际 RGBA', () => {
  const input = fixture(), output = detectRegionsFromRgba(input);
  assert.equal(output.detectorRevision, DETECTOR_REVISION);
  assert.equal(output.experimental, true);
  assert.deepEqual(output.regions.map(r => r.bbox), [{ x: 12, y: 12, width: 56, height: 46 }, { x: 92, y: 32, width: 56, height: 46 }]);
  assert.deepEqual(output.regions.map(r => r.readingOrder), [0, 1]);
});

test('无文字、断裂边框和边缘背景保守回退，不把背景当作气泡', () => {
  const input = fixture(); input.rect(10, 10, 150, 90, 255);
  assert.equal(detectRegionsFromRgba(input).fallbackReason, 'no-confident-region');
  const broken = fixture(); broken.rect(10, 10, 3, 50, 255); broken.rect(90, 30, 3, 50, 255);
  assert.equal(detectRegionsFromRgba(broken).regions.length, 0);
});

test('检测像素预算、参数与取消检查', () => {
  assert.throws(() => detectRegionsFromRgba({ data: new Uint8Array(0), width: 2000, height: 2000 }), /oversized/);
  assert.throws(() => detectRegionsFromRgba({ ...fixture(), config: { lightThreshold: 1 } }), /threshold/);
  const controller = new AbortController(); controller.abort();
  assert.throws(() => detectRegionsFromRgba({ ...fixture(), signal: controller.signal }), { name: 'AbortError' });
});

test('浏览器解码映射到原图坐标并关闭位图', async () => {
  let closed = 0;
  const input = fixture();
  const detector = createRegionDetector({ createImageBitmapImpl: async () => ({ width: 160, height: 100, close: () => closed++ }), Canvas: class {
    getContext() { return { drawImage() {}, getImageData: () => ({ data: input.data }) }; }
  } });
  const output = await detector.detect({ imageBytes: new Uint8Array([1]), width: 160, height: 100 });
  assert.equal(output.regions.length, 2); assert.equal(closed, 1);
  await assert.rejects(detector.detect({ imageBytes: new Uint8Array([1]), width: 161, height: 100 }), /mismatch/);
  assert.equal(closed, 2);
});

test('整图选项与无解码器有明确回退原因', async () => {
  const detector = createRegionDetector({ createImageBitmapImpl: null, Canvas: null });
  const input = { imageBytes: new Uint8Array([1]), width: 100, height: 100 };
  assert.equal((await detector.detect(input)).fallbackReason, 'decoder-unavailable');
  assert.equal((await detector.detect({ ...input, config: { regionMode: 'whole-image' } })).fallbackReason, 'whole-image-requested');
});

test('超过采样预算时缩小检测并向外取整映射原图框', async () => {
  let size, closed = false;
  const detector = createRegionDetector({ createImageBitmapImpl: async () => ({ width: 2000, height: 1000, close: () => { closed = true; } }), Canvas: class {
    constructor(w, h) { size = [w, h]; }
    getContext() { return { drawImage() {}, getImageData() {
      const [w, h] = size, data = new Uint8ClampedArray(w * h * 4).fill(255);
      const paint = (x, y, ww, hh, color) => { for (let yy = y; yy < y + hh; yy++) for (let xx = x; xx < x + ww; xx++) { const i = (yy * w + xx) * 4; data[i] = data[i + 1] = data[i + 2] = color; } };
      paint(10, 10, 60, 50, 0); paint(12, 12, 56, 46, 255); paint(25, 25, 6, 15, 0);
      return { data };
    } }; }
  } });
  const output = await detector.detect({ imageBytes: new Uint8Array([1]), width: 2000, height: 1000 });
  assert.ok(size[0] * size[1] <= 1048576); assert.equal(output.regions.length, 1);
  const box = output.regions[0].bbox;
  assert.equal(box.x, Math.floor(12 * 2000 / size[0]));
  assert.equal(box.y, Math.floor(12 * 1000 / size[1]));
  assert.equal(box.x + box.width, Math.ceil(68 * 2000 / size[0]));
  assert.equal(box.y + box.height, Math.ceil(58 * 1000 / size[1]));
  assert.equal(closed, true);
});

test('解码后取消仍关闭位图且不启动像素读取', async () => {
  const controller = new AbortController(); let closed = false;
  const detector = createRegionDetector({ createImageBitmapImpl: async () => {
    controller.abort(); return { width: 100, height: 100, close: () => { closed = true; } };
  }, Canvas: class { constructor() { throw new Error('Must not allocate canvas'); } } });
  await assert.rejects(detector.detect({ imageBytes: new Uint8Array([1]), width: 100, height: 100, signal: controller.signal }), { name: 'AbortError' });
  assert.equal(closed, true);
});
