# First Implementation Research Boundaries

- Status: open
- Updated: 2026-11-03, Asia/Shanghai
- Scope: the first design draft for an independently implemented MIT Chrome manga translator; no translation application exists yet.

## Context and evidence

The owner requested ImageTrans-inspired requirements and a source-backed implementation plan on dev. Current ImageTrans extension documentation includes browser-local PaddleOCR as well as desktop-server mode; therefore desktop-required assumptions are stale. Chrome documents service-worker termination and cross-origin fetch restrictions, so durable OCR residency and permission routing need explicit design. Manga-context papers support evaluating context, not blindly maximizing it. Code licenses and model-asset grants differ; Magi's research-only assets are not a default commercial-capable dependency.

## Decision and alternatives

The draft proposes reversible overlays, local OCR, explicitly configured LLM translation, exact staged caches, and recoverable scheduling. Inpainting, full chapter automation, and native local LLM execution are deferred alternatives. These are proposals pending scope confirmation and feasibility tests, not benchmark-backed final decisions.

## Verification and applicability

Primary documentation and the repository's Issue 1 were read. Existing developer-tooling tests and document-link checks are used for this change. No packaged browser OCR, live paid provider call, application latency test, or bilingual corpus evaluation was run. First implement mock contracts and measure actual engines before selecting production checkpoints or release budgets.

This record applies to the initial design and must be updated when concrete runtime/model/provider evidence changes. Do not convert a source claim into a project performance result. A result cache avoids repeated completed work; provider prefix caching still requires a request. Context and glossary revisions are part of translation identity.

## References

- [First plan](../../../docs/plans/v0.1/README.md)
- [Source and license matrix](../../../docs/plans/v0.1/research.md)
- [Cache requirements in Issue 1](https://github.com/xioacd99/manga-live-translator/issues/1)

Superseded by: none.
