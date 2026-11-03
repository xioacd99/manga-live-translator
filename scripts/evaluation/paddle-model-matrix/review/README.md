# 独立评分与元数据复核

仅分析已有私有预测，不运行OCR、不联网、不修改GT。评分器由调用者显式指定，固定英文GT SHA及 `line-column-overlap-v2` / WER。输出白名单含逐图错误计数、状态和来源SHA，不含参考或预测全文。

```sh
python recompute.py --scorer SCORE_PY --ground-truth PRIVATE_GT_JSON \
  --results PRIVATE_RESULTS_DIR --output REVIEW_DIR --lock SHARED_LOCK \
  --groups GROUP_NAME_1 GROUP_NAME_2
python validate_metadata.py --results PRIVATE_RESULTS_DIR \
  --summary SUMMARY_NO_GT_JSON --ground-truth PRIVATE_GT_JSON \
  --review REVIEW_DIR --output METADATA_VALIDATION_JSON
```

`recompute.py` 可用于相同GT的其他结果组，保留缺页/失败页分母；completed_images只计error为空的实际结果。status沿用runner，不把资源失败解释为纯识字能力。原始预测与GT始终留在本地，不复制入公开目录。

`validate_metadata.py` 核验已完成的v6及追加server/语言矩阵：每组10图、同输入SHA、CPU1/字典维度、目标缩放和实际round32形状、时延均值/总和、同步采样RSS最大值。server native960单独检查原图供rec裁框和det内部long960/ceil128，不套用target2048公式。它不自动处理partial组；这种限制会直接assert失败，不默默跳过。

no_assigned_raw_line_proxy 是人工certain段落目标中，按与主评分相同的几何归属规则，没有过滤前行框可归属的目标数。它不是全页检测召回率或mAP。empty_regions是没有最终预测框归属的certain目标数；不是仅用空字符串判断。几何粒度、部分标注和排序限制沿用主报告。

公开版本由私有独立复算脚本参数化而来，并移除完整metrics文件输出；19组白名单summary及metadata-validation经重新分析，与原独立结果对象逐字段完全一致。没有重新推理。单遍时延不是warm benchmark。
