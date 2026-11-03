# 第一阶段冻结：Medium/混搭/Tiny单遍覆盖

正式执行前先新runner的small-det+small-rec、short2048/cap4096对同10图单遍桥接，必须与已验证small2048三遍结果第一遍的框与文字全部完全一致；不通过就不启动正式组。

正式顺序：①medium原Global2000/Det min736+Paddle敏感det参数；②medium short1024；③medium short1536；④medium short2048；⑤medium short2560；⑥small-det+medium-rec short2048；⑦medium-det+small-rec short2048；⑧tiny-det+tiny-rec short2048。②–⑧均cap4096、Det max4096，ratio=min(short/minSide,4096/maxSide)，一次INTER_LINEAR缩放与库32倍数取整。

每组同原英文10图按manifest顺序单遍，所有组先完整一遍，不按准确率选赢家补重复，不称warm基准。旧medium默认与旧small2048不无意义重跑，small桥接用于新runner等价验证，不混入旧batchB时延口径。输入hash启动前确认；GT仅hash检查为984017f90ce822edb0c480207ed29ec8ec5ded587ba37f7ec40b3eb35e22753f，不读GT调参。

同ORT CPU intra1/inter1、OpenCV/BLAS1、rec_batch6、旧cls。det敏感参数各组相同：mean .485/.456/.406、std .229/.224/.225、thresh .2、box .45、unclip1.4、max_candidates3000、dilation false。tiny也是本协议共同参数，并非冒称tiny官方默认。识别动态宽与各自嵌入字典不变；不同det/rec模型使用对应ModelType路由。所有权重用此前冻结Rapid ModelScope版本与SHA，不是官方ONNX字节等价声明。代码及模型许可来源沿用既有Apache2.0证据。

每组独立worker进程，协调器全程持 CLI --lock 指定的同一共享锁。前置MemAvailable≥6GiB；运行available<1.5GiB或同时协调器+worker RSS>5GiB，或单图从提交至结果返回超过180秒，就停止组、保留partial/blocked和已完成图片，继续下一组，不降尺寸/阈值。100ms采样可能漏短峰，共享页可能重计；不保证独占物理CPU或不可见cgroup配额。此最终阈值取代草案6GB说法。

初始化/锁等待不计单图wall；记录engine_wall（含decode/OCR/raw与shape观察）、processing wall及queuewait。保留每图原始过滤前框与输出，实际tensor尺寸和cap状态。RSS同时采样，不加独立峰值。输出私有，不外传图/全文、不付费、不改产品。

预计单遍正式8组约27–63分钟，资源/180秒安全时限可能导致高档partial；这是基于旧medium耗时的粗估，不是实测承诺。先低档顺序运行，按真实耗时更新进度，不据质量改参。
