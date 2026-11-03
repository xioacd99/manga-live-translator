# Research and Dependency Decisions

Checked 2026-11-03. The following primary sources inform an independently written design. Repository licensing describes the inspected project, not every transitive dependency, model weight, font, dataset, or hosted service. Candidate dependencies are not installed or selected for shipping by this document.

## ImageTrans ideas to retain independently

The [ImageTrans extension](https://github.com/xulihang/ImageTrans_chrome_extension) documents two paths: desktop-server integration and standalone browser-local PaddleOCR with a chosen translation service. Useful product patterns are per-image control, viewport-triggered work, original/translation switching, and reusable local results. Local OCR is not the same as offline translation. The extension is GPL-3.0; study documented behavior and implement new interfaces rather than copying its helpers or relabeling its code MIT.

The separate [ImageTrans desktop product](https://www.basiccat.org/imagetrans/) is an editing pipeline with OCR, translation, text removal, typesetting, terminology, and review. Its product/license status cannot be inferred from the extension repository. This project adopts the decomposition and user correction concept, but defers editor/export/inpainting scope. The initial reading UI should remain reversible.

## Research papers

| Primary source | Relevant evidence | Proposed experiment or boundary |
| --- | --- | --- |
| [Hinami et al., Towards Fully Automated Manga Translation, AAAI 2021](https://arxiv.org/abs/2012.14271) | Frames translation as contextual and multimodal rather than independent strings. | Preserve page regions and neighboring context. Do not transfer the paper's results to an untested current API. |
| [Kaino et al., Utilizing Longer Context than Speech Bubbles in Automated Manga Translation, LREC-COLING 2024](https://aclanthology.org/2024.lrec-main.1505/) | Studies longer narrative/work context in manga translation. | Compare bubble-only and bounded-context conditions, tracking terminology/pronouns as well as cost. More context is not automatically better. |
| [Lippmann et al., Context-Informed Machine Translation of Manga using Multimodal Large Language Models, COLING 2025](https://aclanthology.org/2025.coling-main.232/) | Evaluates visual input, translation-unit size, and context, including token-efficient processing. | Test page-text versus opt-in page-image context with the same model/version. Keep each region ID and measure quality/cost/latency separately. |
| [Sachdeva and Zisserman, The Manga Whisperer, CVPR 2024](https://arxiv.org/abs/2401.10224) | Models panel/text/character relationships, speakers and order; evaluation is on English manga. | Reading order is not a universal top-left sort. Use uncertainty and corrections; this does not establish Japanese OCR quality. |
| [Tails Tell Tales, ACCV 2024](https://www.robots.ox.ac.uk/~vgg/publications/2024/Sachdeva24a/sachdeva24a.pdf) | Studies chapter-wide named-character transcription. | Later chapter glossary/speaker-state experiment, not a prerequisite or permission to upload an entire chapter. |

Research results motivate hypotheses. None of these papers establishes this extension's latency, cache hit rate, quality, memory use, or commercial dataset rights. Use licensed, public-domain, self-authored, or separately authorized evaluation pages; public visibility is not a redistribution license.

## Repository and model comparison

| Project and primary reference | Observed license and role | Decision for this plan |
| --- | --- | --- |
| [ImageTrans Chrome Extension](https://github.com/xulihang/ImageTrans_chrome_extension) | GPL-3.0 extension; browser/local and desktop-server workflows. | Behavior reference only; no code incorporation. |
| [manga-image-translator](https://github.com/zyddnys/manga-image-translator) | GPL-3.0 end-to-end pipeline. | Study modular stages and UX failures; do not import renderer/helpers. A directory called mit-renderer is not an MIT license grant. |
| [mokuro](https://github.com/kha-white/mokuro) | GPL-3.0 offline analysis plus browser reading metadata. | Retain analysis/reader separation as a concept, not code. |
| [comic-text-detector](https://github.com/dmMaze/comic-text-detector) | GPL-3.0 detector/segmentation repository; data/font rights require attention. | Reference-only; do not assume checkpoint permission from availability. |
| [Comic Translate](https://github.com/ogkalu2/comic-translate) | Current repository identifies Apache-2.0; multi-stage desktop workflow. | Comparative product reference. Inspect exact files, notices and assets before any reuse; no dependency chosen here. |
| [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) | Apache-2.0 code; detector/recognizer and larger document/VL families differ. | Candidate lightweight exported OCR path after exact-weight, preprocessing, runtime, quality and size checks. Do not substitute large VL models by name alone. |
| [Tesseract.js](https://github.com/naptha/tesseract.js), [license](https://github.com/naptha/tesseract.js/blob/master/LICENSE.md) | Apache-2.0 browser WASM wrapper. | Portable baseline; reuse workers, audit language data, and measure manga accuracy. Not a specialized recognition improvement. |
| [Manga OCR](https://github.com/kha-white/manga-ocr), [original model card](https://huggingface.co/kha-white/manga-ocr-base) | Code and original model identify Apache-2.0; Japanese crop recognition. | Later specialist candidate. Detection is separate; browser export/quantization needs validation. Recognition can hallucinate plausible text on non-text crops. |
| [Magi](https://github.com/ragavsachdeva/magi) | Provided models/datasets restricted to academic research in the README. | Paper/concept reference; exclude restricted weights/datasets from default commercial-capable distribution. |
| [ONNX Runtime](https://github.com/microsoft/onnxruntime/blob/main/LICENSE), [Web guide](https://onnxruntime.ai/docs/tutorials/web/) | MIT runtime; model license independent. | Candidate browser inference runtime. Check exported operators and WASM/WebGPU fallback on supported Chrome. |
| [MLX LM](https://github.com/ml-explore/mlx-lm) | MIT runner, with separate model licenses. | Optional future Apple-silicon companion research; not part of first browser MVP. |

Do not claim that an independent MIT wrapper overrides another component's obligations. Before adoption, record dependency version/commit, code license, transitive notices, artifact source/digest, weight license, training-data limitations when known, font license, redistribution terms and review result. Reject unclear or research-only artifacts for the default distribution until resolved.

## Platform and provider constraints

- [Chrome service-worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle): worker termination and loss of globals require recoverable job state. Keep long-lived model residency elsewhere, and test interruptions rather than relying on keepalive tricks.
- [Chrome offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen): a bundled offscreen page can support justified background web work, with API/lifecycle restrictions. Confirm the selected reason and worker implementation in a spike.
- [Chrome cross-origin requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests): content-script CORS and extension host permissions differ; privileged fetch must validate destinations and senders.
- [Chrome storage](https://developer.chrome.com/docs/extensions/reference/api/storage): small settings/session storage differs from content databases, and storage access levels matter. Use IndexedDB for bounded structured results, not sync storage for image/model payloads.
- [Remote-hosted code rules](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code) and [extension CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy): package executable JS/WASM; inspect library defaults for CDN loading and configure WASM CSP deliberately.
- [ONNX Web deployment](https://onnxruntime.ai/docs/tutorials/web/deploy.html): artifact/worker/runtime packaging is an engineering concern separate from model quality.
- [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching) and [Claude prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching): prefix processing reuse is not a saved translated answer. Provider/model eligibility, TTL and usage fields must be verified in the adapter; do not pad prompts only to manufacture a hit metric.
- [OpenAI key safety](https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety): client-side secret exposure is a risk. A personal BYOK extension is a conscious tradeoff, not secure secret custody. A local credential-holding helper or authenticated proxy is a separate deployment option with its own privacy and operational cost.

## Decisions and remaining uncertainty

The default proposal favors independent implementation, reversible overlays, local OCR, a typed provider adapter, exact staged caching, and explicit disclosure. It does not yet select a production OCR checkpoint or provider model. The owner must review scope/privacy choices, then prototype gates determine compatibility and budgets. No application benchmark, browser package test, or rights-cleared corpus evaluation was performed during this documentation task.
