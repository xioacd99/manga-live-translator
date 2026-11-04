> 当前架构更新（2026-11-04）：以下浏览器 Tesseract / WASM 资产清单保留用于旧版追溯；当前 `scripts/build.mjs` 不再打包这些OCR运行时/权重。Python Paddle与FP32 RT-DETR的固定版本、完整哈希、许可全文和来源见 [services/local-ocr](../../services/local-ocr/README.md)。Node旧依赖保留供历史回归测试，不代表当前浏览器调用它们。

# MVP dependency and model provenance

Checked 2026-11-03. Project-authored source remains MIT. Third-party assets retain their own licenses; the distribution must include their notices rather than relabel them MIT. The package lock pins resolved packages and integrity values. No ImageTrans or other GPL/AGPL implementation was copied.

## OCR runtime and English weights

- `tesseract.js@6.0.1`: official [naptha/tesseract.js](https://github.com/naptha/tesseract.js/tree/v6.0.1), Apache-2.0. Browser worker: `dist/worker.min.js`. API wrapper is bundled from the npm entry with its browser mapping. Preserve `LICENSE.md` and bundled license comments/notices.
- `tesseract.js-core@6.0.0`: official [naptha/tesseract.js-core](https://github.com/naptha/tesseract.js-core/tree/v6.0.0), Apache-2.0. The package contains compiled Tesseract and native image-processing dependencies; preserve its license and upstream dependency notices. The selected LSTM-only mode uses `tesseract-core-lstm.wasm.js` and `tesseract-core-lstm.wasm`, or the corresponding `tesseract-core-simd-lstm` pair when SIMD is supported. Package both paths, or all distributed WASM variants. Supply the directory as corePath, not a single SIMD-only filename.
- `@tesseract.js-data/eng@1.0.0`, `4.0.0_best_int/eng.traineddata.gz`: official [naptha/tessdata](https://github.com/naptha/tessdata), integerized English LSTM weights. Artifact SHA-256: `45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91`. The npm wrapper declares MIT but does not include a license file. The actual upstream [tessdata license](https://github.com/naptha/tessdata/blob/gh-pages/LICENSE) and [tessdata_best license](https://github.com/tesseract-ocr/tessdata_best/blob/main/LICENSE) are Apache-2.0; preserve the upstream Apache notice for these weights, not only the wrapper metadata. No independent training-corpus rights or manga-specific accuracy claim is made.

The `extension/notices/` directory includes upstream native dependency notices, full runtime and traineddata Apache licenses, and relevant npm/browser-worker notices. Copy this directory into every distribution. This software is based in part on the work of the Independent JPEG Group. Native revisions below were verified against the [v6.0.0 source tree](https://api.github.com/repos/naptha/tesseract.js-core/git/trees/v6.0.0?recursive=1), not inferred from the top-level npm license. No source rebuild or binary-reproducibility audit was performed.

The [v6.0.1 API](https://github.com/naptha/tesseract.js/blob/v6.0.1/docs/api.md) initializes with `createWorker('eng', 1, options)`. The adapter supplies explicit worker/core/language paths, disables Blob workers and persistent traineddata cache, and rejects HTTP/CDN asset paths. Recognition explicitly enables blocks because v6 only returns text by default. Sparse text mode produces paragraph regions in native coordinates and heuristic engine order; it is not a manga bubble detector. English horizontal text is the only packaged language. Coordinators must decode within their budget and pass unrotated/canonical encoded bytes whose dimensions match the supplied dimensions.

`tests/js/adapters-ocr-smoke.test.js` draws an original 800×160 bitmap with a tiny independent bitmap alphabet and recognizes HELLO WORLD through the actual local Node worker and weights. This passed in the development environment without model downloads. It proves the local runtime path, not Chrome extension compatibility or manga translation quality. The separate mocked adapter tests cover cancellation, strict IDs, output limits, and redacted provider errors.

## Translation transport

The adapter uses built-in fetch, no OpenAI SDK. Its only destination is `https://api.openai.com/v1/chat/completions`; redirects are rejected. See [Chat Completions API](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create). Requests use strict JSON Schema, explicit model, bounded text/output, and `store:false`. This does not promise zero provider retention or universal model compatibility. The user must choose a model that supports Chat Completions and strict structured output. Credentials remain in a trusted extension-owned closure. No key is included in source regions, cache keys, errors, or logs.

No paid request was made for tests. Mocked HTTP responses validate mapping and failure handling; live translation quality, pricing and provider-account compatibility remain unverified. Timeout/cancellation may still incur charges, so the adapter never automatically retries an ambiguous paid request.

## Embedded core source revisions and notice sources

- leptonica: `4af068b56a9674da915debea4ed7e1b9885b17e8`, [notice source](https://github.com/DanBloomberg/leptonica/blob/4af068b56a9674da915debea4ed7e1b9885b17e8/leptonica-license.txt).
- libjpeg: `6c0fcb8ddee365e7abc4d332662b06900612e923`, [notice source](https://github.com/LuaDist/libjpeg/blob/6c0fcb8ddee365e7abc4d332662b06900612e923/README).
- giflib: `fa37672085ce4b3d62c51627ab3c8cf2dda8009a`, [notice source](https://github.com/mirrorer/giflib/blob/fa37672085ce4b3d62c51627ab3c8cf2dda8009a/COPYING).
- libpng: `a37d4836519517bdce6cb9d956092321eca3e73b`, [notice source](https://github.com/glennrp/libpng/blob/a37d4836519517bdce6cb9d956092321eca3e73b/LICENSE).
- libtiff: `b51bb157123264e26d34c09cc673d213aea61fc7`, [notice source](https://github.com/libsdl-org/libtiff/blob/b51bb157123264e26d34c09cc673d213aea61fc7/COPYRIGHT).
- libwebp: `20ef03ee351d4ff03fc5ff3ec4804a879d1b9d5c`, [notice source](https://github.com/webmproject/libwebp/blob/20ef03ee351d4ff03fc5ff3ec4804a879d1b9d5c/COPYING).
- zlib: `21767c654d31d2dccdde4330529775c6c5fd5389`, [notice source](https://github.com/madler/zlib/blob/21767c654d31d2dccdde4330529775c6c5fd5389/README).
- tesseract: `5a21eebeacd77dd181eec17317de7e3a20b7b9fb`, [notice source](https://github.com/Balearica/tesseract/blob/5a21eebeacd77dd181eec17317de7e3a20b7b9fb/LICENSE).
- openlibm: `ae2d91698508701c83cab83714d42a1146dccf85`, [notice source](https://github.com/JuliaMath/openlibm/blob/ae2d91698508701c83cab83714d42a1146dccf85/LICENSE.md).

The libtiff notice is from the GitHub mirror at the exact same pinned commit; the upstream submodule uses GitLab. OpenLibm includes permissive MIT/BSD/ISC/FDLIBM components and separately LGPL test files. The pinned [core build](https://github.com/naptha/tesseract.js-core/blob/v6.0.0/build-scripts/build-openlibm.sh) invokes `install-static`; the pinned [OpenLibm Makefile](https://github.com/JuliaMath/openlibm/blob/ae2d91698508701c83cab83714d42a1146dccf85/Makefile) builds library objects from src/architecture/bsdsrc, with LGPL test files under separate test targets. Those test files are not incorporated in this project. The complete upstream notice is retained to avoid deleting context.

The minified worker additionally embeds buffer, ieee754, regenerator-runtime and zlib.js notices; these are retained with corresponding permissive license text. idb-keyval 6.3.0 uses Apache-2.0; its notice is from the matching upstream tag. Other npm license notices are copied unchanged from installed packages. Node-only transitive dependencies are not imported into the browser bundle by the Tesseract browser entry.

## 预训练区域检测（2026-11-03 新增）

当前默认区域检测替换旧亮色启发式，采用 [ogkalu/comic-text-and-bubble-detector](https://huggingface.co/ogkalu/comic-text-and-bubble-detector/tree/16e8a622f91fabc6b5b65c96d32d1183f8843546) 的 `detector-v4-s_int8.onnx`，11,120,765 字节，SHA-256 `5fe9e4f576e49d4e7e8b0e029d6d3cdc252abd4694113e1cae120e62c931ea79`。固定修订模型卡声明 Apache-2.0；训练数据未逐样本审计，不承诺所有原始图片权利均已清理。

浏览器适配器独立实现，参考[固定修订上游输入输出约定](https://github.com/ogkalu2/comic-translate/blob/8977b91a4f7a40c3917c5a268e9e7d78e1d818da/modules/detection/rtdetr_v2_onnx.py)，不拷贝 ImageTrans 或 GPL/AGPL 实现。ImageTrans 仅作产品思路参考。

`onnxruntime-web@1.23.2` 使用[官方源码版本](https://github.com/microsoft/onnxruntime/tree/v1.23.2)，主许可证 MIT，保留完整 `ThirdPartyNotices.txt`。本次只启用本地单线程 CPU/WASM，不启用 WebGPU，未测 Apple M4。运行时代码随扩展打包，模型由用户首次触发下载、完整校验后独立缓存；不上传漫画图片。详细缓存与数据边界见[预训练检测说明](pretrained-detector.md)。

`extension/notices/comic-detector-Apache-2.0.txt` 原样下载自 Apache 官方全文；ONNX Runtime LICENSE 与 ThirdPartyNotices 原样下载自官方 v1.23.2。来源 URL 和文件哈希保存在 `comic-detector-attribution.txt`。完整声明保留不代表运行时启用了其列举的所有可选组件；未做从源码重建或二进制可复现审计。
