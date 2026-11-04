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

## 独立的真实 Native Messaging 生命周期冒烟

`native-lifecycle.mjs` 使用真实 Chromium 的 `connectNative()`，由浏览器启动生产 Python 宿主及其真实环回 HTTP 服务。它不是上述模拟 OCR HTTP 服务，也不需要模型或推理依赖。

在允许启动 Chromium 的 Linux 环境中运行：

```sh
python3 -m venv .venv-lifecycle
.venv-lifecycle/bin/python -m pip install --no-deps -e services/local-ocr
npm run build
npx playwright install chromium
MLT_NATIVE_PYTHON=.venv-lifecycle/bin/python node tests/browser/native-lifecycle.mjs
```

安装器仅向全新临时 HOME/profile 写入宿主 manifest、配置和启动器；不注册到真实用户目录，不安装系统自启动。测试结束清理临时目录。临时扩展副本静态授予 Native Messaging 与环回权限，观察真实连接，不伪造消息或 HTTP 响应；外网请求被拒绝。生产 `dist/manifest.json` 不变。

为兼容 Playwright 的浏览器品牌和版本，夹具把同一 manifest 复制到临时 profile 以及临时 HOME 下的 Chromium、Chrome、Chrome for Testing 官方默认目录；Chrome 146 前的 CfT 使用 Chrome 路径。这不等于验证生产安装器自动探测浏览器。目录规则见 [Chrome 官方 Native Messaging 文档](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging#native-messaging-host-location)。

验收范围：

- 缺少宿主时，生产启用消息返回包含安装/注册指引的固定错误。
- 保存托管设置、被动状态轮询不启动进程；生产 `MLT_UI_ENABLE` 的 `auto:true` 路径启动真实服务，模型缺失时停止在明确提示处，不下载模型或发送翻译请求。
- 重复启用复用同一连接；临时端口与令牌不写入持久扩展存储。
- 第二个真实浏览器进程得到独立端口与令牌；第一个实例的令牌不能访问第二个实例。
- 关闭多个普通窗口中的一个不停止服务。关闭最后一个普通窗口时，保留 popup 窗口使浏览器继续运行，验证生产窗口监听器停止本实例服务，不影响第二个实例。
- 第二个实例直接建立原始 Native Messaging 端口，然后关闭整个浏览器，验证连接结束和真实 TCP 端口关闭。该路径不冒充自动翻译按钮 UI 验证。

独立 CI job `native-lifecycle` 保留 `artifacts/native-lifecycle.json` 或失败文件，自动清理令牌等敏感字段。检查模型缓存仍为空，且引擎未加载。**这不验收实际按钮点击、权限弹窗、OCR/检测质量、真实网站、真实提供方或用户 Mac。** 文件存在或脚本语法通过不代表 Chromium 已执行通过，须查看当前提交的 CI 结果。

`native-lifecycle.test.mjs` 只验证测试身份、隔离目录、观察器透明转发和证据脱敏，不需要浏览器，不能代替上述运行。

## 独立的真实模型冒烟

默认 CI 不下载 Python 模型。手动触发 `Extension tests`，显式启用 `run_native_models` 后，单独的 job 安装固定 Python 依赖，下载约 308 MB 固定权重，并运行：

```sh
PYTHONPATH=services/local-ocr python services/local-ocr/tests/smoke_real_models.py --download --output artifacts/native-real-model-smoke.json
```

该测试执行真实 Python OCR 与检测，通过真实环回 HTTP 处理原创合成图，单独保留 `native-real-model-smoke.json`。它不运行浏览器，也不是漫画质量验收。使用已经校验的缓存时可以省略 `--download` 并传 `--cache-dir`。

## 环境限制

2026-11-04 的当前受限云环境允许 Node 环回 HTTP 监听，真实 HTTP 辅助测试通过；Chromium 在独立、可写 HOME/profile 下仍于 `process_singleton_posix.cc` 创建套接字时报 `Operation not permitted`，页面尚未启动。没有绕过限制，也不把静态检查或 HTTP 辅助测试说成 Chromium 通过。需查看本次提交对应的 CI 结果确认浏览器执行情况。
