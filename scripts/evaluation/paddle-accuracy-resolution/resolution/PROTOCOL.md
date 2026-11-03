# 分辨率四档正式实验，预先冻结
短边目标1024/1536/2048/2560；统一ratio=min(target/minSide,4096/maxSide)。直接原图INTER_LINEAR一次resize；Det max4096、库32倍数取整。仅target变化；其他v6_small_paddle_params配置、权重、字典、分类器、识别器、阈值、排序全部相同。
同原10图，每档各图连续3遍，保留每遍输出；首遍与后两warm分别报告。不以输出选择样本或参数、不读GT。2048旧pilot不充当此正式运行。每档新进程记录import/model init，按1024→1536→2048→2560顺序。
单线程ORT/OpenCV；使用 CLI --lock指定的共享锁文件，与VL严格串行，锁等待不计推理。每档持锁直到完成，随后释放。
记录cap生效、实际预处理尺寸、ORT检测输入tensor实际shape；记录ru_maxrss(KiB，进程累计峰值，不是每图独立峰值)。Session代理只记录输入shape后原样调用，不改tensor。各档保持同记录开销。raw detector score可能排序错位，不用来逐框归因。
