# CPU吞吐四组实验（运行前冻结）

A=1worker/ORT intra1/inter1/rec_batch1；B=1worker/intra1/inter1/batch6；C=1worker/intra2/inter1/batch6；D=2workers，各intra1/inter1/batch6。OpenCV与BLAS环境均1。C与D是总请求线程预算2，并非声称OS全过程恰好只有2线程。

同v6small_params权重、字典、所有DB/识别参数及原英文10图，短边目标2048，长边cap4096。各组按原顺序提交10个独立图片任务，独立图片不合并模型上下文。仅组定义的worker数、ORT intra、识别crop batch改变，不读GT、不选最佳结果。

每组独立进程，先全部worker模型加载完成ready，初始化时间独立。每组3轮，每轮所有10图各一次；一轮完全收齐后才下一轮。B本轮重测，不将之前每图连续重复结果混入吞吐表。完整保存每轮每图预测、worker身份、队列等待、实际处理、engine调用时间。makespan从开始提交到全部结果收到（含队列和IPC），不含输出文件写入和初始化。首张完成及首结果收到时间同时保存。首轮与后两warm轮分开。

每组全程独占既有共享inference.lock，其他CPU实验不得并行。D两个worker是本组预授权并发。进程树父+worker当前RSS每100ms采样后同一采样时刻求和，记录采样峰而非独立峰值相加。共享物理页可能重复计数，因此不是唯一物理内存占用。采样会有轻量开销且可能漏掉短峰。

D开始前MemAvailable须≥6GiB，否则记录blocked。D运行若采样MemAvailable<1.5GiB或父+worker同时RSS>5GiB，安全停止并保留失败和已完成轮，不降分辨率或改组参数。上述阈值经父任务明确授权更新于正式冻结前。

所有输入与模型SHA预检；保留每次输出，即使不同也不择优。raw detectorConfidence可能因上游排序不同步而错配，不能逐框归因。
