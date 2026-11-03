# Paddle v5 server 与 Latin/English 组件对照：公开复现材料

本目录仅交付冻结协议、脚本、资源来源和静态检查。**不包含本轮实验结果，不表示实验已完成，也不表示任何候选优于其他候选。** 请仅发布本目录，不要把相邻目录的旧结果或运行目录一起打包。

没有附带图片、实际输入清单、GT、完整预测、原始响应、模型权重或字符字典内容。调用者应自行准备有权使用的十张图片。没有原始私有数据和 GT，就不能复现原实验的具体准确率；可以复现此处的处理协议。

## 固定的六组

前四组由 `run_server_matrix.py` 顺序执行：

1. `v5_server_native960`：官方 v5 server det + rec。原图进入检测器内部长边 960、整数截断后 ceil128；识别裁剪来自原图；关闭外层缩放和垂直 padding。
2. `v5_server_common2048`：同样的 server det + rec，共同 2048 输入流程。
3. `v6small_det_server_rec_common2048`：v6 small det + v5 server rec，共同流程。
4. `server_det_v6medium_rec_common2048`：v5 server det + v6 medium rec，共同流程。

前四组终止后，`run_language_matrix.py` 顺序执行：

5. `small_det_latin_rec_common2048`：同一个 v6 small det + 官方 v5 Latin mobile rec。
6. `small_det_en_rec_common2048`：同一个 v6 small det + 已有 RapidAI 英文 v5 mobile rec 导出。

这不是本包之外所有 tiny、small、medium、large 或所有模型变体的完整枚举。RapidAI 导出和 PaddlePaddle 官方 ONNX 导出是不同制品，不能因模型家族相同就混用字节、字典或哈希，也不应计为额外的新模型家族。

## 冻结的处理流程

- 共同外层比例：`min(2048/min(h,w), 4096/max(h,w))`。高、宽分别 `max(1, round(original_dimension * ratio))`，使用 `cv2.INTER_LINEAR`。检测与识别裁剪使用同一张外层缩放后的图，保留 RapidOCR 默认垂直 padding。
- 共同检测器内部：RapidOCR 的 max4096/round32。server 检测器用适配器替换归一化，保留 BGR，按 float32 逐通道执行 alpha/beta 运算。native960 的内部 ceil128 不等同于共同流程。
- server DB：阈值 0.3、box 0.6、unclip 1.5、最多 1000 候选、不膨胀。v6 small DB：0.2、0.45、1.4、最多 3000、不膨胀。
- 两者采用均值 `[0.485,0.456,0.406]`、标准差 `[0.229,0.224,0.225]`；归一化实现的运算顺序不能因此视为可任意互换。
- 全组使用固定 `legacy_cls`、识别输入 `[3,48,320]`、batch 6、text score 0.5。RapidOCR 3.10.0，ONNX Runtime 1.23.2；线程设置为 1，OpenCV 线程设置为 1。
- server 字典：官方 YAML 的 18383 项，解码器另加 blank/space 后为 18385 类。Latin：836 项，加两项为 838 类。英文使用模型内嵌 436 项，加两项为 438 类，不替换成 Latin 字典。

`FROZEN-PROTOCOL.json` 与 `FROZEN-APPEND-PROTOCOL.json` 是公开化后的协议，不保留旧执行状态或探针结果。准确删除的 JSON 字段、原始和公开副本哈希见 `PUBLIC-COPY-CHANGES.json`。七份评测 Python 文件原字节不变；没有为了公开化修改算法或制造无意义的差异。协调器、worker 和适配器名称及相邻模块布局必须保留。

## 资源准备

使用 Linux 环境。`fcntl`、`/proc` 和进程 spawn 都是协议实现的依赖。`requirements-current.lock.txt` 是原运行环境的精确版本清单，未附 wheel 哈希、操作系统镜像或 Python 版本锁；它不是跨平台可安装性或二进制等价保证。本次打包没有重新安装环境。

```sh
python -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements-current.lock.txt
python prepare_assets.py --plan
```

明确需要下载时，再执行：

```sh
python prepare_assets.py --download --output ../private-run/models
```

准备器只读取本目录固定 SHA-256 的 `asset-lock.json`，不接受自定义模型 URL。七个模型约 275.7 MB，另有两个很小的 YAML。网络下载由调用者在自己的环境明确启动；本次材料制作**没有运行下载器、没有下载模型权重**。

每个文件都须通过固定字节数及 SHA-256 校验。官方模型 URL 使用固定 commit；RapidAI URL 使用版本标签，再由固定内容哈希阻止标签漂移。只允许 HTTPS，允许服务自身的 HTTPS CDN 重定向；对 HTTP 错误不换源、不绕过、不自动重试。已存在的文件必须匹配，否则停止，不覆盖。

server/Latin 字典只从固定官方 `inference.yml` 的 `PostProcess.character_dict` 按原列表顺序派生：UTF-8，各项以 LF 连接，末尾一个 LF。不排序、不过滤、不去重、不 strip、不做 Unicode 归一化，不在文件里添加 blank/space。YAML 源、派生字典均校验固定哈希和长度；源 URL、commit、源 SHA-256 和派生 SHA-256 在 `asset-lock.json` 中逐项记录。

准备器使用 `yaml.safe_load`，不下载或运行远端 Python，不加载任何 ONNX session。成功后只在调用者指定的本地目录写入 `models.local.json`，其中的路径是调用者本机路径，**该生成文件不属于可发布材料**。

## 自备十图并运行

`input-manifest.schema.json` 只是结构定义，不是实际图片清单。调用者自己创建 `../private-run/inputs.json`，恰好十项。每项包含 `id`、本地 `file`、原文件 `sha256`、`width`、`height`。ID 必须唯一，且仅含字母、数字、下划线或连字符。维度应与原图一致，所有输入须有权使用。

执行前停止其他重任务。使用新的、互不重叠的输出目录，所有相关进程共享同一把调用者本地锁；不要直接执行 worker engine 绕过协调器。

```sh
python run_server_matrix.py \
  --manifest ../private-run/inputs.json \
  --models ../private-run/models/models.local.json \
  --engine server_worker_engine.py \
  --output ../private-run/server-results \
  --lock ../private-run/inference.lock

python run_language_matrix.py \
  --manifest ../private-run/inputs.json \
  --models ../private-run/models/models.local.json \
  --engine language_worker_engine.py \
  --output ../private-run/language-results \
  --lock ../private-run/inference.lock
```

运行输出会包含识别文字、框、原始过滤前响应和本地路径，默认作为私有数据保管，不应随本目录发布。重跑会改变耗时和可能覆盖输出，因此必须使用新输出目录，并清楚区分首次单遍和额外重跑。

## 资源守护和分母

- 每组启动前 MemAvailable 至少 6 GiB。
- 运行中每 100 ms 采样，MemAvailable 低于 1.5 GiB，或协调器与 OCR worker RSS 同步求和超过 5 GiB，则停止当前组。
- 初始化和每张图各有 180 秒墙钟接收时限。每图一次，无预热；初始化和锁等待不计入图级引擎耗时。引擎墙钟包含图片解码、OCR 及原始结果/shape 观测开销。
- partial/blocked 保留已完成图片，对缺失项明确填错误与空结果。**分母始终是十个原始输入**，不得只对成功项重新计算为十图结果。
- RSS 求和可能重复统计共享页，且不包含辅助 tracker。采样有时间间隔；这些检查不是硬内存隔离、独占物理 CPU、容器配额保证或必然不会 OOM 的证明。

## 本次验证的边界与修复历史

初次打包只运行了 9 项静态测试，使用 `-B` 和 `PYTHONDONTWRITEBYTECODE=1` 禁止生成字节码；当时四项合成字典测试没有执行，不能把那次 9 项通过写成完整测试通过。

随后普通全发现实际运行 13 项：11 项通过、2 项失败。失败的是发布白名单和封存清单检查，它们误把测试自动生成的字节码缓存当成公开 payload。这不是推理结果失败，也不是四项合成字典测试失败。

修复只针对测试侧文件筛选：仅排除 `__pycache__` **直接子级**中符合标准缓存布局、扩展名为 `.pyc`、且能对应上级同目录真实非符号链接 `.py` 源码的缓存文件。不跳过整个缓存目录。根目录 `foo.pyc`、缓存目录未知 `.bin`/`.json`、无对应源码的 `.pyc`、非法缓存命名和更深子目录文件仍进入白名单或封存检查。

新增一项回归后，全套为 **14 项：10 项静态/包结构检查 + 4 项纯合成字典测试**。使用以下普通命令连续两次验证，不使用 `-B` 或 `PYTHONDONTWRITEBYTECODE`：

```sh
python -m unittest discover -s tests -v
python -m unittest discover -s tests -v
```

实际次数、结果和日志见 `STATIC-VALIDATION.json`。合成单测验证原顺序/重复字符/Unicode保留、重排拒绝、数字类型拒绝及换行拒绝；只导入本地准备器和 PyYAML，不下载资源，不导入评测 engine，不运行模型。

静态部分检查 AST/语法、元数据、源文件与清单哈希、发布白名单，以及生成清单的模型 path/sha256 和 dictionary.derived_path/derived_sha256/dictionary_entries 层级与两套 engine 的读取是否匹配。七份冻结评测源码保持原字节。没有读取用户图/GT/预测、实例化 ONNX session、获取实验锁、运行推理或编译 native 代码。

下载器网络行为、真实官方 YAML 派生、模型初始化、guard 的运行时触发、结果等价性和隔离性仍未验证。AST 方法体一致只能证明所比较的语法结构一致，不能证明运行等价。

`PUBLIC-FILES.json` 和 `SHA256SUMS.txt` 给出公开文件清单与内容哈希，**均不包含运行生成的字节码缓存**。验证后只清理本次测试生成且对应真实源码的标准缓存，不删除未知文件。发布时按清单复制文件。清单文件互相不做循环哈希：JSON 清单不包含自身和 SHA256SUMS；SHA256SUMS 包含 JSON 清单但不包含自身。

## 许可证

见 `THIRD-PARTY-NOTICES.md`、`license-sources.json` 和 `licenses/`。特别注意：PaddleX 适配器保留上游 2024 PaddlePaddle 版权及 Apache-2.0 声明，**不是 blanket MIT**。RapidOCR 3.10.0 是 Apache-2.0，ONNX Runtime 1.23.2 是 MIT，两者不可混为同一种许可。

官方 PaddlePaddle 模型/字典许可按原模型记录标为 Apache-2.0。RapidAI 原资产清单没有逐文件许可记录；固定版本的官方 ModelScope 仓库卡声明 Apache License 2.0，单列其证据与范围，不从 runtime 许可推导单个权重的许可。完整依赖及权重并未随本包再分发；若后续加入它们，需另行检查各自通知与再分发义务。

发布前仍需由发布方确认项目自有评测协调脚本/新增工具的发布许可证。本包不通过统一许可证替换第三方权利，也不包含已完成实验结论。
