# 英文与日文漫画：Tesseract 实测

## 预先固定的方案

- 英文B：tessdata_best eng，原尺寸整图PSM11，完全空文本才回退PSM3。
- 英文C：同一RTDETR检测框，外扩4原图像素，Pillow bicubic放大2倍，eng PSM6。
- 日文B/C：主语言jpn，同英文PSM11/PSM6以维持原基准方法；jpn默认配置可加载jpn_vert子语言。
- 日文C-vertical：单独命名的竖排对照，复用完全相同的检测框及裁剪，jpn_vert PSM5。不是根据GT逐框择优，没有旋转、自动方向选择或模型融合。横排内容可能退化。

上述参数在任何GT评分前固定。PSM5是单块竖排假设，不适合把漫画整页视作单一块，因此只用于已检测的裁剪区域。官方PSM定义：https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html#page-segmentation-method
官方模型仓库：https://github.com/tesseract-ocr/tessdata_best

## 模型与依赖

权重均来自官方tessdata_best固定commit e12c65a915945e4c28e237a9b52bc4a8f39a0cec，Apache-2.0，固定URL、大小和SHA256见model-provenance.json。eng 15,400,601字节；jpn 14,330,109字节；jpn_vert 14,330,809字节。第三方许可证保留原文。

CPU原生libtesseract 5.5.0持久C API、Python与Pillow/numpy版本见requirements.txt；检测使用onnxruntime-web 1.23.2 WASM单线程及产品仓库固定hash的检测适配代码，见runtime-metadata.json。

## 复现

python run.py --language eng --sources ../english/sources.json --model-dir ./models --ort-dir /path/to/onnxruntime-web --repo-root /path/to/product --output ./english --lock /path/to/shared/inference.lock

日文基线将language换为jpn、sources换为日文manifest、output换为japanese。竖排对照使用language jpn_vert、crop-psm 5、reuse-results ./japanese/results.json及新的output ./japanese-vertical。复用仅限检测框及其既有计时，不复用OCR输出；另跑三次OCR。

所有输入manifest须恰好十图并含id、file、sha256，程序核对原始图hash。所有模型也核对hash。若模型或样本不足，停止，不悄悄缩小样本量。

## 时延与评估

所有推理独占同一fcntl锁，OMP_THREAD_LIMIT=1、OMP_NUM_THREADS=1、ORT线程1。每图first、warm1、warm2，初始化另计，未清系统页缓存。后续图片first只是首次处理该图片，不能统称冷启动。

检测先于OCR，检测与OCR分批测量后相加，不代表浏览器一体化墙钟时间；Pillow bilinear缩放不保证和浏览器Canvas逐像素一致。C-vertical复用基线检测计时，新的OCR/裁剪时间仍独立实测。持久Tesseract实例逐次清空自适应分类器。

统一预测regions为OCR词框；独立检测框为detectorRegions。无独立检测器的整图方案，不与段落GT进行严格框IoU比较。confidence不是准确率。准确率由独立人工GT评分，不按模型输出补GT。

原图、GT和OCR全文不随公开脚本分发。本目录的models及各语言结果目录均为本地工作文件，不得打包为公开复现材料。仅run.py、detect.mjs、README、依赖、许可及metadata可公开。

## 本轮验证完成

同一参数化run.py/detect.mjs已经真实完成英文B/C、日文B/C各十图三轮，并真实跑完日文jpn_vert、PSM5、reuse-results独立对照十图三轮。公开副本与实测脚本字节一致；语法、CLI、无私有路径及无数据/权重扫描通过。每份预测已验证10张图的hash、OCR框范围及confidence范围。公共副本未另行重复推理，以免把重复测量混入既定结果。
