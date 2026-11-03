import test from 'node:test';
import assert from 'node:assert/strict';
import { createPretrainedRegionDetector, decodePretrainedOutputs, selectPretrainedRegions, planDetectorTiles, PRETRAINED_MODEL_SHA256, PRETRAINED_MODEL_BYTES, PRETRAINED_DETECTOR_REVISION } from '../../extension/adapters/pretrained-regions.js';

function outputs(rows = []) {
  const labels = { dims: [1, 300], data: new BigInt64Array(300) };
  const scores = { dims: [1, 300], data: new Float32Array(300) };
  const boxes = { dims: [1, 300, 4], data: new Float32Array(1200) };
  rows.forEach(([label, score, box], i) => { labels.data[i] = BigInt(label); scores.data[i] = score; boxes.data.set(box, i * 4); });
  return { labels, scores, boxes };
}
const tile = { x: 0, y: 0, width: 100, height: 100 };
function harness(options = {}) {
  const events = [], feeds = [];
  let closed = 0, released = 0, creates = 0;
  const session = { run: async f => { feeds.push(f); return options.output || outputs(); }, release: async () => { released++; events.push('release'); } };
  class Tensor { constructor(type, data, dims) { Object.assign(this, { type, data, dims }); } dispose() { events.push('tensor-dispose'); } }
  class Canvas {
    getContext() { return { fillRect() {}, drawImage(...args) { events.push(args.slice(1)); }, getImageData() { const data = new Uint8ClampedArray(640 * 640 * 4); data.set([255, 128, 0, 255]); return { data }; } }; }
  }
  const detector = createPretrainedRegionDetector({
    ort: { env: { wasm: {} }, Tensor }, wasmPaths: '/runtime/',
    loadModel: async () => new Uint8Array(PRETRAINED_MODEL_BYTES),
    cryptoImpl: { subtle: { digest: async () => Uint8Array.from(PRETRAINED_MODEL_SHA256.match(/../g), n => parseInt(n, 16)) } },
    createSessionImpl: async (bytes, config) => { creates++; assert.equal(bytes.byteLength, PRETRAINED_MODEL_BYTES); assert.deepEqual(config.executionProviders, ['wasm']); return session; },
    createImageBitmapImpl: async () => ({ width: options.width || 100, height: options.height || 100, close() { closed++; } }), Canvas,
    ...options.dependencies,
  });
  return { detector, session, feeds, events, get closed() { return closed; }, get released() { return released; }, get creates() { return creates; } };
}
const request = { imageBytes: new Uint8Array([1]), width: 100, height: 100 };

test('预训练输出采用实际 300 查询格式，优先文字且不重复 OCR 气泡', () => {
  const raw = outputs([[0, .9, [0, 0, 60, 60]], [1, .8, [10, 10, 50, 30]], [2, .7, [65, 65, 90, 90]], [0, .4, [0, 70, 20, 90]]]);
  const result = selectPretrainedRegions(decodePretrainedOutputs(raw, tile), 100, 100);
  assert.equal(result.regions.length, 3);
  assert.deepEqual(result.regions[0].bbox, { x: 10, y: 10, width: 40, height: 20 });
  assert.ok(Math.abs(result.regions[0].confidence - .8) < 1e-6);
  assert.equal(result.detectorRevision, PRETRAINED_DETECTOR_REVISION);
  assert.deepEqual(Object.keys(result.regions[0]).sort(), ['bbox', 'confidence', 'readingOrder', 'regionId']);
});

test('边界裁剪、向外取整、原图偏移以及跨类别去重', () => {
  const candidates = decodePretrainedOutputs(outputs([[1, .8, [-2, 1.2, 40.2, 50]], [2, .7, [0, 1, 40, 50]]]), { ...tile, y: 100 });
  assert.deepEqual(candidates[0].bbox, { x: 0, y: 101, width: 41, height: 49 });
  assert.equal(selectPretrainedRegions(candidates, 100, 200).regions.length, 1);
});

test('拒绝恶意模型输出、错误几何和尺寸', () => {
  for (const mutate of [o => { o.labels.data[0] = 999n; }, o => { o.scores.data[0] = NaN; }, o => { o.boxes.data[0] = Infinity; }, o => { o.boxes.dims = [300, 4]; }, o => { o.boxes.data[2] = -10; }]) {
    const raw = outputs([[1, .8, [1, 1, 20, 20]]]); mutate(raw);
    assert.throws(() => decodePretrainedOutputs(raw, tile), /Invalid/);
  }
  assert.throws(() => selectPretrainedRegions([{ label: 1, confidence: .8, bbox: { x: 90, y: 0, width: 20, height: 10 } }], 100, 100));
  assert.throws(() => planDetectorTiles(1e9, 1));
});

test('长图重叠分块覆盖首尾，超出预算不悄悄遗漏', () => {
  const tiles = planDetectorTiles(100, 1000);
  assert.equal(tiles[0].y, 0);
  assert.equal(tiles.at(-1).y + tiles.at(-1).height, 1000);
  for (let i = 1; i < tiles.length; i++) assert.ok(tiles[i].y < tiles[i - 1].y + tiles[i - 1].height);
  assert.throws(() => planDetectorTiles(10, 1000), /tile budget/);
});

test('区域数量超额和零检测使用显式回退原因', () => {
  assert.equal(selectPretrainedRegions([], 100, 100).fallbackReason, 'no-confident-region');
  const candidates = Array.from({ length: 33 }, (_, i) => ({ label: 1, confidence: .8, bbox: { x: i * 2, y: 0, width: 1, height: 1 } }));
  assert.equal(selectPretrainedRegions(candidates, 100, 100).fallbackReason, 'region-budget');
});

test('RGB NCHW 与宽高 int64 输入，重用一个会话且释放所有位图', async () => {
  const h = harness();
  await h.detector.detect(request); await h.detector.detect(request);
  assert.equal(h.creates, 1); assert.equal(h.closed, 2);
  const f = h.feeds[0];
  assert.deepEqual(f.images.dims, [1, 3, 640, 640]);
  assert.equal(f.images.data[0], 1); assert.ok(Math.abs(f.images.data[640 * 640] - 128 / 255) < 1e-6); assert.equal(f.images.data[2 * 640 * 640], 0);
  assert.deepEqual([...f.orig_target_sizes.data], [100n, 100n]);
  await h.detector.dispose(); await h.detector.dispose(); assert.equal(h.released, 1);
  await assert.rejects(h.detector.detect(request), /disposed/);
});

test('长图推理输出恢复原图坐标并消除重叠分块重复框', async () => {
  const h = harness({ width: 100, height: 300 });
  h.session.run = async f => {
    h.feeds.push(f);
    return h.feeds.length === 1 ? outputs([[1, .8, [10, 130, 30, 145]]]) : h.feeds.length === 2 ? outputs([[1, .7, [10, 10, 30, 25]]]) : outputs();
  };
  const r = await h.detector.detect({ ...request, height: 300 });
  assert.equal(r.regions.length, 1); assert.equal(r.regions[0].bbox.y, 130);
  assert.deepEqual([...h.feeds[0].orig_target_sizes.data], [100n, 150n]);
  await h.detector.dispose();
});

test('损坏或缺失模型不创建会话且关闭位图', async () => {
  for (const dependencies of [{ loadModel: async () => new Uint8Array(2) }, { cryptoImpl: { subtle: { digest: async () => new Uint8Array(32) } } }, { loadModel: async () => { throw new Error('Model not downloaded.'); } }]) {
    const h = harness({ dependencies });
    await assert.rejects(h.detector.detect(request), /size mismatch|integrity|not downloaded/);
    assert.equal(h.creates, 0); assert.equal(h.closed, 1); await h.detector.dispose();
  }
});

test('拒绝远端运行时、超量图片、尺寸不匹配，不受网页路径配置影响', async () => {
  assert.throws(() => createPretrainedRegionDetector({ loadModel() {}, wasmPaths: 'https://evil.example/' }), /local asset/);
  const h = harness();
  await assert.rejects(h.detector.detect({ ...request, imageBytes: new Uint8Array(4 * 1024 * 1024 + 1) }), /bytes exceed/);
  await assert.rejects(h.detector.detect({ ...request, width: 99 }), /dimensions mismatch/);
  await h.detector.detect({ ...request, config: { modelPath: 'https://evil.example/model', threshold: 0, wasmPaths: 'https://evil.example/' } });
  assert.equal(h.creates, 1); await h.detector.dispose();
});

test('取消不能抢先释放运行中 WASM，会话结束后才返回 AbortError', async () => {
  const h = harness(), controller = new AbortController();
  let settle, started;
  const running = new Promise(resolve => { started = resolve; });
  h.session.run = () => { started(); return new Promise(resolve => { settle = resolve; }); };
  const pending = h.detector.detect({ ...request, signal: controller.signal });
  await running; controller.abort();
  await assert.rejects(h.detector.detect(request), /one active/);
  let finished = false; pending.catch(() => { finished = true; });
  const disposal = h.detector.dispose();
  await Promise.resolve(); assert.equal(finished, false); assert.equal(h.released, 0); assert.equal(h.closed, 0);
  settle(outputs());
  await assert.rejects(pending, { name: 'AbortError' }); await disposal;
  assert.equal(h.closed, 1); assert.equal(h.released, 1);
});

test('取消发生在会话创建期间也等待创建结束后释放', async () => {
  let resolveSession, started;
  const creating = new Promise(resolve => { started = resolve; });
  let released = 0;
  const h = harness({ dependencies: { createSessionImpl: () => { started(); return new Promise(resolve => { resolveSession = resolve; }); } } });
  const pending = h.detector.detect(request); await creating;
  const disposal = h.detector.dispose();
  resolveSession({ run: () => assert.fail('不得在销毁后运行'), release: async () => { released++; } });
  await assert.rejects(pending, { name: 'AbortError' }); await disposal; assert.equal(released, 1); assert.equal(h.closed, 1);
});

test('显式 load 预热校验会话，不解码图片，后续 detect 复用', async () => {
  const h = harness();
  await h.detector.load(); await h.detector.load();
  assert.equal(h.creates, 1); assert.equal(h.closed, 0); assert.equal(h.feeds.length, 0);
  await h.detector.detect(request); assert.equal(h.creates, 1);
  await h.detector.dispose(); await assert.rejects(h.detector.load(), /disposed/);
});
