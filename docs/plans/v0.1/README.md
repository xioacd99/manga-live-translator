# First Implementation Plan

> 语言约定更新（2026-11-03）：本目录保留首版英文研究与方案原文供追溯；新增开发文档、代码注释和 Issue 默认中文，以根目录 AGENTS.md 为准。后续需要英文支持时维护独立文档，不将历史英文材料视为当前语言要求。

Draft 1, 2026-11-03 (Asia/Shanghai). This is a proposed implementation plan, not a released product or a benchmark report. Development belongs on dev; main is unchanged by this plan.

## Recommendation

Build a Chrome Manifest V3 extension with reversible translated-text overlays, local OCR, an explicit user-configured LLM endpoint, and cache correctness before throughput optimization. Start with English-to-Simplified-Chinese static manga images, then admit Japanese vertical text only after an OCR quality gate. Keep languages configurable; this sequencing is a proposal, not a language restriction.

Use ImageTrans as a product/workflow reference, not as source code to relicense. Its current extension supports both a desktop-server path and browser-local PaddleOCR. Independently implement the experience, and audit every selected dependency and model artifact before adoption.

The first differentiator should be reuse: reopening an identical image with identical translation context should not repeat OCR or an LLM request when valid local results exist. Provider prompt caching is a separate optimization and must not be counted as an application-result cache hit.

## Read the plan

1. [Requirements and acceptance criteria](requirements.md)
2. [Architecture and data contracts](architecture.md)
3. [Development stages and evaluation](delivery-and-evaluation.md)
4. [Research and dependency decisions](research.md)

The detailed cache feature request is [Issue 1](https://github.com/xioacd99/manga-live-translator/issues/1). Existing repository rules remain in [AGENTS.md](../../../AGENTS.md), [MEMORY.md](../../../MEMORY.md), and the [issue guide](../../ISSUES.md).

## Decisions for owner review

- Confirm English-to-Chinese as the initial quality target; Japanese-to-Chinese remains the next gated language pair.
- Confirm local OCR plus text-only LLM requests as the default. Image/VLM upload is an explicit optional fallback, never a silent escalation.
- Confirm reversible overlays before inpainting or reconstructed downloadable pages.
- Choose a first LLM provider and model only after testing its endpoint, structured output support, latency, price, retention, and key-handling constraints. An OpenAI-compatible transport adapter is a proposed interface, not a claim of universal compatibility.
- Confirm a user-approved origin scope and whether any persistent reading-content cache should be enabled by default. Proposed default: session-only content, opt-in bounded persistence.
- Approve measured performance budgets after the first prototype; the plan gives testable correctness gates and provisional engineering budgets rather than invented product numbers.

Changes made to a separate Chinese review document are proposals until explicitly reconciled back into dev. Do not overwrite user edits or treat a document edit as permission to implement, merge, or release.
