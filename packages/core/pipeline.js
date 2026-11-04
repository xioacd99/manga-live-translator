import { canonicalize, sha256, hashKey, detectionKey, ocrKey, translationKey } from './keys.js';
import { BoundedCache } from './cache.js';
import { BoundedQueue, SingleFlight, throwIfAborted } from './jobs.js';
import { groupTextLines, normalizeGroupingConfig } from './grouping.js';
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

/** 检测结果只允许几何信息，不能把识别文本或其他内容混入检测缓存。 */
export function validateDetectionResult(value, dimensions) {
  const plain = item => item && Object.getPrototypeOf(item) === Object.prototype;
  if (!plain(value) || Object.keys(value).some(key => !['regions', 'detectorRevision', 'experimental', 'fallbackReason'].includes(key)) ||
      !Array.isArray(value.regions) || value.regions.length > LIMITS.maxRegions ||
      typeof value.detectorRevision !== 'string' || !value.detectorRevision.length || value.detectorRevision.length > 128 ||
      (value.experimental !== undefined && typeof value.experimental !== 'boolean') ||
      (value.fallbackReason !== undefined && (typeof value.fallbackReason !== 'string' || value.fallbackReason.length > 256))) throw new TypeError('Invalid detection result');
  for (const region of value.regions) {
    if (!plain(region) || Object.keys(region).some(key => !['regionId', 'bbox', 'confidence', 'readingOrder'].includes(key))) throw new TypeError('Invalid detection geometry');
  }
  const regions = validateRegions(value.regions.map(region => ({ ...region, sourceText: '' })), dimensions)
    .map(({ sourceText, ...region }) => region);
  return { ...structuredClone(value), regions };
}

/** 适配器由外部注入；本模块不发起网络请求，也不持久化数据。 */
export function createPipeline({ detect, ocr, translate, cacheOptions, detectionConcurrency = 1, ocrConcurrency = 1, translationConcurrency = 2, maxQueue = 16 } = {}) {
  if (typeof ocr !== 'function' || (translate !== undefined && typeof translate !== 'function') || (detect !== undefined && typeof detect !== 'function')) throw new TypeError('Invalid pipeline adapters');
  const detectionCache = new BoundedCache(cacheOptions), ocrCache = new BoundedCache(cacheOptions), translationCache = new BoundedCache(cacheOptions);
  const detectionQueue = new BoundedQueue({ concurrency: detectionConcurrency, maxQueue });
  const ocrQueue = new BoundedQueue({ concurrency: ocrConcurrency, maxQueue });
  const translationQueue = new BoundedQueue({ concurrency: translationConcurrency, maxQueue });
  const flights = new SingleFlight();
  const stats = { preparationCalls: 0, detectionLookups: 0, detectionHits: 0, detectionMisses: 0, detectionCoalesced: 0, detectionCalls: 0, ocrLookups: 0, ocrHits: 0, ocrMisses: 0, ocrCoalesced: 0, ocrCalls: 0, translationLookups: 0, translationHits: 0, translationMisses: 0, translationCoalesced: 0, translationCalls: 0 };
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
  function snapshot(input, needsTranslation) {
    // 首次 await 前建立快照，避免调用方后续修改影响实际缓存键。
    const { width, height, namespace } = input;
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0 || width * height > LIMITS.maxPixels) throw new TypeError('Image exceeds dimension budget');
    if (typeof namespace !== 'string' || !namespace.length || namespace.length > 512) throw new TypeError('A bounded cache namespace is required');
    const raw = input.imageBytes;
    if (!(raw instanceof ArrayBuffer) && !ArrayBuffer.isView(raw)) throw new TypeError('Expected image bytes');
    if (raw.byteLength === 0 || raw.byteLength > LIMITS.maxImageBytes) throw new TypeError('Image exceeds byte budget');
    const imageBytes = raw instanceof ArrayBuffer ? new Uint8Array(raw.slice(0)) : new Uint8Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    const config = structuredClone(input.ocrConfig ?? {}), detectionConfig = structuredClone(input.detectionConfig ?? null);
    for (const value of [config, detectionConfig]) {
      if (value !== null && (Object.getPrototypeOf(value) !== Object.prototype || new TextEncoder().encode(canonicalize(value)).byteLength > LIMITS.maxRequestBytes)) throw new TypeError('Invalid bounded stage configuration');
    }
    if (detectionConfig && detectionConfig.enabled !== undefined && typeof detectionConfig.enabled !== 'boolean') throw new TypeError('Invalid detection enabled flag');
    const detectionEnabled = detectionConfig !== null && detectionConfig.enabled !== false;
    if (detectionEnabled && typeof detect !== 'function') throw new TypeError('Detection adapter is required');
    const translation = needsTranslation ? structuredClone(input.translation) : undefined;
    if (needsTranslation) {
      if (typeof translate !== 'function') throw new TypeError('Translation adapter is required');
      validateTranslationConfig(translation);
    }
    const groupingConfig = normalizeGroupingConfig(structuredClone(input.groupingConfig ?? null));
    const sourceEdits = structuredClone(input.sourceEdits ?? {});
    if (Object.getPrototypeOf(sourceEdits) !== Object.prototype) throw new TypeError('Expected source edit map');
    return { width, height, namespace, imageBytes, config, detectionConfig, detectionEnabled, translation, sourceEdits, groupingConfig,
      detectionGeneration: detectionCache.generation, ocrGeneration: ocrCache.generation, translationGeneration: translationCache.generation };
  }
  async function recognize(state, signal) {
    const { width, height, namespace, imageBytes, config, detectionConfig, detectionEnabled, detectionGeneration, ocrGeneration, sourceEdits, groupingConfig } = state;
    const imageHash = await sha256(imageBytes);
    let detection = null, detectedKey = null;
    if (detectionEnabled) {
      detectedKey = await detectionKey({ imageHash, width, height, namespace, detectionConfig });
      detection = await stage({ key: detectedKey, cache: detectionCache, generation: detectionGeneration, queue: detectionQueue, kind: 'detection', signal,
        work: sharedSignal => detect({ imageBytes: imageBytes.slice(), width, height, config: structuredClone(detectionConfig), signal: sharedSignal }),
        validate: value => validateDetectionResult(value, { width, height }) });
    }
    // 旧裁剪识别绑定检测几何；整图 OCR 的气泡仅供下游聚合，不失效原始行缓存。
    const groupingEnabled = groupingConfig?.enabled === true;
    const cropDetection = groupingEnabled ? null : detection;
    const effectiveConfig = cropDetection ? { ...config, regions: cropDetection.regions, detectorRevision: cropDetection.detectorRevision } : config;
    const recognitionKey = await ocrKey({ imageHash, width, height, namespace, ocrConfig: effectiveConfig,
      ...(cropDetection ? { detection: { config: detectionConfig, result: cropDetection } } : {}) });
    const result = await stage({ key: recognitionKey, cache: ocrCache, generation: ocrGeneration, queue: ocrQueue, kind: 'ocr', signal,
      work: sharedSignal => ocr({ imageBytes: imageBytes.slice(), width, height, config: structuredClone(effectiveConfig), detection: structuredClone(cropDetection), signal: sharedSignal }),
      validate: value => validateOCRResult(value, { width, height }) });
    const grouped = groupingEnabled ? await groupTextLines({ regions: result.regions, detection, width, height, readingDirection: groupingConfig.readingDirection }) : result;
    const groupingKey = groupingEnabled ? await hashKey({ cacheSchema: 1, stage: 'grouping', ocrKey: recognitionKey, config: groupingConfig, detection, regions: grouped.regions }) : null;
    for (const id of Object.keys(sourceEdits)) if (!grouped.regions.some(region => region.regionId === id)) throw new TypeError('Source edit has unknown region ID');
    const regions = validateRegions(grouped.regions.map(region => Object.hasOwn(sourceEdits, region.regionId)
      ? { ...region, sourceText: sourceEdits[region.regionId], sourceRevision: (region.sourceRevision ?? 0) + 1 } : region), { width, height });
    throwIfAborted(signal);
    return { regions, imageHash, ocrKey: recognitionKey, detectionKey: detectedKey, detection, ...(groupingEnabled ? { groupingKey, grouping: grouped.grouping } : {}) };
  }
  return {
    async prepare(input, { signal } = {}) {
      throwIfAborted(signal); stats.preparationCalls++;
      return recognize(snapshot(input, false), signal);
    },
    async run(input, { signal } = {}) {
      throwIfAborted(signal);
      const state = snapshot(input, true);
      const { translation, namespace, translationGeneration } = state;
      const prepared = await recognize(state, signal);
      const { regions } = prepared;
      const request = { ...translation, namespace, regions: regions.map(({ regionId, sourceText, readingOrder, sourceRevision = 0 }) => ({ regionId, sourceText, readingOrder, sourceRevision })) };
      if (new TextEncoder().encode(canonicalize(request)).byteLength > LIMITS.maxRequestBytes) throw new TypeError('Translation request too large');
      const resultKey = await translationKey({ ...request, ...(prepared.groupingKey ? { groupingKey: prepared.groupingKey } : {}) });
      const translated = regions.length ? await stage({ key: resultKey, cache: translationCache, generation: translationGeneration, queue: translationQueue, kind: 'translation', signal,
        work: sharedSignal => translate(structuredClone(request), { signal: sharedSignal }), validate: value => validateTranslationResult(value, regions) }) : { translations: [] };
      throwIfAborted(signal);
      return { ...prepared, translations: translated.translations, translationKey: resultKey };
    },
    clear() { detectionCache.clear(); ocrCache.clear(); translationCache.clear(); },
    diagnostics() { return { ...stats, detectionEntries: detectionCache.size, detectionActive: detectionQueue.active, detectionQueued: detectionQueue.pending.length, ocrEntries: ocrCache.size, translationEntries: translationCache.size, ocrActive: ocrQueue.active, ocrQueued: ocrQueue.pending.length, translationActive: translationQueue.active, translationQueued: translationQueue.pending.length }; }
  };
}
