# 更新记录

每个更新使用日期与版本号标题（`YYYY-MM-DD - vX.Y.Z`），标题下分点记录已完成修改。日期使用 Asia/Shanghai。

新增记录默认中文，说明实际新增、改进、修复、兼容变化与升级注意事项，不把计划写成已完成。既有英文记录保留用于历史追溯。

## 2026-11-04 - v0.1.0

- 新增可选 Native Messaging 自动管理：用户一次安装宿主并授权后，点击启用/自动翻译或模型准备时启动本机 OCR；关闭最后一个普通窗口、退出浏览器或管道断开时回收本次服务。自动管理偏好保存，临时端口/令牌不落盘，翻译密钥仍仅会话保存。
- 每个浏览器连接拥有独立环回端口与同进程服务；不扫描或关闭其他 Python 进程，不干扰手动服务。状态轮询/浏览器启动不启动宿主，模型仍需明确下载。安装器面向 macOS/Linux，Windows保留手动模式；具体测试和未验证平台见生命周期文档。

- 首轮新版 CI 已通过单元、Python协议和构建，但浏览器夹具在服务工作线程API尚未可用时读取manifest失败；新增明确筛选与有界等待，保留超时失败，不把夹具修复说成产品浏览器已验收。

- dev 默认改为独立 Python 本地伴随服务：PP-OCRv6 medium1536 与报告同款 FP32 RT-DETR。新增固定资产哈希、显式下载进度/取消/完整缓存、环回Bearer及Host/Origin校验、字节/像素/并发上限；不提供任意URL代理，不上传漫画。
- 接入气泡包含归组、保留原行坐标与稳定ID、XY-cut/重叠行阅读顺序及LTR/RTL；框外字幕不丢弃。新增用户选定的 DeepSeek V4.1 Flash（API `deepseek-flash`）结构化文本翻译，完整ID验证，保留OpenAI旧配置选项，无自动付费重试。
- 精确缓存隔离原始OCR与分组/顺序；同账户上下文变化复用OCR，改文及上下文使译文失效。预读限制为可见/邻近小窗口，远端仍需单独授权和预算。
- 新增实际像素纯色检查、安全子矩形覆盖、实测字宽自适应排版和完整译文卡片回退。未知/复杂背景或容不下时不强行擦字；原图和文本修正保留。
- README列明八个可独立优化的算法模块、代码入口、安装步骤和实测限制。浏览器构建不再携带旧Tesseract/WASM模型；升级需要单独安装并启动Python服务、重新填写会话内凭据。
- 增加算法、权限、下载、取消、状态竞争、缓存与浏览器接线回归。真实模型CPU/HTTP与合成浏览器/LLM证据分别记录；本地Chromium受宿主Unix套接字限制，最终CI状态见本次开发提交。没有真实付费翻译、私有图片外发、M4验收或main合并。

## 2026-11-03 - v0.1.0

- 完成英文漫画高精度追加3组30次完整单遍：固定扩边、三视图置信度重识别及docTR DB-ResNet50＋PARSeq，新增图文负结果与公开复现；三视图仅少7字符编辑但耗时约2.34倍，不夸大微小收益。核验漫画专用模型的授权限制和未测LightOnOCR-3候选，未修改默认、未合并main。

- 完成英文漫画Paddle扩展矩阵19组190次单遍实测：v6完整检测×识别3×3、medium四档分辨率及参数隔离、v5 server和英文/Latin识别分支；新增CER/WER、耗时、RSS与实际权重体积图表及公开复现。核实v6没有官方large，保留非单调分辨率与组件取舍，未修改产品默认或发布main。

- 完成固定英文10图的Paddle四种批量/并发配置120次实测，新增整批耗时、首结果、内存与CER图文对照及可复现协议；核实Unlimited-OCR 2多页接口与二代格式，记录本地MLX CPU两页合成探针成功加载但900秒无首token的超时边界；不将多页能力或探针超时等同于漫画精度，不更改产品默认。

- 完成固定英文10图的四档分辨率120次调用与本地PaddleOCR-VL-1.6整页10次实测，新增图文精度/资源报告、重复退化证据和参数化复现；保留两页失败及探索性离线回退边界，不改产品默认模型，不把云CPU结果称为浏览器或M4性能。

- 完成同一英文漫画10图的Paddle七组实测，包含英语专用v5、v6 tiny/small/medium、运行库桥接及预先定义的检测参数对照；新增CER/逐图热力图、耗时/体积图与复现来源，保留OCR和浏览器/翻译质量边界，不改默认模型。

- 完成英文/日文各10图的五路线对照及日文竖排补充，加入图表、真实公版错误样例、逐图统计、参数化复现与模型许可说明；明确部分标注、历史手写未评OCR、模型下载受阻和非浏览器性能边界。
- 新增可选英文WER、版本化行/列几何排序及显式OCR排除标记，保留历史默认输出；纯合成回归覆盖竖排框抖动，未调整GT或模型去追求分数。没有替换产品默认模型或发布main。

- 完成固定中文漫画10图的五方案CPU对照，公开来源哈希、评分协议、逐图指标、许可和可搬迁复现脚本；原图及完整参考/OCR文字不公开，结果不代表浏览器或M4性能。
- 增加CER与检测匹配评分单测，明确行框/段落框粒度差异、标点、空输出和截断文本边界；报告供维护者选择，不修改产品默认方案。

- 云浏览器验证暴露稀疏 OCR 对带边框合成图返回空文本；本地真实 Tesseract 复现后增加仅空结果触发的一次自动版面回退，并版本化 OCR 缓存身份。保留原测试，增强失败诊断，不把空结果绕过为成功。

- 默认区域检测改为漫画专用预训练 RT-DETR ONNX，本地单线程 WASM 推理，替代未充分比较的亮色启发式；新增固定模型来源、完整性校验与第三方许可记录，不宣称真实漫画质量已验收。
- 增加首次明确触发的本地模型下载、字节进度、未知总量显示、校验与加载阶段、取消和重试；只持久保存完整已验证权重，后续重建执行器可复用，扩展包不包含检测权重。
- 增加检测资源共享队列、下载意图竞争与撤权取消修复，以及真实模型合成浏览器测试；测试下载流与 LLM 为模拟，实际 ONNX/OCR 在云浏览器本地运行，最终结果以对应 CI 为准。

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
