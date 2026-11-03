# 最终记录：模型加载成功，双页探针超时

2026-11-03，Linux x86 CPU，两个合成英文大字页，一次请求。

## 实测

- 官方 MLX CPU 基础检查通过：BF16 卷积、BF16 SDPA、`mx.compile`、4bit×BF16 矩阵乘。均在 `mx.eval` 和同步后验证。
- 真正加载了原生 Unlimited-OCR-2，第一层为 `mlx_vlm.models.unlimited_ocr.dash.DashAttention`，不是一代替代实现。
- 同步模型初始化 **2.5707 秒**；该阶段最大 RSS **2,736,418,816 bytes**。这是新进程初始化，但此前失败加载已预热文件缓存，不能称为严格冷盘测试。
- 两页请求到 **900.184 秒进程总时限**仍未返回首 token，监护器按预设界限发 SIGTERM，子进程退出码 -15。输出 token 记录 **0**，无 PAGE/BLOCK 可解析，内容正确性及漫画精度均**未评**。
- 主进程峰值采样 RSS **4,608,626,688 bytes（约 4.61 GB）**，8952 次采样，间隔目标 0.1 秒；未达到 6 GB 限制。峰值发生在进程约 340.02 秒处，最后采样约 2.90 GB。
- 实际 `Device(cpu, 0)`；进程 affinity 为 4 个逻辑 CPU，观察到最多 13 个线程。未验证 MLX 内部线程控制，未采集 CPU 利用率，不能与 Paddle CPU1/CPU2 作等资源速度比较。
- 模型初始化与请求边界设有同步，但请求未正常返回，不能给出一个完成的推理时延。未拆分图像预处理、视觉编码和文本 prefill，也无法仅凭等待时间判断内部计算极慢还是等待/阻塞。

## 解释边界

本轮结果是：**该 Linux CPU 环境未在冻结的内存与时间界限内完成双页端到端可行性验证**。它不是模型准确率差的证据，也不是 Apple M4 的实测结果。没有自动扩展到真实漫画、增加预算、改变注意力实现或换云 API。

首次尝试因探针多传了 `local_files_only`，原生 processor 将其透传到 Transformers 构造器后报未知关键字；那次未开始视觉推理。第二次只移除此不兼容参数，仍保留本地目录、离线环境变量、`trust_remote_code=False`、HF 动态代码入口阻断，未改模型代码或权重。所有任务进程已停止，共享推理锁已释放。

## 来源和可复现性

- [MLX-VLM v0.7.11 二代原生实现](https://github.com/Blaizzy/mlx-vlm/blob/527c513a0768245644a70266a22126d880767b18/mlx_vlm/models/unlimited_ocr/README.md)
- [官方 MLX CPU 安装入口](https://github.com/ml-explore/mlx#installation)
- [社区 4bit 固定权重](https://huggingface.co/mlx-community/Unlimited-OCR-2-4bit/tree/ac04b808479927cc42ea82e06f55ebecd2b0a623)
- [百度原版固定配置](https://huggingface.co/baidu/Unlimited-OCR-2/blob/0480966938291445591f69f08a13b041c073a96a/config.json)

[最小复现包与合成样张](../../../scripts/evaluation/unlimited-ocr2/README.md)包含完整命令和固定依赖。

包内 `result-summary.json` 是数值记录；`protocol.json` 是本轮执行参数；`provenance.json` 保留原始 runner SHA、公开版本差异和许可来源；`requirements.lock` 固定安装包版本及哈希。公开脚本仅路径参数化，未重新推理。静态检查：5 个 Python 文件可编译、3 个 CLI help 通过、6 个协议测试通过。包内只有脚本、配置、说明、合成样张，没有权重、用户漫画、GT 或真实漫画预测。
