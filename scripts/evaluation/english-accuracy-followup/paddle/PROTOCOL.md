# 两个Paddle局部重识别候选，正式输出前冻结

固定原英文10图、medium det+rec、目标短边1536/cap4096、既有Paddle敏感DB参数与legacy cls、CPU1/ORT intra1 inter1、OpenCV/BLAS1、rec_batch6、text_score0.5。与既有medium1536比较，但本轮是已参考此验证集错误设计的新研究，不视为独立未见测试集。

A：所有检测四边形沿局部宽/高轴扩为原宽1.08倍、原高1.16倍（整体尺寸比例，不是每侧各加8%/16%），从同预处理图重裁，运行同cls与rec。向原图回报的框保持原检测框，不以扩边改变几何匹配。

B：每行三视图按固定次序为原裁剪、1.08宽×1.16高、1.00宽×1.16高。每视图分别对全图行集合调用同cls/rec（batch6），保持原视图原批处理分组，不能把3视图混成一批导致原分支padding改变。按同识别器平均置信度最大选文本，完全相同分数优先较早视图；不查GT、长度或字典词频，不依据图ID选择。先选后按原text_score过滤，保存所有视图原始文本、置信度、chosen_view、扩边坐标和边界处理，不计算GT oracle挑选收益冒充生产策略。

扩边由四边形均值中心与两对边平均方向构建，坐标clamp到[0,w-1]/[0,h-1]。如clamp后任意边<1像素则回退clamp后的原四边形；原框仍退化或图像宽高<2则报错，不制造裁剪。4项合成几何测试检查固定比例、边界、退化拒绝及只扩高；合成OCR只检查接口与视图记录，不据其文本调整参数。

每方案全10图单遍，独立进程，全部输出保留。共享锁与前期相同；等待其他候选锁不计入计算时间。前置available≥6GiB，运行available<1.5GiB或同步协调器+worker RSS>5GiB、单图提交至返回>180秒，终止该组保partial/缺页错误，不偷偷减少样本或改参数。

记录全流程engine wall和processing wall、初始化、queue wait、实际det输入shape；stage_timings包含detect_and_crop（包含crop_construction，为嵌套计时，不能相加）、primary cls、各view recognition及extra cls。同步RSS100ms采样可能漏短峰及重计共享页。full-manifest补齐所有10图，评分保留全GT分母。

主CER/WER、S/D/I及空目标/无原始行框覆盖代理按原几何评分器，不能把无空目标误解为det完美。置信度跨视图未校准，均值可能偏爱较短文本，必须报告选中视图的长度变化与质量变化；不根据本轮成绩再次调整扩边比例或策略。所有图、GT、视图全文和结果保持私有，只公开指标与图表。
