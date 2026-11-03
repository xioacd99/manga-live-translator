# Paddle英文型号追加评测：运行侧说明

本轮不读GT、不依照GT调参。输入与原英文10图逐文件SHA一致，模型本地CPU执行，无图片上传、云OCR或付费API。不修改产品运行代码；公开目录仅含复现脚本/元数据，原图与完整输出不公开。

## 七个预先指定候选

1. v5_multi_legacy：RapidOCR3.4.5 + 原v5 multilingual mobile det/rec，原classifier。
2. v5_multi_bridge：相同三权重SHA，RapidOCR3.10.0桥接，控制wrapper版本变化。
3. v5_english：相同v5 detector和classifier，仅rec替换为英语专用en_PP-OCRv5_mobile_rec的Rapid转换版。
4. v6_tiny：RapidOCR3.10.0预设缩放/DB参数，v6tiny det/rec。
5. v6_small：RapidOCR3.10.0预设缩放/DB参数，v6small det/rec。
6. v6_medium：RapidOCR3.10.0预设缩放/DB参数，v6medium det/rec。
7. v6_small_paddle_params：同Rapid v6small权重，仅det归一化和DB参数改为官方配置敏感性。mean=[.485,.456,.406]、std=[.229,.224,.225]、thresh=.2、box_thresh=.45、unclip=1.4、max_candidates=3000、use_dilation=False。保持相同736/min、Global max2000与识别/分类配置。不是原生Paddle官方完整管线。

所有型号ORT1.23.2、intra/inter=1、OpenCV实际线程=1。固定classifier避免把方向分类器升级混入模型比较。3.4.5使用opencv-python5.0.0.93、3.10使用opencv-python-headless5.0.0.93，包变体差异如实记录；其他完整依赖见两份requirements lock。

## 参数来源与重要边界

RapidOCR3.10默认det mean/std=.5/.5，与Paddle官方配置不同。Rapid作者参数对齐文章明确记录比较两套norm后保留.5默认，而非模型已折叠归一化。故六组不能被描述为百度官方默认，也不能用它们否定官方原生实现。

来源：https://github.com/RapidAI/RapidOCRDocs/blob/main/docs/blog/posts/about_model/rapidocr-paddleocr-param-align-plan.md

官方v6small/medium rec inference.yml为[3,48,320]，实际ONNX输入为动态batch×3×48×动态宽。Rapid内部按图像比例扩展batch宽、等比resize/pad，320是最低宽基准，不是硬裁剪上限。词表在转换ONNX的character metadata内；session-details.json给出源条目数、最终含blank/space解码条目数和输出类别维度，不把有字符当成高准确率。

官方small det模型已下载作来源核对，实际SHA与Rapid版不同。该官方文件没有用于正式推理；主权重仍是models.json的Rapid固定v3.10.0制品。不再扩展官方权重下载。

## 冷暖计时

每图第一次+两次warm，整图路径读取/解码到检测、分类、识别、后处理输出的wall。所有推理使用同fcntl锁串行；导入、cached模型初始化分开记录，下载和等锁排除。3.10为lazy模型加载，本次显式载入三个子模型再测第一图首调用，避免把lazy初始化混入推理。

runner在build_final_output中额外观察过滤前的raw结果，并用库坐标映射函数导出原图坐标；此观察的Python开销包含在本轮wall内。因此和旧历史benchmark的额外det-only导出方式不是完全相同计时口径，应优先比较本轮全部新跑结果。每次调用开头清空last_raw，不沿用上一图。

## 原始结果诊断限制

TextRecognizer内部按宽排序批处理后恢复原crop顺序，raw text/rec confidence与框对应。TextDetector先生成boxes/scores，再只对boxes排序；库原始detectorConfidence可能与框错配。本轮保留原始捕获，不据此对单框质量做结论，不修改库或预测。DB内部阈值筛选发生在排序前；输出框数量、位置以及识别配对不受该scores排序问题影响。

raw_detector_count=0表示该图无DB候选；非空框下的blank_recognition_count、below_threshold_count可区分空字符串/低分过滤，但二者可能重叠，不能相加当删除总数。参考区域的字符删除也不等同检测失败。评分由独立GT方处理。

## 许可与归属

RapidOCR代码Apache-2.0、PaddleOCR代码Apache-2.0、ONNX Runtime MIT。PaddlePaddle官方HF各模型卡声明Apache-2.0；API原响应与固定revision推理yml在official-metadata。实际模型来自RapidAI固定v3.10.0转换目录，并逐个按RapidOCR包声明SHA验证；不能混称官方下载的同字节制品。模型权重、完整预测、GT不公开，脚本可单独提供。

- https://github.com/RapidAI/RapidOCR/blob/main/LICENSE
- https://github.com/PaddlePaddle/PaddleOCR/blob/main/LICENSE
- https://huggingface.co/PaddlePaddle/en_PP-OCRv5_mobile_rec
- https://huggingface.co/PaddlePaddle/PP-OCRv6_small_rec_onnx
- https://huggingface.co/PaddlePaddle/PP-OCRv6_medium_rec_onnx
- https://huggingface.co/PaddlePaddle/PP-OCRv6_tiny_rec_onnx

本轮不证明浏览器/WASM、WebGPU或用户Mac M4可用性和性能，也不把官方论文通用分数当本数据集成绩。

## 体积口径

model-sizes.json仅计算各方案实际使用的det/rec/共同classifier文件，不含Python、ORT、OpenCV、其他依赖wheel、包内未使用的模型或缓存。不能把这个数当完整安装包或浏览器首次下载流量。
