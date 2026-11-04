# Python 常驻服务与浏览器算法接线

- 状态：已解决（实现与回归）；真实站点、M4和真实翻译质量仍待验收。
- 更新日期：2026-11-04，Asia/Shanghai。
- 范围：dev，Python PP-OCRv6 medium1536、报告同款FP32 RT-DETR、Chrome MV3、DeepSeek V4.1 Flash文本适配。
- 背景：浏览器OCR与原生基线不能混称同一性能。本次按原生方案拆分八模块，模型服务只在本机运行；未引入其他候选模型的研究产物。
- 证据：固定模型SHA、参数、字典与依赖身份均进入服务修订。真实原创合成图通过四模型和环回HTTP；JavaScript测试验证气泡归组/阅读顺序、精确缓存失效、安全排版及中断。详细最终计数与限制见当前集成文档。
- 原因与实践：OCR结果依赖原图及OCR配置，不依赖后续气泡/顺序。归组输出、修订、顺序和源文编辑参与译文身份。同账户上下文修改不清原始OCR；账号切换清空，设置改变暂停旧页面并使旧输出失效。
- 边界修复：状态接口区分OCR权重与气泡权重，不能只用OCR ready显示完整就绪。只读状态查询不能占用全局设置写锁；短超时和代次检查防止挂起请求堵塞忘记凭据或迟到状态恢复。
- 排版实践：气泡框不是像素mask。实测纯色、安全内边距和最小可读字号共同允许覆盖，否则保留原图、展示完整卡片。不能把实验真值mask带来的结果当生产分割精度。
- 验证：`npm test`、`npm run test:tooling`、`npm run build`、Python服务协议单测与独立真实模型检查。浏览器本地启动被宿主Unix套接字限制阻止；CI合成HTTP/LLM接线测试与真实模型分开，不冒充真实网站/翻译质量。
- 适用边界：英文静态图片，当前本机Linux CPU证据；未做M4/CoreML、现代漫画独立人工GT、真实付费DeepSeek调用。HTTP取消不保证立即终止ORT内核，服务串行锁仍可能忙。
- 参考：[当前流水线](../../../docs/development/native-pipeline.md)、[服务契约](../../../services/local-ocr/README.md)、[八模块清单](../../../README.md)。

## CI 启动时序证据

首次新版 [CI](https://github.com/xioacd99/manga-live-translator/actions/runs/41772081049) 已实际启动Chromium，但枚举服务工作线程时 `chrome.runtime` 尚不可读；没有进入设置流程。夹具现在只检查扩展background.js，并在20秒截止内等待API，不再直接解引用。超时仍失败并列出线程URL；本地受限环境无法替代CI验证这条时序。
