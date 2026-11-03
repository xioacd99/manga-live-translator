# 更高精度英文漫画 OCR：新增路线与许可筛选

核验日期：2026-11-03。仅阅读官方仓库、模型卡、论文及许可；本研究未下载或执行候选模型，未上传漫画，未联系作者。下列论文指标不是本项目十图得分。代码开源、模型可下载和产品可商用是三件不同的事。

## 建议

- **漫画领域最相关：Magi；当前不进入产品实验。** 英文译本漫画适配比通用文档模型更贴题，但官方模型限制非商业用途，须另行取得适用许可。
- **COMICS Text+：有直接漫画 OCR 论文，但权重许可未解决。** 包装器 MIT 不能代替原 checkpoint 授权；先不下载运行。
- **可继续推进通用、许可较清晰的 docTR 路线**，由本轮实测决定，不把官方文档或自然场景成绩说成漫画提升。注意词级检测/识别与当前行级 Paddle 的粒度差异。
- **Surya / Indra 暂排除本产品候选。** 不是仅看收入门槛：竞争条款无相同研究豁免，输出也有额外义务。
- PARSeq 原始模型、TrOCR 可列后备，但先解决输入粒度与明确 checkpoint 许可。不能为了凑“新方案”将词模型硬套整段，也不能以代码 MIT 推定所有派生权重都可商用。

## 1. COMICS Text+：FCENet + MASTER

官方[仓库](https://github.com/gsoykan/comics_text_plus)公开检测/识别 checkpoint 的 Google Drive 入口；其 README 许可部分仍是名称占位。另一个[comics_ocr 包装器](https://github.com/gsoykan/comics_ocr)标 MIT 并提供 CPU 安装选项，但没有因此解决原权重授权。调用链基于较旧的 MMOCR；FCENet/DCNv2 的算子与 CPU 支持仍需独立验证，不能承诺可直接在本环境运行。

[论文](https://arxiv.org/pdf/2212.14674)面向 Golden Age 西方漫画，而非现代英文译本漫画。表 5 的 MASTER 识别字符召回/精确率为 0.9962/0.9954，词准确率 0.9593；表 6 的 FCENet+MASTER 端到端忽略符号词准确率为 0.722、1−NED 为 0.9782。识别裁剪与完整检测流水线不能混为一谈，也不能用 1−NED 换算本项目 CER。领域训练值得借鉴，但高分不能证明迁移后仍优于 Paddle。

工程判断：如许可明确后再试，应保留检测多边形并映射原图，避免包装器只交付拼接字符串造成无法按几何公平评分。当前无实测 CPU 耗时、内存、M4 结果。

## 2. Magi v1 / v2 / v3

[官方项目](https://github.com/ragavsachdeva/magi)提供漫画中的文本、人物、分镜、说话者与阅读顺序分析；v1/v2 的 OCR 可使用检测文本框，v3 更统一地生成结构化信息。[v1 模型卡](https://huggingface.co/ragavsachdeva/magi)、[v2 模型卡](https://huggingface.co/ragavsachdeva/magiv2)、[v3 模型卡](https://huggingface.co/ragavsachdeva/magiv3)均将免费用途限于个人、研究、非商业、非营利，其他用途需单独许可。因此不作为 MIT 商业产品默认组件，不擅自联系作者。

[论文及附录](https://arxiv.org/html/2401.10224v2)的漫画人物/文本任务更贴近现代英文漫画；OCR 使用合成数据微调 TrOCR。但检测、人物关联、聚类成绩不等于完整漫画 OCR CER。本次未找到可直接与我们的固定十图口径等价的官方 OCR 分数。

v3 模型卡显示约 0.8B 参数、F16；示例使用 CUDA 和 trust_remote_code。这不是 CPU/M4 性能保证。即使另获许可，也需固定 revision、先静态审代码，再做离线合成接口与资源守卫验证；生成式输出须保存截断/解析失败，整页失败仍计全部 GT 分母，不能只报告成功页。

## 3. Surya 2.5 与 Indra：资源有吸引力，授权不能跳过

[Surya 官方仓库](https://github.com/datalab-to/surya)当前介绍 689M 文档 VLM，可经 llama.cpp 在 CPU/Apple Silicon 运行，输出带坐标和阅读顺序的内容。官方 OmniParseBench 85.9、olmOCR bench 83.7 是文档 benchmark，不是英文漫画准确率；没有本机实测。代码 Apache-2.0 不等于权重许可。

[Surya 完整模型条款](https://raw.githubusercontent.com/datalab-to/surya/master/MODEL_LICENSE)：收入/融资门槛为 500 万美元；Attachment A2c 对提供竞争产品/服务的主体施加任何目的限制，条款中的个人/研究例外只出现在 A2a/b；第 7、8 节还涉及署名及输出同许可。不能据“研究免费”为本 OCR 产品下载实验开绿灯。

[Indra 官方仓库](https://github.com/datalab-to/indra)和[模型卡](https://huggingface.co/datalab-to/indra-ocr)介绍 CPU ONNX 路线，默认网络合计约 7.3M 参数，默认下载约 76MB（其中语言模型约 46MB），可输出文本行及坐标。官方 OmniParseBench 66.7 和多核吞吐属于文档测试，不能挪作漫画结果。相比大 VLM，资源路线值得关注，但不是质量已证实更高。

[Indra 完整模型条款](https://huggingface.co/datalab-to/indra-ocr/blob/main/LICENSE)收入/融资门槛为 2000 万美元，而非 Surya 的 500 万；同样有 A2c 竞争限制以及第 8 节输出同许可。模型卡的 OpenRAIL 标签不足以描述这些附加限制。结论是本项目暂不采用，需适用的另行授权或专业许可审查；此处不是对用户主体是否构成竞争的法律判决。

## 4. 可行识别器后备与输入陷阱

### PARSeq

[作者仓库](https://github.com/baudm/parseq)主体 Apache-2.0，可选 CPU，提供预训练下载；[NOTICE](https://raw.githubusercontent.com/baudm/parseq/main/NOTICE)另列复现模型来源。应固定实际架构和 checkpoint，不能笼统把模型集合全称同一种授权。

[默认配置](https://raw.githubusercontent.com/baudm/parseq/main/configs/main.yaml)是 32×128、最长标签 25，数据预处理移除空白。这是词级场景识别设置；将现有 Paddle 的长行/多行气泡直接输入，可能天然丢空格、截断，不是公平的高精度方案。词切分与原图坐标需固定、不用 GT 调整。单独识别器不提供完整页检测坐标。无本十图实测。

### docTR 的 PARSeq / MASTER

[官方 docTR](https://github.com/mindee/doctr)项目为 Apache-2.0，提供检测后识别的词级流水线、词框、行块层次，以及 PARSeq/MASTER 等架构。这是比未知授权漫画 checkpoint 更适合继续核验的工程路线，但仍应归档所选权重来源、哈希及许可证，不依赖第三方转换模型卡代替原始证据。本轮应保留其原生词级框并按相同几何聚合评分，不能拿严格段落 IoU 惩罚细词框后宣称不准。

### TrOCR-large-printed / STR

[微软官方项目](https://github.com/microsoft/unilm/tree/master/trocr)列 558M large；打印票据 SROIE F1 96.60、IAM 手写 CER 2.89 属于不同模型和任务，不能当漫画成绩。它是识别器而非整页定位器。官方链接包含 printed 与 STR 权重，二者不可混名。

[项目根许可证](https://raw.githubusercontent.com/microsoft/unilm/master/LICENSE)是 MIT；[HF large-printed 模型卡](https://huggingface.co/microsoft/trocr-large-printed)描述单行输入及票据微调，卡本身没有清晰的单独权重许可字段。上游项目整体许可提供依据，但下载部署前仍应记录确切 artifact 及许可适用性，不能继承 Magi 漫画微调的限制权重后标 MIT。CPU 自回归逐行生成可能昂贵，现无本机成本测量。

## 5. 下一轮实验的不可变边界

1. 使用原十图 SHA 与冻结英文 GT；不因新模型不擅长老漫画而换图。与此同时明确：这十张历史漫画不足以代表现代英文漫画，新增现代集应独立预声明、合法取样、独立标注。
2. 方案/检测输入尺寸/阈值/词或行粒度/生成预算先冻结，先做不含 GT 的合成接口验证。不得看 GT 挑分词、框、字符串或最佳重复。
3. 同一几何规则 line-column-overlap-v2、CER/WER、S/D/I、空输出、未分配行框诊断；失败图保留分母。保留标点主分，去标点仅副指标。
4. 论文数值、成功子集、后验离线回退与全十图主成绩分开。此前 VL1.6 截断失败不能从分母删除。
5. 记录真实模型 revision/hash、预处理和坐标逆映射、字典、CPU 线程、wall 边界、内存及失败原因。单遍 pilot 不叫三次 warm benchmark，不跨 CPU1/CPU4 或云 CPU/M4 直接比速。
6. 实验不自动改变产品默认值。暂未获清晰适用许可的权重不先下载运行；无外部 OCR/VLM API、付费、联系作者或图片外传。

docTR的DB-ResNet50＋PARSeq随后已完成本轮同10图实测，结果与限制见[主报告](README.md)及[完整结果](RESULTS.md)。没有因为官方通用成绩较高就将其视为漫画优胜者。

## 研究边界

本报告是公开资料筛选，不是新模型实测排行榜或法律意见。已有 PaddleVL1.6、Qwen3VL、GLM 等通用 VLM 研究不重复算成新增漫画方案。未找到一个同时具备明确适用的宽松权重许可、可信现代英文漫画端到端高精度证据、以及本机可验证 CPU 资源预算的“直接替换必胜”模型；最有价值的下一步仍是对授权可行的不同结构做同集实测，而不是拼接不同论文的最高数字。

## 6. 追加核验：LightOnOCR-3-1B，许可更明确的生成式候选

[官方模型卡](https://huggingface.co/lightonai/LightOnOCR-3-1B)明确所有该系列模型以 Apache-2.0 供研究与商业使用。`grounding` 模式是真正的文本/标题等布局块加 0–1000 坐标，不只是图片位置；必须保留块的多行内容与类别，映射原图后评分。模型卡给出 Transformers 5 的 LightOnOcr 类，并示例 CPU/CUDA/MPS 设备选择；CPU 示例 BF16 的实际算子适配与速度仍须验证，不是已通过本环境。

[官方文件树](https://huggingface.co/lightonai/LightOnOCR-3-1B/tree/main)显示 revision 短号 23d5440，model.safetensors 约 2.01GB、仓库约 2.02GB；这是网站圆整大小，不是已下载校验的字节数或运行峰值内存。未下载权重。

[官方客户端 README](https://github.com/lightonai/LightOnOCR)给 1B 长边 1540px；推荐固定 vLLM 0.30.0 / Transformers 5.16.1，并警告其他版本可能不兼容或循环，建议 temperature 0.1 而不是 greedy。实验不应未经说明统一成温度零。必须预声明采样种子、重复次数、预算、失败分母。官方文档 benchmark 不能证明漫画更准。

当前核到的官方部署路线是 Transformers / vLLM；模型页的通用“量化版本”入口不是已验证的 llama.cpp 或 MLX 实现证据。本研究没有确认可直接复用现有本地运行时的转换权重和解析链，因此**不建议把它叫零成本合成小探针**，也没有自行下载 2GB 资产。下一步应先静态检查已缓存 runtime 的 architecture 支持及处理器，再由主任务决定是否值得独立资源受限验证。它比非商业 Magi 更有部署希望，但尚未测漫画准确率或云 CPU/M4 性能。
