import { canonicalize, sha256, ocrKey, translationKey } from './keys.js';
import { BoundedCache } from './cache.js';
import { BoundedQueue, SingleFlight, throwIfAborted } from './jobs.js';
import { LIMITS, validateOCRResult, validateRegions, validateTranslationResult } from './schema.js';

const TRANSLATION_FIELDS = ['sourceLanguage','targetLanguage','provider','endpoint','accountNamespace','model','modelRevision','promptVersion','schemaVersion','glossary','glossaryRevision','style','context','contextRevision','generation','adapterRevision'];
function validateTranslationConfig(config) {
  if (!config || Object.getPrototypeOf(config) !== Object.prototype || Object.keys(config).some(k => !TRANSLATION_FIELDS.includes(k))) throw new TypeError('Invalid translation configuration');
  for (const field of ['sourceLanguage','targetLanguage','provider','endpoint','accountNamespace','model']) {
    if (typeof config[field] !== 'string' || !config[field].length || config[field].length > 2048) throw new TypeError('Missing or invalid translation identity');
  }
  if (config.context !== undefined && (typeof config.context !== 'string' || config.context.length > LIMITS.maxContext)) throw new TypeError('Invalid context');
  if (new TextEncoder().encode(canonicalize(config)).byteLength > LIMITS.maxRequestBytes) throw new TypeError('Translation configuration too large');
}

/** Adapters are injected; this module never performs network requests or persists data. */
export function createPipeline({ ocr, translate, cacheOptions, ocrConcurrency = 1, translationConcurrency = 2, maxQueue = 16 } = {}) {
  if (typeof ocr !== 'function' || typeof translate !== 'function') throw new TypeError('OCR and translation adapters are required');
  const ocrCache = new BoundedCache(cacheOptions), translationCache = new BoundedCache(cacheOptions);
  const ocrQueue = new BoundedQueue({ concurrency: ocrConcurrency, maxQueue });
  const translationQueue = new BoundedQueue({ concurrency: translationConcurrency, maxQueue });
  const flights = new SingleFlight();
  const stats = { ocrLookups: 0, ocrHits: 0, ocrMisses: 0, ocrCoalesced: 0, ocrCalls: 0, translationLookups: 0, translationHits: 0, translationMisses: 0, translationCoalesced: 0, translationCalls: 0 };
  async function stage({ key, cache, generation, queue, work, validate, signal, kind }) {
    throwIfAborted(signal);
    stats[kind + 'Lookups']++;
    const cached = generation === cache.generation ? cache.get(key) : undefined;
    if (cached !== undefined) { stats[kind + 'Hits']++; return cached; }
    stats[kind + 'Misses']++;
    const flightKey = `${kind}:${generation}:${key}`;
    if (flights.has(flightKey)) stats[kind + 'Coalesced']++;
    return flights.run(flightKey, sharedSignal => queue.run(async () => {
      throwIfAborted(sharedSignal); stats[kind + 'Calls']++;
      const value = validate(await work(sharedSignal));
      throwIfAborted(sharedSignal); cache.set(key, value, generation); return value;
    }, { signal: sharedSignal }), { signal });
  }
  return {
    async run(input, { signal } = {}) {
      throwIfAborted(signal);
      // Snapshot before the first await: caller mutations must not change effective keys.
      const { width, height, namespace } = input;
      if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0 || width * height > LIMITS.maxPixels) throw new TypeError('Image exceeds dimension budget');
      if (typeof namespace !== 'string' || !namespace.length || namespace.length > 512) throw new TypeError('A bounded cache namespace is required');
      const raw = input.imageBytes;
      if (!(raw instanceof ArrayBuffer) && !ArrayBuffer.isView(raw)) throw new TypeError('Expected image bytes');
      if (raw.byteLength === 0 || raw.byteLength > LIMITS.maxImageBytes) throw new TypeError('Image exceeds byte budget');
      const imageBytes = raw instanceof ArrayBuffer ? new Uint8Array(raw.slice(0)) : new Uint8Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
      const config = structuredClone(input.ocrConfig ?? {}), translation = structuredClone(input.translation);
      const sourceEdits = structuredClone(input.sourceEdits ?? {});
      canonicalize(config); validateTranslationConfig(translation);
      if (Object.getPrototypeOf(sourceEdits) !== Object.prototype) throw new TypeError('Expected source edit map');
      const ocrGeneration = ocrCache.generation, translationGeneration = translationCache.generation;
      const imageHash = await sha256(imageBytes);
      const recognitionKey = await ocrKey({ imageHash, width, height, namespace, ocrConfig: config });
      const result = await stage({ key: recognitionKey, cache: ocrCache, generation: ocrGeneration, queue: ocrQueue, kind: 'ocr', signal,
        work: sharedSignal => ocr({ imageBytes, width, height, config, signal: sharedSignal }), validate: value => validateOCRResult(value, { width, height }) });
      for (const id of Object.keys(sourceEdits)) if (!result.regions.some(region => region.regionId === id)) throw new TypeError('Source edit has unknown region ID');
      const regions = validateRegions(result.regions.map(region => Object.hasOwn(sourceEdits, region.regionId)
        ? { ...region, sourceText: sourceEdits[region.regionId], sourceRevision: (region.sourceRevision ?? 0) + 1 } : region), { width, height });
      const request = { ...translation, namespace, regions: regions.map(({ regionId, sourceText, readingOrder, sourceRevision = 0 }) => ({ regionId, sourceText, readingOrder, sourceRevision })) };
      if (new TextEncoder().encode(canonicalize(request)).byteLength > LIMITS.maxRequestBytes) throw new TypeError('Translation request too large');
      const resultKey = await translationKey(request);
      const translated = regions.length ? await stage({ key: resultKey, cache: translationCache, generation: translationGeneration, queue: translationQueue, kind: 'translation', signal,
        work: sharedSignal => translate(structuredClone(request), { signal: sharedSignal }), validate: value => validateTranslationResult(value, regions) }) : { translations: [] };
      throwIfAborted(signal);
      return { regions, translations: translated.translations, imageHash, ocrKey: recognitionKey, translationKey: resultKey };
    },
    clear() { ocrCache.clear(); translationCache.clear(); },
    diagnostics() { return { ...stats, ocrEntries: ocrCache.size, translationEntries: translationCache.size, ocrActive: ocrQueue.active, ocrQueued: ocrQueue.pending.length, translationActive: translationQueue.active, translationQueued: translationQueue.pending.length }; }
  };
}
