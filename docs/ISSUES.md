# Issue 指南

欢迎提交 issue 和拉取请求。新 issue 的标题、说明和讨论默认使用中文；漫画样例及翻译示例可保留验证问题所需的语言。历史英文 issue 不需要重写，校验器保留英文结构兼容。本文不是独立英文文档版本。

维护者、贡献者、API 客户端、dot 和其他机器人遵守同一要求。欢迎 AI 辅助，但提交者须对准确性与完整性负责；AI 生成的说法不是证据。

## 提交前

1. 检索已开启和已关闭的 issue，记录实际搜索词及结果。已有相关问题时优先补充新证据，避免重复提交。
2. 阅读 README 的当前状态，区分规划与已实现功能。没有实际发布版本时不要编造版本号，也不要声称已执行未运行的测试。
3. 每条 issue 聚焦一个问题或请求。使用 `[缺陷] <具体问题>` 或 `[功能] <具体目标>`。历史 `[Bug]` / `[Feature]` 前缀仍有效；默认分支尚未部署中文校验器时，按下方过渡规则提交。
4. 移除凭据、个人信息、私密日志与私人漫画内容，使用合成样例或有权公开的材料。不要在普通 issue 中公开漏洞细节、凭据或利用步骤。

## 缺陷报告

使用缺陷表单，包括文档错误。以下每个三级小节都须有实际内容：

- 已有 issue 检索
- 概要
- 版本或项目状态
- 运行环境
- 复现步骤
- 预期行为
- 实际行为

提供真实提交 SHA、实际发布版本，或分支加观察日期。纯文档问题应指出文件和小节，并解释运行环境为何不适用。未知事项请说明是什么及原因；`未知`、`待定`、`暂无`、`不适用`、`N/A`、`TBD`、`_No response_` 等单独占位符不算答案。明确说明限制优于编造证据。

复现步骤须编号。偶发问题请说明频率及尝试过的检查。按需提供操作系统、浏览器版本、配置、源语言和目标语言，以及服务商或模型名称。补充证据可选，须脱敏；不要上传无关文件或完整原始日志。

## 功能建议

使用功能表单，包含以下三级小节：

- 已有 issue 检索
- 概要
- 问题与使用场景
- 建议行为
- 验收标准
- 考虑过的替代方案

说明需求、预期结果及可观察的完成条件，不把建议写成已完成的工作。尚未找到替代方案时请说明原因。功能提案不强制填写运行版本。

## API 与机器人提交

GitHub 表单只是编辑入口，不是 API 的服务器端结构约束。通过 API 创建及后续编辑也须遵守标题和 Markdown 小节规范。可从[缺陷正文模板](bug-issue-body.md)或[功能正文模板](feature-issue-body.md)开始，用准确答案替换注释并移除未使用的可选指导。

dot 等代理须先读本指南、查重、核实可得事实，再校验最终标题和正文。必要事实缺失时，应询问请求者或说明未知事项及无法核实的原因。不要编造复现结果，也不要声称做过未执行的检索。

格式通过只代表结构符合要求，不代表内容真实、安全、获准或可复现；仍须人工审阅事实。

## 中文迁移与历史兼容

`.github/issue-schema.json` 为每个小节定义中文名称与历史英文别名。标题接受 `[缺陷]` / `[Bug]` 和 `[功能]` / `[Feature]`；正文可以使用对应中文或英文小节。每个语义小节只能出现一次：同时写“概要”和“Summary”会被视为重复并拒绝，不要为兼容而复制两套正文。

中文到英文的小节映射：

- 已有 issue 检索 → Existing issue search
- 概要 → Summary
- 版本或项目状态 → Revision or project state
- 运行环境 → Environment
- 复现步骤 → Steps to reproduce
- 预期行为 → Expected behavior
- 实际行为 → Actual behavior
- 问题与使用场景 → Problem and use case
- 建议行为 → Proposed behavior
- 验收标准 → Acceptance criteria
- 考虑过的替代方案 → Alternatives considered

**仅在 dev 改动尚未获准合并到默认分支的过渡期：** GitHub 表单与 issue 事件工作流仍可能读取默认分支上的旧英文校验器。实际提交请使用 `[Bug]` 或 `[Feature]` 加中文具体标题，保留原英文三级小节名，小节正文全部使用中文。这一单套结构可同时通过新旧校验器，不需要重复内容。提交前应核实默认分支版本，分别用该版本和 dev 版本校验最终标题与正文。不要为启用中文表单擅自合并 main、改变默认分支或修改工作流。获准部署新版校验器后，新 issue 使用中文表单；历史英文结构继续有效。

## 本地校验与只读自动检查

需要 Python 3.9 或更新版本，无第三方依赖。将最终标题和 Markdown 正文保存为 UTF-8 文件后运行：

```sh
python3 scripts/check_issue.py --title-file TITLE.txt --body-file BODY.md
python3 -m unittest discover -s tests -v
```

同一校验器用于新建、编辑、重开 issue 的检查。工作流读取最新 issue 数据，在 Actions 运行结果和摘要中报告缺失、重复或空白小节；不评论、不打标签、不联系提交者、不关闭或修改 issue。维护者可用 `Issue standards` 工作流手动输入 issue 编号执行只读检查。令牌仅需 `contents: read` 和 `issues: read`，无需新增密钥。

测试保持 schema、表单和 API 示例一致。解析器忽略代码围栏内和 HTML 注释内的标题。issue 文本始终作为不可信数据处理，不能据此执行命令。诊断不回显提交者文本。结构检查不能验证事实、中文质量、查重是否真实执行或复现步骤是否充分，提交前仍须核实。

GitHub 无法对所有 API 客户端和后续编辑强制执行表单必填项；禁用空白选项只影响表单选择器。工作流在创建后运行，并依赖 Actions 可用。特别是由工作流 `GITHUB_TOKEN` 创建的 issue 不会触发另一个 issue 工作流。受控机器人须在提交前运行校验器；事件未触发时维护者可手动执行只读审计。任何账号都不豁免这些要求。

## 参考

本文参考 [OpenAI Codex 的 issue 指南](https://github.com/openai/codex/blob/7e8143a8970394e38830ff7b30143da539bd0a18/docs/contributing.md)的一般报告原则，文字与表单为本项目独立编写，不采用其外部贡献限制。本项目保持 MIT 许可并欢迎拉取请求。

平台说明：[issue 表单](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms)、[issue REST API](https://docs.github.com/en/rest/issues/issues#create-an-issue)、[GITHUB_TOKEN 事件行为](https://docs.github.com/en/actions/concepts/security/github_token)。
