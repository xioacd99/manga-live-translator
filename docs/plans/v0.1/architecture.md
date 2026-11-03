# Architecture and Data Contracts

## Proposed component boundaries

Use TypeScript for the extension and pure, testable pipeline contracts. Keep UI framework/build-tool selection lightweight and reversible until the first rendering spike. Packaged runtime code, a model manifest, and dependency/weight notices are part of the release input, not afterthoughts.

| Component | Responsibility | Must not do |
| --- | --- | --- |
| Content script | Observe enabled-page images; maintain image identity/revision and DOM geometry; render reversible overlays and progress. | Hold provider keys, accept arbitrary fetch instructions, evaluate LLM HTML, or process unrelated tabs. |
| Extension service worker | Validate messages/sender/origins; coordinate permissions, provider requests, small durable job metadata, and cache lookup. | Assume globals survive, host a permanently warm OCR model, or use fake activity to defeat lifecycle rules. |
| Extension-owned inference context | Decode/crop images and host a bounded worker with packaged OCR runtime; use an offscreen document only with an appropriate declared Chrome reason and lifecycle. | Run remote scripts, silently upload pixels, or retain unbounded decoded pages. |
| Storage layer | Session-memory OCR/results by default; opt-in IndexedDB content persistence; minimal durable job metadata; separate optional source-byte and model-artifact storage; migrations and eviction. | Store credentials in shared/content-readable databases or treat a content hash as consent. |
| Provider adapter | Map a typed translation request to one explicitly configured endpoint/model; normalize usage/errors; validate response schema. | Promise all OpenAI-compatible endpoints behave alike or blindly replay paid requests after crashes. |
| Extension UI | Provider and language settings, disclosure/consent, original/translation toggle, corrections, cache controls, diagnostics. | Hide data transmission, silently change providers, or imply cancellation reverses charges. |

Chrome's service-worker lifecycle and offscreen restrictions make restartability a design requirement, not an optional optimization. Content scripts remain subject to page-origin CORS; cross-origin fetches need an extension context and appropriate host access. These platform facts are documented in [research sources](research.md).

## End-to-end pipeline

1. User enables a page and chooses selected-image or visible-image mode. Snapshot the policy, language, provider, model, glossary, and context revisions.
2. Content script assigns an image revision using currentSrc and element lifecycle. New source, navigation, or removal invalidates the DOM subscriber; it does not automatically discard reusable content results.
3. Coordinator validates the tab/frame, URL scheme, destination origin, scope, byte/pixel budget, and requested capability. Fetch only authorized images. Do not accept arbitrary URLs forwarded by a website as a privileged network proxy. Authentication-required images and cross-origin frame access get explicit unsupported/recovery states until safely designed.
4. Hash original image bytes with SHA-256 after a successful fetch. URL/ETag mappings can accelerate lookup but cannot prove unchanged content indefinitely. Identical content behind two URLs can share analysis only inside the permitted cache scope.
5. Decode under dimensions/pixel limits and run bounded preprocessing. A large vertical strip may be tiled with overlap; transform coordinates back to source space and deduplicate overlap regions. Reject unsupported/oversized formats clearly rather than freezing the page.
6. Load/reuse a permitted local OCR model and produce regions. Preserve low-confidence outputs, don't invent boxes or confidence scores. Run a reading-order heuristic for the declared layout, permit manual correction, and record uncertainty.
7. Build a page-text translation request with stable region IDs, bounded previous context, explicit target language/style, and glossary. Cache-check the full effective request before calling the provider.
8. Validate all returned IDs, types, bounds, and completeness. Treat OCR text and model output as data; no tools, executable commands, or markup injection. Commit only validated completed results transactionally, then notify still-current subscribers.
9. Render escaped text with an overlay anchored to intrinsic-image coordinates and current CSS sizing. Include object-fit/content-box transforms and ResizeObserver updates; never rely on a one-time screenshot coordinate map.

## Data contracts

These are proposed contracts, not existing code types.

- ImageRecord: contentHash, byteLength, MIME, intrinsic width/height, decode/preprocess revision, authorized scope ID. Do not store full signed URLs in persistent diagnostics.
- Region: regionId, polygon/bbox in source coordinates, sourceText, sourceRevision, optional genuine confidence, direction/script, optional panelId, readingOrder, uncertainty flags.
- OCRResult: imageHash, engine/model artifact revision and hashes, language dictionaries, preprocessing/config versions, ordered regions, completion status.
- TranslationRequest: ordered region IDs/text, source/target languages, glossary revision, style, bounded context snapshot/hash, provider endpoint/account namespace/model revision, template/schema versions and generation parameters.
- TranslationResult: requestKey, per-region plain text, provider/model provenance, completion time, optional returned usage, manual override references, validation status.
- JobRecord: jobId, opaque effective key, stage, state, generation, subscriber IDs, lease owner/expiry, retry count, budget, optional provider request ID. Default durable records exclude source text, context, signed URLs, provider payloads and secrets; they do not assert success without a committed result.

Manual source/order corrections increment sourceRevision; translation overrides use a separate revision and explicit reset. A global setting change only changes relevant keys. A rendering font/size change does not invalidate translation.

## Cache design

Maintain distinct layers rather than one opaque response cache:

| Layer | Effective identity | Invalidation and retention |
| --- | --- | --- |
| Model artifacts | Exact artifact revision + SHA-256 + runtime compatibility | Version/license change, integrity failure, explicit deletion; immutable verified artifacts can be reused. |
| Image/preprocess | Authorized scope + original-byte SHA-256 + preprocess revision/config | Changed bytes or preprocessing; persistent raw images disabled initially. |
| OCR | Image/preprocess identity + detector/recognizer hashes + dictionaries + language/config | OCR/model/preprocess changes; manual corrections are a separate source revision layered over raw OCR, invalidating translation without rerunning recognition. |
| Translation result | Canonical serialized source regions + order/revisions + target/source languages + endpoint/account namespace + model/revision + template/schema + glossary/style + bounded context + relevant generation parameters | Any output-affecting change; complete validated results only; no cross-user sharing. |
| Layout | Translation result/override revision + geometry + renderer/font revision | Resize, zoom, style or font changes; do not call LLM again. |

Use a deterministic canonical serialization and explicit cache schema version. Do not normalize whitespace, punctuation, image pixels, or language codes aggressively without equivalence tests. Perceptual hashes can suggest duplicates for review, but are not sufficient exact-result keys. Treat a provider's moving model alias as potentially changed: use an explicit adapter revision/expiry policy and provide refresh/bypass controls.

Proposed privacy default: cache reading content in memory for the current session; opt-in persistent OCR/results in extension-origin IndexedDB with finite TTL and byte/entry limits. Model binaries may persist separately after explicit download. Session content lives in bounded extension-owned inference-context memory, not service-worker globals; small trusted session metadata can use chrome.storage.session. A coordinator restart may reconnect to a surviving executor; an executor/browser restart loses default content and requires reacquisition. No cross-restart content reuse is promised without persistence opt-in. No cloud sync or cross-user cache. Changing endpoint/account namespace isolates results without putting an API key into the key. Separate incognito handling: disable persistent reading-content cache and cross-context reuse there in MVP.

Choose concrete TTL/capacity budgets during the storage spike and expose them before opting in. A candidate initial test configuration is 100 MB of persistent OCR/translation metadata, seven-day expiry, one active OCR job, and two outbound translation requests; these are tunable engineering trial limits, not measured safe limits or product promises. Monitor quota errors and degrade to bounded memory instead of crashing. Clear operations increment a generation/tombstone so late responses cannot repopulate cleared data.

## In-flight deduplication and interruption

Coalesce by the full effective request key. Each UI request subscribes to an existing job; one cancelled subscriber does not cancel others. Use bounded queues prioritized by selected image, then visible images, then user-enabled nearby prefetch. Prefetch is off initially because it can send unseen content and incur charges. Pause stops new work; navigation detaches subscribers and drops obsolete queued tasks.

A service-worker restart loses its in-memory map. Persist minimal job states and use transactional leases/generations to recover without duplicate local workers. Exactly-once paid external execution cannot be guaranteed after an ambiguous network response unless the provider offers a verified idempotency mechanism. An interrupted sent request must be marked outcome-unknown; wait for a known response or ask for explicit retry rather than claiming universal deduplication. Never infer remote failure solely from local timeout.

Bound queue length, decoded pixels, active jobs, retries, and output length. Yield image work to workers, release object URLs/bitmaps, and dispose unused OCR sessions. A content-script disconnect is normal lifecycle behavior. Tests must terminate/restart the coordinator during each stage and verify no stale overlay or permanently waiting subscriber.

## OCR and translation choices

Begin with a browser-compatible OCR baseline, then compare a pinned lightweight PaddleOCR detector/recognizer export against it. Tesseract.js is a useful portability baseline, not a claimed manga-quality winner. ONNX Runtime Web is a candidate runtime for selected exported models; WebGPU is feature-detected with WASM fallback. Model operator support, packaging/CSP, license, preprocessing parity, output correctness, download size, and peak RAM are gates before selecting it.

Manga OCR is a Japanese crop-recognition candidate after the detector path is established, not a full-page model. A browser export or quantization must preserve quality and carry traceable artifact licensing. No large local VLM is required for MVP. An optional local companion may later offer better specialist OCR, but is not a zero-install substitute and needs authenticated loopback access.

Default translation unit: ordered text regions from one page with a small, explicit previous-context snapshot and glossary. Compare it against bubble-only and opt-in page-image/VLM variants. Chapter-long context is not assumed better; changing context legitimately reduces exact cache reuse. Context is frozen per request, and later context enrichment creates a new result version rather than silently rewriting an already-read page.

## Security and privacy

- Store a user-provided API key only in extension-owned session memory/storage by default, restricted to trusted extension contexts. Persistent storage is an explicit option with an honest warning: an installed client cannot hide a long-lived key from its owner or a compromised local profile. Never ship a developer's secret key.
- Ask for provider origin and necessary image origins narrowly; prefer activeTab/scripting for user-invoked injection and optional host grants for sustained site operation. No all-URLs default without demonstrated need and review.
- Require HTTPS for remote provider endpoints; a separately reviewed local companion may use an explicit loopback-only exception. Reject redirects by default for credentialed/content-bearing calls or validate the destination before sending any sensitive headers/body.
- Validate every message's sender, schema, sizes, allowed operation, and destination. Keep provider network code outside the page context; do not forward arbitrary headers, cookies, or URLs.
- Treat webpage text, OCR, model outputs, filenames, and provider errors as untrusted. Use textContent/escaped rendering and schema validation, not innerHTML. Prompt instructions contained in manga text remain content to translate and must not cause tool execution or key disclosure.
- Package executable code with the extension. Downloaded models are declarative assets with integrity/provenance checks, not a route to remote executable code. Review Chrome Web Store requirements and content security policy before release.
- Show precisely what goes to the configured provider. Raw image upload and visual context require separate opt-in. No raw manga, OCR, prompts, keys, or page URLs in telemetry by default; use local aggregated counters and scrubbed opt-in debug exports.
- Test cache clearing, origin revocation, account switch, incognito isolation, malicious filenames/HTML, oversized images, retry storms, and a page trying to misuse extension message handlers.
