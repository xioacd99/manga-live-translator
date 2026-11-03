/** 规范化 JSON 有意保留数组顺序、空白以及语言名称的拼写。 */
export function canonicalize(value) {
  const seen = new Set();
  function visit(item) {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item);
    if (typeof item !== 'object' || item === null || seen.has(item)) throw new TypeError('Expected finite, acyclic JSON data');
    seen.add(item);
    let result;
    if (Array.isArray(item)) result = '[' + Array.from(item, visit).join(',') + ']';
    else {
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw new TypeError('Expected plain JSON object');
      result = '{' + Object.keys(item).sort().map(key => JSON.stringify(key) + ':' + visit(item[key])).join(',') + '}';
    }
    seen.delete(item);
    return result;
  }
  return visit(value);
}
export async function sha256(bytes) {
  if (!(bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(bytes)) throw new TypeError('Expected image bytes');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('');
}
export async function hashKey(value) { return sha256(new TextEncoder().encode(canonicalize(value))); }
export async function detectionKey({ imageHash, width, height, namespace, detectionConfig }) {
  return hashKey({ cacheSchema: 1, stage: 'detection', imageHash, width, height, namespace, detectionConfig });
}
export async function ocrKey({ imageHash, width, height, namespace, ocrConfig, detection }) {
  return hashKey({ cacheSchema: 1, stage: 'ocr', imageHash, width, height, namespace, ocrConfig, ...(detection === undefined ? {} : { detection }) });
}
export async function translationKey(request) { return hashKey({ cacheSchema: 1, stage: 'translation', request }); }
