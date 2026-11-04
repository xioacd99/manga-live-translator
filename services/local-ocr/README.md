# 本地原生 OCR 服务

这是需单独安装、手动启动的 Python 伴随服务，不是零安装的浏览器内推理。只监听 `127.0.0.1`，不接受远程图片 URL，不向模型站点或翻译服务发送漫画。下载器只请求下面四份固定的公共权重；OCR/气泡检测只使用本地已校验资产。

## 安装和首次使用

需要 Python **3.12 或 3.13**。当前真实验证环境是 Linux x86_64/Python 3.12/CPU；尚未验证 Windows、macOS 或 Apple M4 性能。若当前平台没有这些固定版本的 wheel，不要悄悄换版本，应作为兼容性问题另行验证。

在仓库根目录执行：

```sh
python3.12 -m venv .venv-local-ocr
. .venv-local-ocr/bin/activate
python -m pip install -r services/local-ocr/requirements.lock.txt -e services/local-ocr
manga-local-ocr --extension-id aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
```

把示例 ID 替换为 `chrome://extensions` 中此扩展的真实 32 位 ID；多个已批准扩展可重复传入 `--extension-id`。服务不允许 `*`、普通网页 Origin、`null`、`localhost` Host 或远程监听地址。Windows 可在 PowerShell 用 `.venv-local-ocr\Scripts\Activate.ps1` 激活环境。

1. 首次启动生成随机 256-bit Bearer 令牌，**不会下载模型**。终端只显示服务地址和令牌文件路径，不显示令牌值。
2. 在本机打开该令牌文件，将值粘贴到扩展的本地服务令牌设置。不要把令牌写进 URL、仓库、截图或聊天。POSIX 文件权限必须是 `0600`；Windows 应使用当前用户私有目录与 ACL。
3. 服务地址默认 `http://127.0.0.1:8787`。可用 `--port` 改端口，扩展设置须一致。浏览器若要求局域网/本地网络权限，需由用户按浏览器提示批准；HTTP CORS 头不代替浏览器权限。
4. 在扩展中主动选择下载模型；状态接口持续提供逐模型和总字节进度。四份权重总计 **307,816,501 字节（约 293.56 MiB）**。已下载且 SHA-256 正确的模型会复用。OCR 三模型合计 139,334,970 字节，其余为 FP32 RT-DETR。
5. 图片只在进程内暂存，处理后释放引用。服务不保存图片、OCR 全文、访问日志或错误 traceback。它不持久保存阅读结果，也不自动启动系统服务。按 Ctrl+C 停止；首次识别另有模型初始化成本。

默认缓存目录：Linux `${XDG_CACHE_HOME:-~/.cache}/manga-live-translator/local-ocr/models`，macOS `~/Library/Caches/manga-live-translator/local-ocr/models`，Windows `%LOCALAPPDATA%\manga-live-translator\local-ocr\models`。可用 `--cache-dir` 指定。令牌位于同名应用数据目录：Linux `${XDG_DATA_HOME:-~/.local/share}`，macOS `~/Library/Application Support`，Windows `%LOCALAPPDATA%`，后接 `manga-live-translator/local-ocr/token`；可用 `--token-file` 指定。

## 四份模型、两个推理模块

**OCR 模块**采用 RapidOCR 3.10.0 的 PP-OCRv6 medium 检测 + legacy 方向分类 + PP-OCRv6 medium 多语识别。ONNX Runtime 1.23.2 CPU 执行，单线程。固定的原生基线是短边 1536、长边上限 4096、OpenCV 双线性缩放、检测张量 round32 对齐；ImageNet mean `.485/.456/.406`、std `.229/.224/.225`；DB thresh `.2`、box `.45`、unclip `1.4`、max_candidates `3000`、不膨胀；识别 batch `6`、文本阈值 `.5`。识别字典读取已校验 ONNX 的内嵌 metadata，且另校验字典 SHA-256。没有把不同参数的浏览器 WASM 结果当作这条原生流水线。

**实验性气泡框模块**采用 `ogkalu/comic-text-and-bubble-detector` 固定修订的 **detector.onnx FP32（168,481,531 字节）**，不是旧的 11 MB `detector-v4-s_int8.onnx`。RGB、PIL BICUBIC resize 640×640、除以 255、NCHW float32；`orig_target_sizes=[[width,height]]`，bubble 类别 `0`、阈值 `.5`、CPU 单线程、整页不切片。只输出框，不输出像素 mask，不做修复。OCR 仍处理整页，不按这些框裁掉未匹配文字。

分组、阅读顺序、文本翻译与覆盖排版在扩展核心中进行，不在此服务里执行。OCR 返回原始行 polygon 和稳定行 ID；分组不能被误称为更高 OCR 识字率。

`config.py` 记录全部模型 URL、字节数、SHA-256 和生效参数。`modelRevision` / `detectorRevision` 是精确模型哈希、配置、固定运行依赖版本的 SHA-256 身份；修改算法或模型时更改相应配置/输出修订，避免复用旧缓存。两个模型模块均首次使用时初始化，之后驻留复用；同时加载会增加进程内存，模型文件大小不等于运行内存。没有给未实测平台承诺时延或内存指标。

## HTTP v1 契约

所有实际请求都需 `Authorization: Bearer <token>`。精确 Host 为 `127.0.0.1:<port>`。有 Origin 时必须精确匹配 CLI 配置的 `chrome-extension://<id>`；允许无 Origin 的本机命令行调用，但仍需令牌与正确 Host。没有无认证的 health/status。所有响应 `Cache-Control: no-store`。

- `GET /health`、`GET /status`：返回同一不含秘密的状态对象，包括 `protocolVersion:1`、`ready`（OCR 资产已校验）、`detectorReady`、`activeOperation`、`engine:{ocr,detector}`（`loaded/unloaded`）、两个算法修订、资源限制和 `download`。
- `POST /models/download`：空 body 或 JSON `{"components":["ocr","detector"]}`，202 返回 `{started,download}`。省略 components 下载两组；可只选一组。禁止额外 URL、路径或模型参数。此操作显式开始后台下载，重复点击不创建并行下载。
- `POST /models/cancel`：空 body 或 `{}`，停止下载，已校验完整模型保留，当前 `.part` 文件删除；网络读取中取消最多等待当前 socket timeout（20 秒）。强制终止进程可能遗留 `.download-*.part`，可在所有服务停止后手动删除。
- `POST /cancel`：空 body 或 `{}`，也将正在处理的 OCR/检测结果标记作废。已运行的 ORT kernel 无法安全中断，返回前丢弃结果；锁仍占用到执行结束，不承诺即刻释放 CPU。
- `POST /ocr`：原始 JPEG/PNG/WebP/BMP 字节，准确的对应 `Content-Type` 和 `Content-Length`。返回 `{regions,width,height,sha256,engineSeconds,modelRevision}`。每行 `{regionId,bbox:{x,y,width,height},polygon:[{x,y},...],sourceText,confidence,readingOrder}`；坐标为源图像像素，`readingOrder` 保留引擎顺序，不冒称漫画阅读顺序。
- `POST /detect`：同样的原始图片请求，返回 `{regions,width,height,sha256,engineSeconds,detectorRevision,experimental:true}`。每框 `{regionId,bbox,confidence,readingOrder}`，没有虚构的识别文字。

`download` 包含 `state`（`idle/downloading/cancelling/completed/cancelled/error`）、固定错误码或 null、`bytesDownloaded`、`bytesTotal`、`models`。每模型含 `id/component/bytesTotal/bytesDownloaded/sha256/state`，state 为 `missing/downloading/cached`。总进度包括未选择下载的模型，逐模型状态可以区分已完成 OCR 与尚未选择的气泡模型。`ready` 不代表模型已初始化，第一条推理会加载。

仅上述路由支持精确预检 OPTIONS；请求方法必须匹配，允许头仅 Authorization 和 Content-Type。支持经过 Origin/Host 校验的 Private Network Access 预检；没有通配 CORS。

## 资源和错误边界

- 接收图片最多 **4 MiB、16,000,000 像素、单边 16,384、长宽比 128:1**。先手工读取 PNG/JPEG/BMP/WebP 容器尺寸（尤其在 WebP 画布创建前），再用 Pillow 验证容器，最后调用 OpenCV 解码；不支持动画、HTML、SVG、PDF、base64 JSON、文件路径或图片 URL。EXIF 方向由 OpenCV 按原生基线处理，返回实际解码后的尺寸。
- HTTP 最多 8 个处理线程；OCR 和气泡检测共用 **1 个推理槽、0 个排队槽**。忙时返回 429，不会把任意数量的压缩图片解码后排队。请求体有限大小和总读取时间，拒绝分块传输、重复关键头、缺失或冲突长度。客户端应自行有界排队，不要无上限重试。
- 输出最多 256 区域、每区 8192 字符、总 UTF-8 文字 256 KiB。超过上限显式失败，不截断后冒称完整成功。行 ID 基于坐标/文字哈希，不因返回列表排序而改变。
- 常用状态：401 令牌错误；403 Host/Origin 拒绝；409 模型未就绪或推理已取消；413 字节/尺寸超限；415 不支持格式；422 无效图或结果超限；429 推理忙；503 运行依赖/模型问题。响应只含固定 `error` 码，不输出原始异常、模型下载签名 URL、路径、令牌或图片数据。
- 下载只用固定 HTTPS 源和已知 CDN 允许列表，保留标准环境代理支持，限制时间/字节并 SHA-256 校验后原子改名；无用户 URL 代理。RapidOCR 的隐式下载函数被禁止。若上游更换 CDN，不扩大到任意重定向，应先核验来源再改允许列表。
- 环回认证不能抵御同一用户权限的恶意本机程序、被攻陷的扩展或操作系统；不要公开转发此端口。模型目录须由当前用户管理，不是运行任意上传 ONNX 的服务。

## 验证

无需模型下载的协议、下载器和取消测试（需要 Pillow）：

```sh
python -m unittest discover -s services/local-ocr/tests -v
```

真实四模型、原创合成图片、真实环回 HTTP 冒烟（明确允许下载约 294 MiB 权重）：

```sh
PYTHONPATH=services/local-ocr python services/local-ocr/tests/smoke_real_models.py --download --output artifacts/native-real-model-smoke.json
```

已缓存时去掉 `--download`；指定现有缓存可加 `--cache-dir`。如运行环境禁止开监听 socket，可明确使用 `--in-process` 只检验真实模型，不得声称完成 HTTP 或浏览器验证。脚本只写计数、模型身份与计时摘要，不落盘图片或 OCR 全文。OCR 必须实际识别出原创 `HELLO WORLD`；气泡检测运行真实模型，但合成图不要求任意固定框数，以免把测试夹具充当真实漫画质量门槛。

本地协议单元测试、真实模型冒烟、真实 Chromium 扩展集成与真实漫画质量评估是四种不同证据；合成/模拟服务不能替代后两者。取消的 ORT 计算和首次模型初始化应单独计时，不能把首次调用成本隐藏在性能数字外。

### 本次开发验证（2026-11-04）

- 39 项协议/安全/生命周期测试通过，其中 5 项走真实环回 HTTP，但推理使用合成替身。
- [真实模型合成图 HTTP 冒烟摘要](evidence/native-real-model-smoke.json)：固定四份资产实际加载，原创 `HELLO WORLD` 识别通过，真实 RT-DETR 调用完成；不等于真实浏览器集成验收。
- [原十图精确回归摘要](evidence/native-regression-10.json)：新服务的 680 个 OCR 行在文字、bbox、polygon、置信度与原常驻 Python 基线逐项一致；126 个气泡框/置信度与原 FP32 RT-DETR 实测逐项一致。原冻结 GT 独立复算 CER 13.4537%、WER 39.6552%，没有声称改进原有识字率。
- EN09 历史文件名为 `.jpg`，实际字节是 PNG；首次测试脚本错误发送 JPEG MIME 被服务正确拒绝。修正测试请求后对同一字节继续验证，未删除失败样本，也未放宽生产格式检查。原图、GT 和预测全文均未加入仓库。
- 完成 source wheel 构建；没有验证所有平台安装器、macOS/M4 性能、翻译质量或气泡像素级分割。

## 许可证与固定来源

项目自有服务源码 MIT；第三方依赖和模型保持各自许可，完整上游通知在 [notices](notices/)；来源和限制见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。本目录不分发权重和 wheel。`requirements.lock.txt` 固定本次验证的直接与传递依赖版本；它不是跨平台 wheel SHA 锁或二进制可复现证明。不要在未重新验证参数、模型与依赖行为时升级为浮动版本。
