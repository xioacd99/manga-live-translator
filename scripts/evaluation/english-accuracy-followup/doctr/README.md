# DB-ResNet50 + PARSeq：本地英文漫画OCR研究复现

这是独立研究管线，不是产品默认实现。包内不包含模型、安装轮子、漫画、GT、实际图片清单或预测全文。调用者提供自己有权使用的十张图片；没有原始私有数据和GT，不能从本包复现原实验的具体准确率。

## 固定方案

- docTR1.1.0，发布提交2d8e244bd051634704ed9e69a70dd975ce166c78；DB-ResNet50检测和docTR版PARSeq识别，PyTorch2.8.0+cpu/torchvision0.23.0+cpu。
- 原图RGB。检测1024×1024，保比例、对称padding。识别32×128，保比例、非对称padding，batch8。词框已经由docTR去掉检测padding，归一化坐标再乘原图宽高。
- DB二值化0.3、box0.1、unclip1.5，3×3 opening，最小框2像素，不加入额外识别置信度过滤。输出是词框，不能把其定位召回直接与Paddle行框硬比较。
- docTR PARSeq的max_length=32，不是原论文默认25；最多33个解码位置含EOS、一次refine。词表为官方french，包含完整英文。无词典纠错、无英文白名单、无GT调参。宽词框沿用官方拆分和合并，合并后的词可能长于32。
- 原始导出、检测词框、每个识别片段的EOS诊断在调用者输出目录保存。不伪补文本或坐标，不把EOS缺失当成正常结束。
- CPU线程1，并关闭docTR预处理线程池。组前可用内存6GiB，运行中可用内存1.5GiB及协调器+worker RSS5GiB守卫；初始化和每图180秒。
- 同图单遍，初始化和锁等待单列。单图时间包含RGB解码、预处理/模型/观察hook、坐标投影，不含私有raw JSON写盘。不是三遍warm、独占CPU或硬内存隔离证明。

详见PROTOCOL.json。这里官方1024输入与前Paddle1536输入不同，比较的是各自固定的完整管线，不是等像素模型消融。

## 来源、许可和平台

- [docTR发布](https://github.com/mindee/doctr/releases/tag/v1.1.0)
- [固定LICENSE](https://github.com/mindee/doctr/blob/2d8e244bd051634704ed9e69a70dd975ce166c78/LICENSE)
- [官方模型指南](https://mindee.github.io/doctr/latest/models/index.html)
- [官方识别说明](https://mindee.github.io/doctr/latest/models/recognition.html)
- [官方PyTorch版本配对](https://pytorch.org/get-started/previous-versions/)

官方文档把DB-R50+PARSeq列为高精度候选，但通用文档指标不能证明漫画胜出。两项官方checkpoint合计197,479,261 bytes，完整URL/字节数/SHA固定于asset-lock.json。项目整体Apache-2.0声明及官方预训练入口已核；未找到checkpoint单独许可文件，故保留证据范围，不给出商用法律确定性、不再分发权重。原docTR许可证原文随包附上。PyTorch为BSD风格许可，其依赖不随本包分发。

本次为Linux/PyTorch CPU实现。官方有Apple Silicon MPS路径，但未运行M4；不能用云CPU耗时推算M4。Python/.pt管线不是可直接部署的浏览器实现。浏览器转换和算子支持仍需另外验证。

## 安装和模型准备

需要Linux、Python3.12及共享锁机制。原实验使用独立venv；不要覆盖旧环境。

```sh
python -m venv .venv
. .venv/bin/activate
python -m pip install torch==2.8.0+cpu torchvision==0.23.0+cpu --index-url https://download.pytorch.org/whl/cpu
python -m pip install -r requirements-public.lock.txt
python download_models.py --output ../private-run/models
```

依赖锁保留实际版本，但将两个本地wheel地址改成setuptools/wheel版本固定；它不是带所有wheel哈希的离线环境镜像。CPU wheels必须从官方CPU索引安装，不能换成CUDA包。准备器只下载固定官方数据URL并验证完整SHA，HTTP失败不换源；不会下载或执行远端Python。生成的models.local.json含调用者本地路径，应私有保管。

engine加载使用官方本地from_pretrained，环境变量TORCH_FORCE_WEIGHTS_ONLY_LOAD=1强制PyTorch安全权重加载。docTR官方兼容逻辑会处理旧PARSeq checkpoint中的四个norm键；不修改权重文件或未知模型代码。推理进程阻止Python socket连接并设置HF离线，这不是操作系统网络隔离证明。

## 先做自有合成冒烟

```sh
python make_synthetic.py --output ../private-run/synthetic --font /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf
python run_eval.py --synthetic-smoke \
  --manifest ../private-run/synthetic/sources.json \
  --models ../private-run/models/models.local.json \
  --output ../private-run/synthetic-results \
  --lock ../private-run/inference.lock
```

字体须由调用者合法提供。生成器不会下载字体或读取漫画。

## 十图执行

自己创建JSON数组manifest，恰好10项。每项包含唯一安全ID、file本地路径、sha256原文件哈希、width和height原尺寸。ID只使用字母、数字、连字符和下划线，避免路径字符。示例结构不是实际输入清单：

```json
[{"id":"PAGE01","file":"/caller/local/page.png","sha256":"64位原文件SHA256","width":1000,"height":1500}]
```

所有重任务共用同一锁，输出必须是尚不存在的新目录：

```sh
python run_eval.py \
  --manifest ../private-run/inputs.json \
  --models ../private-run/models/models.local.json \
  --output ../private-run/results \
  --lock ../private-run/inference.lock
python summarize_results.py --input ../private-run/results/predictions.json --output ../private-run/summary.json
```

失败保留所有原输入分母，已完成页保留、未完成页明确error和空结果。脚本不读GT；本包不含私有几何评分标注。不要公开运行目录，其中有识别全文和本地路径。

## 验证与公开化差异

```sh
python -m unittest discover -s tests -v
```

轻量测试只核语法、坐标、失败分母、固定下载锁、文件清单和私有数据排除，不加载模型。完整模型实测、合成验证及尚未验证的事项以VALIDATION.json为准。runtime源码与实际运行文件的对应SHA、协议删减字段和依赖锁路径替换见SOURCE-HASHES.json。公开包的复制/元数据清理不是再次推理。

发布只复制PUBLIC-FILES.json和SHA256SUMS.txt列出的文件，不包含测试生成的__pycache__。测试只忽略能对应真实源码的标准.pyc缓存，未知文件仍纳入检查。

## 本次实际执行

已完成同一固定十图单遍：平均19.881秒/页，初始化4.290秒，采样RSS峰值1,524,445,184 bytes（约1.420GiB）；1647个词，识别片段缺EOS计数为0。公开合成生成器生成了与真实冒烟完全相同的图片，冒烟五词全对。这些仅说明运行和接口成功，准确率另由既定几何评分核验，不根据输出增加分辨率或改阈值。

首次合成预检因版本断言错误在加载模型前失败：安装metadata为1.1.0，官方模块为v1.1.0。保留首次失败，v2只改双重版本核验，随后合成和十图均完成。包内10项轻量测试正常unittest连续两遍通过；实际冻结协议另4项通过。测试不是操作系统隔离证明。

独立既定GT几何评分：CER 36.7043%、WER 74.5211%，字符编辑S181/D485/I147，分母N2215；exact区域5、空输出区域6。仅在已有标注区域评分，不是全页穷尽文字召回。它没有显示出这组漫画上更高的精度；保留不理想结果，不基于GT重调。本包accuracy-summary.json只含数值和证据哈希，旧评分器的line proxy字段在公开投影中改称word box proxy，不能当作同单位检测召回。

评分标注共71区域，其中67个certain区域（66对话+1说明）进入主指标，4个uncertain区域排除。评分器为同仓库scripts/evaluation/score.py，固定SHA与GT文件SHA见accuracy-summary.json；GT本身不公开。
