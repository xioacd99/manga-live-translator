# Unlimited-OCR-2：Linux CPU 两页合成探针

本包复现一次**有界可行性测试**，不是漫画准确率测试。两张示例页由 Pillow 生成，不含用户内容。最终状态见 `RESULT.md` 和 `result-summary.json`。

## 固定环境与模型

- Python 3.12、Linux x86_64；本次云电脑 AMD EPYC，9 个逻辑 CPU、总内存约 9.73 GiB。
- 官方 PyPI `mlx==0.32.4`、`mlx-cpu==0.32.4`、`mlx-vlm==0.7.11`。`requirements.lock` 固定全部 73 个 wheel 的版本和 SHA256；没有 PyTorch/CUDA 包。运行时与模型许可/来源见 `provenance.json`。
- 原生 MLX-VLM 0.7.11 的二代 DASH/page2d 路径，不是一代 R-SWA。实际加载后验证第一层类型为 `DashAttention`。
- `mlx-community/Unlimited-OCR-2-4bit` 是社区量化，不是百度官方量化。固定 revision `ac04b808479927cc42ea82e06f55ebecd2b0a623`，权重 2,459,096,904 bytes，SHA256 `c623d9e83bf3f7035770beeb3110f57dc3ff4bf86e7ce871a858f840d329ed11`。
- 语言模型使用 4bit affine/group64；SAM、CLIP 和 DASH router 仍为 BF16。

## 复现命令

先建立独立环境，避免修改产品或系统默认环境：

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install --index-url https://pypi.org/simple \
  --only-binary=:all: --require-hashes -r requirements.lock

# 若与其他基准共享 CPU，基础算子检查也应使用同一把锁。
flock /tmp/ocr-inference.lock env OMP_NUM_THREADS=4 OPENBLAS_NUM_THREADS=4 \
  MKL_NUM_THREADS=4 .venv/bin/python cpu_ops_probe.py

# 仅下载固定提交的十个数据文件；不下载任何模型仓库 Python。
python download_model.py --output ./models

.venv/bin/python run_guarded_probe.py \
  --models ./models --output ./run --lock /tmp/ocr-inference.lock
```

需要 Pillow 能找到 `/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf`。这是系统字体路径，不是用户文件。若系统没有该字体，先按发行版正规方式安装 DejaVu Sans；不要替换字体后仍声称与本次图像完全相同。附带的 `page_1.png`、`page_2.png` 是本次实际生成样张。

下载失败会原样停止，不自动换源或绕过 HTTP 拒绝。下载脚本按固定 metadata 验证 LFS SHA256 或 Git blob SHA1，并另记每个文件 SHA256。

## 已冻结的测试范围

- 一次请求，两张 768×512 的合成页，每页两行大字。
- 提示 `Multi page parsing.`；原生 processor 生成 `<PAGE><image>` 布局。
- `cropping=False`，每页 1024 base view；这与 MLX 默认动态裁切不同，不能把本探针包装成高精度整页协议。
- greedy/temperature 0，最多 256 输出 tokens，prefill step 2048；保留特殊 tokens，不加重复抑制、不补文本或坐标。
- 进程 affinity 限制在前 4 个可用逻辑 CPU；OMP/OpenBLAS/MKL 各设 4。**未验证 MLX 内部工作线程数能由这些环境变量限制**，不能称与 Paddle CPU1/CPU2 公平等资源计时。
- 子进程整体 900 秒上限，主进程 RSS 每 0.1 秒采样，超过 6,000,000,000 bytes 终止。监护器在结束时保存 RSS 样本与最终原因。
- 加载使用本地目录、`trust_remote_code=False`、离线环境变量，并额外阻断 HF 动态 Python 加载入口；模型目录断言没有 `.py`。不用云 API，不上传图，不启动服务。

## 计时、失败与输出解释

模型初始化结束前执行 `mx.eval(model.parameters())` 和同步。请求计时包括本轮图片预处理、视觉编码与文本生成；计时前后同步，结束时还同步 generation stream。程序启动/import/合成图绘制另有阶段记录。

首次加载测试因额外传入 `local_files_only` 后被原生 processor 透传为未知关键字而失败，未进入视觉推理。移除该不支持的关键字后，仍保持离线环境和 remote-code 禁止。第二次是新进程加载，但操作系统文件缓存已预热，不是冷盘测试。没有做三遍 warm benchmark。

本次不对推理前半段细分计时，也未实时保存 CPU 利用率；没有首 token 不能单凭等待时间区分纯计算缓慢与内部阻塞。若达到上限，应记作“该环境在既定界限内无法完成可行性验证”，不能记作模型 OCR 准确率差，也不能推断 Apple M4 同样失败。

若有输出，保留 `<PAGE>`、`<BLOCK>`、`<FORK>`、完整 token IDs、结束原因和原始文本。正式计分前仍需冻结二代 converter、页对应和坐标映射。不能将旧版 `<|det|>` helper 的 `/999` 规则直接套在二代 BLOCK 上。

公开脚本只将本轮执行脚本的路径参数化并调整 manifest 所在位置，没有用公开版再跑推理。原始脚本 SHA 与差异见 `provenance.json`；公开版本有自己的 SHA256SUMS，不冒充原始文件同哈希。
