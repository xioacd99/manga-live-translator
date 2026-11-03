# 英文/日文漫画 Paddle 公开复现白名单

本目录只提供参数化脚本、环境/模型元数据、运行摘要和补充候选blocked说明。无漫画原图、派生图、全文预测、GT、模型权重、私人路径、venv或缓存。

通过 `run_language.py --dataset YOUR_DATASET --model-dir YOUR_MODELS --lock YOUR_SHARED_LOCK --output YOUR_RESULTS` 执行三路线，dataset目录应含sources.json及rtdetr-regions.json，具体schema/依赖与单模式调用见repro/README.md。可用 --modes full 独立执行整图，或 --modes rec-only inner-db-rec执行两种裁剪路线；可用 --rtdetr 指定其他上游结果路径。

复用同一套PP-OCRv5 mobile模型支持英日有官方模型卡依据，见MODEL-CHOICE.md。语言样本差异不能用于跨语种能力因果结论。任何新结果都需要独立GT评估，脚本只导出原始预测和计时。

manga-ocr只是被阻塞的补充候选。只有依赖和部分模型的元数据，不提供可执行下载脚本，也不授权重试被拒资源。不会被当作已运行方案。

公开版本不含下载或安装后的输出，实际运行生成的predictions可能含版权全文，应仅私有保存。原始实测脚本与输入保留在私有评测目录，本公开副本不改历史模型、参数、预测。

本轮20图×3路线使用repro/benchmark.py真实运行；公开副本仅翻译注释/文档字符串，逻辑不变，未另作全量重复实验。PUBLIC-FILES.json记录公开副本哈希，原实跑文件哈希保留于终态记录。
