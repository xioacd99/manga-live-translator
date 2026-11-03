import { canonicalize } from './keys.js';

/** In-memory only. Values are cloned so callers cannot poison validated entries. */
export class BoundedCache {
  constructor({ maxEntries = 128, maxBytes = 8 * 1024 * 1024, ttlMs = 30 * 60 * 1000, now = Date.now } = {}) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1 || !Number.isFinite(maxBytes) || maxBytes < 1 || !Number.isFinite(ttlMs) || ttlMs <= 0) throw new TypeError('Invalid cache limits');
    Object.assign(this, { maxEntries, maxBytes, ttlMs, now });
    this.entries = new Map(); this.bytes = 0; this.generation = 0;
  }
  get size() { this.prune(); return this.entries.size; }
  delete(key) { const entry = this.entries.get(key); if (entry) { this.bytes -= entry.bytes; this.entries.delete(key); } }
  prune() { const time = this.now(); for (const [key, entry] of this.entries) if (entry.expires <= time) this.delete(key); }
  get(key) {
    this.prune(); const entry = this.entries.get(key); if (!entry) return undefined;
    this.entries.delete(key); this.entries.set(key, entry); return structuredClone(entry.value);
  }
  set(key, value, generation = this.generation) {
    if (generation !== this.generation) return false;
    const bytes = new TextEncoder().encode(canonicalize(value)).byteLength + new TextEncoder().encode(key).byteLength;
    if (bytes > this.maxBytes) return false;
    this.prune(); this.delete(key);
    while (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes) this.delete(this.entries.keys().next().value);
    this.entries.set(key, { value: structuredClone(value), bytes, expires: this.now() + this.ttlMs }); this.bytes += bytes; return true;
  }
  clear() { this.generation++; this.entries.clear(); this.bytes = 0; }
}
