# 来源、许可与复现

## 固定输入

- [英文10图来源/尺寸/哈希](english/sources.json)：两部历史报纸漫画 Little Nemo、Krazy Kat。原来只含报头或拟声的两图在正式推理前被替换，理由是任务范围，不是模型表现。
- [日文10图来源/页码/哈希](japanese/sources.json)：1张北泽乐天历史漫画；9张佐藤秀峰《ブラックジャックによろしく》第一卷，固定PDF页8、28、49、68、89、108、128、148、169，页码为PDF从1计数。无对白的初选章节页按相邻下一页规则在预测前排除。
- 现代日文来自[权利人官方免费下载及利用条件](https://www.densho810.com/free/)，是自定条件，**不是CC或公版**。日文/FAQ与英文简译对报告条件措辞不同；本任务保守不公开原图、带框衍生图或全文转写，没有发送邮件。这里只做本地推理，没有模型训练。
- 日文PDF统一用Poppler整页渲染为最长边1600像素PNG；没有按预测裁掉难区域。ZIP、PDF、最终输入图都记录SHA。各方案使用同一最终图。

**这是可追溯协议，不是公开自包含数据集。** 公共仓库不带现代漫画原图、完整GT或全文预测；获得合适权利后，按来源取原图并核验哈希，再用独立标注复现。公开英文示例的作者、地区版权提示和加工方式见[图像归属](assets/attribution.md)。

## 方案和模型

- [Tesseract参数化脚本、固定语言包及许可](../../../scripts/evaluation/multilingual/tesseract/README.md)。官方tessdata_best固定commit，英eng、日jpn、补充jpn_vert；均Apache-2.0。RT-DETR沿用产品固定11,120,765字节ONNX和SHA，没有为了结果改阈值/预算。
- [Paddle三路线脚本及环境](../../../scripts/evaluation/multilingual/paddle/README.md)。RapidOCR3.4.5 / ONNX Runtime1.23.2，PP-OCRv5 mobile DB+rec+分类器有效模型总22,036,414字节；[官方识别模型卡](https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_rec)说明中英日/竖排范围。代码/模型许可与转换来源分别记录，不将ONNX转换库的许可自动当权重许可。
- [权重SHA与字表实物检查](../../../scripts/evaluation/multilingual/paddle/model-verification.json)：字表覆盖仅表示有相关字符，不是准确率证明。
- [manga-ocr未运行原因](../../../scripts/evaluation/multilingual/paddle/manga-ocr-status.md)：官方代码和模型Apache-2.0，主权重约444MB，尚缺被代理403拒绝的tokenizer资产；不参与数值排名、不换源绕过。

Linux 6.18.57 x86_64、AMD EPYC 9V74虚拟化CPU、Python3.12.14；Tesseract5.5.0原生C API、ORT Web1.23.2 WASM单线程检测、Paddle ORT CPU单线程。运行之间持有同一文件锁；云机器并非独占物理主机。没有模型API、LLM调用、用户Mac测试或用户数据上传。

## 运行与计时

各公开目录README提供具体参数。先下载许可允许的固定权重，核对models metadata和图片SHA，英文/日文分开运行；候选共用同一lock路径。源manifest的file字段填当前机器本地图片路径，不能把公共sources.json误当附带图片的数据包。

- [Paddle初始化/首次/暖调用完整表](../../../scripts/evaluation/multilingual/paddle/TIMING-REPORT.md)
- [Tesseract运行协议](../../../scripts/evaluation/multilingual/tesseract/protocol.json)
- 每图3次，所有正式调用重复输出稳定；[Paddle终态校验](../../../scripts/evaluation/multilingual/paddle/terminal-validation.json)。每语言每A/D/E30次，共180次；Tesseract英2/日3路线共150次，合计330次图像级路线测量，检测另计；区域管线每次可能包含多个底层OCR子调用。重复稳定不等于结果正确。
- 模型下载、锁等待与初始化不混入warm时间。组合路线总耗时是检测与后续阶段相加，不伪装成集成管线墙钟。

## 统一评分

```sh
python3 scripts/evaluation/score.py PRIVATE_GT.json PRIVATE_PREDICTIONS.json metrics.json --wer --text-order line-column-overlap-v2
python3 -m unittest discover -s tests -p 'test_comic_benchmark_metrics.py' -v
```

GT的图片SHA必须和预测一致，重复ID/越界框拒绝。英文以已标目标为范围；JA01 ocrEvaluation:false只保留检测，不贡献OCR编辑计数。详见[标注协议](ANNOTATION.md)和[方法](METHODS.md)。旧v1敏感性在RESULTS，不能把评分器顺序变化说成模型进步。

历史中文报告没有重写；默认评分版本保持legacy-yx，显式新参数才启用新口径。公开Tesseract副本仅翻译一行注释，运行逻辑与实跑版本一致；Paddle副本的静态与实际验证范围见自身说明。

## 图表重建

图表数据JSON与PNG同名置于assets，数字来自summary/metrics，没有手工改柱长。绘图脚本不含OCR全文：

```sh
python3 -m pip install -r scripts/evaluation/multilingual/requirements-charts.txt
MPLCONFIGDIR=/tmp/manga-charts python3 scripts/evaluation/multilingual/chart.py docs/evaluation/english-japanese-2026-11-03/assets/english-CER.json english-CER.png
```

绘图使用Noto Sans CJK，当前脚本字体位置为Linux系统路径；其他平台需指向已安装字体。模型推理在上述云CPU完成，PNG绘制不构成浏览器模型验证。典型错误图只在公开许可覆盖的历史英文样本展示，现代日文只用原创框粒度示意。
