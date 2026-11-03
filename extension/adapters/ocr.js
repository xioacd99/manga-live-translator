import { createWorker } from 'tesseract.js';

const abortError = () => new DOMException('OCR cancelled.', 'AbortError');

// Paths are supplied by the trusted extension coordinator, never page messages.
export function createOcrAdapter({ workerPath, corePath, langPath, createWorkerImpl = createWorker }) {
  for (const path of [workerPath, corePath, langPath]) {
    if (typeof path !== 'string' || !path || !/^(?:chrome-extension:\/\/|moz-extension:\/\/|file:\/\/|\/(?!\/))/.test(path)) {
      throw new Error('OCR requires packaged local asset paths.');
    }
  }
  let workerPromise;
  let busy = false;
  let disposed = false;
  let cancelCurrent;
  const release = async () => {
    const pending = workerPromise;
    workerPromise = undefined;
    if (pending) {
      try { await (await pending).terminate(); } catch { /* Failed workers have no reusable state. */ }
    }
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
      // Sparse text admits separated bubbles. No orientation/vertical-language claim.
      await worker.setParameters({ tessedit_pageseg_mode: '11', user_defined_dpi: '300' });
      const input = typeof window === 'undefined' ? imageBytes : new Blob([imageBytes]);
      const { data } = await worker.recognize(input, {}, { blocks: true, text: true });
      if (signal?.aborted || disposed) throw abortError();
      const paragraphs = (data.blocks || []).flatMap(block => block.paragraphs || []);
      const regions = paragraphs.filter(p => typeof p.text === 'string' && p.text.trim()).map((p, index) => {
        const { x0, y0, x1, y1 } = p.bbox || {};
        if (![x0, y0, x1, y1].every(Number.isFinite) || x0 < 0 || y0 < 0 || x1 > width || y1 > height || x1 <= x0 || y1 <= y0) {
          throw new Error('OCR returned invalid region geometry.');
        }
        return {
          regionId: `r${index + 1}`, bbox: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
          sourceText: p.text.trim(), sourceRevision: 0, readingOrder: index,
          ...(Number.isFinite(p.confidence) && p.confidence >= 0 && p.confidence <= 100 ? { confidence: p.confidence / 100 } : {}),
        };
      });
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
