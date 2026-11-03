# 更新记录

每个更新使用日期与版本号标题（`YYYY-MM-DD - vX.Y.Z`），标题下分点记录已完成修改。日期使用 Asia/Shanghai。

新增记录默认中文，说明实际新增、改进、修复、兼容变化与升级注意事项，不把计划写成已完成。既有英文记录保留用于历史追溯。

## 2026-11-03 - v0.1.0

- 增加实验性本地亮色区域检测、局部 OCR 与整图补漏，以及独立检测缓存和不调用 LLM 的准备入口；不宣称真实漫画准确率或性能改善。
- 增加当前页面可见优先的有界提前处理，默认关闭，纯本地与远端计费预取分开同意；后台原子预算、精确页面授权、暂停/撤权/导航取消和清理世代保护。
- 增加合成区域、准备缓存与安全回归及可重复对照测量；浏览器集成结果以此提交的 CI 为准，仍不代表真实网站或付费模型质量。

- 为 README 增加项目说明头和中文、英文版本入口；两版同步说明开发预览的已验证范围和限制。

- 将后续开发文档、代码注释、文档字符串与 Issue 默认语言改为中文；更新当前开发规范、使用指南与记忆模板，保留历史英文研究、许可证和更新记录，不更改 API 标识或运行时翻译语言。
- 新 Issue 表单与共享校验器支持中文，保留历史英文结构兼容；main 未合并前按过渡规则提交中文内容，不误称 dev 模板或校验器已替换线上 main 版本。

- Verified the packaged Chromium path with real local OCR and synthetic acquisition/provider boundaries: warm reuse, OCR correction, context invalidation, reversible original display and forget/reconfigure all passed. Recorded exact CI evidence and remaining real-site/model/M4 acceptance gates; added seven-day build and screenshot/metrics artifacts without publishing a release.

- Confined synthetic provider responses to the temporary offscreen test context and relayed bounded diagnostics directly to the harness. Unexpected offscreen network calls now fail closed in the test, independently of Playwright routing support.

- Corrected the browser test acquisition mock: extension service-worker fetches were not intercepted by Playwright context routes. The harness now injects only the synthetic image response at that boundary and checks privacy fetch options; production fetching and the shipped extension are unchanged.

- Made synthetic service-worker failure diagnostics directly readable by the browser harness because worker console messages were absent from the context-level console stream.

- Added synthetic-only browser failure tracing in the test temporary copy after CI confirmed an initial translation failure before any provider call. Production error redaction remains unchanged; browser acceptance is still pending.

- Fixed asynchronous OCR teardown so replacement work cannot overlap a worker still terminating; serialized OCR across account-specific pipelines, protected replacement job identities from stale cleanup, and added lifecycle regressions plus fail-fast browser diagnostics. Unified the image pixel budget at 16 million.

- Pinned extension CI to Ubuntu 24.04 after the first run proved that the rolling Ubuntu 26.04 image is unsupported by the locked Playwright version. Unit tests and build passed on that first run; browser setup failed before browser tests ran.

- Added an unreleased MV3 development preview with locally bundled English OCR, opt-in fixed-endpoint LLM text translation, reversible overlays, original-image toggle and cumulative OCR corrections.
- Added byte-keyed OCR and context-sensitive translation caches, bounded queues and storage, cancellation/single-flight handling, generation-safe clear/forget, and explicit cache/call counters. No persistent reading cache or automatic paid retry is claimed.
- Added explicit host/text consent, session-only provider settings, sender validation, bounded image fetching and pre-decode dimension checks; images and secrets are not passed to the LLM or content-script settings.
- Added locked builds, dependency/model provenance and license notices, real offline synthetic OCR tests, application/lifecycle tests, synthetic cache benchmark and a mocked-provider browser CI smoke. Live provider, real manga quality and M4 performance remain unverified.
- Recorded actual cancellation/correction/resource pitfalls and the cloud browser execution restriction in memory; documented installation, supported scope and remaining acceptance gates. This entry does not publish a release or merge dev into main.

## 2026-11-03 - v0.0.0

- Added the first English implementation plan under docs/plans/v0.1: requirements, independent ImageTrans-inspired architecture, layered cache contracts, privacy, research/license comparison, staged delivery, and reproducible evaluation gates. This is a documentation proposal, not an implemented translator or measured benchmark.
- Recorded checked MV3 lifecycle, context-sensitive cache identity, and separate code/model-license constraints in project memory; linked the plan from README and AGENTS.

- Created dev from main at 0cbb377b69a844299b0e8926a06282cc2a73d494 and documented development on dev, testing before merge, and main as the release branch. This workflow update is committed on dev only; it does not merge into main or publish a release.
- Added a development record documenting branch separation, verification steps, and the need for explicit merge/release authorization.

- English bug and feature Issue Forms, API body examples, and a shared issue guide applying equally to people, maintainers, dot, and other bots.
- Dependency-free issue-structure validator with offline tests and a read-only opened/edited/reopened/manual audit workflow; reports results without commenting, labeling, closing, or modifying issues.
- Documented API/form bypass limits, GITHUB_TOKEN event suppression, factual-review obligations, and safe treatment of untrusted issue content. These are contribution-tooling changes, not a translation implementation or software release.

- Initial README documenting the project goals: high-performance, low-latency online manga translation and natural, context-aware LLM translation.
- Early-stage status notice distinguishing goals from implemented features and measured performance.
- Contribution invitation welcoming issues and pull requests.
- MIT License allowing modification, distribution, and commercial use subject to its terms.
- This update history, linked from the README, using date-version section headings and direct bullet points.
- Agent development guidelines covering project goals, evidence-based performance claims, licensing, contributions, and documentation updates.
- English-only project documentation, code comments, and docstrings are required by the development guidelines; manga and translation languages remain unrestricted.
- Root MEMORY.md index and a multi-level memory/ knowledge tree for architecture decisions, development pitfalls and practices, and performance testing.
- Reusable record template covering evidence, cause, fix, verification, applicability, references, status, and update date; category indexes explicitly state that no implementation lessons exist yet.
- Required reading order of README.md, MEMORY.md, and AGENTS.md before development, followed by task-relevant records; guidelines for maintaining useful, current, public-safe project knowledge.
- Versioned commit, merge, and push hooks requiring PUBLISH.md and real memory/ record content updates, with a fixed pre-policy history baseline and fail-closed remote-history inspection.
- Python standard-library validator, 21 isolated integration tests, explicit per-clone installation instructions, and a verified development record documenting behavior and limitations.
- Project initialization: v0.0.0 covers documentation and developer tooling only. No manga translation application release or Git tag has been published, and no application upgrade procedure exists yet.
