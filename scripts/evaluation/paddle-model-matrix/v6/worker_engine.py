"""固定2048分辨率模型初始化；线程与识别batch由预冻结组参数指定，不使用GT。"""
import time
START=time.perf_counter()
import os
for key in ('OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS'):os.environ[key]='1'
import argparse,json,hashlib,fcntl,sys,platform,copy,resource
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--manifest',type=Path,required=True);p.add_argument('--model-manifest',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--lock',type=Path,required=True);p.add_argument('--candidate',choices=['v5_multi_legacy','v5_multi_bridge','v5_english','v6_small','v6_medium','v6_tiny','v6_small_paddle_params'],required=True);p.add_argument('--short-side',type=int,choices=[1024,1536,2048,2560],required=True);p.add_argument('--intra',type=int,required=True);p.add_argument('--rec-batch',type=int,required=True);p.add_argument('--det-key',required=True);p.add_argument('--rec-key',required=True);p.add_argument('--resize-mode',choices=['original','target'],required=True);a=p.parse_args()
a.output.mkdir(parents=True,exist_ok=True);sources=json.loads(a.manifest.read_text());models=json.loads(a.model_manifest.read_text())
selection=(a.det_key,a.rec_key)
for key in [*selection,'legacy_cls']:
 assert hashlib.sha256(Path(models[key]['path']).read_bytes()).hexdigest()==models[key]['sha256'],key
for s in sources:
 assert hashlib.sha256(Path(s['file']).read_bytes()).hexdigest()==s['sha256'],s['id']
LOCKED=time.perf_counter() # 外层协调器独占共享锁，worker不重复加锁
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
 def preprocess_img(self, ori_img):
  if a.resize_mode=='original':
   img,record=super().preprocess_img(ori_img)
   self.last_resize={'original':list(ori_img.shape[:2]),'preprocess':list(img.shape[:2]),'rule':'original_Global2000_Det_min736'}
   return img,record
  h,w=ori_img.shape[:2]
  ratio=min(a.short_side/min(h,w),4096/max(h,w))
  nh,nw=max(1,round(h*ratio)),max(1,round(w*ratio))
  img=cv2.resize(ori_img,(nw,nh),interpolation=cv2.INTER_LINEAR)
  self.last_resize={'original':[h,w],'preprocess':[nh,nw],'detector_tensor':[round(nh/32)*32,round(nw/32)*32],'rule':f'short{a.short_side}_cap4096','target_short':a.short_side,'long_cap_active':4096/max(h,w)<a.short_side/min(h,w),'achieved_short':min(nh,nw),'interpolation':'INTER_LINEAR'}
  return img,{'preprocess':{'ratio_h':h/nh,'ratio_w':w/nw}}

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
params={'Det.engine_type':EngineType.ONNXRUNTIME,'Rec.engine_type':EngineType.ONNXRUNTIME,'Cls.engine_type':EngineType.ONNXRUNTIME,'EngineConfig.onnxruntime.intra_op_num_threads':a.intra,'EngineConfig.onnxruntime.inter_op_num_threads':1,'Det.model_path':models[selection[0]]['path'],'Rec.model_path':models[selection[1]]['path'],'Cls.model_path':models['legacy_cls']['path'],'Det.lang_type':LangDet.CH,'Rec.lang_type':LangRec.EN if a.candidate=='v5_english' else LangRec.CH,'Det.limit_side_len':736,'Det.limit_type':'min','Det.box_thresh':0.5,'Det.thresh':0.3,'Det.unclip_ratio':1.6,'Global.text_score':0.5,'Rec.rec_img_shape':[3,48,320],'Rec.rec_batch_num':a.rec_batch}
if a.candidate.startswith('v6'):
 size={'v6_small':ModelType.SMALL,'v6_medium':ModelType.MEDIUM,'v6_tiny':ModelType.TINY,'v6_small_paddle_params':ModelType.SMALL}[a.candidate]
 params.update({'Det.model_type':size,'Rec.model_type':size,'Det.ocr_version':OCRVersion.PPOCRV6,'Rec.ocr_version':OCRVersion.PPOCRV6})
else:params.update({'Det.model_type':ModelType.MOBILE,'Rec.model_type':ModelType.MOBILE,'Det.ocr_version':OCRVersion.PPOCRV5,'Rec.ocr_version':OCRVersion.PPOCRV5})
# 第7组仅预先指定det参数敏感性，权重、缩放、识别器及分类器均保持不变。
if a.candidate=='v6_small_paddle_params':
 params.update({'Det.mean':[0.485,0.456,0.406],'Det.std':[0.229,0.224,0.225],'Det.thresh':0.2,'Det.box_thresh':0.45,'Det.unclip_ratio':1.4,'Det.max_candidates':3000,'Det.use_dilation':False})
params.update({'Det.limit_side_len':4096,'Det.limit_type':'max','Global.max_side_len':4096})
if a.resize_mode=='original':params.update({'Det.limit_side_len':736,'Det.limit_type':'min','Global.max_side_len':2000})
for stage,key in [('Det',a.det_key),('Rec',a.rec_key)]:
 params[stage+'.model_type']={'tiny':ModelType.TINY,'small':ModelType.SMALL,'medium':ModelType.MEDIUM}[key.split('_')[1]]
engine=CapturingOCR(params=params)
# 3.10采用lazy loading；显式载入三子模型，使cached init和首次推理边界一致。
if hasattr(engine,'_load_det_model'):
 engine._load_det_model();engine._load_cls_model();engine._load_rec_model()
INITIALIZED=time.perf_counter()
class ObservedDetSession:
 def __init__(self, inner): self.inner=inner;self.last_shape=None
 def __getattr__(self, name):return getattr(self.inner,name)
 def __call__(self, tensor):
  self.last_shape=list(tensor.shape)
  return self.inner(tensor)
engine.text_det.session=ObservedDetSession(engine.text_det.session)

session_details={}
for stage in ['det','cls','rec']:
 session=getattr(engine,'text_'+stage).session.session;options=session.get_session_options();meta=session.get_modelmeta().custom_metadata_map
 session_details[stage]={'providers':session.get_providers(),'intra_op_threads':options.intra_op_num_threads,'inter_op_threads':options.inter_op_num_threads,'inputs':[{'name':v.name,'shape':v.shape} for v in session.get_inputs()],'outputs':[{'name':v.name,'shape':v.shape} for v in session.get_outputs()],'dictionary_source':'ONNX embedded character metadata' if 'character' in meta else None,'dictionary_entries':len(meta['character'].splitlines()) if 'character' in meta else None,'dictionary_sha256':hashlib.sha256(meta['character'].encode()).hexdigest() if 'character' in meta else None}
session_details['rec']['decoder_dictionary_entries_including_blank']=len(engine.text_rec.postprocess_op.character)
(a.output/'session-details.json').write_text(json.dumps(session_details,indent=2))
(a.output/'effective-config.yaml').write_text(OmegaConf.to_yaml(engine.cfg))
