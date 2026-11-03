# Paddle 系列漫画 OCR 复现脚本

本目录仅包含脚本、版本和模型校验元数据，不包含漫画原图、裁剪图、漫画全文、预测全文或模型权重。请自行准备有权使用的本地输入。输出可能包含版权文本，默认仅供私有评测，不要直接上传公开仓库。

这是原实际运行脚本的参数化公开副本；历史原脚本和结果保持不变。采用同样的模型、CPU 1 线程、预处理、识别阈值和每图三次调用。公开副本在每图三次计时后另外导出原始检测框，该辅助步骤不计入主推理耗时；历史版在全10图跑完后单独导出。

## 环境

测试环境：Python 3.12.14、RapidOCR 3.4.5、ONNX Runtime 1.23.2、Linux x86_64。使用 Python 虚拟环境：

```sh
python -m venv .venv
.venv/bin/pip install -r requirements.lock.txt
```

`requirements.lock.txt` 固定本次实际安装的完整依赖版本。不同CPU/操作系统可能需要兼容wheel；Linux中使用fcntl锁，不是跨平台性能承诺。

## 输入

manifest 是 JSON 数组，至少有以下字段：

```json
[{"id":"sample01","file":"images/sample01.png","sha256":"填写原始文件SHA256","width":640,"height":875}]
```

file 可以为绝对路径或相对manifest目录的路径。按真实内容解码，不依赖扩展名，BMP也可输入。原始文件字节必须通过SHA256检查。

RTDETR结果是对象，含images数组，每图至少有id、sha256、regions；每个region含bbox对象，其x、y、width、height为原图像素。可额外提供regionId、confidence和每图timing。脚本不内置RTDETR，不伪造上游推理时间。

## 三个候选

```sh
# 首次可用 --download-models 下载缺失模型；以后可以完全离线运行
.venv/bin/python benchmark.py --manifest ./data/sources.json \
  --model-dir ./models --lock ./shared-inference.lock \
  --output ./results/full --mode full --download-models

.venv/bin/python benchmark.py --manifest ./data/sources.json \
  --model-dir ./models --rtdetr ./data/rtdetr-regions.json \
  --lock ./shared-inference.lock --output ./results/rec --mode rec-only

.venv/bin/python benchmark.py --manifest ./data/sources.json \
  --model-dir ./models --rtdetr ./data/rtdetr-regions.json \
  --lock ./shared-inference.lock --output ./results/inner --mode inner-db-rec
```

所有比较方案必须使用相同lock文件，并遵守相同CPU线程规则；锁是操作系统flock，不是文件存在检查。网络只用于显式请求的模型下载，不上传图片。下载URL/固定版本/SHA256/字节数在models.json；全部活跃模型共22,036,414字节。

- full：整图Paddle DB检测 + 方向分类 + Paddle识别。
- rec-only：RTDETR原图段落裁剪直接送同一Paddle单行识别器。无二次检测，无方向分类，无外部强制拉伸；识别器内部按比例resize/pad。段落与单行模型的粒度不匹配是局限。
- inner-db-rec：RTDETR裁剪内部再运行DB检测 + 方向分类 + 识别，映射回原图。明确为二次检测，不是rec-only。

每图首次调用和随后两次warm分别保留bbox/text/confidence和wall。只有第一张的第一次才是初始化后的首次推理；其他图不能称为fresh-process cold。import、cached模型初始化独立计时。下载时间不算推理。组合计时只含图片读取/裁剪/Paddle，上游RTDETR时间另附；相加最多称stage-sum估计，不能称完整pipeline实测wall。

`predictions.json` 为统一schema；每图JSON保存三次结果；`effective-config.yaml` 保存完整配置。准确率需独立GT和几何匹配计算，confidence不是准确率。行级DB框与段落级GT的严格IoU不能不加说明直接比较。

## 零行现象：已证实的环节与未证实的成因

`crop-diagnostics.json` 只含框、尺寸、计数、分数，不含漫画文本。它是本次固定未调参组合的额外诊断，不改原基准结果：

- DP03两个裁剪为104×61与60×32，DB实际找到1和2个候选；原始识别分数分别为0.36363、0.06291和0。最终被空字符串处理/0.5识别阈值滤掉，所以不能说DP03的DB完全未检出。
- DL01的106×71裁剪DB找到7个候选，但识别分数均低于0.5；33×126竖框则DB本身输出0个候选。
- 默认DB `limit_type=min, limit_side_len=736` 使这些小框分别扩大到约1248×736、1376×736、1088×736和736×2816。小裁剪作为独立图片被大幅放大、缺少周边留白、原段落粒度与行级识别假设，都可能改变分割与识别表现。这里证明了实际输入尺度和失败阶段，尚未做控制变量实验，不能断言哪一因素单独导致失败。
- 降低识别阈值只会暴露低置信度候选，不代表能恢复正确文本。值得另测的方向是crop上下文留白、限制放大、合理行分割等，须作为独立调参候选在独立验证集评估，不回写本次分数。

结论限定为“本次默认参数组合在这些样本失败”，不是“crop内检测算法无效”或“Paddle不适合漫画”。

## 许可与来源

RapidOCR代码Apache-2.0，PaddleOCR代码Apache-2.0；ONNX Runtime MIT。这里运行的是RapidAI转换和推理实现，不是Paddle原生运行时。Paddle官方PP-OCRv5 mobile det/rec模型卡均标注Apache-2.0；转换模型来自RapidAI版本化v3.4.0地址，校验值与RapidOCR 3.4.5包一致。保留上游许可和归属，不将第三方模型称为本项目原创。

- https://github.com/RapidAI/RapidOCR/blob/main/LICENSE
- https://github.com/PaddlePaddle/PaddleOCR/blob/main/LICENSE
- https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det
- https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_rec
- https://rapidai.github.io/RapidOCRDocs/main/en/model_licenses/

当前RapidOCR许可页具体bundled模型列表主要针对v6，不应声称其明确逐项列出这里的v5文件；v5许可证据来自上述官方模型卡及版本化模型来源。旧方向分类器来源为官方PaddleOCR旧模型列表。再分发时保留适用许可证和NOTICE；本目录不再分发权重。
