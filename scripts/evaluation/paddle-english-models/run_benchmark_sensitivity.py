"""固定模型、单线程CPU；记录整图检测识别三遍墙钟和过滤前结果，不使用GT。"""
import time
START=time.perf_counter()
import os
for key in ('OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS'):os.environ[key]='1'
import argparse,json,hashlib,fcntl,sys,platform,copy
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--manifest',type=Path,required=True);p.add_argument('--model-manifest',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--lock',type=Path,required=True);p.add_argument('--candidate',choices=['v5_multi_legacy','v5_multi_bridge','v5_english','v6_small','v6_medium','v6_tiny','v6_small_paddle_params'],required=True);a=p.parse_args()
a.output.mkdir(parents=True,exist_ok=True);sources=json.loads(a.manifest.read_text());models=json.loads(a.model_manifest.read_text())
selection={'v5_multi_legacy':('v5_det','v5_multi_rec'),'v5_multi_bridge':('v5_det','v5_multi_rec'),'v5_english':('v5_det','v5_en_rec'),'v6_small':('v6_small_det','v6_small_rec'),'v6_medium':('v6_medium_det','v6_medium_rec'),'v6_tiny':('v6_tiny_det','v6_tiny_rec'),'v6_small_paddle_params':('v6_small_det','v6_small_rec')}[a.candidate]
for key in [*selection,'legacy_cls']:
 assert hashlib.sha256(Path(models[key]['path']).read_bytes()).hexdigest()==models[key]['sha256'],key
for s in sources:
 assert hashlib.sha256(Path(s['file']).read_bytes()).hexdigest()==s['sha256'],s['id']
lock=a.lock.open('a');fcntl.flock(lock,fcntl.LOCK_EX);LOCKED=time.perf_counter()
from rapidocr import RapidOCR,EngineType,LangDet,LangRec,ModelType,OCRVersion
from rapidocr.utils.process_img import map_boxes_to_original
from omegaconf import OmegaConf
import importlib.metadata,cv2,onnxruntime
cv2.setNumThreads(1)
IMPORTED=time.perf_counter()
version=importlib.metadata.version('rapidocr');assert version==('3.4.5' if a.candidate=='v5_multi_legacy' else '3.10.0')
def bbox(q):
 xs=[float(v[0]) for v in q];ys=[float(v[1]) for v in q];return dict(x=min(xs),y=min(ys),width=max(xs)-min(xs),height=max(ys)-min(ys))
class CapturingOCR(RapidOCR):
 def __call__(self,*args,**kwargs):
  self.last_raw=[]
  return super().__call__(*args,**kwargs)
 def build_final_output(self,ori_img,det_res,cls_res,rec_res,cropped_img_list,op_record):
  # 只观察过滤前结果；坐标映射使用库自己的函数，不修改参与识别的数据。
  raw=[]
  if det_res.boxes is not None:
   boxes=map_boxes_to_original(det_res.boxes.copy(),copy.deepcopy(op_record),*ori_img.shape[:2]).tolist()
   for i,q in enumerate(boxes):
    txt=rec_res.txts[i] if rec_res.txts is not None and i<len(rec_res.txts) else None
    score=float(rec_res.scores[i]) if rec_res.txts is not None and i<len(rec_res.scores) else None
    raw.append({'bbox':bbox(q),'quad':q,'detectorConfidence':float(det_res.scores[i]) if det_res.scores is not None else None,'text':txt,'confidence':score,'blank':not bool(txt and txt.strip()),'belowThreshold':score is not None and score<self.text_score})
  self.last_raw=raw
  return super().build_final_output(ori_img,det_res,cls_res,rec_res,cropped_img_list,op_record)
params={'Det.engine_type':EngineType.ONNXRUNTIME,'Rec.engine_type':EngineType.ONNXRUNTIME,'Cls.engine_type':EngineType.ONNXRUNTIME,'EngineConfig.onnxruntime.intra_op_num_threads':1,'EngineConfig.onnxruntime.inter_op_num_threads':1,'Det.model_path':models[selection[0]]['path'],'Rec.model_path':models[selection[1]]['path'],'Cls.model_path':models['legacy_cls']['path'],'Det.lang_type':LangDet.CH,'Rec.lang_type':LangRec.EN if a.candidate=='v5_english' else LangRec.CH,'Det.limit_side_len':736,'Det.limit_type':'min','Det.box_thresh':0.5,'Det.thresh':0.3,'Det.unclip_ratio':1.6,'Global.text_score':0.5,'Rec.rec_img_shape':[3,48,320],'Rec.rec_batch_num':6}
if a.candidate.startswith('v6'):
 size={'v6_small':ModelType.SMALL,'v6_medium':ModelType.MEDIUM,'v6_tiny':ModelType.TINY,'v6_small_paddle_params':ModelType.SMALL}[a.candidate]
 params.update({'Det.model_type':size,'Rec.model_type':size,'Det.ocr_version':OCRVersion.PPOCRV6,'Rec.ocr_version':OCRVersion.PPOCRV6})
else:params.update({'Det.model_type':ModelType.MOBILE,'Rec.model_type':ModelType.MOBILE,'Det.ocr_version':OCRVersion.PPOCRV5,'Rec.ocr_version':OCRVersion.PPOCRV5})
# 第7组仅预先指定det参数敏感性，权重、缩放、识别器及分类器均保持不变。
if a.candidate=='v6_small_paddle_params':
 params.update({'Det.mean':[0.485,0.456,0.406],'Det.std':[0.229,0.224,0.225],'Det.thresh':0.2,'Det.box_thresh':0.45,'Det.unclip_ratio':1.4,'Det.max_candidates':3000,'Det.use_dilation':False})
engine=CapturingOCR(params=params)
# 3.10采用lazy loading；显式载入三子模型，使cached init和首次推理边界一致。
if hasattr(engine,'_load_det_model'):
 engine._load_det_model();engine._load_cls_model();engine._load_rec_model()
INITIALIZED=time.perf_counter()
session_details={}
for stage in ['det','cls','rec']:
 session=getattr(engine,'text_'+stage).session.session;options=session.get_session_options();meta=session.get_modelmeta().custom_metadata_map
 session_details[stage]={'providers':session.get_providers(),'intra_op_threads':options.intra_op_num_threads,'inter_op_threads':options.inter_op_num_threads,'inputs':[{'name':v.name,'shape':v.shape} for v in session.get_inputs()],'outputs':[{'name':v.name,'shape':v.shape} for v in session.get_outputs()],'dictionary_source':'ONNX embedded character metadata' if 'character' in meta else None,'dictionary_entries':len(meta['character'].splitlines()) if 'character' in meta else None,'dictionary_sha256':hashlib.sha256(meta['character'].encode()).hexdigest() if 'character' in meta else None}
session_details['rec']['decoder_dictionary_entries_including_blank']=len(engine.text_rec.postprocess_op.character)
(a.output/'session-details.json').write_text(json.dumps(session_details,indent=2))
(a.output/'effective-config.yaml').write_text(OmegaConf.to_yaml(engine.cfg))
images=[]
for s in sources:
 runs=[]
 for repeat in range(3):
  t=time.perf_counter();r=engine(s['file']);elapsed=time.perf_counter()-t
  regions=[] if r.boxes is None else [{'bbox':bbox(q),'quad':q,'text':txt,'confidence':float(score)} for q,txt,score in zip(r.boxes.tolist(),r.txts,r.scores)]
  runs.append({'run':repeat,'wall_seconds':elapsed,'regions':regions,'rawBeforeFiltering':engine.last_raw})
 item={k:s[k] for k in ('id','sha256','width','height')};raw=runs[0]['rawBeforeFiltering']
 item.update({'regions':runs[0]['regions'],'detectorRegions':[{'bbox':v['bbox'],'quad':v['quad'],'confidence':v['detectorConfidence']} for v in raw],'rawBeforeFiltering':raw,'diagnostics':{'raw_detector_count':len(raw),'blank_recognition_count':sum(v['blank'] for v in raw),'below_threshold_count':sum(v['belowThreshold'] for v in raw),'filtered_recognition_count':len(runs[0]['regions'])},'runs':runs,'timing':{'first_pass_seconds':runs[0]['wall_seconds'],'warm_seconds':[v['wall_seconds'] for v in runs[1:]],'warm_mean_seconds':sum(v['wall_seconds'] for v in runs[1:])/2},'error':None})
 images.append(item);(a.output/(s['id']+'.json')).write_text(json.dumps(item,ensure_ascii=False,indent=2));print(s['id'],item['diagnostics'],[round(v['wall_seconds'],4) for v in runs],flush=True)
result={'scheme':a.candidate,'images':images,'model_selection':{k:models[k] for k in [*selection,'legacy_cls']},'environment':{'python':sys.version,'platform':platform.platform(),'rapidocr':version,'onnxruntime':onnxruntime.__version__,'opencv':cv2.__version__,'opencv_threads':cv2.getNumThreads(),'sessions':session_details,'cpu_threads':1,'import_seconds':IMPORTED-LOCKED,'cached_model_init_seconds':INITIALIZED-IMPORTED,'cold_import_plus_init_seconds':INITIALIZED-LOCKED,'lock_wait_excluded':True},'manifest_sha256':hashlib.sha256(a.manifest.read_bytes()).hexdigest(),'timing_scope':'cached weights; whole image load+preprocess+DB+angle cls+rec+postprocess+raw capture; 1 first pass plus 2 warm per image. No model downloads or lock wait included.'}
(a.output/'predictions.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));fcntl.flock(lock,fcntl.LOCK_UN)
