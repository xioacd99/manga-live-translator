# 英文漫画：更高精度本地 OCR 候选

更新：2026-11-03。目标是英文漫画转中文前的文字识别；本页记录候选研究与验证方法；实际实验见[主报告](README.md)，不替用户选择产品默认方案。

**本地架构**

`浏览器界面 → 127.0.0.1 本地推理服务 → OCR 文字与坐标 → 翻译与排版`

模型首次下载后可离线使用，漫画图片不上传第三方、不调用付费 API。当前实验在云电脑本机 CPU 执行；用户 Mac M4 16GB 的速度、峰值内存和稳定性需要另测。

## 优先验证的两条路线

| 优先级与模型 | 官方资产及精确文件大小 | 代码许可证 | 权重许可证 |
|---|---|---|---|
| 1. PaddleOCR-VL-1.6，0.9B | [官方 GGUF](https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6-GGUF/tree/511b09642bb324401f15f97cc23bc67e8f0a291d)：主模型 935,769,056 字节＋视觉投影 881,770,560 字节，合计 1,817,539,616 字节。[原始 safetensors](https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6/tree/c5630abae1d940eafe0697512a0325494b02ab42)：1,917,255,968 字节。 | [PaddleOCR：Apache-2.0](https://github.com/PaddlePaddle/PaddleOCR/blob/main/LICENSE)；[llama.cpp：MIT](https://github.com/ggml-org/llama.cpp/blob/master/LICENSE) | [Apache-2.0](https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6/blob/main/LICENSE) |
| 2. Qwen3-VL-4B-Instruct，Q8_0 | [官方 GGUF](https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct-GGUF/tree/1cd86afb9a95c410a6038ab3b40d8b578c892266)：Q8_0 主模型 4,280,406,144 字节＋F16 视觉投影 836,180,256 字节，合计 5,116,586,400 字节。 | [Qwen3-VL：Apache-2.0](https://github.com/QwenLM/Qwen3-VL/blob/main/LICENSE)；运行时 llama.cpp：MIT | [官方模型卡：Apache-2.0](https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct-GGUF) |

以上是**权重文件体积，不是运行内存**；还需上下文缓存、图像编码和运行时空间。Qwen 4B Q8 是 16GB 机器的待测候选，不保证整页高分辨率下都能容纳。先测 Q8，再考虑更小量化，避免把量化损失混入模型比较。

PaddleOCR-VL-1.6 优先：专门面向文档识别，且官方提供带文字定位的 Spotting，便于漫画区域匹配。Qwen 4B 作为备选，重点检查复杂字体和上下文能否改善识别，同时防止自动补词、改拼写。两者都先输出英文原文，再独立翻译，不把翻译混入 OCR 指标。

## Spotting：可解析，但必须保留特殊符号

[官方模型卡](https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6-GGUF)要求 Spotting 使用 `image_max_pixels=1605632`。[PaddleX 流水线](https://github.com/PaddlePaddle/PaddleX/blob/4c968d30b9d0d4a693d9eaaef0881c20f8d7d0e0/paddlex/inference/pipelines/paddleocr_vl/pipeline.py#L336-L339)使用提示词 `Spotting:`、最小像素 112896，并保留特殊 token。

[官方解析器](https://github.com/PaddlePaddle/PaddleX/blob/4c968d30b9d0d4a693d9eaaef0881c20f8d7d0e0/paddlex/inference/pipelines/paddleocr_vl/uilts.py#L1111-L1184)支持文字包装符，也支持“正文后跟八个 LOC”的形式；八个值表示四个点，坐标按 0–1000 归一化，再映射回原图。宽、高都小于 1500 时，官方预处理先放大两倍。llama.cpp CLI/server 要启用 `--special`；解析时检查缺失、越界、零面积包围框与输出截断，不能静默当作成功。

目前官方 GGUF 已在云 CPU 合成两行图上通过 CLI 和本地 server 的文字、坐标解析验证。**这只是可运行性烟测，不是漫画准确率或 M4 性能证明。**后续同十图整页实验已完成，实测结果与失败率见[主报告](README.md)，不能再把合成烟测当作质量结论。

## 原生 Mac 与浏览器不是同一部署

[官方 Apple Silicon 专页](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/pipeline_usage/PaddleOCR-VL-Apple-Silicon.en.md)提供原生 Paddle CPU／MLX-VLM 路线，并列有 M4 测试环境；[llama.cpp](https://github.com/ggml-org/llama.cpp)也支持 CPU 与 Apple Metal。通用后端支持不等于本项目已在用户 M4 验证，不能用云 CPU 耗时推算。

[Transformers 原生接口](https://huggingface.co/docs/transformers/main/en/model_doc/paddleocr_vl)可在 Transformers 5 及兼容版本下加载 VL1.6，无需执行模型仓库自定义 Python。固定版本和文件校验，优先 safetensors／官方 GGUF；不因加载失败就开启 `trust_remote_code`。调整 GGUF 元数据时保留原件并记录新校验值。本地服务仅绑定回环地址。

[Transformers.js](https://github.com/huggingface/transformers.js)虽列有 Qwen3-VL，但浏览器需要匹配的 ONNX/WebGPU 实现，不能直接复用这组 GGUF。现有 [PaddleOCR.js](https://github.com/PaddlePaddle/PaddleOCR/blob/main/paddleocr-js/packages/core/README.md)的传统检测识别路线也不等于 VL 已能在浏览器运行。

## 如何判断值得换模型

官方文档榜单不能换算成英文漫画 CER。现有十图只标注部分区域：整页 Spotting 应按几何区域匹配；无坐标全文不能靠 GT 文字对齐计分。另做“已知正确框裁剪”的纯识别测试时，传统 OCR 也必须重跑同样裁剪，并标明这不是端到端结果。

每次实验固定模型文件、提示词、预处理尺寸、解码参数和 token 上限；保存原始输出与解析失败记录。分开报告首次加载与复用模型的时间，记录线程数和实际峰值内存。未标注区域不能自动计为错字，模型擅自补出的内容也不能借助正确答案删除。

高分辨率传统 OCR 已有改善，VLM 必须在相同输入、标注和计分规则下证明额外收益，并报告漏字、幻觉、截断、耗时和内存。GLM-OCR 仅保留后备：[官方仓库](https://github.com/zai-org/GLM-OCR#license)区分 SDK 的 Apache-2.0 与模型权重的 MIT；本轮不扩展第三条实验。

## 论文证据的适用边界

[PaddleOCR-VL-1.6 原论文](https://arxiv.org/abs/2606.03264)描述针对薄弱区域的数据优化与渐进式后训练；其OmniDocBench文档解析榜单结果不是漫画CER，不能换算成本项目识字准确率。本文候选排序依据可执行性、定位输出与许可，最终判断仍以同图实测为准。
