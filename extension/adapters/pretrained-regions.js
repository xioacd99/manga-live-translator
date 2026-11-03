// 独立实现 RT-DETR v2 的浏览器预处理与区域映射；权重来源和许可见第三方清单。
export const PRETRAINED_MODEL_SHA256 = '5fe9e4f576e49d4e7e8b0e029d6d3cdc252abd4694113e1cae120e62c931ea79';
export const PRETRAINED_MODEL_BYTES = 11120765;
export const PRETRAINED_DETECTOR_REVISION = 'ogkalu-rtdetr-v4-s-int8-5fe9e4f576e49-rgb640-direct-tiles-v1';
const SIZE = 640, THRESHOLD = 0.3, MAX_PIXELS = 16000000, MAX_REGIONS = 32;
const abort = signal => { if (signal?.aborted) throw new DOMException('Detection cancelled.', 'AbortError'); };
const result = (regions, fallbackReason) => ({ regions, detectorRevision: PRETRAINED_DETECTOR_REVISION, experimental: true, ...(fallbackReason ? { fallbackReason } : {}) });
const dimensions = (width, height) => {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > MAX_PIXELS) throw new Error('Detector image dimensions exceed budget.');
};
const localPath = path => typeof path === 'string' && /^(?:chrome-extension:\/\/|moz-extension:\/\/|file:\/\/|\/(?!\/))/.test(path) && !/[?#\\]/.test(path) && !path.split('/').some(p => p === '..' || /%/i.test(p));

// 超长图片不能悄悄截断：预算不足时让协调层明确回到整图 OCR。
export function planDetectorTiles(width, height) {
  dimensions(width, height);
  const tileHeight = height > width * 2 ? Math.min(height, Math.max(1, Math.round(width * 1.5))) : height;
  const stride = Math.max(1, Math.floor(tileHeight * 0.8));
  const tiles = [];
  for (let y = 0; ; y = Math.min(y + stride, height - tileHeight)) {
    tiles.push({ x: 0, y, width, height: tileHeight });
    if (tiles.length > 16) throw new Error('Detector tile budget exceeded; whole-image OCR required.');
    if (y + tileHeight === height) return tiles;
  }
}

function intersection(a, b) {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
}
const area = b => b.width * b.height;
function duplicates(a, b) {
  const overlap = intersection(a, b);
  return overlap / (area(a) + area(b) - overlap) >= 0.5 || overlap / Math.min(area(a), area(b)) >= 0.85;
}

// 每个输出框都是原始分块坐标 xyxy，不是归一化坐标，也不需要逆 letterbox。
export function decodePretrainedOutputs(outputs, tile) {
  dimensions(tile?.width, tile?.height);
  if (![tile.x, tile.y].every(n => Number.isInteger(n) && n >= 0)) throw new Error('Invalid detector tile offset.');
  const { labels, boxes, scores } = outputs || {};
  for (const [tensor, dims] of [[labels, [1, 300]], [boxes, [1, 300, 4]], [scores, [1, 300]]]) {
    if (!tensor || !ArrayBuffer.isView(tensor.data) || !Array.isArray(tensor.dims) || tensor.dims.length !== dims.length || !dims.every((d, i) => tensor.dims[i] === d) || tensor.data.length !== dims.reduce((a, b) => a * b, 1)) throw new Error('Invalid pretrained detector output shape.');
  }
  const candidates = [];
  for (let i = 0; i < 300; i++) {
    const label = Number(labels.data[i]), confidence = scores.data[i];
    const coords = Array.from(boxes.data.subarray(i * 4, i * 4 + 4));
    if (!Number.isInteger(label) || label < 0 || label > 2 || !Number.isFinite(confidence) || confidence < 0 || confidence > 1 || !coords.every(Number.isFinite)) throw new Error('Invalid pretrained detector output values.');
    if (confidence < THRESHOLD) continue;
    const [x0, y0, x1, y1] = coords;
    if (x1 <= x0 || y1 <= y0) throw new Error('Invalid pretrained detector box.');
    const left = Math.max(0, Math.floor(x0)), top = Math.max(0, Math.floor(y0));
    const right = Math.min(tile.width, Math.ceil(x1)), bottom = Math.min(tile.height, Math.ceil(y1));
    if (right <= left || bottom <= top) continue;
    candidates.push({ label, confidence, bbox: { x: left + tile.x, y: top + tile.y, width: right - left, height: bottom - top } });
  }
  return candidates;
}

export function selectPretrainedRegions(candidates, width, height) {
  dimensions(width, height);
  if (!Array.isArray(candidates) || candidates.length > 4800) throw new Error('Invalid detector candidates.');
  for (const { bbox: b, label, confidence } of candidates) {
    if (!b || ![b.x, b.y, b.width, b.height].every(Number.isInteger) || b.x < 0 || b.y < 0 || b.width <= 0 || b.height <= 0 || b.x + b.width > width || b.y + b.height > height || ![0, 1, 2].includes(label) || !Number.isFinite(confidence) || confidence < THRESHOLD || confidence > 1) throw new Error('Invalid detector candidate geometry.');
  }
  const ranked = [...candidates].sort((a, b) => b.confidence - a.confidence);
  const selected = [];
  // 优先文字框；有匹配文字的气泡只作为上下文，不再重复送入 OCR。
  for (const item of ranked.filter(c => c.label !== 0)) if (!selected.some(other => duplicates(item.bbox, other.bbox))) selected.push(item);
  for (const item of ranked.filter(c => c.label === 0)) {
    if (selected.some(other => other.label !== 0 && intersection(item.bbox, other.bbox) / area(other.bbox) >= 0.5)) continue;
    if (!selected.some(other => duplicates(item.bbox, other.bbox))) selected.push(item);
  }
  if (selected.length > MAX_REGIONS) return result([], 'region-budget');
  selected.sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
  return result(selected.map(({ bbox, confidence }, i) => ({ regionId: `d${i + 1}`, bbox, confidence, readingOrder: i })), selected.length ? undefined : 'no-confident-region');
}

// 路径来自可信协调层；网页传入的配置不会改变模型、运行时、阈值或网络目标。
export function createPretrainedRegionDetector({ ort, loadModel, wasmPaths, cryptoImpl = globalThis.crypto, createSessionImpl, createImageBitmapImpl = globalThis.createImageBitmap, Canvas = globalThis.OffscreenCanvas } = {}) {
  if (typeof loadModel !== 'function' || !(typeof wasmPaths === 'string' ? localPath(wasmPaths) : wasmPaths && Object.keys(wasmPaths).length > 0 && Object.values(wasmPaths).every(localPath))) throw new Error('Detector requires packaged local asset paths.');
  if (!ort?.env?.wasm || typeof ort.Tensor !== 'function' || (!createSessionImpl && typeof ort.InferenceSession?.create !== 'function')) throw new Error('Packaged ONNX runtime unavailable.');
  ort.env.wasm.wasmPaths = wasmPaths;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  let session, busy = false, disposed = false, current, disposal;
  async function getSession(signal) {
    if (session) return session;
    const bytes = await loadModel({ signal });
    if (!(bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(bytes)) throw new Error('Detector model loader returned invalid bytes.');
    if (bytes.byteLength !== PRETRAINED_MODEL_BYTES) throw new Error('Local detector model size mismatch.');
    const digest = Array.from(new Uint8Array(await cryptoImpl.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
    if (digest !== PRETRAINED_MODEL_SHA256) throw new Error('Local detector model integrity check failed.');
    abort(signal);
    if (disposed) throw new DOMException('Detection cancelled.', 'AbortError');
    session = await (createSessionImpl || ((data, options) => ort.InferenceSession.create(data, options)))(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    return session;
  }
  async function operation({ imageBytes, width, height, config = {}, signal }) {
    let bitmap;
    try {
      abort(signal);
      dimensions(width, height);
      if (!(imageBytes instanceof ArrayBuffer) && !ArrayBuffer.isView(imageBytes)) throw new Error('Detector requires encoded image bytes.');
      if (!imageBytes.byteLength || imageBytes.byteLength > 4 * 1024 * 1024) throw new Error('Detector image bytes exceed budget.');
      if (config.regionMode === 'whole-image') return result([], 'whole-image-requested');
      const tiles = planDetectorTiles(width, height);
      if (typeof createImageBitmapImpl !== 'function' || typeof Canvas !== 'function') throw new Error('Detector image decoder unavailable.');
      bitmap = await createImageBitmapImpl(new Blob([imageBytes]));
      abort(signal);
      if (disposed) throw new DOMException('Detection cancelled.', 'AbortError');
      if (bitmap.width !== width || bitmap.height !== height) throw new Error('Detector image dimensions mismatch.');
      const activeSession = await getSession(signal);
      const canvas = new Canvas(SIZE, SIZE), ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Detector canvas unavailable.');
      const candidates = [];
      for (const tile of tiles) {
        abort(signal);
        if (disposed) throw new DOMException('Detection cancelled.', 'AbortError');
        // 白色背景防止透明图片复用上一分块；直接缩放符合导出模型预处理。
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, SIZE, SIZE);
        ctx.drawImage(bitmap, tile.x, tile.y, tile.width, tile.height, 0, 0, SIZE, SIZE);
        const rgba = ctx.getImageData(0, 0, SIZE, SIZE).data;
        if (!(rgba instanceof Uint8ClampedArray) || rgba.length !== SIZE * SIZE * 4) throw new Error('Invalid detector pixels.');
        const rgb = new Float32Array(3 * SIZE * SIZE);
        for (let i = 0; i < SIZE * SIZE; i++) for (let c = 0; c < 3; c++) rgb[c * SIZE * SIZE + i] = rgba[i * 4 + c] / 255;
        const feeds = { images: new ort.Tensor('float32', rgb, [1, 3, SIZE, SIZE]), orig_target_sizes: new ort.Tensor('int64', BigInt64Array.from([BigInt(tile.width), BigInt(tile.height)]), [1, 2]) };
        let outputs;
        try {
          // WASM run 无法中断；等待其结束才允许下一次推理或释放会话。
          outputs = await activeSession.run(feeds);
          abort(signal);
          if (disposed) throw new DOMException('Detection cancelled.', 'AbortError');
          candidates.push(...decodePretrainedOutputs(outputs, tile));
        } finally {
          for (const tensor of Object.values(outputs || {})) tensor?.dispose?.();
          for (const tensor of Object.values(feeds)) tensor.dispose?.();
        }
      }
      return selectPretrainedRegions(candidates, width, height);
    } finally { bitmap?.close(); }
  }
  return {
    async load({ signal } = {}) {
      if (disposed) throw new Error('Detector is disposed.');
      if (busy) throw new Error('Detector allows one active inference.');
      abort(signal);
      busy = true;
      current = (async () => {
        await getSession(signal);
        abort(signal);
        if (disposed) throw new DOMException('Detection cancelled.', 'AbortError');
      })();
      try { await current; } finally { busy = false; current = undefined; }
    },
    async detect(args) {
      if (disposed) throw new Error('Detector is disposed.');
      if (busy) throw new Error('Detector allows one active inference.');
      busy = true;
      current = operation(args);
      try { return await current; } finally { busy = false; current = undefined; }
    },
    dispose() {
      if (disposal) return disposal;
      disposed = true;
      disposal = (async () => {
        try { await current; } catch { /* 推理失败也必须清理已创建的会话。 */ }
        if (session) { const stale = session; session = undefined; await stale.release(); }
      })();
      return disposal;
    },
  };
}
