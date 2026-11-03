# 区域准备的缓存与授权边界

- 状态：superseded（检测选择与默认补漏行为）；缓存和授权发现仍适用。参见[预训练检测、本地下载与生命周期](pretrained-local-detector.md)。
- 日期：2026-11-03（Asia/Shanghai）。
- 关联：[Issue #2](https://github.com/xioacd99/manga-live-translator/issues/2)。

## 已验证发现

单独准备 OCR 不应构造翻译请求，更不能要求模型密钥；prepare 和 run 必须走同一检测/OCR 身份计算，才能在后续阅读中复用。检测模型标识不足以决定裁剪缓存，实际几何与裁剪约定也需要纳入键。单元测试覆盖这些边界。

预取授权不能只存在 content script。后台以 session 中的明确开关与预算原子预扣尝试次数，失败不退，且页面隐藏后需要重新启用。授权存储读写与清理、导航、标签关闭可能交错；全局 generation 和可取消的单标签 fence 在注册任务前后阻断旧任务复活。权限撤销也暂停既有授权，而非只删除 provider key。

真实 Tesseract rectangle 实验表明输出保持原图坐标，不能再次叠加裁剪偏移。局部裁剪可能使识别变差，因此默认局部识别后整图补漏；不能将区域检测实现当作效率或准确率的结论。

## 检查与边界

运行 npm test、npm run test:tooling、npm run build 和当前提交 CI 浏览器检查。浏览器使用自制图片和 mock 获取/模型边界；实际本地 OCR 不替换。node benchmarks/preparation.mjs 的固定延迟替身验证请求数量与命中分母，不代表真实性能。实现详情见 [开发说明](../../../docs/development/issue-2.md)。

本次本地全量验证：126 项 JavaScript、47 项 Python 测试与构建通过；当前提交浏览器 CI 结果单独核验。
