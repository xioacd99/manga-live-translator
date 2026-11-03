# 第二阶段追加冻结
第一阶段保持不变，在其全部组终态后顺序运行，不能依据第一阶段质量选择。仍使用已通过的10图small2048框/文字桥接。
09 tiny-det+small-rec；10 tiny-det+medium-rec；11 small-det+tiny-rec；12 medium-det+tiny-rec。均short2048/cap4096，同第一阶段DB敏感参数/rec_batch6/CPU1/cls，独立模型字典与类型路由。每组同10图按原序单遍，不称warm，保留全部结果。
同原共享锁；前置available≥6GiB，运行available<1.5GiB或同步RSS>5GiB或单图180秒即停止该组保partial，不降参数。四组预计追加8–24分钟为粗估。全2048涵盖tiny/small/medium的det×rec完整3×3（small+small采用已通过桥接）。
第二阶段runner是第一阶段仅矩阵和桥接前置断言的独立副本；不修改第一阶段冻结执行文件。
