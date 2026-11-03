# PaddleOCR 多图与批处理：哪些值得实测

更新：2026-11-03。本文为运行前的一手资料研究，表末为当时提出的候选实验，不是全部已执行项目。实际冻结并完成的是[四组120次Paddle实验](PADDLE-RESULTS.md)：识别batch 1/6、ORT线程1/2和worker 1/2；batch12及VL并发未实测。现有云电脑约9个逻辑CPU、9.7GiB内存，不使用用户电脑，不外传图片、不付费。

**先说结论：一次选很多页可以改善使用体验，但不自动更快、更准。优先测试现有 v6 的文本行 batch，其次才是 VL 独立请求的有限并发。**

## 三种“批量”不要混为一谈

**传统 OCR：** 多页队列 → 每页检测 → 多个文本行组成识别 batch → 按页归还文字与坐标。

**VL 服务：** 多页队列 → 每页独立请求 → 一个本地模型、有限并发槽位 → 按页归还结果。

| 方式 | 官方支持与边界 | 对本项目的意义 |
|---|---|---|
| 接收列表、目录或 PDF | 官方产线可遍历多页；VL 的 `use_queues` 把读取、版面分析、VLM 阶段分线程衔接。[文档](https://www.paddleocr.ai/latest/en/version3.x/pipeline_usage/PaddleOCR-VL.html) | 批量入口与阶段重叠，不等于模型同时算完十页。 |
| 传统 v6 检测／识别 batch | 模块有 `batch_size`；产线有 `text_recognition_batch_size`，当前 [OCR.yaml](https://github.com/PaddlePaddle/PaddleX/blob/4c968d30b9d0d4a693d9eaaef0881c20f8d7d0e0/paddlex/configs/pipelines/OCR.yaml#L35-L45)识别默认 6。 | 文本行通常比整页更适合组成 batch。 |
| VL 多个独立请求 | [源码](https://github.com/PaddlePaddle/PaddleX/blob/4c968d30b9d0d4a693d9eaaef0881c20f8d7d0e0/paddlex/inference/models/doc_vlm/predictor.py#L450-L617)为每个区域／图片构造请求，再用 future 并发提交；客户端用 `vl_rec_max_concurrency` 控制数量。 | 可以保留每页独立身份、坐标与失败状态。 |
| VL 一个请求塞多页 | 未找到 VL1.6 官方为此提供的可靠逐页 Spotting 输出契约或吞吐验证。 | 不作为首轮方案；共享上下文和输出预算，也难区分各页坐标。 |

## v6：已有 batch，不是从零开启

现有冻结 RapidOCR＋ONNX Runtime 脚本已设 `Rec.rec_batch_num=6`；已保存的 v6 ONNX 输入元数据也显示动态 batch 维度。下一轮应比较 **6 与 1／12**，而不是宣称首次实现批处理。

标准 PaddleX 检测预处理逐图保持比例缩放，随后 [ToBatch 直接堆叠数组](https://github.com/PaddlePaddle/PaddleX/blob/4c968d30b9d0d4a693d9eaaef0881c20f8d7d0e0/paddlex/inference/models/common/vision/processors.py#L282-L287)。不同宽高的漫画不能直接假设检测 batch 大于 1 可行；先保留逐页检测。若按同尺寸分组或统一缩放，应单独验证，不能悄悄改变精度条件。

此外，当前 [OCR 产线](https://github.com/PaddlePaddle/PaddleX/blob/4c968d30b9d0d4a693d9eaaef0881c20f8d7d0e0/paddlex/inference/pipelines/ocr/pipeline.py#L451-L477)仍逐页调用识别，跨页合并所有裁剪处保留 TODO。传入十页，不代表自动形成跨页大 batch。改变 batch 还可能改变宽度补齐与数值结果，须复核输出。

## VL1.6：并发不等于多图联合识别

Paddle 原生动态图后端将模型 batch 限制为 **1**；[常量](https://github.com/PaddlePaddle/PaddleX/blob/4c968d30b9d0d4a693d9eaaef0881c20f8d7d0e0/paddlex/inference/models/doc_vlm/constants.py#L34-L37)中的 GenAI 客户端 batch=8192 是收集待发任务的上限，不代表能同时推理 8192 张。该限制不能推广到所有后端：Transformers 路径可构造独立样本批次，但仍需实际验证具体模型与显存／内存。

现有 llama.cpp b11960 的 [`--parallel`](https://github.com/ggml-org/llama.cpp/blob/8642541b255bfb5dc39cd351a178be09013a55d6/tools/server/README.md)控制服务槽位，continuous batching 默认开启；`--batch-size`／`--ubatch-size` 是 token 计算批次，**不是图片数量**。一个服务可共享模型权重，但并发会增加 KV 缓存与中间缓冲，CPU 也可能因竞争变慢。

尤其在 `kv_unified=false` 时，[上下文按槽位划分](https://github.com/ggml-org/llama.cpp/blob/8642541b255bfb5dc39cd351a178be09013a55d6/src/llama-context.cpp#L389-L407)：单槽总 8192 改双槽却仍保留总 8192，会使每页仅剩 4096。应设总 16384，并核对启动日志每槽确实为 8192，避免失真比较。批量不解决已出现的重复生成或截断。

## Mac M4 与浏览器的边界

[Paddle 官方 Apple Silicon 专页](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/pipeline_usage/PaddleOCR-VL-Apple-Silicon.en.md)提供 Paddle CPU 和 MLX-VLM 服务路线，列有 M4 验证；当前 [MLX-VLM](https://github.com/Blaizzy/mlx-vlm#continuous-batching)也提供多请求 continuous batching。**尚未验证用户 M4 16GB 上 VL1.6 Spotting 并发 2 的速度与稳定性**，不能由通用支持推导。云 CPU 结果不能替代 Mac 实测。

浏览器可以一次选十张图并显示队列，实际推理仍交给回环地址本地服务；这不等于模型已改为纯浏览器执行。

## 建议冻结的十图实验

| 顺序 | 唯一主要变量 | 保持一致与验收 |
|---|---|---|
| A，优先 | v6 small 识别 batch=1、6、12 | 沿用同一高分辨率检测配置、权重、阈值、词典、预处理与单线程预算；整页检测仍逐页。所有组同样热身，再完整跑十图三遍，另记加载时间。 |
| B，可靠性允许后 | VL 独立请求并发 1 对 2 | 复用现有官方 GGUF与 b11960；每槽上下文8192，输出上限4096，温度0、惩罚1、Spotting像素1605632、特殊token与解析器不变；服务总CPU线程仍4，不额外启动两套模型。 |

逐页保存结束原因与映射，报告整批总耗时、成功页吞吐、单页中位／尾部延迟、峰值 RSS、失败／重复／截断数及同口径 CER；不能通过更快失败“提高吞吐”。先用两张合成图验证批次身份、形状与坐标，再跑冻结十图。10GB 环境应预设内存保护，不直接尝试十路并发；同一时刻只跑一组，避免其他评测争用资源。惩罚、切图或尺寸变化另立实验，不与并发混改。

## 许可证与证据范围

代码：[PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR/blob/main/LICENSE)、[PaddleX](https://github.com/PaddlePaddle/PaddleX/blob/develop/LICENSE)、[RapidOCR](https://github.com/RapidAI/RapidOCR/blob/main/LICENSE)均为 Apache-2.0；[ONNX Runtime](https://github.com/microsoft/onnxruntime/blob/main/LICENSE)、[llama.cpp](https://github.com/ggml-org/llama.cpp/blob/master/LICENSE)、[MLX-VLM](https://github.com/Blaizzy/mlx-vlm/blob/main/LICENSE)为 MIT。

权重单独核查：[v6 small 检测 ONNX](https://huggingface.co/PaddlePaddle/PP-OCRv6_small_det_onnx)、[识别 ONNX](https://huggingface.co/PaddlePaddle/PP-OCRv6_small_rec_onnx)、[VL1.6](https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6/blob/main/LICENSE)均标注 Apache-2.0。固定现有文件与校验值；本方案无需新增模型下载或启用 remote code。

[v6 论文](https://arxiv.org/abs/2606.13108)和 [VL1.6 论文](https://arxiv.org/abs/2606.03264)的文档／通用 OCR 指标，不能当作本项目漫画 CER，也不能证明批量一定带来加速。本报告提出待测方案，不声称已得到性能改善。
