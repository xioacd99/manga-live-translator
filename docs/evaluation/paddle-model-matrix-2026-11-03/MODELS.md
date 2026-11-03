# 官方型号范围与本轮覆盖

核验日期：2026-11-03。聚焦英文漫画OCR，区分官方型号、导出格式、检测与识别模块组合，以及实际完成的测试。

## medium、large到底有哪些

[PP-OCRv6官方说明](https://www.paddleocr.ai/latest/en/version3.x/algorithm/PP-OCRv6/PP-OCRv6.html)列出tiny、small、medium三档，medium是该代最大档。本次没有查到官方v6 large，不能编造一个large或把medium改名。v5 server是真实存在的另一代型号，须独立列名。

Paddle、ONNX、safetensors是发布格式，不是三个额外精度档位。当前v6没有核实到独立en专用型号，三档多语模型均包含英文。v5另有英文专用mobile识别器，没有找到英文专用server型号。

## 官方ONNX数据文件

以下只统计官方ONNX单文件字节，**不是运行内存**，也不是本地RapidAI重新导出的文件大小。已有RapidAI资产的真实大小与哈希以每次实验manifest为准，两种来源不能冒称字节相同。

| 官方型号 | det字节 | rec字节 | 官方来源 |
|---|---:|---:|---|
| v6 tiny | 1,780,590 | 4,462,639 | [det](https://huggingface.co/PaddlePaddle/PP-OCRv6_tiny_det_onnx) / [rec](https://huggingface.co/PaddlePaddle/PP-OCRv6_tiny_rec_onnx) |
| v6 small | 9,880,512 | 21,159,378 | [det](https://huggingface.co/PaddlePaddle/PP-OCRv6_small_det_onnx) / [rec](https://huggingface.co/PaddlePaddle/PP-OCRv6_small_rec_onnx) |
| v6 medium | 62,032,837 | 76,554,979 | [det](https://huggingface.co/PaddlePaddle/PP-OCRv6_medium_det_onnx) / [rec](https://huggingface.co/PaddlePaddle/PP-OCRv6_medium_rec_onnx) |
| v5 mobile通用 | 4,826,518 | 16,534,782 | [det](https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det_onnx) / [rec](https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_rec_onnx) |
| v5 server通用 | 88,116,791 | 84,503,027 | [det](https://huggingface.co/PaddlePaddle/PP-OCRv5_server_det_onnx) / [rec](https://huggingface.co/PaddlePaddle/PP-OCRv5_server_rec_onnx) |
| v5英文专用 | 配通用det | 7,848,423 | [en mobile rec](https://huggingface.co/PaddlePaddle/en_PP-OCRv5_mobile_rec_onnx) |
| v5 Latin | 配通用det | 8,042,023 | [latin mobile rec](https://huggingface.co/PaddlePaddle/latin_PP-OCRv5_mobile_rec_onnx) |

这些仓库本轮元数据及固定下载URL的HEAD已核验可访问；下载可达不代表模型已实际测过。Latin和英文专用识别器均已在同一v6 small检测器、共同2048流程下完成10图单遍对照；准确率以主报告实际独立评分为准。针对其他语种训练且附带英文的变体，不等于更大英文模型；本轮不是所有语言分支的穷举。

## 许可证、配置与比较边界

上述官方权重卡标Apache-2.0。代码单独核实：[PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR/blob/main/LICENSE)、[PaddleX](https://github.com/PaddlePaddle/PaddleX/blob/develop/LICENSE)、[RapidOCR](https://github.com/RapidAI/RapidOCR/blob/main/LICENSE)为Apache-2.0，[ONNX Runtime](https://github.com/microsoft/onnxruntime/blob/main/LICENSE)为MIT。仓库不重新上传模型权重。

官方rec必须使用配套inference.yml字典与输入归一化，不能沿用名称相近模型的字典。v5 server官方resize_long使用PaddleX type2路径，按长边目标缩放后向上取128倍数，与Rapid的round32路径不同；实验需要记录各组件实际输入、参数和适配方式。一个合成图识别正确不证明真实漫画精度。

此前已完成v6三档和v5 mobile多语/英文默认配置：[早期七组报告](../paddle-english-models-2026-11-03/README.md)。本轮补充v6检测×识别完整3×3受控组合、medium多分辨率和参数隔离，及v5 server候选；是否全部完成、资源失败或尚未测试，均以主报告实际结果为准。混搭是本项目实验组合，不冒称官方推荐型号。
