# 开发预览：Python 本地 OCR + Chrome

这是尚未发布的 dev 实现。根 [README 的八模块清单](../../README.md)是当前算法入口，旧 Tesseract / 浏览器WASM路线及其CI记录仅供历史追溯，不能作为新版验收。

## 安装与构建

1. 按 [Python 服务说明](../../services/local-ocr/README.md)安装固定依赖并启动仅监听127.0.0.1的服务。保管本机令牌，不写入Issue、网页脚本或公共日志。
2. Node.js22+环境运行：

```sh
npm ci --ignore-scripts
npm test
npm run test:tooling
npm run build
npx playwright install chromium
npm run test:browser
```

3. 在 `chrome://extensions` 启用开发者模式，加载 `dist/`，记下扩展ID供服务Origin允许列表使用。这是手动开发安装，不修改其他浏览器或Git配置。
4. 打开扩展设置，填写 `http://127.0.0.1:8787`、本机令牌和阅读方向，明确允许像素发送给本机服务。Chrome主机权限不区分端口，扩展自身仅使用保存的精确端口。
5. 在弹窗点击“下载并准备模型”，观察下载/校验/加载进度。四份权重约293.6MiB，缓存本机；状态查询不发起下载。失败或取消后可重试，只有完整校验的文件复用。
6. 可选配置 DeepSeek 或 OpenAI、当前账户可用模型与目标语言。只有单独勾选文本授权后才保存；上下文与术语表也会发送，可能计费。默认采用用户指定的 DeepSeek V4.1 Flash，对应API型号 `deepseek-flash`；没有执行真实付费API验证。
7. 打开公开HTTP(S)图片阅读页，弹窗授权当前来源及所需CDN，启用页面。只做本地准备不需要远端密钥；手动翻译/自动翻译/远端预读有各自授权与预算。
8. 使用原图切换和阅读/改文面板。复杂背景或小框放不下译文时显示完整卡片，不强制涂白，不永久改图。

## 边界

- 英文静态PNG/JPEG/BMP/WebP；4MiB压缩文件、1600万像素。拒绝不支持/动画/超限输入。不支持需Cookie图片、canvas提取、iframe、跨章抓取或自动翻页。
- 预读默认关闭，只处理当前已加载且可见/邻近的图片，最多80个候选、2个在途任务。Python单一推理资源串行，忙时明确拒绝。隐藏/暂停/导航停止新工作，已发出的请求可能仍在处理或计费。
- 密钥只存扩展受信任会话；阅读缓存为容量受限内存，模型文件另存。清除会阻止旧任务回写；浏览器重启不保留密钥或阅读结果。无痕模式禁用。
- 本地服务只提供固定模型管理/推理端点，不是任意URL转发器。远程提供方只收文本，不收图片。没有Magpie、GPU/CoreML或M4性能验收。
- 纯色检查与归组是保守启发式，不是真值分割mask。模型误检/漏检、阅读顺序和翻译质量仍需用户复核。

## 测试解释

`npm test`包括纯算法、模拟网络/DOM、旧基线OCR与当前生命周期回归；旧Tesseract测试通过不代表新版Paddle质量。

`npm run test:browser`是实际Chromium、合成环回HTTP服务和模拟LLM的接线测试。它覆盖鉴权、设置、归组、渲染、缓存和改文，但**不把模拟服务当真实Paddle或DeepSeek**。Python服务单元及真实模型检查另外运行并记录。

云环境本地Chromium实际启动被Unix套接字限制阻止，不能绕过安全限制；最终浏览器结果以本次提交的CI为准。真实网站、真实付费翻译、现代漫画金标准、用户Mac/M4、复杂滚动内存和完整进程重启恢复尚未验收。详见[当前集成证据](native-pipeline.md)。

[依赖与历史来源](dependency-provenance.md)、[本地服务许可](../../services/local-ocr/README.md)、[首版计划](../plans/v0.1/README.md)。
