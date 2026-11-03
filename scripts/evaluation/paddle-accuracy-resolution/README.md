# 精度与分辨率评测复现

[图文报告](../../../docs/evaluation/paddle-accuracy-resolution-2026-11-03/README.md)。本目录只含代码、官方模型来源与哈希、协议和非全文统计，不含原图、GT全文、模型权重或完整预测。

- [传统OCR四档分辨率](resolution/README.md)：同模型同CPU1，每档10图×3遍，输入原图hash固定。
- [PaddleOCR-VL-1.6整页Spotting](vl/README.md)：本机CPU4、官方GGUF、固定预算、一遍10图；仅回环HTTP。
- 模型与运行库来源、许可证在各目录单独记录。不要执行模型仓库自定义代码；下载前后核实文件hash。
- 运行依赖使用各子目录说明。传统OCR沿用[七型号复现环境](../paddle-english-models/README.md)，模型manifest由其下载脚本生成。

## 评分与公开图表

使用仓库原评分器，不根据文字相似度找答案：

```sh
python scripts/evaluation/score.py GT.json predictions.json metrics.json --wer --text-order line-column-overlap-v2
```

VL评分前只移除空detectorRegions键，由最终Spotting框提供定位诊断；此步骤不改任何文字/坐标/错误状态，详见VL目录。不能把空的独立检测阶段误记为全漏检。

图表可直接从仓库内公开数值重建，不需要原图或GT：

```sh
MPLCONFIGDIR=/tmp/manga-chart-cache python scripts/evaluation/paddle-accuracy-resolution/build_figures.py --repo . --report docs/evaluation/paddle-accuracy-resolution-2026-11-03
```

绘图需matplotlib及中文字体，沿用[此前图表环境说明](../paddle-english-models/README.md)。图表源JSON和PNG一同保存。PNG通过本地可视检查；GitHub真实网页渲染若未单独验收，不应只凭文件存在宣称远程渲染完成。

## 离线故障回退不是产品实现

探索性组合只在VL明确error时整页选用此前固定small_params输出，其他页保留完整VL。不得按GT挑框/拼字，也不按分辨率结果再改回退候选。原预测hash与选择规则见[回退manifest](../../../docs/evaluation/paddle-accuracy-resolution-2026-11-03/data/hybrid-manifest.json)。没有测量已集成混合系统时延，不能把独立CPU1/CPU4运行直接相加当作用户体验。

公开runner为路径参数化/中文说明版本；保留正式执行脚本的SHA及差异记录，不能声称字节完全相同。此提交不改变扩展模型或默认运行方式。
