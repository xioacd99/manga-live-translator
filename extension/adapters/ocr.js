import { createWorker } from 'tesseract.js';

const abortError = () => new DOMException('OCR cancelled.', 'AbortError');

// Tesseract 的 rectangle 保留原图坐标，不要再次叠加裁剪偏移。
function paragraphsToRegions(data, width, height) {
  const paragraphs = (data.blocks || []).flatMap(block => block.paragraphs || []);
  return paragraphs.filter(p => typeof p.text === 'string' && p.text.trim()).map(p => {
    const { x0, y0, x1, y1 } = p.bbox || {};
    if (![x0, y0, x1, y1].every(Number.isFinite) || x0 < 0 || y0 < 0 || x1 > width || y1 > height || x1 <= x0 || y1 <= y0) throw new Error('OCR returned invalid region geometry.');
    return {
      bbox: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, sourceText: p.text.trim(), sourceRevision: 0,
      ...(Number.isFinite(p.confidence) && p.confidence >= 0 && p.confidence <= 100 ? { confidence: p.confidence / 100 } : {}),
    };
  });
}

// 相同位置且文字相同/包含才去重；不同气泡的重复对白必须保留。
export function mergeOcrRegions(regions) {
  const merged = [];
  const normalized = text => text.replace(/\s+/g, '').toLowerCase();
  // 先保留长文本，避免整图段落包含多个裁剪段落时仅去掉其中一个。
  const candidates = [...regions].sort((a, b) => Number((b.confidence ?? 0) >= 0.5) - Number((a.confidence ?? 0) >= 0.5) || normalized(b.sourceText).length - normalized(a.sourceText).length || (b.confidence ?? 0) - (a.confidence ?? 0));
  for (const region of candidates) {
    const a = region.bbox, text = normalized(region.sourceText);
    const index = merged.findIndex(other => {
      const b = other.bbox, otherText = normalized(other.sourceText);
      const overlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
      // 整图高置信度段落已覆盖该低置信度候选时，不重复显示冲突乱码。
      const coveredUncertain = (region.confidence ?? 0) < 0.5 && (other.confidence ?? 0) >= 0.5 && overlap / (a.width * a.height) >= 0.9;
      return overlap / Math.min(a.width * a.height, b.width * b.height) >= 0.65 && (text.includes(otherText) || otherText.includes(text) || coveredUncertain);
    });
    if (index < 0) merged.push(region);
  }
  merged.sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
  return merged.map((region, i) => ({ ...region, regionId: `r${i + 1}`, readingOrder: i }));
}

function cropRectangles(config, width, height) {
  if (config.regionMode === 'whole-image' || !Array.isArray(config.regions) || !config.regions.length || config.regions.length > 32) return [];
  const crops = [];
  for (const region of config.regions) {
    const b = region?.bbox;
    if (!b || ![b.x, b.y, b.width, b.height].every(Number.isInteger) || b.x < 0 || b.y < 0 || b.width < 1 || b.height < 1 || b.x + b.width > width || b.y + b.height > height || !Number.isFinite(region.confidence) || region.confidence < 0.3 || region.confidence > 1) return [];
    if (!crops.some(c => c.left === b.x && c.top === b.y && c.width === b.width && c.height === b.height)) crops.push({ left: b.x, top: b.y, width: b.width, height: b.height });
  }
  // 重叠框也不能放大总计算预算，超额时直接回到一次整图。
  if (crops.reduce((sum, c) => sum + c.width * c.height, 0) > width * height * 2) return [];
  return crops.sort((a, b) => a.top - b.top || a.left - b.left);
}

// 路径只能由可信扩展协调层提供，不能取自网页消息。
export function createOcrAdapter({ workerPath, corePath, langPath, createWorkerImpl = createWorker }) {
  for (const path of [workerPath, corePath, langPath]) {
    if (typeof path !== 'string' || !path || !/^(?:chrome-extension:\/\/|moz-extension:\/\/|file:\/\/|\/(?!\/))/.test(path)) {
      throw new Error('OCR requires packaged local asset paths.');
    }
  }
  let workerPromise;
  let releasePromise;
  let busy = false;
  let disposed = false;
  let cancelCurrent;
  const release = () => {
    // 所有调用方（包括取消与销毁）必须等待同一次清理完成。
    if (releasePromise) return releasePromise;
    const pending = workerPromise;
    workerPromise = undefined;
    if (!pending) return Promise.resolve();
    releasePromise = (async () => {
      try { await (await pending).terminate(); } catch { /* 失败工作线程没有可复用状态。 */ }
    })().finally(() => { releasePromise = undefined; });
    return releasePromise;
  };
  async function recognize({ imageBytes, width, height, config = {}, signal }) {
    if (disposed) throw new Error('OCR adapter is disposed.');
    if (signal?.aborted) throw abortError();
    if (busy) throw new Error('OCR adapter allows one active recognition.');
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 16000000) {
      throw new Error('OCR image dimensions exceed the supported budget.');
    }
    if (!(imageBytes instanceof ArrayBuffer) && !ArrayBuffer.isView(imageBytes)) throw new Error('OCR requires encoded image bytes.');
    if (config.language && !['eng', 'en'].includes(config.language)) throw new Error('Only packaged English OCR is supported.');
    busy = true;
    let rejectAbort;
    const interrupted = new Promise((_, reject) => { rejectAbort = reject; });
    const abort = () => { rejectAbort(abortError()); void release(); };
    cancelCurrent = abort;
    signal?.addEventListener('abort', abort, { once: true });
    const operation = async () => {
      if (!workerPromise) {
        workerPromise = createWorkerImpl('eng', 1, {
          workerPath, corePath, langPath, workerBlobURL: false, cacheMethod: 'none', gzip: true,
          logger: () => {}, errorHandler: () => {},
        });
      }
      const worker = await workerPromise;
      if (signal?.aborted || disposed) throw abortError();
      // 稀疏文本模式兼容分散气泡，但不代表已经支持方向检测或竖排语言。
      await worker.setParameters({ tessedit_pageseg_mode: '11', user_defined_dpi: '300' });
      if (signal?.aborted || disposed) throw abortError();
      const input = typeof window === 'undefined' ? imageBytes : new Blob([imageBytes]);
      const crops = cropRectangles(config, width, height);
      const collected = [];
      for (const rectangle of crops) {
        if (signal?.aborted || disposed) throw abortError();
        const { data } = await worker.recognize(input, { rectangle }, { blocks: true, text: true });
        if (signal?.aborted || disposed) throw abortError();
        collected.push(...paragraphsToRegions(data, width, height));
        if (collected.length > 1024) throw new Error('OCR candidate budget exceeded.');
      }
      // 保守默认总是整图补漏，区域模式仅供显式实验；低置信度或空结果也回退。
      const uncertain = !collected.length || collected.some(r => (r.confidence ?? 0) < 0.5);
      if (config.regionMode !== 'regions-only' || !crops.length || uncertain) {
        const { data } = await worker.recognize(input, {}, { blocks: true, text: true });
        if (signal?.aborted || disposed) throw abortError();
        collected.push(...paragraphsToRegions(data, width, height));
      }
      if (collected.length > 1280) throw new Error('OCR candidate budget exceeded.');
      const regions = mergeOcrRegions(collected);
      if (regions.length > 256) throw new Error('OCR region budget exceeded.');
      return { regions };
    };
    try { return await Promise.race([operation(), interrupted]); }
    catch (error) {
      await release();
      if (signal?.aborted || error?.name === 'AbortError') throw abortError();
      throw new Error('Local OCR failed. Check packaged assets and image format.');
    } finally {
      signal?.removeEventListener('abort', abort);
      cancelCurrent = undefined;
      busy = false;
    }
  }
  return { recognize, dispose: async () => { disposed = true; cancelCurrent?.(); await release(); } };
}
