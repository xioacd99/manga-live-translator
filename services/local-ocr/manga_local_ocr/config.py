"""固定资产、参数和协议边界；修改算法时必须生成新修订。"""
import hashlib
import json

PROTOCOL_VERSION = 1
DEFAULT_PORT = 8787
MAX_IMAGE_BYTES = 4 * 1024 * 1024
MAX_PIXELS = 16_000_000
MAX_EDGE = 16384
MAX_REGIONS = 256
MAX_TEXT = 8192
MAX_CLIENTS = 8
RUNTIME_PINS = {
    "rapidocr": "3.10.0", "onnxruntime": "1.23.2", "numpy": "2.5.4",
    "opencv-python-headless": "5.0.0.93", "pillow": "13.0.0",
    "omegaconf": "2.4.0", "pyclipper": "1.4.0", "shapely": "2.2.0",
}
MODELS = (
    {"id": "v6_medium_det", "component": "ocr", "bytes": 62119454,
     "sha256": "92078b7355007ccfffcd4c8cd441a3afd4538904d06881b29a155e1e679907c2",
     "url": "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx/PP-OCRv6/det/PP-OCRv6_det_medium.onnx"},
    {"id": "v6_medium_rec", "component": "ocr", "bytes": 76629984,
     "sha256": "eef444829dbbe18d7fea59a3f6eb75647518d2b3a9568d27c92e42940204894b",
     "url": "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx/PP-OCRv6/rec/PP-OCRv6_rec_medium.onnx"},
    {"id": "legacy_cls", "component": "ocr", "bytes": 585532,
     "sha256": "e47acedf663230f8863ff1ab0e64dd2d82b838fceb5957146dab185a89d6215c",
     "url": "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.4.0/onnx/PP-OCRv4/cls/ch_ppocr_mobile_v2.0_cls_infer.onnx"},
    {"id": "rtdetr_bubble", "component": "detector", "bytes": 168481531,
     "sha256": "065744e91c0594ad8663aa8b870ce3fb27222942eded5a3cc388ce23421bd195",
     "url": "https://huggingface.co/ogkalu/comic-text-and-bubble-detector/resolve/16e8a622f91fabc6b5b65c96d32d1183f8843546/detector.onnx"},
)
OCR_CONFIG = {
    "resize": {"shortSide": 1536, "longCap": 4096, "interpolation": "opencv-INTER_LINEAR", "detectorAlignment": 32},
    "Det.mean": [0.485, 0.456, 0.406], "Det.std": [0.229, 0.224, 0.225],
    "Det.thresh": 0.2, "Det.box_thresh": 0.45, "Det.unclip_ratio": 1.4,
    "Det.max_candidates": 3000, "Det.use_dilation": False, "Det.score_mode": "fast",
    "Det.limit_side_len": 4096, "Det.limit_type": "max",
    "Global.max_side_len": 4096, "Global.text_score": 0.5,
    "Global.use_det": True, "Global.use_cls": True, "Global.use_rec": True,
    "Global.use_preprocess_img": True, "Global.use_vertical_padding": True,
    "Global.min_side_len": 30, "Global.min_height": 30, "Global.width_height_ratio": 8,
    "Global.return_word_box": False, "Global.return_single_char_box": False,
    "Rec.rec_img_shape": [3, 48, 320], "Rec.rec_batch_num": 6,
    "Cls.cls_image_shape": [3, 48, 192], "Cls.cls_batch_num": 6,
    "Cls.cls_thresh": 0.9, "Cls.label_list": ["0", "180"],
    "EngineConfig.onnxruntime.intra_op_num_threads": 1,
    "EngineConfig.onnxruntime.inter_op_num_threads": 1,
    "EngineConfig.onnxruntime.enable_cpu_mem_arena": False,
    "EngineConfig.onnxruntime.use_cuda": False, "EngineConfig.onnxruntime.use_coreml": False,
    "EngineConfig.onnxruntime.use_dml": False, "EngineConfig.onnxruntime.use_cann": False,
    "opencvThreads": 1, "decoder": "onnx-embedded-ctc",
    "characterSha256": "f7aa897ca828a4c7c9e2739c30f9161a33306d532f020bcdb91dcfb664a5507e",
    "output": "source-pixel-lines-v1",
}
DETECTOR_CONFIG = {
    "resize": [640, 640], "interpolation": "PIL-BICUBIC", "colors": "RGB",
    "scale": 255, "targetSizes": "width-height", "label": 0, "threshold": 0.5,
    "intraThreads": 1, "interThreads": 1, "provider": "CPUExecutionProvider",
    "slicing": False, "output": "source-pixel-bubble-boxes-v1",
}

def revision(component, config):
    identity = {"runtime": RUNTIME_PINS, "config": config,
                "models": [{"id": m["id"], "sha256": m["sha256"]} for m in MODELS if m["component"] == component]}
    digest = hashlib.sha256(json.dumps(identity, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return f"{component}-v1-{digest}"

MODEL_REVISION = revision("ocr", OCR_CONFIG)
DETECTOR_REVISION = revision("detector", DETECTOR_CONFIG)
