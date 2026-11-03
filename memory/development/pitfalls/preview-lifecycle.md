# Preview lifecycle and validation lessons

- Status: resolved unit-level findings; browser lifecycle acceptance remains open.
- Updated: 2026-11-03 (Asia/Shanghai).
- Scope: the first MV3 development preview.

## Evidence and fixes

Review found that forgetting settings permanently disposed the OCR adapter. The executor now recreates it, allowing a later explicitly configured session. Clearing or forgetting while a background image fetch was pending could otherwise restore old settings and dispatch stale work. Background invalidation now aborts outstanding fetches, advances a generation, and checks cancellation again after asynchronous executor readiness. UI mutations are serialized.

A second OCR edit originally sent only the newest changed region and lost the first edit. Corrections now accumulate per source version, survive retries and reset when the image source changes; a sequential-edit regression test verifies this.

Image decoding previously preceded the pixel-limit check and could run concurrently outside the OCR queue. Header dimensions are now validated before decoding and the decode queue is serial. Header checks do not prove compressed payload correctness: browser decode still validates the payload and closes its bitmap.

A popup permission request following initialization could lose its user gesture. Enable remains disabled until initialization completes; the permission request is invoked directly in the click path before another asynchronous operation.

## Verification and applicability

The actual local Tesseract worker recognized the generated English test bitmap. Cache, provider, content and security tests are offline and use no user content or real provider key. Cache benchmark timings measure synthetic adapters, not OCR or paid LLM latency.

Chromium launch failed in the cloud host with socket creation denied, including an isolated-profile permitted retry. This is an environment restriction, not evidence that the extension works or fails in Chrome. The built-extension synthetic browser test is included in CI; inspect its actual outcome before claiming browser validation. M4 performance, real manga quality and live provider behavior require separate evidence.

## References

- [Preview guide](../../../docs/development/preview.md)
- [Cache tests](../../../tests/js/core.test.js)
- [Content lifecycle tests](../../../tests/js/content-lifecycle.test.js)
- [Synthetic browser smoke](../../../tests/browser/smoke.mjs)

## CI operating-system pin

[First CI run](https://github.com/xioacd99/manga-live-translator/actions/runs/41580639361) passed all 73 JavaScript and 42 Python tests and the build. Browser installation failed because ubuntu-latest resolved to Ubuntu 26.04, unsupported by pinned Playwright 1.56.1. Pinning Ubuntu 24.04 aligns the runner with that browser tool's supported dependency installer; it is not a browser success claim. Keep runner and browser-tool versions compatible when upgrading.

## Asynchronous worker teardown and job identity

An isolated regression reproduced cancellation settling before asynchronous worker termination: the abort path cleared workerPromise, and a second cleanup saw no worker to await. A shared release promise now keeps the adapter busy until teardown completes. A module-level OCR queue spans account-specific pipelines so switching accounts cannot overlap old/new worker lifetimes.

A separate reproduction showed an old RUN finalizer deleting a replacement job with the same request ID after reconfiguration. Cleanup now checks object identity before deletion; background fetch cleanup similarly checks controller identity. Late successful responses also pass a post-await generation fence before reaching content. These findings are covered by lifecycle tests, not inferred from the browser CI result.
