# Development preview: v0.1.0

This is an unreleased dev-branch implementation, not a Chrome Web Store release or a production-quality translation benchmark.

## Build and test

Use Node.js 22 or later and Python 3. The initial local run used Node 24.22.1.

```sh
npm ci --ignore-scripts
npm test
npm run test:tooling
npm run build
npx playwright install chromium
npm run test:browser
node benchmarks/cache.mjs
```

Load the resulting `dist/` directory with Chrome's **Load unpacked** action in `chrome://extensions` after enabling Developer mode. This is a manual installation; no installer changes your browser or Git configuration. The build bundles the OCR worker, WASM, English model and license notices. It checks the pinned model hash and writes an asset manifest. No model CDN is contacted while reading.

## Try the preview

1. Open the extension's options. Enter your own OpenAI API key and a model ID supporting Chat Completions strict JSON schema. No default model or free usage is promised.
2. Review and accept the text-transmission consent. Optional context and glossary are sent with the dialogue. The API key is kept in Chrome's trusted session storage, not content scripts or sync storage.
3. Open a public HTTP(S) image reader. Use the extension popup to enable the current site. If images use another CDN origin, explicitly enter that origin too. Chrome asks for those hosts and `api.openai.com`; arbitrary page access is not granted by default.
4. Click **Translate** on a visible image. Local OCR extracts English text; only text and translation configuration go to OpenAI. Automatic mode is optional and may create additional billable calls for visible images.
5. Use **Show original** to remove the overlay, or **Read / correct text** to inspect and correct OCR. Corrections accumulate for the same image source and invalidate translation identity without rerunning unchanged OCR.
6. Use **Clear reading cache** or **Forget key and clear session** when finished. Already transmitted API requests may still be billed after cancellation.

Never paste a production secret into an issue or commit. No key is needed for the automated tests: provider responses are mocked and the image is generated from original bitmap glyphs.

## Implemented boundaries

- One local Tesseract English OCR worker, one decode at a time, and at most two concurrent translations. Bounded pending queues, image bytes and dimensions; malformed image headers are rejected before browser decode.
- Static PNG, JPEG, BMP and WebP within the validated subset; 4 MiB compressed bytes and 16 million pixels. Unsupported or animated formats are rejected rather than silently processed.
- Byte-based image hash; independent bounded OCR and translation caches; context, glossary, source corrections, provider/model/account and output configuration participate in keys. Application cache hits are not provider prompt-cache hits.
- Single-flight work coalescing, subscriber cancellation, generation-fenced clearing and counters distinguishing lookups, hits, misses, coalescing and actual adapter calls.
- Reversible text-only overlay and accessible text panel. Original pixels remain untouched. No inpainting, image export, whole-chapter crawl, canvas reader extraction, iframe support or authenticated image downloads.
- Memory-only reading caches. Service-worker interruption may lose an in-flight response; executor/browser restart may discard cache. No automatic paid retry or promise of exactly-once billing. Re-enable/retry manually if interrupted.
- The first provider adapter uses the fixed OpenAI endpoint. Redirects, arbitrary endpoints and image uploads are not supported. Invalid/missing region IDs, malformed output, refusal and incomplete output are rejected without caching.
- Public hostname restrictions are defense in depth, not DNS-rebinding protection. Only grant trusted reader/CDN origins. Fetches omit cookies and referrer and reject redirects. Incognito is disabled.

## Verification and limitations

The local unit suite includes actual offline OCR on a synthetic English bitmap, cache invalidation/concurrency tests, content lifecycle/geometry tests, provider malformed-response tests, and request security checks. Synthetic core timing is a test fixture measurement, not end-to-end browser latency or manga translation quality.

The initial cloud container could not start Chromium because the host denied socket creation, including an isolated-profile retry. The browser smoke is therefore also wired into GitHub Actions, where the [first successful synthetic browser run](https://github.com/xioacd99/manga-live-translator/actions/runs/41581846987) passed on commit 1906c1d909023e29a44813ca4ac7635c0346249b (Chromium 141, Ubuntu 24.04). It uses the built extension, genuine packaged OCR, a generated image, a mocked image-acquisition boundary and a mocked provider. Live reader/CDN acquisition is not covered by that synthetic smoke. No live paid provider call, user device run, M4 performance result or real manga corpus quality gate has been completed.

Outstanding acceptance work includes real reader-site coverage, speech-bubble/panel quality, natural dialogue evaluation, interruption/recovery exercises across Chrome lifecycle states, representative long-scroll memory measurements, Japanese/vertical OCR and a larger licensed benchmark corpus. These are not implied by passing synthetic tests.

See [dependency provenance](dependency-provenance.md), the [approved plan](../plans/v0.1/README.md) and [Issue #1](https://github.com/xioacd99/manga-live-translator/issues/1).

## Current acceptance status

| Area | Actual evidence | Still open |
| --- | --- | --- |
| Repository and application checks | 77 JavaScript tests, 42 Python tooling tests, locked build and full committed-file readback | Broader fuzzing and independent security audit |
| Browser vertical slice | Real packaged Chromium/Tesseract, synthetic image and mocked acquisition/provider; overlays, correction, context change, warm reuse and forget/reconfigure passed | Real site/CDN fetching, permissions prompt interaction, real reader layouts |
| Cache correctness | Stage keys, coalescing, per-subscriber cancel, TTL/LRU/byte limits, account isolation, clear fencing and stale cleanup regressions | Persistent content is deliberately absent; full browser process-death acceptance |
| OCR quality | Original generated English bitmap recognized offline and in packaged browser | Rights-cleared manga corpus, second OCR candidate comparison, Japanese/vertical input, reading-order/quality scoring |
| Translation quality | Strict schema and error contracts with synthetic provider response | Explicitly authorized paid model smoke and bilingual quality review |
| Performance and release | Synthetic cache counters/benchmark, bounded implementation, reproducible build | M4 p50/p95/memory measurements, release thresholds, authorized main merge/store publication |

Successful CI runs preserve an unpacked development build and synthetic screenshot/metrics artifacts for seven days. These are test/build artifacts, not GitHub Releases or store packages. Build locally after artifact expiry.
