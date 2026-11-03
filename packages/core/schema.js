export const LIMITS = Object.freeze({ maxRegions: 256, maxText: 8192, maxContext: 32768, maxRequestBytes: 512 * 1024, maxImageBytes: 20 * 1024 * 1024, maxPixels: 40_000_000 });
const object = value => value && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
function keys(value, allowed, required) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) throw new TypeError('Invalid object schema');
}
function text(value, max, empty = true) { if (typeof value !== 'string' || value.length > max || (!empty && !value.length)) throw new TypeError('Invalid bounded text'); }
export function validateRegions(regions, { width, height } = {}) {
  if (!Array.isArray(regions) || regions.length > LIMITS.maxRegions) throw new TypeError('Invalid region list');
  const ids = new Set(), orders = new Set();
  for (const region of regions) {
    keys(region, ['regionId','bbox','sourceText','readingOrder','sourceRevision','confidence','direction','uncertainty'], ['regionId','bbox','sourceText','readingOrder']);
    text(region.regionId, 128, false);
    if (!/^[A-Za-z0-9_-]+$/.test(region.regionId) || ids.has(region.regionId)) throw new TypeError('Invalid or duplicate region ID');
    ids.add(region.regionId); text(region.sourceText, LIMITS.maxText);
    if (!Number.isInteger(region.readingOrder) || region.readingOrder < 0 || orders.has(region.readingOrder)) throw new TypeError('Invalid reading order');
    orders.add(region.readingOrder);
    keys(region.bbox, ['x','y','width','height'], ['x','y','width','height']);
    const b = region.bbox;
    if (!Object.values(b).every(Number.isFinite) || b.x < 0 || b.y < 0 || b.width <= 0 || b.height <= 0 || (width !== undefined && b.x + b.width > width) || (height !== undefined && b.y + b.height > height)) throw new TypeError('Invalid bounding box');
    if (region.sourceRevision !== undefined && (!Number.isInteger(region.sourceRevision) || region.sourceRevision < 0)) throw new TypeError('Invalid source revision');
    if (region.confidence !== undefined && (!Number.isFinite(region.confidence) || region.confidence < 0 || region.confidence > 1)) throw new TypeError('Invalid confidence');
    if (region.direction !== undefined && !['ltr','rtl','vertical'].includes(region.direction)) throw new TypeError('Invalid direction');
    if (region.uncertainty !== undefined) { if (!Array.isArray(region.uncertainty) || region.uncertainty.length > 16) throw new TypeError('Invalid uncertainty'); region.uncertainty.forEach(v => text(v, 256)); }
  }
  return structuredClone(regions).sort((a,b) => a.readingOrder - b.readingOrder);
}
export function validateOCRResult(result, dimensions) {
  keys(result, ['regions'], ['regions']); return { regions: validateRegions(result.regions, dimensions) };
}
export function validateTranslationResult(result, regions) {
  keys(result, ['translations'], ['translations']);
  if (!Array.isArray(result.translations) || result.translations.length !== regions.length) throw new TypeError('Incomplete translation result');
  const expected = new Set(regions.map(r => r.regionId)), found = new Map();
  for (const entry of result.translations) {
    keys(entry, ['regionId','text'], ['regionId','text']);
    if (!expected.has(entry.regionId) || found.has(entry.regionId)) throw new TypeError('Unexpected or duplicate translation ID');
    text(entry.text, LIMITS.maxText); found.set(entry.regionId, entry.text);
  }
  return { translations: regions.map(r => ({ regionId: r.regionId, text: found.get(r.regionId) })) };
}
