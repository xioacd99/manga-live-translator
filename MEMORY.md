# 项目经验索引

这里是 Manga Live Translator 可复用开发知识的公开索引。只记录真实项目经验，不记录臆测的缺陷或尚未实现的结果。下方收录开发工具和预览版实现中的发现；不得将合成测试测量值当作真实阅读性能。

## 从这里开始

每次开发前，依次阅读 [README.md](README.md)、本文件和 [AGENTS.md](AGENTS.md)，再阅读相关分类索引及链接记录。

## 知识目录

- [架构](memory/architecture/README.md)
  - [决策](memory/architecture/decisions/README.md)：方案、替代选项和选择理由，包括[首版实施研究边界](memory/architecture/decisions/initial-plan-research.md)。
- [开发](memory/development/README.md)
  - [陷阱](memory/development/pitfalls/README.md)：实际观察到的问题、原因、修复和验证。
  - [实践](memory/development/practices/README.md)：在实际工作中验证有效的方法。
- [预览版生命周期与验证经验](memory/development/pitfalls/preview-lifecycle.md)
- [测试](memory/testing/README.md)
  - [性能](memory/testing/performance/README.md)：可复现的测量及其限制。
- [记录模板](memory/templates/record.md)

## 维护规则

- 每个开发提交必须同时更新 PUBLISH.md 和 memory/ 下的一份实际记录。记录已验证的发现，或新确认的适用范围和限制，不凑字数。优先更新现有条目，避免重复或无价值的记录。
- 使用模板，在对应分类索引中链接新记录；分类变更时同步更新本索引。
- 区分已验证的原因与假设。使用 open、resolved 或 superseded 状态；及时更新过时内容，并链接替代记录。
- 新增或修改的记录默认使用中文，日期使用 Asia/Shanghai 时区。该约定取代之前的仅英文要求；历史英文记录可保留原文，后续如需英文文档另设版本。技术标识符、引用及许可证原文不翻译。
- 这些文件公开可见。不得包含 API 密钥、令牌、密码、私有日志或用户的漫画内容；使用脱敏示例和公开项目引用。

- [中文默认规范与 Issue 迁移边界](memory/development/practices/chinese-default-transition.md)
