# PaddleOCR-VL-1.6：重复输出排查证据

更新：2026-11-03。范围：官方 GGUF＋llama.cpp b11960、云 CPU 四线程、整页 Spotting。这里只记录只读排查结果；没有改变冻结协议、重跑推理、上传图片或调用云 API。

## 结论：现象确认，根因未知

EN01 在五组完整 LOC 坐标后连续生成 4,023 个字符 `0`，最终触及 4,096 输出 token 上限。这是重复退化，不是普通的区域过多。**未找到官方确认、精确对应此版本与症状的缺陷或修复。**不能据此断定是模型能力、llama.cpp 数值实现、模板或预处理问题，也不能把合成图成功当作漫画可靠性证明。

## 官方记录能说明什么

- [PaddleOCR #18079](https://github.com/PaddlePaddle/PaddleOCR/issues/18079)报告 VL1.6 在模糊、密集图片上推理卡住。[仓库协作者建议](https://github.com/PaddlePaddle/PaddleOCR/issues/18079#issuecomment-5015102156)限定生成长度、尝试重复惩罚 1.05–1.1、温度 0、限制图片尺寸并设置超时。该建议没有证明本次 LOC 后重复 `0` 与之同因，也没有提供对本次组合有效的修复验证。
- [PaddleOCR #17903](https://github.com/PaddlePaddle/PaddleOCR/issues/17903)记录旧版遇到重复数字图片时大量输出，调参后换图片仍可能复发。它不是 llama.cpp／Spotting 的同条件实验。
- [llama.cpp #31155](https://github.com/ggml-org/llama.cpp/issues/31155)涉及交互 CLI 执行 `/clear` 后复用旧图像缓存；[#27543](https://github.com/ggml-org/llama.cpp/issues/27543)涉及非法 UTF-8 引发 HTTP 500。本次首次 server 请求返回可解码的重复文本，不能直接套用这些根因。

## 已核对的参数与模板

| 项目 | 本轮设置／证据 | 判断 |
|---|---|---|
| 提示词、视觉预算、温度 | `Spotting:`、`image_max_pixels=1605632`、`temperature=0` | 与[官方 GGUF 卡](https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6-GGUF)一致。没有证据要求改回默认视觉上限 1003520。 |
| 重复惩罚 | `repeat_penalty=1.0` | b11960 [固定源码](https://github.com/ggml-org/llama.cpp/blob/8642541b255bfb5dc39cd351a178be09013a55d6/common/common.h#L233-L247)与本机保存的 help 均以 1.0 为默认值，表示关闭。旧版文档的 1.1 不能当作本版默认。 |
| 模板引擎 | 未显式传 `--jinja` | 本版本[默认已启用 Jinja](https://github.com/ggml-org/llama.cpp/blob/8642541b255bfb5dc39cd351a178be09013a55d6/common/common.h#L652-L655)，不能因此判定漏配置。 |
| 模型模板与结束符 | 只读 GGUF 头；嵌入模板与同修订[官方模板](https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6-GGUF/blob/511b09642bb324401f15f97cc23bc67e8f0a291d/chat_template.jinja)一致，EOS ID 为 2 | 未发现该处文件不匹配；这不等于所有运行时行为均已验证正确。 |
| 特殊 token | CLI/server 使用 `--special`，合成图 LOC 已成功解析 | 未发现本次因输出过滤丢失 LOC 的证据。 |

历史 [PR #18825](https://github.com/ggml-org/llama.cpp/pull/18825)确曾提及旧版本模板修正，但不能因此认定当前官方 1.6 文件仍有同一问题。

## 4096 与 8192：输出限制不等于上下文耗尽

PaddleX [默认最大生成量为 8192](https://github.com/PaddlePaddle/PaddleX/blob/4c968d30b9d0d4a693d9eaaef0881c20f8d7d0e0/paddlex/inference/models/doc_vlm/constants.py#L35)，本轮主动限制为 4096。EN01 记录为输入 1989＋输出 4096＝6085 token，低于本轮上下文容量 8192；server 同时记录 `truncated=0`，响应结束原因为 `length`。

因此，本次是**输出上限终止了重复生成**，不是上下文容量耗尽。把输出上限提高到 8192，可能只产生更长的重复串；现无证据表明它会修复问题。server 的 `truncated=0` 与应用层记录的输出截断并不矛盾，两者描述的限制不同。

## 后续诊断必须独立于本轮结果

保留当前冻结实验。若之后测试 1.05／1.1 重复惩罚，应另立协议，每次只改变该变量，保存原始结果和失败状态。重复惩罚也可能影响合法的重复文字或 LOC 坐标，必须同时检查完整率、几何解析和识别误差，不能只看是否不再循环。

本报告不包含漫画全文或原始预测，也不提供尚未完成的十图准确率。
