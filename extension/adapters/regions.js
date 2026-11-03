// 实验性亮色连通域检测：不是训练模型；复杂漫画仍需整图 OCR 补漏。
export const DETECTOR_REVISION = 'light-components-v1';
const MAX_PIXELS = 16000000;
const MAX_SAMPLES = 1048576;
const MAX_REGIONS = 32;
const aborted = signal => { if (signal?.aborted) throw new DOMException('Detection cancelled.', 'AbortError'); };
const result = (regions, fallbackReason) => ({ regions, detectorRevision: DETECTOR_REVISION, experimental: true, ...(fallbackReason ? { fallbackReason } : {}) });

// 四邻域洪泛只保留不碰边缘、具有暗色内部证据的亮色区域。置信度是启发式分数。
export function detectRegionsFromRgba({ data, width, height, config = {}, signal }) {
  aborted(signal);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > MAX_SAMPLES || !ArrayBuffer.isView(data) || data.length !== width * height * 4) {
    throw new Error('Invalid or oversized detector pixels.');
  }
  const threshold = config.lightThreshold ?? 220;
  if (!Number.isInteger(threshold) || threshold < 160 || threshold > 250) throw new Error('Invalid light threshold.');
  const count = width * height;
  const light = new Uint8Array(count);
  const queue = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    if (!(i % 16384)) aborted(signal);
    light[i] = data[i * 4 + 3] >= 240 && Math.min(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) >= threshold ? 1 : 0;
  }
  const regions = [];
  for (let seed = 0; seed < count; seed++) {
    if (!(seed % 16384)) aborted(signal);
    if (light[seed] !== 1) continue;
    let head = 0, tail = 1, minX = width, minY = height, maxX = 0, maxY = 0, touches = false;
    queue[0] = seed; light[seed] = 2;
    while (head < tail) {
      if (!(head % 16384)) aborted(signal);
      const i = queue[head++], x = i % width, y = Math.floor(i / width);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      if (!x || !y || x === width - 1 || y === height - 1) touches = true;
      const visit = n => { if (light[n] === 1) { light[n] = 2; queue[tail++] = n; } };
      if (x) visit(i - 1); if (x < width - 1) visit(i + 1);
      if (y) visit(i - width); if (y < height - 1) visit(i + width);
    }
    const w = maxX - minX + 1, h = maxY - minY + 1, area = w * h;
    if (touches || w < 16 || h < 12 || area < 256 || area > count * 0.8 || tail / area < 0.5) continue;
    // 内缩边界排除轮廓；要求暗点证据但不声称这些暗点一定是文字。
    const inset = Math.max(2, Math.floor(Math.min(w, h) * 0.15));
    let dark = 0, interior = 0;
    for (let y = minY + inset; y <= maxY - inset; y++) {
      for (let x = minX + inset; x <= maxX - inset; x++) { interior++; if (!light[y * width + x]) dark++; }
    }
    const density = dark / interior;
    if (density < 0.005 || density > 0.45) continue;
    regions.push({ bbox: { x: minX, y: minY, width: w, height: h }, confidence: 0.6 });
    if (regions.length > MAX_REGIONS) return result([], 'region-budget');
  }
  regions.sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
  return result(regions.map((region, i) => ({ ...region, regionId: `d${i + 1}`, readingOrder: i })), regions.length ? undefined : 'no-confident-region');
}

export function createRegionDetector({ createImageBitmapImpl = globalThis.createImageBitmap, Canvas = globalThis.OffscreenCanvas } = {}) {
  return { async detect({ imageBytes, width, height, config = {}, signal }) {
    aborted(signal);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > MAX_PIXELS) throw new Error('Detector image dimensions exceed budget.');
    if (!(imageBytes instanceof ArrayBuffer) && !ArrayBuffer.isView(imageBytes)) throw new Error('Detector requires encoded image bytes.');
    if (imageBytes.byteLength > 20 * 1024 * 1024) throw new Error('Detector image bytes exceed budget.');
    if (config.regionMode === 'whole-image') return result([], 'whole-image-requested');
    if (typeof createImageBitmapImpl !== 'function' || typeof Canvas !== 'function') return result([], 'decoder-unavailable');
    let bitmap;
    try {
      bitmap = await createImageBitmapImpl(new Blob([imageBytes]));
      aborted(signal);
      if (bitmap.width !== width || bitmap.height !== height) throw new Error('Detector image dimensions mismatch.');
      const scale = Math.min(1, Math.sqrt(MAX_SAMPLES / (width * height)));
      const sw = Math.max(1, Math.floor(width * scale)), sh = Math.max(1, Math.floor(height * scale));
      const canvas = new Canvas(sw, sh), ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return result([], 'canvas-unavailable');
      ctx.drawImage(bitmap, 0, 0, sw, sh);
      const detected = detectRegionsFromRgba({ data: ctx.getImageData(0, 0, sw, sh).data, width: sw, height: sh, config, signal });
      return { ...detected, regions: detected.regions.map(region => {
        const b = region.bbox, x = Math.floor(b.x * width / sw), y = Math.floor(b.y * height / sh);
        return { ...region, bbox: { x, y, width: Math.min(width, Math.ceil((b.x + b.width) * width / sw)) - x, height: Math.min(height, Math.ceil((b.y + b.height) * height / sh)) - y } };
      }) };
    } finally { bitmap?.close(); }
  } };
}
