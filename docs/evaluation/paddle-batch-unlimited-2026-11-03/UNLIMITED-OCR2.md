# Unlimited-OCR 2 与英文漫画翻译：候选核实

查阅日期：2026-11-03。本文核实公开资料与部署路线，不包含漫画识别实测。另已完成[Linux CPU两页合成探针](UNLIMITED-RUNTIME.md)：模型成功加载，但900秒无首token，按冻结上限停止，未得到漫画精度结果。

## 项目识别

“新的 ultimate ocr、一次能传很多”很可能指百度 **Unlimited-OCR 2**：名称相近，且多页连续解析正是其核心功能。这个判断足以继续做接口和运行条件验证，但不是对用户原意的确定认定。官方于2026-10-27发布二代；论文确切标题是 [Unlimited OCR Works 2](https://arxiv.org/abs/2610.39308)，arXiv 首次提交10月29日、当前v2修订10月30日。论文研究的是长文档解析，并未给出英文漫画专项准确率。

## “一次很多”的三个含义

| 机制 | 实际含义 | 漫画项目注意点 |
|---|---|---|
| 多页单请求 | infer_multi 接收有序图片列表，一次生成，用 `<PAGE>` 分隔各页 | 可利用跨页信息；仍需检查漏页、错序和重复 |
| 请求并发 | SGLang 同时服务多个文档请求 | 吞吐受显存和调度影响，不等于每页更快 |
| 页窗口调度 | 超长文档按页窗口推进并复用上下文 | 较小窗口降低峰值内存，但可能损伤跨窗口内容衔接 |

[官方 README](https://github.com/baidu/Unlimited-OCR) 明确：Transformers 的多页模式每页使用一个全局视图，单页模式默认动态切块。**多页输入不保证漫画识别更准**；小字、倾斜字和拟声词可能更需要高分辨率局部处理。应对同一组漫画比较逐页和多页结果，不能以文档榜单代替漫画测试。

## 模型、许可与坐标

[模型卡](https://huggingface.co/baidu/Unlimited-OCR-2) 标为3B级BF16模型。本次读取官方HF元数据得到权重总字节数 **6,688,305,576 B**、约 **3.344B** 参数；[文件列表](https://huggingface.co/baidu/Unlimited-OCR-2/tree/main) 显示两个权重分片约5GB与1.69GB。磁盘大小不等于推理内存，还需视觉编码、缓存和系统余量。

代码的 [LICENSE](https://github.com/baidu/Unlimited-OCR/blob/main/LICENSE) 是MIT；权重的官方HF模型卡也单独标注MIT，两者应分别记录。配置显示12层MoE解码器，64个路由专家、2个共享专家，每token选择6个路由专家，并使用SAM/CLIP视觉组件和SR-SWA。

**输出格式更正（2026-11-03复核）：** 二代原生输出为 `<PAGE><BLOCK>label[x1,y1,x2,y2]<FORK>text`，标题可含 `<LEVELn>`，跨页段落含 `cross_text` / `append_text` 等标签。它不是直接输出Markdown。[百度官方二代转换脚本](https://github.com/baidu/Unlimited-OCR/blob/main/utils/process_unlimitedOCR2.py) 明确说明该格式，并将框坐标限制在 **0–1000**；集成时应采用二代坐标约定，不沿用一代的 `/999`。

先前依据 [modeling_unlimitedocr.py](https://huggingface.co/baidu/Unlimited-OCR-2/blob/main/modeling_unlimitedocr.py) 中旧式 `<|det|>` 和 `/999` 可视化helper，推断二代必然使用该输出格式，证据不足，现撤回该推断。存在旧parser不能证明模型实际输出格式。该helper确实使用 `eval`，不应照抄；二代转换脚本则使用正则及整数转换。项目应使用严格解析、数值范围和框顺序检查，保留原始输出供核查。

有框不等于漫画气泡mask，也不保证可直接擦字。保存页号、框、原文和人工修订，优先验证对白边界及阅读顺序。

## M4 16GB 与部署路径

| 方案 | 已核实支持 | 尚不能承诺 |
|---|---|---|
| 二代官方实现 | Transformers、定制SGLang；官方示例CUDA，测试机A800 80GB | A800不是最低配置；没有官方M4 16GB稳定性和速度数据 |
| 一代Apple移植 | [FluidInference](https://huggingface.co/FluidInference/unlimited-ocr-mlx-coreml)：macOS15+，Swift、MLX/CoreML，离线，多页最高16张 | 这是**一代**，不是二代；M5 Pro 24GB性能不能套给M4 |
| 二代MLX-VLM实现 | [实现方README](https://github.com/Blaizzy/mlx-vlm/blob/main/mlx_vlm/models/unlimited_ocr/README.md) 明确支持二代与BLOCK/FORK格式，多页默认也使用gundam tiles | 不同于官方Transformers多页base；仍未在M4 16GB实测，不能承诺精度或速度 |

官方模型可自托管，并非只能用云API；项目也提供百度云及网页demo入口。OpenAI兼容API可以是本机服务，不代表必然上传第三方。未找到官方纯浏览器本地推理方案，浏览器界面与模型运行位置应分开说明。

建议MVP先实现多图导入、受控队列及可替换OCR后端，用真实漫画检查漏字、阅读顺序和回填框，再决定是否启用整章单请求。本次云环境无CUDA；是否能走CPU或其他路径成功运行，见配套的运行条件核验记录，本文不把资料核实当作已运行验证。
