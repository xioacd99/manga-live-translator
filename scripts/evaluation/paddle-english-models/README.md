# Paddle英文型号对照：公开复现材料

此目录只含脚本、参数和模型/依赖/许可证元数据。不包含漫画图片、全文转写、完整预测或权重。请准备有权使用的本地输入，运行产生的全文预测不要自动上传公开仓库。

## 环境与下载

建议Linux x86_64、Python3.12。分别创建两个venv：legacy按requirements-legacy.lock.txt安装，current按requirements-current.lock.txt安装。两者ORT均1.23.2。仅wrapper基线使用RapidOCR3.4.5，其他3.10.0。运行download_models.py的Python只需标准库：

```sh
python download_models.py --output-dir ./models
python run_all.py --manifest ./data/sources.json --models ./models/models-local.json \
  --output ./results --lock ./inference.lock \
  --legacy-python ./.venv-legacy/bin/python --current-python ./.venv/bin/python
```

下载URL固定于模型版本目录，SHA与原评测逐字节一致；下载器生成含本地path的models-local.json。不需要Paddle原生runtime、GPU或图片云服务。模型下载时间不包含在推理wall内。

## 输入manifest

JSON数组，每项至少id、file、sha256、width、height。file为本地图片绝对路径，SHA为原文件字节，不对图片内容预先重编码。

```json
[{"id":"sample01","file":"/your/data/sample01.png","sha256":"原图SHA256","width":1000,"height":800}]
```

runner先验证输入和模型SHA。每图首次调用加两次warm。各候选独立进程、单线程ORT与OpenCV，使用相同fcntl锁；初始化明确分开，3.10lazy模型先加载后测首调用。全流程墙钟含raw capture的Python开销，不能与历史不同仪器口径直接比较。

## 路线和解释

前三个候选用于隔离wrapper变化及英文识别器替换；v6 tiny/small/medium均为Rapid预设。第七候选同small权重、Paddle官方det归一化及DB参数、但保持控制缩放736/min及Global max2000。不是官方原生完整管线，也不是纯架构消融。来源、差异、全部限制见METHOD.md。

实际运行代码保存在run_benchmark_main_frozen.py及run_benchmark_sensitivity.py，SHA见runner-versions.json。公开驱动仅把原运行中的路径参数化，不改变runner计算逻辑。

每个候选输出predictions.json、逐图3次raw结果、effective-config.yaml、session-details.json。DB的原始confidence在库内排序后可能与框错配，禁止据此单框评分；rec confidence/文字/框配对有效。原始DB候选、空文本和低分过滤分别记录，空/低分集合可重叠。

运行脚本不读GT、不提供准确率。准确率需要独立标注及统一几何匹配与CER/WER规则。模型能运行不代表浏览器/WASM或用户M4已验证。

## 重建公开图表

在项目根目录运行以下命令；读取公开指标，不需要漫画图像或GT全文。matplotlib及字体依赖沿用多语评测chart.py。

```sh
MPLCONFIGDIR=/tmp/manga-charts python scripts/evaluation/paddle-english-models/build_figures.py --repo . --summary docs/evaluation/paddle-english-models-2026-11-03/data/summary.json --output docs/evaluation/paddle-english-models-2026-11-03/assets
```
