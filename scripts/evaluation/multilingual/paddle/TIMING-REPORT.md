# 英文/日文 Paddle 三路线真实计时

全部输入冻结后运行，单线程CPU、同一共享fcntl锁串行。每语言10图，每方案30次调用；六方案合计180次。逐图SHA全部一致，三次bbox/text/confidence完全一致。没有GT调参。

| 语言 | 路线 | import(s) | cached init(s) | 第一图首调用(s) | mean warm(s) |
|---|---|---:|---:|---:|---:|
| english | full | 0.29227 | 0.16476 | 6.41667 | 3.34451 |
| english | rec-only | 0.26234 | 0.18193 | 1.83924 | 0.77916 |
| english | inner-db-rec | 0.24753 | 0.13400 | 17.59969 | 8.37617 |
| japanese | full | 0.32997 | 0.18755 | 1.60641 | 1.22553 |
| japanese | rec-only | 0.32778 | 0.14471 | 0.27329 | 0.17962 |
| japanese | inner-db-rec | 0.22767 | 0.14854 | 6.33514 | 3.34962 |

full包含读图、DB、分类和识别；rec-only/inner-db-rec只包含读图、crop、Paddle阶段，不含RTDETR。上游检测时间另附，和相加只能称stage-sum估计。模型下载不在推理计时内；lock等待也不在import/init内。

Linux 6.18.57 x86_64，AMD EPYC 9V74虚拟化CPU，Python3.12.14，RapidOCR3.4.5，ONNX Runtime1.23.2。共享云环境时延不代表浏览器或用户设备。

英文EN05上游选择器因region-budget返回0框，D/E保留空结果，无识别调用；不能误解为无对白或Paddle本身失败。

manga-ocr补充候选下载tokenizer资产遇到Tunnel403，未重试/绕过，未运行不参与排名。已有4文件只作为下载证据，不是完整模型就绪。

准确率由独立GT/统一评估脚本计算，当前文档只报告运行事实，不将confidence当准确率。
