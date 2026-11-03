# Development Practices

Record techniques supported by actual project experience, including when they apply and how they were checked. Use the [record template](../../templates/record.md) and link each record here.

- [Checking change records at commit and push](change-record-hooks.md): staged content checks, outgoing commit boundaries, and tested limitations.

- [Validating issue structure across entry points](issue-standards.md): shared pre-submit checks, read-only audits, and platform limits.

- [Developing on dev before releasing from main](dev-main-workflow.md): branch separation, testing, and explicit merge boundaries.

[Back to development](../README.md)

- [中文默认规范与 Issue 迁移边界](chinese-default-transition.md)：区分 dev 规范更新与 main 线上入口，保留历史兼容。

- [双语 README 维护](bilingual-readme.md)：保持中文默认与英文入口同步，并避免将合成测试说成真实站点验证。

- [区域准备的缓存与授权边界](region-preparation.md)

- [预训练检测、本地下载与生命周期](pretrained-local-detector.md)

- [中文漫画候选方案的公平比较](chinese-comic-benchmark.md)

- [多语言漫画评测与可视化](multilingual-comic-evaluation.md)

- [Paddle英文型号比较经验](paddle-english-model-comparison.md)：固定GT、运行库桥接、检测参数差异和计时边界。

- [OCR批量、并发与多页模型边界](ocr-batching-boundaries.md)：区分吞吐、首结果、缓存身份与二代输出格式。

- [Paddle组件矩阵与官方导出适配](paddle-component-matrix.md)：分辨率非单调、字典与裁框分辨率的一致性。

- [英文OCR追加精度验证](ocr-accuracy-followup.md)：负结果、置信度选择、桥接与模型许可边界。
