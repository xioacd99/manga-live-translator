# 评测视觉材料来源

## english-ground-truth-example.png

- 1400 × 1400 PNG。EN09：George Herriman，《Krazy Kat》，1918-09-04。
- Commons: https://commons.wikimedia.org/wiki/File:Krazy_Kat_1918-09-04.png
- 原图：https://upload.wikimedia.org/wikipedia/commons/d/de/Krazy_Kat_1918-09-04.png
- Commons 标示美国公版（PD-US），并保留其他司法辖区版权期限警告；不能称为全球统一公版许可。来源核对日期：2026-11-03。
- 原图 SHA256：4c79c83a80263e52e8150a491059f0f928c4a7660919b96b3c6379a7be0e5e4c。原图746 × 1144，未经裁剪/缩放，置于独立说明画布；添加非填充矩形框。
- 人工 GT 完整覆盖该图6处对白，全部certain；拟声、日期、署名、格号被排除。完整是本次任务目标范围完整，不是标出全部可见文字。
- 蓝框是确定目标，橙框图例表示uncertain（本图没有橙色目标）。不是检测器预测，不是翻译效果。
- 英文GT已最终冻结（SHA256 984017f90ce822edb0c480207ed29ec8ec5ded587ba37f7ec40b3eb35e22753f）；可视化使用最新EN09-R03 x481/y20/w177/h137记录，其canonical JSON SHA256：fcafaf4bd38ebae74f0db85e9bf81fab4cd95699e185690263497201dc3e2162。不在此发布完整GT或另行转写对白。

## japanese-box-granularity-diagram.png

- 1400 × 820 PNG；本次原创几何示意，只用占位方块与框线，无漫画原图、对白或真实检测结果。
- 明确标注“示意，非实际检测结果”，解释逐列框与段落GT比较时的严格IoU粒度差异。
- 无第三方漫画素材；不触发现代日文作品图片或派生图的公开使用许可条款。

本文所列公开图仅使用上述公版来源或原创示意；现代日文原图及全文没有纳入公开材料。

## english-error-example.png

1500 × 1150 PNG。同一 EN09-R03 公版区域，原图矩形[465,0,685,175]放大3倍；同上述作者/Commons/PD-US条件。人工参考与 A（Paddle DB+rec）、C（RTDETR+best-eng Tesseract crop2x PSM6）真实结果，按score.py几何配对及line-overlap-v1排序。仅该区域，非全部样本；有明确错误而非成功宣传。

输入哈希与配对审计：english-error-example-evidence.json。GT SHA256 984017f90ce822edb0c480207ed29ec8ec5ded587ba37f7ec40b3eb35e22753f。原图及输出未改写。输出文本只为该公版区域短片段，不含现代日文素材。图示不附置信度或以其代替准确率。
