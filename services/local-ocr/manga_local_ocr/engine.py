"""固定的 RapidOCR 原生流水线与独立 RT-DETR 气泡框检测。"""
import hashlib
import importlib.metadata
import json
import math
import os

from .config import MAX_REGIONS, MAX_TEXT, OCR_CONFIG, RUNTIME_PINS
from .errors import GatewayError

# 必须在首次导入 NumPy/OpenCV 前限制线程。
for _key in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
    os.environ[_key] = "1"


def stable_id(prefix, geometry, text=""):
    value = {"geometry": [[round(float(p["x"]), 4), round(float(p["y"]), 4)] for p in geometry], "text": text}
    return prefix + hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()[:24]


def geometry(points, width, height):
    if len(points) < 3 or not all(math.isfinite(float(v)) for point in points for v in point):
        raise GatewayError("invalid_model_output", 502)
    polygon = [{"x": min(float(width), max(0.0, float(p[0]))), "y": min(float(height), max(0.0, float(p[1])))} for p in points]
    xs, ys = [p["x"] for p in polygon], [p["y"] for p in polygon]
    bbox = {"x": min(xs), "y": min(ys), "width": max(xs) - min(xs), "height": max(ys) - min(ys)}
    if bbox["width"] <= 0 or bbox["height"] <= 0:
        raise GatewayError("invalid_model_output", 502)
    return polygon, bbox


class NativeEngine:
    def __init__(self, model_store):
        self.models = model_store
        self._ocr = None
        self._detector = None
        self._runtime_checked = False

    def _runtime(self):
        if self._runtime_checked:
            return
        for key in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
            os.environ[key] = "1"
        for package, version in RUNTIME_PINS.items():
            try:
                actual = importlib.metadata.version(package)
            except importlib.metadata.PackageNotFoundError:
                raise GatewayError("runtime_dependency_missing", 503) from None
            if actual != version:
                raise GatewayError("runtime_version_mismatch", 503)
        import cv2
        cv2.setNumThreads(1)
        self._runtime_checked = True

    def prepare(self):
        self._runtime()

    def states(self):
        return {"ocr": "loaded" if self._ocr is not None else "unloaded",
                "detector": "loaded" if self._detector is not None else "unloaded"}

    def _load_ocr(self):
        self._runtime()
        if self._ocr is not None:
            return self._ocr
        paths = self.models.verified_paths("ocr")
        import cv2
        from rapidocr import RapidOCR, EngineType, LangDet, LangRec, ModelType, OCRVersion
        from rapidocr.utils.download_file import DownloadFile

        # 禁止运行库偷偷补下载；模型与字典只能来自经过校验的本地 ONNX。
        def deny_implicit_download(*args, **kwargs):
            raise GatewayError("implicit_model_download_blocked", 503)
        DownloadFile.run = staticmethod(deny_implicit_download)

        class FixedOCR(RapidOCR):
            def preprocess_img(self, original):
                height, width = original.shape[:2]
                ratio = min(1536 / min(height, width), 4096 / max(height, width))
                nh, nw = max(1, round(height * ratio)), max(1, round(width * ratio))
                resized = cv2.resize(original, (nw, nh), interpolation=cv2.INTER_LINEAR)
                return resized, {"preprocess": {"ratio_h": height / nh, "ratio_w": width / nw}}

        params = {key: value for key, value in OCR_CONFIG.items() if "." in key}
        params.update({
            "Global.log_level": "critical",
            "Det.engine_type": EngineType.ONNXRUNTIME, "Rec.engine_type": EngineType.ONNXRUNTIME,
            "Cls.engine_type": EngineType.ONNXRUNTIME, "Det.lang_type": LangDet.CH, "Rec.lang_type": LangRec.CH,
            "Det.model_type": ModelType.MEDIUM, "Rec.model_type": ModelType.MEDIUM,
            "Det.ocr_version": OCRVersion.PPOCRV6, "Rec.ocr_version": OCRVersion.PPOCRV6,
            "Det.model_path": str(paths["v6_medium_det"]), "Rec.model_path": str(paths["v6_medium_rec"]),
            "Cls.model_path": str(paths["legacy_cls"]),
        })
        engine = FixedOCR(params=params)
        engine._load_det_model()
        engine._load_cls_model()
        engine._load_rec_model()
        metadata = engine.text_rec.session.session.get_modelmeta().custom_metadata_map
        if hashlib.sha256(metadata.get("character", "").encode()).hexdigest() != OCR_CONFIG["characterSha256"]:
            raise GatewayError("model_dictionary_mismatch", 503)
        for stage in ("det", "cls", "rec"):
            if getattr(engine, "text_" + stage).session.session.get_providers() != ["CPUExecutionProvider"]:
                raise GatewayError("unexpected_execution_provider", 503)
        self._ocr = engine
        return engine

    def ocr(self, image):
        result = self._load_ocr()(image)
        if result.boxes is None:
            return []
        if result.txts is None or result.scores is None or not (len(result.boxes) == len(result.txts) == len(result.scores)):
            raise GatewayError("invalid_model_output", 502)
        if len(result.boxes) > MAX_REGIONS:
            raise GatewayError("too_many_regions", 422)
        height, width = image.shape[:2]
        regions, ids, text_bytes = [], {}, 0
        for quad, text, score in zip(result.boxes.tolist(), result.txts, result.scores):
            confidence = float(score)
            if not isinstance(text, str) or len(text) > MAX_TEXT or not math.isfinite(confidence) or not 0 <= confidence <= 1:
                raise GatewayError("invalid_model_output", 502)
            text_bytes += len(text.encode("utf-8"))
            if text_bytes > 256 * 1024:
                raise GatewayError("output_too_large", 422)
            polygon, bbox = geometry(quad, width, height)
            identity = stable_id("r-", polygon, text)
            ids[identity] = ids.get(identity, 0) + 1
            region_id = identity if ids[identity] == 1 else f'{identity}-{ids[identity]}'
            regions.append({"regionId": region_id, "bbox": bbox, "polygon": polygon, "sourceText": text,
                            "confidence": confidence, "readingOrder": len(regions)})
        return regions

    def _load_detector(self):
        self._runtime()
        if self._detector is None:
            paths = self.models.verified_paths("detector")
            import onnxruntime as ort
            options = ort.SessionOptions()
            options.intra_op_num_threads = 1
            options.inter_op_num_threads = 1
            options.log_severity_level = 4
            self._detector = ort.InferenceSession(str(paths["rtdetr_bubble"]), options, providers=["CPUExecutionProvider"])
        return self._detector

    def detect(self, image):
        import cv2
        import numpy as np
        from PIL import Image
        session = self._load_detector()
        height, width = image.shape[:2]
        rgb = Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
        # PIL 对 RGB 默认采用 BICUBIC；显式指定以冻结原实测语义。
        tensor = np.asarray(rgb.resize((640, 640), Image.Resampling.BICUBIC), dtype=np.float32) / 255
        labels, boxes, scores = session.run(None, {
            "images": tensor.transpose(2, 0, 1)[None],
            "orig_target_sizes": np.array([[width, height]], np.int64),
        })
        if not (len(labels[0]) == len(boxes[0]) == len(scores[0])):
            raise GatewayError("invalid_model_output", 502)
        regions, ids = [], {}
        for label, box, score in zip(labels[0], boxes[0], scores[0]):
            confidence = float(score)
            if not math.isfinite(confidence) or not 0 <= confidence <= 1:
                raise GatewayError("invalid_model_output", 502)
            if int(label) != 0 or confidence < 0.5:
                continue
            if len(box) != 4:
                raise GatewayError("invalid_model_output", 502)
            x1, y1, x2, y2 = map(float, box)
            polygon, bbox = geometry([[x1, y1], [x2, y1], [x2, y2], [x1, y2]], width, height)
            identity = stable_id("b-", polygon)
            ids[identity] = ids.get(identity, 0) + 1
            region_id = identity if ids[identity] == 1 else f'{identity}-{ids[identity]}'
            regions.append({"regionId": region_id, "bbox": bbox, "confidence": confidence, "readingOrder": len(regions)})
            if len(regions) > MAX_REGIONS:
                raise GatewayError("too_many_regions", 422)
        return regions
