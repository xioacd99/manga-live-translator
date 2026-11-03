# Development Stages and Evaluation

## Working rules

Read README.md, MEMORY.md and AGENTS.md before work. Develop on dev. Every development commit updates PUBLISH.md and a real memory record with verified findings; write documentation, comments and docstrings in English. Keep main unchanged until a separately authorized tested merge. Use the existing issue structure for humans and bots alike.

The current repository has developer-tooling tests, not a translation implementation. The stages below are proposed work packages, not delivered features. Do not write untested performance claims into README or PUBLISH.

## Ordered stages and exit gates

| Stage | Deliverable | Exit gate |
| --- | --- | --- |
| 0 Scope and evidence | Confirm initial language pair, privacy defaults, first provider, and rights-cleared corpus; artifact/license manifest and data contracts. | Owner decisions recorded; no restricted/unknown-license default assets; fixture provenance recorded. |
| 1 Browser vertical slice | MV3 skeleton, selected-image discovery/fetch, reversible overlay using mocked OCR/provider, narrow permissions and lifecycle state. | Synthetic supported-site fixtures pass; unsafe URLs/messages rejected; no remote call before enablement; overlay survives resize and removes on navigation. |
| 2 OCR feasibility | Tesseract.js baseline and one pinned lightweight Paddle/ONNX candidate; optional Japanese specialist experiment separated. | Golden preprocessing/geometry/text parity, output abstention/error handling, measured startup/memory, WASM fallback, packaged runtime/CSP and license gates. Choose based on data, not project popularity. |
| 3 Translation adapter | One explicitly supported provider/model, ordered page request, glossary/context snapshot, JSON schema validation, cancellation and bounded retry. | Mocked contract tests plus opt-in paid smoke test; region-ID alignment and no key/content leakage; bilingual review against bubble-only baseline. |
| 4 Cache correctness | Image/OCR/result/layout identities, single-flight, finite retention/capacity, clear generation, optional persistence. | Every acceptance criterion in Issue 1 exercised with mocked counters; no stale reuse or poisoned result; restart ambiguity represented honestly. |
| 5 Reading performance | Visible-image scheduling, queue limits, optional nearby prefetch, incremental rendering. | Cold/warm benchmarks on actual M4 target, responsive interaction under scrolling, resource release and cost/wasted-request reporting. No whole-chapter wait barrier. |
| 6 Release readiness | Packaged extension, supported-site/language matrix, dependency/model notices, privacy UX, regression report, installation/rollback guide. | Final browser/security/quality gates passed, no blocking regressions, owner-authorized merge/release. Tests on dev alone do not publish main. |

Stages 3 and 4 should share interfaces early: cache keys and mock counters are designed before live API traffic. A minimal real-provider slice can precede advanced OCR work, but do not defer correctness or privacy to an optimization phase. No calendar estimate is promised before stages 0-2 quantify model/export and compatibility uncertainty.

## Proposed code organization

A future implementation may use extension/ for manifest, content UI, service worker, inference context and settings; packages/core/ for schemas, cache keys, queue and provider contracts; tests/fixtures/ for authorized synthetic inputs; and benchmarks/ for reproducible workload definitions/results. Keep these paths as proposals until code exists. Do not add empty source directories merely to imply implementation progress.

Pure logic should be testable without Chrome or paid APIs. Integration tests use a deterministic fake provider recording call counts. Browser tests verify permissions, actual packaged behavior, rendering and lifecycle. Live provider tests are explicit opt-in and must state model, cost/budget, retention and data destination before running.

## Evaluation corpus and quality

Use a small development corpus and a separate held-out acceptance set, with no adjacent pages from the same scene leaking between them. The first corpus proposal is 30 development pages and 20 held-out pages across several distinct layouts, plus synthetic adversarial fixtures; these are collection targets, not existing data. Record rights, language, page size, orientation, panel count, text density and difficult regions. If permissions or reviewer capacity limit the set, report the smaller coverage rather than invent labels.

Include plain speech bubbles, narrow/rotated text, dark/colored bubbles, small/noisy scans, double spreads, and long vertical strips. Japanese vertical text, furigana and mixed scripts form a separate gated subset. Sound effects are explicitly marked optional until coverage is demonstrated.

Use region-level detection coverage and false positives; OCR CER with a documented normalization policy; reading-order pair errors; translation adequacy, fluency, terminology/speaker consistency and unsupported additions; and layout overflow/unreadability. Record reviewer language expertise, rubric, disagreements and representative failure classes. Do not use BLEU or an LLM judge alone to declare manga reading quality solved.

## Reproducible performance scenarios

Record browser/extension/runtime/model versions, M4 RAM/OS, image dimensions, decoder/engine settings, provider/model/endpoint, concurrency, network conditions, cache state and sample count. Run enough repetitions to show distributions and report confidence/variation rather than an isolated fastest run.

1. Cold browser/model and empty application cache.
2. Warm model, new image, no provider prefix reuse assumed.
3. Identical image and complete configuration with a valid completed result.
4. Same bytes at different URLs; changed bytes at the same URL.
5. Same OCR with changed target language/model/prompt/glossary/context.
6. Concurrent duplicate requests from multiple eligible elements/tabs.
7. Fast scroll/navigation/cancellation with queued and active work.
8. Worker termination before send, after send but before response, and before/after transactional cache commit.
9. Cache full, quota denied, expiry, manual clear, endpoint/account switch and incognito isolation.
10. Provider 429, timeout, malformed/partial JSON and transient failure, with bounded retries.

Report queue wait, acquisition/decode, model load, detection/OCR, translation and render durations; first-usable-region and whole-image p50/p95; peak process memory where measurable; max decoded pixels; outbound request attempts; wasted/cancelled work; billed usage when available; and per-layer cache hit/miss/invalidation counts.

For each layer, define hit rate as successful cache lookups returning a valid existing result divided by eligible lookups. Report coalesced waiters separately, not as stored-result hits. Application-result reuse that avoids an API call and provider cached-input tokens are separate columns with separate denominators. Live provider response variation can affect quality; warm cached results deliberately return the earlier validated artifact.

## Proposed initial engineering budgets

For the spike only, start with one OCR inference job, two provider requests, disabled speculative prefetch, and explicit image/pixel/queue caps selected from the corpus. Trial persistent-content retention, if enabled, is 100 MB and seven days; revise based on observed quota, privacy needs and data size. These defaults are test configurations, not proof of safe performance on every device.

Before a public release, establish concrete p95 latency, UI responsiveness, peak memory, quality and cold-download targets from the measured baseline, record owner-approved limits, and enforce them with regression workloads. A warm-cache no-extra-LLM-call assertion is enforceable immediately using a fake provider. Numerical real-world cache-hit percentage depends on reader behavior and must not be guaranteed in advance.

## Definition of done for each future change

- Requirements and impacted IDs are identified; schemas and failure cases updated.
- Unit/contract tests cover relevant success, cancellation, invalidation and failure branches.
- Relevant packaged-browser and manual quality checks have actual evidence; skipped checks are identified.
- No new permissions, provider data flows, paid calls or model assets are hidden from the user.
- Dependencies and weights have recorded licensing/provenance; no copied copyleft source is presented as MIT.
- README/status, PUBLISH, memory records and relevant plan sections match delivered behavior.
- Dev tip is verified after push. Any merge/release remains a separate authorized action.

For this documentation change, run the existing `python3 -m unittest discover -s tests -v`, verify all repository-relative links, verify the published document bytes, and confirm main is unchanged. Passing these checks validates repository tooling/document integrity only, not the proposed application.
