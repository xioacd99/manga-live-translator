<div align="center">

# Manga Live Translator

面向在线阅读的漫画翻译工具，追求低延迟和自然、理解上下文的 LLM 译文。

简体中文 | [English](README.en.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

</div>

## 当前状态

尚未发布的 dev 分支预览版已实现本地英文 OCR、需主动启用的大语言模型文本翻译、可撤销的浏览器译文覆盖层，以及容量受限的分层缓存。下列目标不代表已测得的性能或质量结论。构建、使用、验证方法和限制见[开发预览指南](docs/development/preview.md)。

[合成浏览器集成测试](https://github.com/xioacd99/manga-live-translator/actions/runs/41581846987)已通过，使用真实打包的 OCR，并模拟图片获取与模型服务边界。真实网站和翻译质量仍待验证。

实验性区域检测已切换为预训练 RT-DETR：首次由用户触发下载约 11.1 MB 权重并缓存，之后本地 CPU/WASM 推理；运行时代码打包，模型不打包，不上传漫画图片。来源、隐私和已观察误检见[预训练检测说明](docs/development/pretrained-detector.md)。区域 OCR 与有预算的当前页提前处理见 [Issue #2 实现说明](docs/development/issue-2.md)。预取默认关闭，检测不代表经过真实漫画质量验收。

## 项目目标

- **高性能、低延迟：** 尽量缩短从打开漫画页面到阅读译文的等待时间。
- **自然的大语言模型翻译：** 利用大语言模型生成流畅、符合上下文的对白。
- **在线阅读：** 让浏览器中的漫画自动翻译更方便。

## 首版实施计划

[首版需求与实施计划](docs/plans/v0.1/README.md)涵盖拟议的 MVP、架构、缓存设计、研究来源、验收门槛和待评审决策。该计划仍是需求基线；预览指南区分已实现范围与尚未完成的验收项。

## 欢迎贡献

欢迎提交 Issue 和 Pull Request，分享想法、报告问题或改进项目！请先阅读 [Issue 指南](docs/ISSUES.md)，使用缺陷或功能建议表单。贡献者、维护者、dot 和其他机器人遵循同一格式。

## 开发语言

开发沟通、新增或修改的文档、代码注释、文档字符串及 Issue 默认使用中文；这取代了之前的仅英文约定。历史英文研究、计划及许可证来源记录按需查阅，不代表本次已将整个项目翻译成中文。标识符、API、命令及第三方原文保持不变；英文 README 已单独提供；其他历史文档在翻译前保留现有语言。

## 分支流程

开发在 dev 分支进行。针对最终修改运行适用测试，只有获得明确授权后，才将验证通过的工作合并到 main 用于发布。请按预览指南运行 `npm test`、`npm run test:tooling`、`npm run build` 和合成浏览器冒烟测试。dev 上的修改不会自动发布；合并或发布是需要明确授权的独立步骤。完整开发流程见 [AGENTS.md](AGENTS.md)。

## 开发知识

开发前请依次阅读本 README、[MEMORY.md](MEMORY.md) 和 [AGENTS.md](AGENTS.md)。MEMORY.md 是项目开发经验、陷阱、决策和测试经验的索引。

## 提交与推送检查

每个开发提交必须同时更新 PUBLISH.md 和 memory/ 下的一份实际经验记录。仓库中的提交、合并和推送钩子会检查此要求，但克隆仓库不会自动启用。安装方法、行为和测试见[检查钩子指南](docs/change-record-hooks.md)；检查已有钩子后，可在每个克隆中自行执行 `git config --local core.hooksPath .githooks` 启用。

## 更新历史

项目变更见 [PUBLISH.md](PUBLISH.md)。发布更新将按版本和日期记录，并按实际情况说明新增、改进、修复、兼容性变化和升级注意事项。

## 许可证

项目采用 [MIT License](LICENSE)。在保留版权声明和许可声明的前提下，可使用、修改、分发本软件，也可用于商业用途。完整条款及免责声明请参阅 LICENSE；许可证原文保持不变。


## 方案对比实验

[中文漫画10图、五方案CPU实测](docs/evaluation/chinese-comics-2026-11-03/README.md)：区分检测、OCR错字漏字与耗时，供选择下一阶段方案；没有自动替换产品默认实现。

[英文与日文图文评测](docs/evaluation/english-japanese-2026-11-03/README.md)：独立语言样本、实际错漏字和耗时图，保留原始指标与范围限制。
