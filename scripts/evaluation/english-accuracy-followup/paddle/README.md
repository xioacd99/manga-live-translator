# Paddle行裁剪扩边与三视图置信度选择

两个预定义候选均保持medium1536/cap4096、原检测框、DB敏感参数和rec_batch6。A固定扩宽8%/扩高16%；B原裁剪、上述扩边、只扩高三视图按识别均值置信度选择，平分优先原视图。全部视图分开调用识别器以保持原批次结构，不查GT选输出。此研究已反复使用同10图设计方法，不是独立未见测试集。

## 本地复现

使用既有Paddle环境（Python3.12、RapidOCR3.10.0、ORT1.23.2、OpenCV5.0.0.93），沿用既有requirements-current.lock.txt。model-references.json固定权重URL、字节数和SHA；自行按既有下载工具准备本地模型manifest，每个模型项包含path/sha256。图像manifest恰好10项，包含id、file、sha256、width、height，file指向本地授权图片。

```sh
python run_candidates.py --manifest private-inputs.json --models models-local.json \
  --engine worker_engine.py --output private-results --lock shared-inference.lock \
  --bridge-reference prior-medium1536.json
python finalize_results.py --manifest private-inputs.json --results private-results
python analyze.py --ground-truth private-gt.json --results private-results \
  --baseline prior-medium1536.json --scorer /path/to/score.py --output private-analysis
python -m unittest discover -s tests -v
```

遗留bridge-reference参数不触发独立桥接，因为矩阵仅A/B；原分支核验在分析阶段用B view0的原框/quad、文本和分数对照旧medium1536，不能把这个参数存在说成已另跑桥接。

等待同锁不计推理；资源guard、边界clamp、退化处理及阶段计时见PROTOCOL.md。初始化没有180秒deadline，180秒只约束单图提交至返回；内存guard也覆盖初始化。阶段detect_and_crop包含crop_construction，不能把嵌套时延相加。所有成功结果均单遍，不称warm。

v1首次A图写诊断JSON失败；v2仅把NumPy布尔转成Python bool，未改变OCR算法，完整重跑两组。失败成本、旧新SHA与观测局限分别见SERIALIZATION-FIX.json、failed-attempt-cost.json、VALIDATION-NOTES.md。选入公开包的脚本本来已经CLI路径化，与实际v2源文件字节一致，provenance.json给出SHA；私有硬编码合成smoke驱动不公开。公开副本未重新推理，几何/JSON单测不能代替真实模型验证。

## 质量和隐私边界

检测框未变，不因无空目标就断言检测完美。平均置信度跨视图未校准，可能偏短文本；必须同时查看CER/WER、S/D/I和所选文字长度变化，不以GT oracle选择最佳分支。失败页仍按全10图/原GT分母计算。

输出将包含所有视图全文、坐标和本地路径，请私有保管。公开包不附图、实际GT、完整预测或rawlog，最终只公开汇总指标。score.py复用仓库既有几何line-column-overlap-v2评分器；未在本目录复制其源码。

归档说明：per-image-metrics.csv 仅将 CRLF 换行规范化为 LF，已逐单元格验证解析值不变；未修改冻结运行脚本或实验数据。
