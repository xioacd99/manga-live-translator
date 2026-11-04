# Python 本地流水线：实现与验收

2026-11-04，dev 开发实现，不代表 main 发布或生产质量验收。

## 变化

此前浏览器 Tesseract / RT-DETR int8 是早期预览。当前改为 Python 常驻进程：固定 PP-OCRv6 medium1536 参数、完整三模型 OCR、与本轮研究相同的 RT-DETR FP32 权重。浏览器只负责取图、鉴权调用本机服务、归组/顺序、授权文本翻译、缓存与可撤销排版。没有采用此前实验性 JS/WASM Paddle 路径。

算法清单与入口见根 README 的八模块表；精确模型哈希、版本、参数见服务 `config.py`。改算法需更新版本身份，而不是改名称沿用缓存。

## 数据路径与隐私

1. 用户在扩展中明确启用当前文档，配置额外图片CDN权限。公开图片请求无Cookie、无Referer且拒绝重定向；不支持登录图、iframe/canvas提取。
2. 扩展在发送本机服务前检查编码头、4MiB字节/1600万像素预算。只有保存在扩展受信任会话中的固定127.0.0.1端点和令牌可以用于请求。网页不能修改目的地址或拿到密钥。
3. Python 仅监听IPv4环回，验证Host、Bearer与存在的Origin，不是公开网关。没有通用URL代理。推理有界串行，未完成内核不能强杀，取消只丢弃迟到结果。浏览器中止HTTP不会停止已运行的原生内核，后续请求在其结束前可能得到429忙状态，需稍后手动重试。
4. 模型下载必须主动触发，仅访问固定发布源及允许CDN。完整字节数与SHA-256均验证后才原子缓存；图片不经过模型下载路径。
5. 本地准备只产生OCR/气泡结果。翻译须单独保存授权，只有有序对白文本、手填上下文和术语表离开设备。没有Magpie接入或云图像OCR。
6. 密钥只存扩展受信任会话，不进入页面脚本、缓存键或日志。阅读缓存为内存，模型权重独立缓存。浏览器重启需要重新填写凭据。

## 缓存与中断

原始OCR键包含图片哈希、模型/运行库/预处理修订。气泡输出不污染整页OCR键。归组键包含气泡几何、分组与顺序版本；译文键还包含组文本、人工改文、阅读顺序、提供方/账户/型号、提示/输出格式、上下文/术语/生成参数。初次配置翻译或修改同账户上下文不会重复OCR；账户更换清除跨账户结果。

默认半小时TTL、各层128条/8MiB上限。清除会增加缓存代次，旧任务不能恢复缓存；取消的订阅者不影响其他订阅者。没有“恰好计费一次”的保证，远端超时不会自动重发。预读只处理当前已加载且可见/邻近的图片，默认关闭，远端另行明确预算与授权。

## 排版的实际边界

RT-DETR给出的是外接矩形，不是真实气泡轮廓。纯色检查只为保守安全子矩形提供证据：透明/复杂背景、文字框外异色、密集前景、裁切或最小字号容不下时保留原图，用译文卡片展示全文。没有图像修复网络，也没有用实验真值mask代替产品检测。

这仍不能证明文字框内一定没有绘画。可撤销覆盖层、查看原图和改文入口必须保留；不导出永久擦除的图片。

## 验证记录

- `npm test`：225项JS测试通过（算法、缓存、权限、生命周期、适配器与旧基线回归）；`npm run test:tooling`：97项通过；`npm run build`成功。最终源码变化后再次运行这些检查。
- Python服务协议/下载/取消/真实环回安全：39项通过。真实四模型在原创合成图上经实际127.0.0.1 HTTP运行，识别HELLO WORLD并完成气泡检测；不等于浏览器验证。
- 新生产服务在原10张历史图上复核：OCR的数量、文本、框、polygon、置信度及RT-DETR框/分数，10/10页均与此前原生结果完全一致。按原GT及 `line-column-overlap-v2` 重新评分，CER **13.4537%**、WER **39.6552%**；S110/D139/I49/N2215，67个确定参考区域。6页仅部分标注，这不是现代漫画或八模块端到端质量。
- 测试脚本最初把所有 `.jpg` 文件声明为JPEG，EN09实际为PNG，服务正确拒绝；修正脚本按字节判断MIME后只补跑EN09/10，保留已完成的前8页，没有放宽生产格式校验。公开材料不含原图、GT或完整OCR文字。
- 独立浏览器辅助测试4项通过，包括生产本地适配器的真实环回HTTP；返回OCR/检测是合成夹具，不能代替上述真实模型证据。
- 本地 Chromium 已实际尝试启动，宿主禁止创建进程单例Unix套接字（`socket() Operation not permitted`），尚未进入页面。没有绕过限制。新版CI浏览器使用实际Chromium、合成环回HTTP和模拟文本LLM；状态必须看本次dev提交的Actions，不能借用旧版已通过记录。CI不测试真实网站获取/Chrome权限弹窗/付费LLM。

真实模型摘要见[四模型HTTP证据](../../services/local-ocr/evidence/native-real-model-smoke.json)及[十图输出一致性与精度摘要](../../services/local-ocr/evidence/native-regression-10.json)；本轮没有真实付费DeepSeek调用。默认采用用户指定DeepSeek V4.1 Flash，API模型 `deepseek-flash`，明确 `thinking:{type:'disabled'}` 降低推理开销，提示修订进入缓存身份。HTTP响应格式已用合成数据校验，不能宣称服务端型号/质量已经实际验收。

## 后续质量门槛

真实阅读网站权限和布局、用户Mac/M4性能、真实DeepSeek可用型号与付费质量、代表性现代英文漫画/真实RTL、独立人工GT、复杂背景掩膜、人物语境和自动上下文均未完成。请勿把有限历史样本或合成通过理解为上述验收通过。

## 参考

- [RapidOCR](https://github.com/RapidAI/RapidOCR)、[PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR)：Apache-2.0。
- [固定RT-DETR来源](https://huggingface.co/ogkalu/comic-text-and-bubble-detector/tree/16e8a622f91fabc6b5b65c96d32d1183f8843546)：Apache-2.0模型声明。
- [DeepSeek JSON输出](https://api-docs.deepseek.com/guides/json_mode)：JSON Object不保证业务ID完整，仍须应用层校验。
- [Chrome跨域请求](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)：主机权限不等于任意页面可直接使用扩展网络权限。
