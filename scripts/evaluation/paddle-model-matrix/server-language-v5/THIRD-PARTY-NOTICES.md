# 第三方来源与许可说明

这份文件是本复现材料的归属说明，不冒充上游 NOTICE 文件。模型权重、运行依赖、官方完整处理器源码和字符字典内容均未打包。

## PaddleX 派生检测预处理适配器

文件：`server_preprocess_adapter.py`。

上游版权：Copyright (c) 2024 PaddlePaddle Authors. All Rights Reserved.

许可：Apache License, Version 2.0。保留原文件版权与许可头。完整上游许可文本见 `licenses/PaddleX-LICENSE.txt`，来源为固定 PaddleX commit `4c968d30b9d0d4a693d9eaaef0881c20f8d7d0e0` 的 LICENSE。

参考源码：[PaddleX text_detection/processors.py 固定版本](https://github.com/PaddlePaddle/PaddleX/blob/4c968d30b9d0d4a693d9eaaef0881c20f8d7d0e0/paddlex/inference/models/text_detection/processors.py)。这是基于 DetResizeForTest / NormalizeImage 语义改写的小型适配器，新增安装到 RapidOCR 实例的桥接函数，分开实现 native960 ceil128 和共同 max4096/round32 的归一化路径；它不是原文件逐字副本。公开化没有进一步修改适配器字节。

与上游不同，完整检测后处理、裁框和识别仍走 RapidOCR 的桥接流程，不宣称是 PaddleX 官方端到端运行。

该固定 commit 根目录的 `NOTICE` URL 本次返回 HTTP 404；没有从其他路由重试，也不据此断言仓库所有子目录都不存在 NOTICE。若发布范围未来增加上游文件，应按具体文件重新审查通知要求。

## 官方 PaddlePaddle ONNX 与派生字典

`v5_server_det`、`v5_server_rec`、`v5_latin_rec` 的原始模型记录声明 Apache-2.0。资源 URL、固定 revision、字节数、SHA-256 在 `asset-lock.json`，原来源清单本身的哈希在 `SOURCE-FILES.json`。

两个字典均由相应固定官方 `inference.yml` 的 `PostProcess.character_dict` 派生。派生规则是保留列表原序，UTF-8/LF 行分隔，末尾 LF；无筛选、重排或字符内容修改。固定源 SHA-256 与派生 SHA-256 均完整列入资源锁。字典内容未复制到此目录，调用者通过准备器自行生成。

## RapidOCR 与 RapidAI 分发导出

RapidOCR runtime：3.10.0，Apache-2.0。完整许可来自官方仓库该版本，见 `licenses/RapidOCR-LICENSE.txt`。这是 runtime 许可，不直接等于每个模型权重的独立许可证明。

v6 small det、v6 medium rec、v5 英文 rec 和 legacy cls 是所列 RapidAI ModelScope 版本的既有导出。它们与 PaddlePaddle 官方 ONNX 可能具有不同字节和元数据，不能互换。原模型清单未逐个声明许可；补充读取的官方 ModelScope v3.10.0/v3.4.0 仓库卡声明 “Apache License 2.0”。这只作为仓库卡声明记录，证据 URL、大小、哈希及范围见资源锁和 `license-sources.json`，不是对每个权重来源链的独立法律审计。

## ONNX Runtime

ONNX Runtime：1.23.2，MIT。完整微软版权与许可见 `licenses/ONNXRuntime-LICENSE.txt`，来自官方 `v1.23.2` 版本。没有把 PaddleX 适配器改标为 MIT。

## 其他依赖和本项目代码

精确依赖版本见 `requirements-current.lock.txt`。本目录不附依赖二进制，因此所收集许可说明不代表所有第三方 wheel、系统库或将来发行包的完整 NOTICE 清单。

七个评测源文件保持原字节。项目自有协调代码和新增准备器/测试的发布许可需由发布方确认；此文档不擅自覆盖已有权利声明或为整个目录套用统一 MIT 许可。
