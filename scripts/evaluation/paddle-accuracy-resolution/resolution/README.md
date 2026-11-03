# PaddleOCR分辨率四档复现

同v6_small_paddle_params权重与推理参数，仅改变全局目标短边1024、1536、2048、2560，长边上限均4096。每图连续3遍，首遍与后两遍分别计时。长条受cap影响时实际短边达不到目标，不是无条件4档等比例放大。

## 输入与运行
使用既有Paddle英文模型比较报告附带的model-manifest及requirements-current.lock.txt；RapidOCR3.10.0、ORT1.23.2，权重用其下载脚本校验SHA。本目录不附图、GT、权重或完整预测。输入manifest为JSON数组，每项含id、file、sha256、width、height，file指向调用者获准使用的本地图片。

用同一Python环境顺序执行四次：
python run_sweep.py --manifest 输入.json --model-manifest 模型.json --output 输出目录 --lock 共享锁文件 --candidate v6_small_paddle_params --short-side 1024
将最后参数依次换1536、2048、2560，并为每档指定独立输出目录。模型.json须使用现有模型下载脚本生成的本地path以及sha256。所有并发CPU实验必须用同一个锁文件。

## 记录边界
整图读取、预处理、检测、方向分类、识别、后处理、raw捕获和tensor-shape观察计入wall。RSS读取在wall外，ru_maxrss为进程累计峰值KiB，不是每图独立峰值。模型加载和等待锁不计图像wall。输出包含每次完整坐标、文字与置信度，不挑选最佳遍；公开汇总不包含文字。

该公开副本只更正文档字符串与计时描述，无算法变化；与原正式运行脚本SHA关系见provenance.json。公开副本通过py_compile，未再次推理。原正式脚本保持冻结。
