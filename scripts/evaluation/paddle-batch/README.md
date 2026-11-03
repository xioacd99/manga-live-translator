# PaddleOCR CPU批量与并发复现

固定2048/cap4096和v6small_params权重，A识别crop batch1、B crop batch6、C单worker ORT intra2、D两个独立worker各ORT intra1。所有组ORT inter1、OpenCV/BLAS1。每组独立初始化后3轮整批10图。rec_batch不是把多张页面送入同一个OCR上下文，而是单张图片内检测文字裁剪的识别batch。

## 运行
沿用既有Paddle模型比较附带的requirements-current.lock.txt与模型下载manifest。模型引用SHA另见model-references.json。该文件只是公开来源清单，不能直接作为运行清单：下载并核验后，给 v6_small_det、v6_small_rec、legacy_cls 每项补充本地 path 字段，保留 sha256，再以 --models 指向该私有副本。运行器不会自动下载模型。输入manifest为10项JSON数组，每项有id、file、sha256、width、height。file指向本地授权图片。
python run_batch.py --manifest 输入.json --models 本地模型.json --engine worker_engine.py --output 输出目录 --lock 共享锁文件
默认按A、B、C、D顺序，每轮按输入原序提交。不按性能重排。每张预测完整保存在私有results/组/results.json及round文件。

## 计时与资源边界
初始化与锁等待独立；makespan从提交首图至收到全部10图结果，包括排队和IPC，输出写文件在计时外。首轮与后两warm轮分列。逐图queue_wait_seconds从提交至worker开始，processing_wall_seconds包含engine和结果提取，engine_wall_seconds包含原图读取、全部OCR和原始结果观察。RSS每100ms采样同一时刻协调器与已知OCR worker当前RSS并相加，可能重复计共享页且漏短峰；不包含Python资源追踪辅助进程，不是独立峰值相加或唯一物理内存。

共享锁仅协调本项目，不保证专属物理CPU。cgroup配额不可见，MemAvailable不是容器配额承诺。C/D只比较请求线程预算，不保证OS全过程恰好2线程。D内存安全阈值及中止协议见PROTOCOL.md。

公开文件不含原图、GT、完整预测、权重或私有绝对路径。两个runner与正式执行文件字节一致，SHA见provenance.json。公开副本仅py_compile，未重新推理。后置验证断言每轮round、唯一index0..9与原manifest身份/hash，不按输出选择最佳轮。

## 从私有结果重新评分与汇总

在仓库根目录执行（不运行OCR，不联网）：

```sh
python3 scripts/evaluation/paddle-batch/analyze_quality.py \
  --ground-truth /path/to/private/ground-truth.json \
  --results /path/to/private/results \
  --output /path/to/private/analysis
python3 -m unittest discover -s scripts/evaluation/paddle-batch/tests -v
```

`--results`需包含A/B/C/D各自的`results.json`，内含三轮原始图片预测；不依赖额外导出的predictions-round文件。`--scorer`可显式指定兼容的`score.py`，默认复用仓库已有几何评分器，固定`line-column-overlap-v2`及英文WER。GT的images顺序应与正式提交顺序一致。评分前拒绝缺组/缺轮、重复index、错误round或id/hash错配。

输出`summary.json`复现原实际`analyze_quality.py`的汇总字段，并输出每组每轮编辑统计和评分器SHA元数据。warm吞吐严格为两暖轮总图片数除以两轮makespan之和（本实验20/sum），不是两轮吞吐的算术平均；另保留该算术平均以便检查。TTFR使用协调器收到首个结果的时间，不混同worker完成时间。RSS直接采用每轮同步采样总RSS峰，不把独立worker峰值相加。首轮不混入warm统计，三轮质量独立保留，不择优或把重复轮当新增图片。A改变crop batch后可能改变输出，不能由B/C/D的质量直接外推A。

合成测试只使用程序生成的ASCII文本和方框，覆盖吞吐/TTFR/RSS定义、A与B/C/D质量边界以及缺轮/错配拒绝。测试不代表真实OCR推理质量。运行参数指向的GT与完整预测始终留在使用者本地，勿将这些输入加入公开仓库。
