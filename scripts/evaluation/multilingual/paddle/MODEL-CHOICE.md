# 英日漫画 Paddle 模型选择及可比性

核验日期：2026-11-03。主候选继续使用与中文评测完全相同的RapidOCR 3.4.5 / ONNX Runtime 1.23.2 / PP-OCRv5 mobile det+rec+旧方向分类器。固定SHA见model-verification.json，实际活跃权重22,036,414字节。三个候选独立运行：整图DB+rec、RTDETR原框rec-only、RTDETR裁剪内部DB+rec。CPU单线程，共享fcntl inference锁。

## 官方证据，不根据中文文件名前缀猜语言

Paddle官方模型卡明确PP-OCRv5_mobile_rec用单一模型支持简体中文、繁体中文、英文、日文，并列出vertical text等场景；模型卡标明Apache-2.0：
https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_rec

官方det模型卡列出中文、英文、日文等语言和vertical/rotated/curved text，Apache-2.0：
https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det

实际ONNX文件内置词表18,383条，包含86个平假名条目、94个片假名条目、52个ASCII拉丁字母。只能证明字表存在这些字符，不能证明漫画精度。实际推理使用同一个已经按包声明SHA验证的模型，不假装为新训练的英文/日文专用权重。

RapidOCR的旧日本语专用japan_PP-OCRv4模型是可选老版本，但换成v4会同时改变模型代际和识别字表，影响A/D/E同模型对照。官方v5既然明确支持日文，本次不以旧专用模型替换主候选。英文同理。

## 横排与竖排的实际实现

RapidOCR DB检测路线会将高宽比>=1.5的行级透视裁剪旋转90度，然后由旧分类器处理0/180方向，最后送入识别器。必须区分这段几何处理和“原生日文整段竖排识别”。原框rec-only路线没有这一步，也没有二次检测，它将原始RTDETR段落crop直接送进同一单行识别器，内部等比resize/pad。对多列竖排/注音，该设置可能吃亏；这是该组合的真实局限，不依据GT调整旋转或阈值。

主评测阈值、resize、det参数不根据英日GT调参。官方支持声明和文档通用精度均不能代替这20张图片的实测结果。不同语言数据难度不同，跨语言均值也不是语言能力排名。

## 可选manga-ocr，不混入五方案主表

官方manga-ocr-base模型卡声明Apache-2.0，目标为日漫，明确覆盖横/竖排、furigana、艺术字体等：
https://huggingface.co/kha-white/manga-ocr-base
代码：https://github.com/kha-white/manga-ocr

它是不同的Vision Encoder Decoder识别器，需要PyTorch/Transformers及额外数百MB权重，并非可无成本替换的同一Paddle模块。已完成隔离CPU依赖安装，并从固定revision下载444,135,475字节主权重；后续tokenizer文件请求遭代理Tunnel403，停止且没有重试/绕过。缺必需资产而未运行，不报告任何实测成绩。详见manga-ocr/STATUS.md和model-files.json。若增加它，应列为独立第六候选，记录实际代码/权重版本、大小、时间和置信度接口差异，不复用Paddle成绩。

## 复现及隐私

run_language.py接受dataset、model-dir、lock、output和可选rtdetr路径；底层repro/benchmark.py接受manifest路径、三模式等参数。依赖与固定模型元数据在repro/。原图、完整识别文本、GT和预测文件仅在私有评测目录，不上传外部OCR服务或公开仓库。脚本只在显式--download-models时下载模型。
