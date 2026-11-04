export const LIMITS = Object.freeze({ maxRegions: 256, maxText: 8192, maxContext: 32768, maxRequestBytes: 512 * 1024, maxImageBytes: 20 * 1024 * 1024, maxPixels: 40_000_000 });
const object = value => value && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
function keys(value, allowed, required) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) throw new TypeError('Invalid object schema');
}
function text(value, max, empty = true) { if (typeof value !== 'string' || value.length > max || (!empty && !value.length)) throw new TypeError('Invalid bounded text'); }
function identifier(value) {
  text(value, 128, false);
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new TypeError('Invalid region ID');
}
function box(value, { width, height } = {}) {
  keys(value, ['x','y','width','height'], ['x','y','width','height']);
  if (!Object.values(value).every(Number.isFinite) || value.x < 0 || value.y < 0 || value.width <= 0 || value.height <= 0 ||
      (width !== undefined && value.x + value.width > width) || (height !== undefined && value.y + value.height > height)) throw new TypeError('Invalid bounding box');
}
function polygon(value, { width, height } = {}) {
  if (!Array.isArray(value) || value.length < 3 || value.length > 16) throw new TypeError('Invalid polygon');
  for (const point of value) {
    keys(point, ['x','y'], ['x','y']);
    if (![point.x, point.y].every(Number.isFinite) || point.x < 0 || point.y < 0 || (width !== undefined && point.x > width) || (height !== undefined && point.y > height)) throw new TypeError('Invalid polygon');
  }
}
function attributes(value) {
  if (value.confidence !== undefined && (!Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1)) throw new TypeError('Invalid confidence');
  if (value.direction !== undefined && !['ltr','rtl','vertical'].includes(value.direction)) throw new TypeError('Invalid direction');
}
export function validateRegions(regions, { width, height } = {}) {
  if (!Array.isArray(regions) || regions.length > LIMITS.maxRegions) throw new TypeError('Invalid region list');
  const ids = new Set(), orders = new Set(), lineIds = new Set();
  for (const region of regions) {
    keys(region, ['regionId','bbox','sourceText','readingOrder','sourceRevision','confidence','direction','uncertainty','polygon','lineIds','lines','bubbleId','bubbleBox'], ['regionId','bbox','sourceText','readingOrder']);
    text(region.regionId, 128, false);
    if (!/^[A-Za-z0-9_-]+$/.test(region.regionId) || ids.has(region.regionId)) throw new TypeError('Invalid or duplicate region ID');
    ids.add(region.regionId); text(region.sourceText, LIMITS.maxText);
    if (!Number.isInteger(region.readingOrder) || region.readingOrder < 0 || orders.has(region.readingOrder)) throw new TypeError('Invalid reading order');
    orders.add(region.readingOrder);
    box(region.bbox, { width, height });
    if (region.sourceRevision !== undefined && (!Number.isInteger(region.sourceRevision) || region.sourceRevision < 0)) throw new TypeError('Invalid source revision');
    attributes(region);
    if (region.polygon !== undefined) polygon(region.polygon, { width, height });
    if (region.bubbleId !== undefined || region.bubbleBox !== undefined) { identifier(region.bubbleId); box(region.bubbleBox, { width, height }); }
    if (region.lineIds !== undefined || region.lines !== undefined) {
      if (!Array.isArray(region.lineIds) || !Array.isArray(region.lines) || !region.lines.length || region.lines.length !== region.lineIds.length || region.lines.length > LIMITS.maxRegions) throw new TypeError('Invalid grouped lines');
      region.lines.forEach((line, index) => {
        keys(line, ['lineId','bbox','sourceText','confidence','direction','polygon'], ['lineId','bbox','sourceText']);
        identifier(line.lineId); box(line.bbox, { width, height }); text(line.sourceText, LIMITS.maxText); attributes(line);
        if (line.polygon !== undefined) polygon(line.polygon, { width, height });
        if (lineIds.has(line.lineId) || region.lineIds[index] !== line.lineId) throw new TypeError('Invalid or duplicate line ID');
        lineIds.add(line.lineId);
        if (lineIds.size > LIMITS.maxRegions) throw new TypeError('Grouped line budget exceeded');
      });
    }
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
