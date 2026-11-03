# PaddleOCR-VL-1.6 本地整页 Spotting 复现脚本

本包把一次固定参数的十图实验整理为可检查、可携带的脚本。**公开版本没有重新运行模型**；它不是原冻结脚本的逐字副本。原 runner、parser、协议的 SHA256 与公开版本差异记录在 `provenance.json`。

包内只有代码、公开来源清单、哈希、许可依据和参数说明。不含模型、原图、标注、原始预测、响应或真实 OCR 全文。合成单测中的短字符串是现造的测试数据。

## 环境与文件准备

- Linux、Python 3.11 或更高版本，安装 `requirements.txt` 中固定的 Pillow 和 psutil。原实验使用 Python 3.12。
- 自行从 `upstream-sources.json` 中的官方固定链接取得 llama.cpp b11960 的 Linux x64 CPU 压缩包，并核验 SHA256 后解压。`--runtime` 指向含 `llama-server` 和随附动态库的目录。
- 同样取得两个官方固定 revision 的 GGUF 权重并核验 SHA256，置于模型目录。主权重 935,769,056 字节，原始视觉投影 881,770,560 字节。
- `sources-manifest.json` 含同十张公开历史漫画的来源链接、原始图片哈希、尺寸和相对路径。自行准备图片，并按照清单相对路径存放。脚本会在推理前核验全部图片哈希和尺寸；EN09 虽使用 `.jpg` 相对文件名，原始内容格式仍是 PNG，应保留原始字节，不转换格式。
- 确认来源页中适用于所在地域及使用方式的许可。本包未重新下载或转发任何图片。
- 不需要 torch、transformers、Paddle runtime 或模型 `remote_code`。

本包没有自动下载入口。不要执行未经检查的远程安装脚本。官方运行时代码采用 MIT，官方模型卡声明权重 Apache-2.0。附带 `LICENSE.llama.cpp` 保留上游 MIT 文本；来源和固定提交在 `upstream-sources.json`。这不替代产品发布时对全部依赖、权重和素材许可的审查。

## 修改视觉元数据副本

官方 `Spotting:` 用法要求视觉 `image_max_pixels` 为 1,605,632。只对经过固定哈希校验的文件进行四字节元数据修正，保留原始文件，不修改张量：

```sh
python patch_spotting_mmproj.py --models ./models
```

原始 mmproj SHA256：
`204d757d7610d9b3faab10d506d69e5b244e32bf765e2bab2d0167e65e0a058a`

修正副本 SHA256：
`8e011479092c5e82c8c1c2d85d52b9ac48df12183c5c7bc3190190732259db09`

目标文件存在但哈希不符时拒绝覆盖。该修正脚本不能用于不同 revision 或不同量化文件。

## 运行

以下是使用者在自行准备文件后执行的命令，不是本包静态检查时执行的步骤：

```sh
python run_eval.py \
  --manifest ./sources-manifest.json \
  --models ./models \
  --runtime ./llama-b11960 \
  --output ./new-local-run \
  --lock ./locks/inference.lock
```

五个路径参数均必填。清单中的相对图片路径按清单所在目录解析。必须使用新的输出目录；若已存在冻结协议，脚本拒绝静默重跑。不要使用 Python 的 `-O`，因为冻结代码使用断言执行多项校验。

输出中的图片、响应和识别结果只供本地诊断，可能含敏感内容，不应自动上传或随复现包公开。共享机器上应给所有重推理任务指定同一个锁文件。服务只监听 `127.0.0.1:18087`，关闭网页 UI；HTTP 客户端禁用代理，图像仅通过回环接口的内联数据传入，不请求外部推理 API。端口须未被占用。

## 保持的冻结实验语义

- 十图按 EN01–EN10 顺序，每张只请求一次，不读标注，不裁图、不拼块、不按单图调参、不自动重试。
- CPU 推理和批处理线程均为 4；8192 上下文、4096 最大输出；temperature 0、top-k 1、repeat penalty 1.0、seed 0。
- `Spotting:` 提示词、保留特殊 token、视觉最小/最大像素 112896/1605632；CPU-only，关闭模型空跑预热，禁用提示缓存，单请求槽。
- Pillow 转 RGB；仅当宽高都小于1500时按各轴2倍 Lanczos 放大，编码为 PNG。模型内部再执行动态像素预算。没有旋转、增强、文字对齐或依据识别结果的处理。
- 八个 LOC 值构成四角坐标，每轴范围0–1000；分别按**原图**宽高映射。前面的等比例2倍放大不会改变此坐标映射规则。
- `finish_reason` 不是 `stop`，或严格解析任一处失败，整页有效预测为空，保留原始响应和失败信息。不会截取成功前缀、删重复区域或补猜文字/坐标。
- 原解析函数只处理明确的 `</s>` 标记及边界空白，拒绝未知特殊标记、缺少坐标、范围越界及退化范围。它不保证模型生成的文本或定位正确。
- 接口不返回 OCR 置信度，因此 `confidence` 为 null。没有独立原始检测阶段。
- 保留每图 token 数、结束原因、客户端时延、API 内部时延和采样 RSS。服务在 `finally` 中停止并释放互斥锁。

完整数值参数见 `protocol-config.json`；它只用于检查固定配置，不是可自由调参的入口。

## 计时与失败解释

原比较对象用 CPU1，本版本按冻结实验使用 CPU4，因此不能直接宣称公平的同线程速度提升。每个不同页面只测一次：后续页面复用已加载模型，**不是同图多次 warm 测量**，不能伪称三遍 warm 均值。

`request_wall_seconds` 排除原图 RGB、Lanczos 和 PNG 预处理，但包含收到响应后的落盘和解析。`input_preparation_plus_request_wall_seconds` 只额外包含准备好的 PNG 读取及 base64 处理，不能称为完整端到端页面时延。模型初始化单独记录。

单请求超时固定900秒。公开版本保留原 runner 的异常处理；若发生超时，应先检查服务是否取消旧请求以及后续请求是否排队，不应把受污染的后续时间解释为纯推理耗时。原实验未触发此情况。此次只做路径参数化，没有以修复之名暗改异常处理。

## 输出结构投影

原 runner 保留旧实验输出结构中的空 `detectorRegions`。如使用会在该键缺失时回退到最终区域的既有评分器，可以显式生成一个新文件：

```sh
python project_for_scoring.py \
  --input ./new-local-run/predictions.json \
  --output ./new-local-run/predictions-spotting-projection.json
```

此操作只删除每图空 `detectorRegions`，保留全部文字、坐标和失败状态，并记录输入/输出哈希。定位指标应称为最终 Spotting 区域的诊断，不能冒称独立 DB 原始检测召回。投影文件不包含在本公开包中。

## 无模型静态检查

```sh
python -m py_compile run_eval.py parse_spotting.py patch_spotting_mmproj.py project_for_scoring.py test_parser.py test_runtime_contract.py
python -m unittest -v test_parser.py test_runtime_contract.py
python run_eval.py --help
python patch_spotting_mmproj.py --help
python project_for_scoring.py --help
```

合成单测覆盖直接格式、包装格式、原尺寸映射、多区域和整页严格拒绝条件；另外静态检查运行时/模型路径分离以及固定命令、请求预算，不会读取真实图片、模型、GT 或原始识别结果。静态通过不等于公开版本已经完成真实推理复验。

文件清单和各文件 SHA256 见 `SHA256SUMS`。文件自身不列入自己的校验清单。
