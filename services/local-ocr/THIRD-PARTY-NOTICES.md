# 本地服务第三方来源

核对日期：2026-11-04（Asia/Shanghai）。本项目服务实现沿用仓库 MIT；没有复制 ImageTrans、comic-translate 或 GPL/AGPL 实现。以下许可声明不是训练数据逐样本权利审计，也不是法律保证。

## OCR 三资产

`config.py` 固定 RapidAI ModelScope 的 v3.10.0 PP-OCRv6 medium det/rec 和 v3.4.0 legacy cls。对应字节数与 SHA-256 已在项目原生基线和本服务本地缓存核验，不能用官方 PaddlePaddle 另一个同名 ONNX 替换。

- [RapidAI v3.10.0 模型卡](https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/README.md)
- [RapidAI v3.4.0 模型卡](https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.4.0/README.md)
- 既有核验记录：两版本卡均声明 Apache License 2.0，卡字节 1140，SHA-256 `3dc91bb3cb667df783178917d69b38bfabb8c935596f34243a1c9f0d36916b6e`。这是仓库卡声明，不虚构为每个导出权重来源链的独立法律审计。
- [RapidOCR 3.10.0 官方 LICENSE](https://github.com/RapidAI/RapidOCR/blob/v3.10.0/LICENSE)：Apache-2.0，完整文本保存在 `notices/RapidOCR-LICENSE.txt`，SHA-256 `3e0af25fdd06aa9586ae97adb00ea927ebe5a3805ac77d2d3a81ce5f55693333`。

RapidOCR 是加载、DB 后处理、透视裁框、方向分类、CTC 解码的依赖，不把这套桥接实现称为 PaddleX 官方完整端到端应用。这里独立实现 HTTP/下载边界和固定预处理配置；未引入参考应用源码。

## RT-DETR-v2 FP32

[ogkalu/comic-text-and-bubble-detector 固定修订 16e8a622f91fabc6b5b65c96d32d1183f8843546](https://huggingface.co/ogkalu/comic-text-and-bubble-detector/tree/16e8a622f91fabc6b5b65c96d32d1183f8843546) 模型卡声明 Apache-2.0。本服务用该修订的 `detector.onnx`，168,481,531 字节，SHA-256 `065744e91c0594ad8663aa8b870ce3fb27222942eded5a3cc388ce23421bd195`。训练数据未逐样本审计。Apache 全文保留在 `notices/comic-detector-Apache-2.0.txt`。

2026-11-04 对上述固定源 URL 的只读 HEAD 验证返回 302，Location 主机为 `us.aws.cdn.hf.co`；下载器只增加这个核验过的精确 CDN 主机，不接受任意域名。签名 URL 不保存在日志或文档。

原实测预处理参考了上游输入输出约定，采用 RGB/PIL resize640、`[[width,height]]` 和 class0 阈值 .5；独立实现本服务适配器，不复制上游应用。它不是旧浏览器 int8 模型，不承诺两者精度相同，也不提供气泡 mask。

## 推理与图像依赖

- [ONNX Runtime v1.23.2](https://github.com/microsoft/onnxruntime/tree/v1.23.2)：MIT，完整 LICENSE 与 ThirdPartyNotices 保存在 notices。LICENSE SHA-256 `2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c`。仅选 CPUExecutionProvider，不以“native”暗示启用 CoreML/GPU。
- NumPy 2.5.4（distribution 声明 `BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0`）、OpenCV Python headless 5.0.0.93（distribution 声明 Apache-2.0，wheel 中其他组件保留自带通知）、Pillow 13.0.0（distribution 声明 MIT-CMU）负责本地数组/缩放/尺寸读取。版本来自本次已运行环境的 distribution metadata，安装时保留各发行包随附许可。
- OmegaConf 2.4.0（BSD-3-Clause）、pyclipper 1.4.0（MIT）、Shapely 2.2.0（BSD-3-Clause，所附 GEOS 有独立 LGPL 许可）是 RapidOCR 的配置/几何依赖。GEOS 是依赖 wheel 的原有组件，不能把整套 wheel 宣称全为 MIT；本仓库未静态合并或重新分发这些二进制。
- 其他传递依赖版本见 `requirements.lock.txt`；这份源代码包不附第三方 wheels。若以后打包桌面安装器或直接分发二进制，须按实际平台 wheel 内容再次审查、保留许可/通知并满足相应再分发要求，本清单不能替代该发布审计。
