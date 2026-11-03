# v6 Medium分辨率与完整det×rec矩阵复现

第一阶段含原缩放参数组、medium四档分辨率、两个混搭和tiny；第二阶段补其余四个混搭，使2048覆盖tiny/small/medium完整3×3。所有新候选同10图单遍，不是暖基线。small2048桥接全10图框与文字须与之前已验证同设置结果一致，才开始正式组。完整清单见PROTOCOL.md和APPEND-PHASE2.md。

## 准备

沿用既有Paddle英文比较中的requirements-current.lock.txt（RapidOCR3.10.0、ORT1.23.2）及模型下载工具；本目录model-references.json固定所需权重URL/大小/SHA。下载后本地模型manifest应保留每项path和sha256。图像manifest是10项JSON数组，包含id、file、sha256、width、height；file为你已获准使用的本地图片。input-hashes.json只提供本轮原输入身份，不含图片或全文。

先用此前分辨率复现脚本生成同2048/cap4096、small_params的已验证参考预测，供桥接检查。不得把别的模型、batch1或分辨率预测当作桥接参考。

## 运行

以下均为本地命令。所有CPU实验必须指向同一个锁文件，阶段不可并行：

```sh
python run_matrix.py --manifest sources.json --models models-local.json \
  --engine worker_engine.py --output private-results --lock shared-inference.lock \
  --bridge-reference prior-small2048-predictions.json
python run_phase2.py --manifest sources.json --models models-local.json \
  --engine worker_engine.py --output private-results --lock shared-inference.lock \
  --bridge-reference prior-small2048-predictions.json \
  --validated-bridge-check private-results/bridge_small_2048/bridge-check.json
python finalize_results.py --manifest sources.json --results private-results
python -m unittest discover -s tests -v
```

必须在第一阶段全部组终态后才运行第二阶段。所有路径来自CLI，公开脚本与实际执行文件字节一致，SHA见provenance.json。没有为公开副本重新运行OCR；编译和合成测试不代表模型推理验收。

## 解释输出

原predictions.json保留实际完成页与组status。finalize_results.py产生predictions-full-manifest.json，缺页显式空regions并标错误，保留全10图GT分母；不要只按成功页算主准确率。summary-no-gt.json的完成页时延只是条件统计，不能把partial组当完整成功。评分另用仓库几何score.py与私有GT，勿公开原GT/完整预测。

单图wall不含初始化/锁等待，包含decode、检测、方向分类、识别及raw/shape观察。所有组单遍，不能与旧warm时延混表而不标注。原缩放①的short=2048/cap4096是统一CLI占位且不生效；resize_mode=original时真正使用Global2000/Det min736，以effective-config.yaml和逐图resize.rule为准。

前置available≥6GiB；运行available<1.5GiB或同步RSS>5GiB或每图提交至结果返回>180秒停止本组，保留partial，不自动降参数。100ms采样协调器+OCR worker当前RSS之和，可能漏短峰/重计共享页，不包括Python资源追踪辅助进程。该锁仅协调本项目，不保证独占宿主CPU；/proc内存不是不可见cgroup配额保证。

合成单测覆盖真实监控函数的内存阈值与同步RSS求和、缺页补齐身份/错误且不覆盖原结果。超时样本只是合成错误传播，不声称单测执行了180秒等待。det分数排序错位的库限制仍适用，不用于逐框质量归因。
