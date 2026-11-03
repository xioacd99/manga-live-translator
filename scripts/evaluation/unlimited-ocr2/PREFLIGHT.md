# Unlimited-OCR-2：本地运行预检

核查时间：2026-11-03。范围是本地 CPU 可行性，不是漫画 OCR 准确率评测；没有读取或发送用户漫画。

## 当前结论

- 百度原版 Transformers 推理不能直接在本次无 CUDA 的 Linux 云电脑运行。前向路径有两个硬编码 `.cuda()`。这不是“必须有 80 GB GPU”的证据：官方 README 仅报告在 A800 80 GB 上测试。
- 不能简单把问题归咎于 FlashAttention/Triton。二代 DASH 的源码有纯 PyTorch attention fallback，Triton 分支也检查 `q.is_cuda`。但换设备还需处理视觉输入 dtype、CPU 算子与实际内存，尚未改写或运行官方远程 Python。
- 找到可正式尝试的低内存路线：MLX 官方 Linux x86 CPU 后端，加 MLX-VLM **0.7.11 的原生二代 DASH/page2d 实现**。该实现不是一代 R-SWA 的冒充。本轮已实际加载模型，但两页合成探针在 900 秒内没有首 token，尚未验证完整端到端执行。
- 官方 llama.cpp 已查的转换器里虽有同名 `UnlimitedOCRForCausalLM`，但示例指向一代，且注明 sliding-window 元数据不被 decoder 使用。未找到足以验证二代 DASH/page2d 正确执行的官方路线，所以不把同名架构当作二代支持。

## 固定来源与大小

1. 百度原版：`baidu/Unlimited-OCR-2`，revision `0480966938291445591f69f08a13b041c073a96a`。两个 safetensors 共 **6,688,305,576 bytes**；约 33.44 亿参数，主体为 BF16。纯权重约 6.23 GiB，FP32 副本仅权重就约 12.46 GiB，超过本次约 9.73 GiB 总内存。未下载大权重。
2. 候选量化：`mlx-community/Unlimited-OCR-2-4bit`，revision `ac04b808479927cc42ea82e06f55ebecd2b0a623`。这是社区衍生资产，不是百度官方发布的量化权重。模型文件 **2,459,096,904 bytes**，SHA256 `c623d9e83bf3f7035770beeb3110f57dc3ff4bf86e7ce871a858f840d329ed11`。卡片说明语言模型 4bit affine/group64，SAM、CLIP 和 DASH router 保留 BF16；不能把全模型都称为 4bit。
3. MLX-VLM v0.7.11 固定提交 `527c513a0768245644a70266a22126d880767b18`；MLX/MLX-CPU 均锁定 0.32.4。PyPI 依赖解析和逐包 SHA 已保存。所选依赖没有 PyTorch/CUDA 包。

短两页量化探针的 RSS 暂估约 3–6 GB，仅用于安排测试，不是已验证的运行需求。长文档缓存仍增长：DASH 减少 decode 的注意力读取，不代表 KV 总存储恒定。原版的标准 BF16 K/V 粗算为 61,440 bytes/token，不含 router/临时张量，131,072 tokens 仅该项约 7.5 GiB。

## 二代与接口证据

- `training_stage == "dash"` 在 MLX-VLM 触发二代路径。实现包含 page2d RoPE、每层 DASH router、32-token block、128-token local window，以及 12 个远端 block。原生输出格式为 `<PAGE>` 和 `<BLOCK>label[x0,y0,x1,y1]<FORK>text`。
- MLX-VLM 默认每页带动态裁切；百度原版 `infer_multi` 默认单个 1024 base view。低成本合成 smoke 明确使用 `cropping=False`，不能把该设置的结果包装成高精度整页评测。
- 百度二代 converter 的文档和正则以 `<PAGE><BLOCK>label<LEVELn>[x1,y1,x2,y2]<FORK>text` 为输出；其坐标检查将整数限制到 0–1000。该证据来自 2026-11-03 13:17:54–13:17:58 UTC 对 main 分支的只读核查，尚无固定 commit/hash；旧标签绘图 helper 的 `/999` 不能替代二代转换协议。
- 社区模型仓库同时含 Python 文件，但实际只下载了 safetensors、JSON 和 tokenizer 数据。加载使用已安装原生 MLX-VLM，显式 `trust_remote_code=False`，离线加载，不执行 HF Python。

## 许可与限制

- 百度模型卡标 MIT；原版若干派生源码保留 Apache-2.0 header，分发时仍需保留各文件原始声明，不能笼统称所有代码只有 MIT。
- MLX、MLX-VLM 为 MIT；社区量化卡标 MIT 并指向百度原模型。社区转换来源和量化方式可核，未独立证明逐张量数值等价。
- GitHub 的百度仓库 API 请求曾返回 HTTP 403，该请求已停止，没有换源绕过其拒绝。独立的 Hugging Face 官方模型页、配置与源码本身可公开读取。

## 精确来源

- [百度固定模型配置](https://huggingface.co/baidu/Unlimited-OCR-2/blob/0480966938291445591f69f08a13b041c073a96a/config.json)
- [原版前向 `.cuda()`](https://huggingface.co/baidu/Unlimited-OCR-2/blob/0480966938291445591f69f08a13b041c073a96a/modeling_unlimitedocr.py#L785-L789)
- [原版多页接口与缓存](https://huggingface.co/baidu/Unlimited-OCR-2/blob/0480966938291445591f69f08a13b041c073a96a/modeling_unlimitedocr.py#L1110-L1160)
- [原版 DASH fallback](https://huggingface.co/baidu/Unlimited-OCR-2/blob/0480966938291445591f69f08a13b041c073a96a/modeling_deepseekv2.py#L438-L451)
- [MLX 官方安装说明](https://github.com/ml-explore/mlx#installation)
- [MLX-VLM 二代支持合并记录](https://github.com/Blaizzy/mlx-vlm/pull/2601)；[0.7.11 发布](https://github.com/Blaizzy/mlx-vlm/releases/tag/v0.7.11)
- [MLX-VLM 固定二代说明](https://github.com/Blaizzy/mlx-vlm/blob/527c513a0768245644a70266a22126d880767b18/mlx_vlm/models/unlimited_ocr/README.md)
- [固定 DASH 实现](https://github.com/Blaizzy/mlx-vlm/blob/527c513a0768245644a70266a22126d880767b18/mlx_vlm/models/unlimited_ocr/dash.py#L54-L59)
- [固定原生 processor](https://github.com/Blaizzy/mlx-vlm/blob/527c513a0768245644a70266a22126d880767b18/mlx_vlm/models/unlimited_ocr/processing_unlimitedocr.py#L30-L59)
- [百度二代 BLOCK converter（main，读取日期见上）](https://github.com/baidu/Unlimited-OCR/blob/main/utils/process_unlimitedOCR2.py)
- [社区 4bit 固定来源和模型卡](https://huggingface.co/mlx-community/Unlimited-OCR-2-4bit/tree/ac04b808479927cc42ea82e06f55ebecd2b0a623)
- [llama.cpp 固定转换器的限制](https://github.com/ggml-org/llama.cpp/blob/8642541b255bfb5dc39cd351a178be09013a55d6/conversion/deepseek.py#L376-L380)

## 实验状态

静态预检和官方 CPU runtime 安装已完成。真实 `Device(cpu, 0)` 下，BF16 卷积、BF16 SDPA、CPU `mx.compile` 和 4bit×BF16 矩阵乘均在 `mx.eval`/同步后通过。第一版基础探针有输入通道维度笔误，修正后通过，失败日志保留；这不是后端算子失败。

十个白名单模型数据文件已下载并核验，模型目录没有 Python 文件。首次模型加载因探针传入 processor 不支持的 `local_files_only` 关键字而停止；移除该参数后，保留离线环境变量与禁 remote-code 约束，原生模型和 DASH attention 在新进程中成功加载。同步初始化 2.57 秒，加载时峰值 RSS 约 2.736 GB。该重试复用了操作系统文件缓存，不是严格冷盘测试。两页合成推理在 900.18 秒达到预设 900 秒进程上限并被终止，未返回首 token。采样峰值 RSS 为 4,608,626,688 bytes，未触及 6 GB 限制；观察到最多 13 个线程。没有 PAGE/BLOCK 输出可供解析，准确率未评。这只能说明本次 Linux CPU 环境未在既定界限内完成端到端探针，不能认定模型精度差或推断 Apple M4 表现。本次探针进程限制为 4 个逻辑 CPU 的 affinity，并设置 OMP/OpenBLAS/MKL 为 4；MLX 内部工作线程数尚无验证的控制接口，不能据此声称与 Paddle CPU1/CPU2 等资源公平对比。
