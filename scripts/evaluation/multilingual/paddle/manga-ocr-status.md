# manga-ocr 补充候选：未运行，不参与成绩排名

代码manga-ocr 0.1.14，Apache-2.0；模型kha-white/manga-ocr-base，官方模型卡Apache-2.0。已安装隔离CPU环境：torch 2.6.0+cpu、torchvision 0.21.0+cpu、transformers 4.49.0。依赖见requirements.lock.txt。

模型revision aa6573bd10b0d446cbf622e29c3e084914df9741。已下载主权重444,135,475字节及3项配置/说明文件；实际SHA及来源见model-files.json。

下载special_tokens_map.json时遇到网络代理Tunnel403 Forbidden。还缺tokenizer_config.json、vocab.txt，未再尝试任何被拒对象、替代镜像或工具，不绕过限制。没有推理、准确率或耗时成绩。完整失败stack见download.log。

此补充候选不阻塞主五方案。它是Python/PyTorch服务端路线，不是现成浏览器ONNX替换；约444MB权重显著大于Paddle mobile约22MB，CPU性能仍未测。
