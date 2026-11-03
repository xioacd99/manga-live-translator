# 可搬迁的中文 OCR 本地评测

本目录可以随评测说明公开；不含模型权重、漫画图片、人工GT或OCR结果全文。用户须自行提供合法取得的十张图片。默认不会联网或上传输入。

## 环境

- Python 3.12；安装 `requirements.txt` 中固定依赖。
- 系统 `libtesseract` 5.5.0，CPU单线程。须让系统动态库查找器能够发现它。
- Node.js；执行 `npm install` 安装 `package.json` 固定的 onnxruntime-web 1.23.2。
- 对应产品仓库的 `extension/adapters/pretrained-regions.js`。脚本核对固定SHA256，防止算法改动冒充相同复现。

## 输入

来源文件是长度为10的JSON数组。每项至少含id、file、sha256。file可用绝对路径，或相对于来源JSON所在目录的路径；也会尝试该目录下images子目录。每个id应为不含目录分隔符的唯一短标识。图片原始字节SHA256必须一致。

模型目录包含以下三个文件：chi_sim.traineddata、chi_sim_vert.traineddata、detector-v4-s_int8.onnx。权重固定下载URL、大小和hash记录于两个metadata JSON，不自动下载；可以从对应官方URL取得。程序会核验权重hash再开始。中文权重总26.15MB，检测权重11.12MB。

## 命令

python run.py --sources ./private-data/sources.json --model-dir ./models --ort-dir ./node_modules/onnxruntime-web --repo-root ./product --output ./private-results --lock ./inference.lock

与其他候选一起测试时，应对所有候选传入同一个锁路径，避免争用CPU。

## 方法和计时

本脚本内部A/B命名分别对应主报告方案B（整图Tesseract）/C（RT-DETR加Tesseract），不要与主报告方案A（Paddle完整流程）混淆。

方案A：整图原尺寸chi_sim PSM11，完全空结果才用PSM3。
方案B：产品RTDETR分块/解码/选框逻辑，框外扩4像素，裁剪后Pillow bicubic放大2倍，再用chi_sim PSM6。没有检测框则回退全图2倍PSM6。

每张图记录first及两次warm，模型实例持续复用，初始化另计。first不代表清空系统缓存，仅代表该图片本次首轮。检测预处理用Pillow bilinear，不保证和浏览器Canvas逐像素一致。检测与OCR分批计时相加，不代表浏览器整条流水线墙钟时间。

输出中regions是OCR词框；方案B的detectorRegions才是独立检测框。方案A没有独立检测框，不能把词框与段落GT直接做严格IoU比较。Tesseract confidence范围0–100，不等于准确率。以独立GT的CER进行主要比较。

结果、临时RGB数据及预测全文会写入output目录，请勿将该目录提交公开仓库。原图、OCR全文和衍生物的版权仍属于权利人。

## 验证状态和来源保留

可搬迁副本只通过Python语法、Node语法和CLI参数检查；没有重新跑模型，也没有查看GT后调参。原始实际测量脚本另行保留，其参数与本副本相同，唯路径和数据验证适配为命令行参数。

官方第三方许可证按原文保留，不翻译。运行时和检测模型许可来源见runtime-metadata.json；中文权重来源见model-provenance.json。分发产品时仍须保留所有实际打包依赖的许可证与声明。
