# 本地 OCR 流水线的浏览器验证边界

先运行 `npm run build` 和 `npx playwright install chromium`，再运行 `npm run test:browser`。

## 默认浏览器集成测试

`smoke.mjs` 启动真正的 Chromium、构建后的扩展和监听 `127.0.0.1` 随机端口的 HTTP 服务。扩展的本地适配器通过真正的 HTTP 发送令牌与原创合成图片；夹具校验 Host、扩展 Origin、Bearer 令牌、图片字节、Cookie 与 Referer 缺省。

明确模拟的部分：

- `helpers/mock-local-service.mjs` 不加载模型。OCR 行、气泡候选和下载进度均为固定合成响应。
- 临时扩展副本模拟远端图片获取与 DeepSeek 返回；其他外部请求直接拒绝，不访问付费翻译接口，也不向外部服务上传图片。
- 临时主扩展副本使用静态主机授权，另一个没有环回权限的副本验证缺权时后台拒绝配置。**没有验证 Chrome 权限弹窗交互。** 生产构建的 manifest 不改动。

真实执行的部分：扩展消息路由、设置页面、模型状态显示、本地 HTTP、图片解码、缓存、分组、阅读顺序、纯色填充判定、字体测量、旁侧回退、原文修正、清除与重新配置。测试包含准备不调用远端翻译、气泡外字幕保留、过长译文回退、热缓存、上下文失效以及可见/邻近预算。

`artifacts/browser-smoke.json` 与失败文件明确记录真实和模拟范围。测试通过不证明 PaddleOCR/RT-DETR 质量、真实网站图片获取、真实 DeepSeek 行为或用户设备表现。

辅助测试可独立运行：

```sh
node --test tests/browser/*.test.mjs
```

其中一项会启动真实环回 HTTP，再用生产适配器发送合成请求；其余验证夹具边界及生产分组/安全填充算法。不需要 Chromium，不代表浏览器验证。

## 独立的真实模型冒烟

默认 CI 不下载 Python 模型。手动触发 `Extension tests`，显式启用 `run_native_models` 后，单独的 job 安装固定 Python 依赖，下载约 308 MB 固定权重，并运行：

```sh
PYTHONPATH=services/local-ocr python services/local-ocr/tests/smoke_real_models.py --download --output artifacts/native-real-model-smoke.json
```

该测试执行真实 Python OCR 与检测，通过真实环回 HTTP 处理原创合成图，单独保留 `native-real-model-smoke.json`。它不运行浏览器，也不是漫画质量验收。使用已经校验的缓存时可以省略 `--download` 并传 `--cache-dir`。

## 环境限制

2026-11-04 的当前受限云环境允许 Node 环回 HTTP 监听，真实 HTTP 辅助测试通过；Chromium 在独立、可写 HOME/profile 下仍于 `process_singleton_posix.cc` 创建套接字时报 `Operation not permitted`，页面尚未启动。没有绕过限制，也不把静态检查或 HTTP 辅助测试说成 Chromium 通过。需查看本次提交对应的 CI 结果确认浏览器执行情况。
