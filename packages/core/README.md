# Pure pipeline core

Independent MIT implementation, browser ES modules, no runtime dependencies. Import from `packages/core/index.js`. Requires Web Crypto, AbortController, structuredClone, TextEncoder. Node tests use Node 22+.

`createPipeline({ ocr, translate, cacheOptions?, ocrConcurrency=1, translationConcurrency=2, maxQueue=16 })` returns `run(input, {signal}?)`, `clear()`, and content-free `diagnostics()`.

Input:
- `imageBytes`: ArrayBuffer or typed array; at most 20 MiB.
- `width`, `height`: positive intrinsic integer dimensions; at most 40 million pixels.
- `namespace`: nonempty profile/site/privacy scope identifier. The caller must isolate normal/incognito and user/account scopes.
- `ocrConfig`: JSON object with all OCR engine/model/preprocessing/language versions affecting output.
- `translation`: sourceLanguage, targetLanguage, provider, endpoint, accountNamespace and model are required strings. Optional output-affecting fields: modelRevision, promptVersion, schemaVersion, glossary, glossaryRevision, style, context (string, 32768 characters maximum), contextRevision, generation, adapterRevision. Never put credentials here. Moving model aliases require caller-managed revisions or expiry.
- `sourceEdits`: optional object mapping known region IDs to replacement source strings. These reuse raw OCR and alter the effective translation identity.

OCR adapter: `ocr({imageBytes,width,height,config,signal})` resolves `{regions}`. Each region has `regionId` (ASCII letters/digits/underscore/hyphen, unique), `bbox: {x,y,width,height}` in original pixels, `sourceText`, and unique integer `readingOrder`. Optional: integer sourceRevision, confidence in [0,1], direction (`ltr`, `rtl`, `vertical`), uncertainty (up to 16 bounded strings). At most 256 regions, text at most 8192 characters. Unknown fields are rejected.

Translation adapter: `translate(request, {signal})` resolves `{translations:[{regionId,text}]}` with exactly the requested IDs, once each. Request contains the full translation configuration, namespace and ordered `{regionId,sourceText,readingOrder,sourceRevision}` regions. Responses may arrive in any order and are normalized to source order. Unknown fields, missing/extra/duplicate IDs and overlong strings are rejected before cache insertion. Adapters must normalize provider usage/provenance separately, outside this strict output object.

Run result: `{regions,translations,imageHash,ocrKey,translationKey}`. `clear()` increments generation in both caches, so already-running work may finish for its existing caller but cannot repopulate either cache. Requests started after clearing cannot join old work. Cancellation detaches one subscriber; the final subscriber aborts the adapter. An adapter that ignores abort retains its concurrency slot until settlement. Sent paid requests may still be billed. Queue overflow rejects with QueueFullError. Failures are not cached or retried by the core.

`BoundedCache({maxEntries=128,maxBytes=8388608,ttlMs=1800000,now=Date.now})` provides get/set/delete/clear, size and generation. Limits apply separately to each pipeline stage; byte accounting measures UTF-8 JSON plus keys, not JavaScript heap overhead. Values are cloned on insertion and return. Storage is memory-only and lost on executor restart. No persistent adapter is enabled; any future storage adapter must preserve generation fencing and validation.

Low-level exports also include canonicalize, sha256, hashKey, ocrKey, translationKey, BoundedQueue, SingleFlight and validators. Keys use canonical JSON with sorted object properties and exact array/string preservation, SHA-256, and cache schema revision 1. Provider prompt caching is not measured or equated with stored-result reuse.

Diagnostics expose lifetime `ocrLookups`, `ocrHits`, `ocrMisses`, `ocrCoalesced`, `ocrCalls` and matching `translation*` counters. Every eligible stage attempt after cancellation checks increments one lookup, with exactly one hit or miss. A generation-invalidated attempt counts as a miss. `Hits / Lookups` is the stored application-result hit rate; coalesced subscribers count as misses plus `Coalesced`, never hits. Calls count actual adapter invocations, not queue admissions, joins, or provider cached tokens. Invalid output and rejected/aborted jobs remain misses. Empty OCR pages do not perform translation lookups. Clear removes entries but preserves lifetime counters, so compare before/after snapshots for a workload. These counters do not log source content or credentials.

Run `node benchmarks/cache.mjs` (optionally `SAMPLES=100`) for a reproducible synthetic cache workload. Its JSON includes actual per-scenario p50/p95, call counts, hit-rate denominators and environment. The adapters return deterministic fixtures; results are core bookkeeping timings, not OCR/LLM or real-browser performance claims. Extension admission can enforce stricter byte/pixel limits than these reusable core upper bounds.
