# Copyright (c) 2024 PaddlePaddle Authors. All Rights Reserved.
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""按已静态审阅的 PaddleX resize_type2/NormalizeImage 语义改写的小适配器。

参考提交 4c968d30b9d0d4a693d9eaaef0881c20f8d7d0e0，
paddlex/inference/models/text_detection/processors.py。
不导入或执行所下载的上游源码。RapidOCR 的 DB/裁框/识别流程仍属桥接实现。
"""
import cv2
import numpy as np

class ServerDetPreprocess:
    def __init__(self, resize_long=960):
        self.resize_long=resize_long
        self.mean=[0.485,0.456,0.406]
        self.std=[0.229,0.224,0.225]
        self.last_shapes=None

    def __call__(self, bgr):
        original=list(bgr.shape)
        h,w,c=bgr.shape
        if h+w<64:
            padded=np.zeros((max(32,h),max(32,w),c),np.uint8)
            padded[:h,:w,:]=bgr;bgr=padded;h,w=bgr.shape[:2]
        ratio=float(self.resize_long)/max(h,w)
        rh,rw=int(h*ratio),int(w*ratio)
        rh=(rh+127)//128*128;rw=(rw+127)//128*128
        if (rh,rw)!=(h,w):bgr=cv2.resize(bgr,(rw,rh))
        # 保留 BGR 次序；按上游 float32 逐通道 alpha/beta 顺序运算。
        channels=list(cv2.split(bgr))
        for i in range(3):
            channels[i]=channels[i].astype(np.float32)
            channels[i]*=(1.0/255.0)/self.std[i]
            channels[i]+=-self.mean[i]/self.std[i]
        result=cv2.merge(channels).transpose(2,0,1)[None,...]
        self.last_shapes={'input_hwc':original,'network_nchw':list(result.shape),'resize_long':self.resize_long,'rounding':'ceil to multiple of 128'}
        return result

def install_server_default_preprocess(engine, resize_long=960):
    """在已加载的 RapidOCR 检测器实例上接入，无全局/产品修改。"""
    adapter=ServerDetPreprocess(resize_long)
    engine.text_det.get_preprocess=lambda:adapter
    return adapter

# common 分辨率组沿用 Rapid 的 max4096/round32 resize，只替换server归一化。
from rapidocr.ch_ppocr_det.utils import DetPreProcess

class ServerCommonPreprocess(DetPreProcess):
    def __init__(self):
        super().__init__(4096,'max',[0.485,0.456,0.406],[0.229,0.224,0.225])

    def normalize(self, bgr):
        channels=list(cv2.split(bgr))
        for i in range(3):
            channels[i]=channels[i].astype(np.float32)
            channels[i]*=(1.0/255.0)/float(self.std[i])
            channels[i]+=-float(self.mean[i])/float(self.std[i])
        return cv2.merge(channels)

def install_server_common_preprocess(engine):
    """外层图像缩放/裁框由共同runner负责；此处不改变它们。"""
    adapter=ServerCommonPreprocess()
    engine.text_det.get_preprocess=lambda:adapter
    return adapter
