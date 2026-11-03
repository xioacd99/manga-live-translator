"""固定 docTR DB-ResNet50 + PARSeq 管线，所有图像只在本地处理。"""
import os
for name in ('OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS','NUMEXPR_NUM_THREADS'):
    os.environ[name] = '1'
os.environ['DOCTR_MULTIPROCESSING_DISABLE'] = 'TRUE'
os.environ['CUDA_VISIBLE_DEVICES'] = ''
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TORCH_FORCE_WEIGHTS_ONLY_LOAD'] = '1'
import hashlib
import json
import math
import socket
import time
from pathlib import Path


def no_connect(*args, **kwargs):
    raise RuntimeError('Inference process forbids outbound socket connections')


def box(geometry, width, height):
    """docTR 已去掉检测 padding；归一化词框直接乘原图宽高。"""
    (x0, y0), (x1, y1) = geometry
    values = [float(x0), float(y0), float(x1), float(y1)]
    assert all(math.isfinite(v) and -1e-6 <= v <= 1 + 1e-6 for v in values)
    x0, y0, x1, y1 = values
    assert x1 >= x0 and y1 >= y0
    return {'x': x0 * width, 'y': y0 * height,
            'width': (x1-x0) * width, 'height': (y1-y0) * height}


class DoctrEngine:
    def __init__(self, model_manifest):
        started = time.perf_counter()
        socket.socket.connect = no_connect
        socket.create_connection = no_connect
        import torch
        torch.set_num_threads(1)
        torch.set_num_interop_threads(1)
        import cv2
        cv2.setNumThreads(1)
        import doctr
        from doctr.models import db_resnet50, parseq, ocr_predictor
        import numpy as np
        from PIL import Image
        self.torch, self.np, self.Image = torch, np, Image
        imported = time.perf_counter()
        from importlib.metadata import version
        assert version('python-doctr') == '1.1.0'
        assert doctr.__version__ == 'v1.1.0'
        assert torch.__version__ == '2.8.0+cpu'
        models = {v['name']: v for v in json.loads(Path(model_manifest).read_text())}
        for record in models.values():
            assert hashlib.sha256(Path(record['path']).read_bytes()).hexdigest() == record['sha256']
        det = db_resnet50(pretrained=False, pretrained_backbone=False, assume_straight_pages=True)
        rec = parseq(pretrained=False, pretrained_backbone=False, max_length=32)
        # 官方加载函数处理旧 checkpoint 四个 norm 键；强制 weights_only，禁止任意 pickle 执行。
        det.from_pretrained(models['db_resnet50']['path'])
        rec.from_pretrained(models['parseq']['path'])
        self.predictor = ocr_predictor(
            det_arch=det, reco_arch=rec, pretrained=False, pretrained_backbone=False,
            assume_straight_pages=True, preserve_aspect_ratio=True, symmetric_pad=True,
            det_bs=1, reco_bs=8, detect_orientation=False, straighten_pages=False,
            detect_language=False, detect_layout=False, detect_tables=False,
            resolve_lines=True, resolve_blocks=False, paragraph_break=0.035,
            keep_reading_order=False,
        ).to(torch.device('cpu')).eval()
        assert rec.max_length == 32
        assert all(c in rec.vocab for c in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')
        assert tuple(det.cfg['input_shape']) == (3, 1024, 1024)
        assert tuple(rec.cfg['input_shape']) == (3, 32, 128)
        assert (det.postprocessor.bin_thresh, det.postprocessor.box_thresh, det.postprocessor.unclip_ratio) == (0.3, 0.1, 1.5)
        self.det_raw, self.rec_diagnostics, self.det_shapes, self.rec_shapes = [], [], [], []
        def observe_det(module, inputs, outputs):
            self.det_raw = [{k: value.tolist() for k, value in page.items()} for page in outputs]
        def observe_det_shape(module, inputs):
            self.det_shapes.append(list(inputs[0].shape))
        def expose_rec_logits(module, args, kwargs):
            # 只保留同一次 forward 已计算出的 logits，未改变解码与模型参数。
            kwargs = dict(kwargs)
            kwargs['return_model_output'] = True
            return args, kwargs
        def observe_rec(module, inputs, outputs):
            self.rec_shapes.append(list(inputs[0].shape))
            tokens = outputs['out_map'].argmax(-1).detach().cpu().tolist()
            for ids, (text, confidence) in zip(tokens, outputs['preds']):
                eos = ids.index(len(rec.vocab)) if len(rec.vocab) in ids else None
                self.rec_diagnostics.append({'text': text, 'confidence': float(confidence),
                    'decoder_positions': len(ids), 'eos_position': eos, 'eos_missing': eos is None})
        self.predictor.det_predictor.register_forward_hook(observe_det)
        det.register_forward_pre_hook(observe_det_shape)
        rec.register_forward_pre_hook(expose_rec_logits, with_kwargs=True)
        rec.register_forward_hook(observe_rec)
        self.initialization = {
            'import_seconds': imported-started, 'model_init_seconds': time.perf_counter()-imported,
            'torch': torch.__version__, 'doctr': doctr.__version__, 'device': str(next(det.parameters()).device),
            'torch_intra_threads': torch.get_num_threads(), 'torch_inter_threads': torch.get_num_interop_threads(),
            'opencv_threads': cv2.getNumThreads(), 'doctr_multithreading_disabled': True,
            'dtype': str(next(det.parameters()).dtype),
            'models': models, 'parameter_counts': {'det': sum(p.numel() for p in det.parameters()), 'rec': sum(p.numel() for p in rec.parameters())},
            'det_config': det.cfg, 'rec_config': rec.cfg,
            'det_preprocess_repr': repr(self.predictor.det_predictor.pre_processor),
            'rec_preprocess_repr': repr(self.predictor.reco_predictor.pre_processor),
            'word_max_length': rec.max_length, 'vocab_size': len(rec.vocab),
            'vocab_sha256': hashlib.sha256(rec.vocab.encode()).hexdigest(),
            'contains_ascii_space': ' ' in rec.vocab,
            'rec_split_wide_crops': self.predictor.reco_predictor.split_wide_crops,
            'rec_critical_aspect_ratio': self.predictor.reco_predictor.critical_ar,
            'rec_target_aspect_ratio': self.predictor.reco_predictor.target_ar,
            'rec_overlap_ratio': self.predictor.reco_predictor.overlap_ratio,
            'network_guard': 'Python socket connect blocked; not an OS sandbox proof',
        }

    def run(self, source, output):
        start = time.perf_counter()
        with self.Image.open(source['file']) as image:
            page = self.np.array(image.convert('RGB'))
        assert page.shape[:2] == (source['height'], source['width'])
        prepared = time.perf_counter()
        self.det_raw, self.rec_diagnostics, self.det_shapes, self.rec_shapes = [], [], [], []
        with self.torch.inference_mode():
            result = self.predictor([page])
        inference_done = time.perf_counter()
        exported = result.export()
        assert len(exported['pages']) == 1
        regions = []
        for block_index, block in enumerate(exported['pages'][0]['blocks']):
            for line_index, line in enumerate(block['lines']):
                for word_index, word in enumerate(line['words']):
                    bbox = box(word['geometry'], source['width'], source['height'])
                    regions.append({'bbox': bbox, 'text': word['value'], 'confidence': float(word['confidence']),
                        'detectorConfidence': float(word['objectness_score']),
                        'block_index': block_index, 'line_index': line_index, 'word_index': word_index})
        detector = []
        assert len(self.det_raw) == 1
        for words in self.det_raw[0].values():
            for x0, y0, x1, y1, confidence in words:
                detector.append({'bbox': box(((x0,y0),(x1,y1)), source['width'], source['height']), 'confidence': confidence})
        finished = time.perf_counter()
        diagnostic = {'official_export': exported, 'detector_after_db_before_crops': self.det_raw,
            'recognizer_split_crop_outputs': self.rec_diagnostics,
            'rec_shape_batches': self.rec_shapes, 'det_shape_batches': self.det_shapes}
        # 私有原始诊断落盘不计入单页引擎时间；结果消息的processing另含写盘。
        (Path(output)/(source['id']+'.raw.json')).write_text(json.dumps(diagnostic,ensure_ascii=False,indent=2)+'\n')
        row = {k: source[k] for k in ('id','sha256','width','height')}
        row.update(regions=regions, detectorRegions=detector, rawBeforeFiltering=regions,
            detector_unit='word', recognition_confidence_threshold=None,
            actual_detector_input_shape=self.det_shapes, resize={'original':[source['height'],source['width']],
                'detector_network':[1024,1024], 'preserve_aspect_ratio':True, 'symmetric_pad':True,
                'rec_crop_source':'original RGB image', 'coordinate_mapping':'unpadding by docTR, normalized x*original_width/y*original_height'},
            recognizer_diagnostics={'split_crop_count':len(self.rec_diagnostics),
                'split_crops_without_eos':sum(x['eos_missing'] for x in self.rec_diagnostics),
                'max_output_word_length':max((len(x['text']) for x in regions),default=0),
                'nominal_word_max_length':32, 'decoder_max_positions_including_eos':33},
            error=None, timing={'single_pass_seconds':finished-start, 'decode_seconds':prepared-start,
                'pipeline_seconds':inference_done-prepared, 'result_projection_seconds':finished-inference_done})
        return row
