# Requirements and Acceptance Criteria

## Product goal and initial audience

Provide low-wait, natural translation while a reader stays on an online manga page. The first development environment is Chrome on a Mac M4 with 16 GB RAM. The initial supported input is a static image available to the browser under an authorized origin grant. The user chooses source and target languages and a translation provider; the first validation corpus is English-to-Simplified-Chinese, with Japanese vertical text evaluated separately.

The primary flow is: explicitly enable the extension for the current site, select an image or activate visible-image translation, view progress, read an overlay, inspect the original, correct OCR/order if needed, and continue reading. Enabling automatic processing must clearly disclose which text or images leave the device and the potential provider cost. Do not translate arbitrary background tabs merely because a host permission exists.

## MVP requirements

| ID | Requirement | Acceptance evidence |
| --- | --- | --- |
| R1 | Discover static img/currentSrc images, including lazy-loaded additions, only within the enabled page. Ignore icons and tiny decorative images using configurable, documented eligibility rules. | Synthetic reader fixtures cover lazy loading, srcset changes, resizing, SPA navigation, duplicate nodes, and removed nodes. |
| R2 | Translate one selected image and optionally visible eligible images; support pause, cancel, retry, and restore original. | UI tests show no duplicate overlay, no stale result after navigation, and no provider work before explicit enablement. |
| R3 | Run text detection and recognition locally, preserve region coordinates and reading order, and expose low-confidence/failed regions instead of inventing missing text. | Detection/recognition outputs have stable region IDs, original-image coordinates, engine/config versions, confidence when supplied, and editable source text. |
| R4 | Translate a page's ordered dialogue with an explicit glossary, target language, style, and bounded context. | A schema-validated response maps exactly to requested region IDs; missing, duplicate, extra, or malformed entries are rejected or selectively retried, never silently shifted to another bubble. |
| R5 | Display reversible, accessible text overlays anchored to regions; preserve the underlying image and page interactions. | Zoom, responsive layout, orientation/resize, long translations, mixed scripts, and original/translation toggles work without destructive changes. Overflow opens a readable panel instead of illegible font shrinking. |
| R6 | Reuse completed image/OCR/translation work and coalesce equivalent in-flight requests. | Warm-repeat tests show zero extra OCR/LLM invocations for identical effective keys, with stage-specific invalidation and failure/retry tests. See Issue 1. |
| R7 | Bound CPU, decoded pixels, memory, concurrent requests, storage, retries, and cost-producing prefetch. | Queue/capacity/cancellation tests demonstrate backpressure and clean resource release; no unbounded chapter-wide processing. |
| R8 | Explain status and recovery in English UI/developer diagnostics while preserving configured translation languages. | Separate states for permission, fetch, model load, OCR, translation, rendering, cancellation, and provider errors; safe diagnostics never contain keys or raw content. |
| R9 | Allow local clearing of results and optional persistent cache, and isolate caches by user profile and content scope. | Retention/expiry/clear tests include delayed responses that must not repopulate a cache after clearing. |
| R10 | Protect provider credentials and page data. | Keys never reach content scripts/page DOM, URLs, logs, sync storage, repository, or telemetry; no arbitrary website-controlled fetch/proxy endpoint. |

## Deliberate non-goals for the first implementation

- No whole-book scraper, access-control bypass, DRM bypass, CAPTCHA solver, or bulk redistribution of translated manga.
- No ImageTrans desktop binary integration or GPL/AGPL source incorporation into this MIT project.
- No universal site compatibility: canvas/WebGL readers, CSS backgrounds, cross-origin iframes, signed/authenticated images, and animated images are separate cases, not silently supported.
- No photorealistic text removal, generative inpainting, original-font reconstruction, or downloadable edited chapters in MVP.
- No hosted shared cache across readers, automatic cloud OCR, or vendor-specific prompt-cache hit-rate guarantee.
- No local full-size translation LLM requirement on 16 GB RAM; local-model support is a later adapter experiment.
- No claim that a structurally valid LLM response is a correct translation or that a passing tooling test proves application quality.

## Interaction and error behavior

A per-image panel shows the current stage and a restore control. A page-level toggle controls new work, while cancellation detaches that image's subscriber. Stop shared work only when all subscribers are gone or its budget expires. Already-sent paid provider requests may still be billed; cancellation must not promise otherwise.

OCR corrections create a new source revision and invalidate dependent translations. Translation edits are stored as user overrides with provenance, not overwritten by a later model response. An explicit reset returns to generated output. Low-confidence recognition and uncertain reading order remain visible to the user; default behavior does not silently upload pixels to a vision model.

A provider timeout or rate limit creates a retryable error, not a successful cache entry. Retrying has bounded attempts, exponential backoff with jitter, and Retry-After handling where supported. User cancellation is not retried. Permission failures explain the missing origin rather than repeatedly requesting broad access.

## Quality and performance definition

Natural translation means preserving meaning, speaker intent, names, pronouns, tone, and cross-bubble consistency without hallucinating content. Use bilingual human review with a fixed rubric; model-as-judge may assist triage but is not the sole acceptance authority. Separate OCR errors, ordering errors, translation errors, and layout errors.

Measure time to first usable translated region and time to complete a visible image. Report p50/p95 with sample count, hardware/browser, provider/model/version, image sizes, languages, network conditions, cache state, and retry counts. Cold model initialization, cold application cache, warm application cache, and provider cached tokens are distinct conditions. No baseline exists yet.

A functional warm-cache acceptance target is zero additional LLM requests for a previously successful, valid identical result. This is a deterministic correctness requirement, not a predicted percentage of real-world traffic. Numerical latency, RAM, and quality release thresholds are selected after the prototype corpus establishes a baseline.
