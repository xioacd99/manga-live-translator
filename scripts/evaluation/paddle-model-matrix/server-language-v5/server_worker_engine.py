"""v5 server及交叉候选初始化；共同2048分支复用冻结基线，native960单列，不使用GT。"""
import time
START=time.perf_counter()
import os
for key in ('OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS'):os.environ[key]='1'
import argparse,json,hashlib,fcntl,sys,platform,copy,resource
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--manifest',type=Path,required=True);p.add_argument('--model-manifest',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--lock',type=Path,required=True);p.add_argument('--candidate',choices=['v5_server_native960','v5_server_common2048','v6small_det_server_rec_common2048','server_det_v6medium_rec_common2048'],required=True);p.add_argument('--short-side',type=int,choices=[960,1024,1536,2048,2560],required=True);p.add_argument('--intra',type=int,required=True);p.add_argument('--rec-batch',type=int,required=True);p.add_argument('--det-key',required=True);p.add_argument('--rec-key',required=True);p.add_argument('--resize-mode',choices=['original','target'],required=True);a=p.parse_args()
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
  if a.candidate=='v5_server_native960':
   self.last_resize={'original':list(ori_img.shape[:2]),'preprocess':list(ori_img.shape[:2]),'rule':'native960_det_internal_ceil128_rec_original'}
   return ori_img,{'preprocess':{'ratio_h':1.0,'ratio_w':1.0}}
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
assert a.intra==1 and a.rec_batch==6 and a.short_side==(960 if a.candidate=='v5_server_native960' else 2048) and a.resize_mode=='target'
expected={'v5_server_native960':('v5_server_det','v5_server_rec'),'v5_server_common2048':('v5_server_det','v5_server_rec'),'v6small_det_server_rec_common2048':('v6_small_det','v5_server_rec'),'server_det_v6medium_rec_common2048':('v5_server_det','v6_medium_rec')}
assert selection==expected[a.candidate],(selection,expected[a.candidate])
params={'Det.engine_type':EngineType.ONNXRUNTIME,'Rec.engine_type':EngineType.ONNXRUNTIME,'Cls.engine_type':EngineType.ONNXRUNTIME,'EngineConfig.onnxruntime.intra_op_num_threads':1,'EngineConfig.onnxruntime.inter_op_num_threads':1,'Det.model_path':models[a.det_key]['path'],'Rec.model_path':models[a.rec_key]['path'],'Cls.model_path':models['legacy_cls']['path'],'Det.lang_type':LangDet.CH,'Rec.lang_type':LangRec.CH,'Global.text_score':0.5,'Rec.rec_img_shape':[3,48,320],'Rec.rec_batch_num':6,'Det.limit_side_len':4096,'Det.limit_type':'max','Global.max_side_len':4096}
for stage,key in [('Det',a.det_key),('Rec',a.rec_key)]:
 params[stage+'.ocr_version']=OCRVersion.PPOCRV5 if key.startswith('v5_server_') else OCRVersion.PPOCRV6
 params[stage+'.model_type']=ModelType.SERVER if key.startswith('v5_server_') else {'small':ModelType.SMALL,'medium':ModelType.MEDIUM}[key.split('_')[1]]
params.update({'Det.mean':[0.485,0.456,0.406],'Det.std':[0.229,0.224,0.225],'Det.use_dilation':False,'Det.score_mode':'fast'})
if a.det_key=='v5_server_det':
 params.update({'Det.thresh':0.3,'Det.box_thresh':0.6,'Det.unclip_ratio':1.5,'Det.max_candidates':1000})
else:
 # 完全沿用已有v6 small敏感参数基线；不套server DB阈值。
 params.update({'Det.thresh':0.2,'Det.box_thresh':0.45,'Det.unclip_ratio':1.4,'Det.max_candidates':3000})
if a.rec_key=='v5_server_rec':
 dictionary=models[a.rec_key]['dictionary'];assert hashlib.sha256(Path(dictionary['derived_path']).read_bytes()).hexdigest()==dictionary['derived_sha256']
 params['Rec.rec_keys_path']=dictionary['derived_path']
if a.candidate=='v5_server_native960':
 params.update({'Global.use_preprocess_img':False,'Global.use_vertical_padding':False,'Det.limit_side_len':960})
engine=CapturingOCR(params=params)
# 3.10采用lazy loading；显式载入三子模型，使cached init和首次推理边界一致。
if hasattr(engine,'_load_det_model'):
 engine._load_det_model();engine._load_cls_model();engine._load_rec_model()
if a.det_key=='v5_server_det':
 from server_preprocess_adapter import install_server_default_preprocess,install_server_common_preprocess
 server_adapter=install_server_default_preprocess(engine,960) if a.candidate=='v5_server_native960' else install_server_common_preprocess(engine)
if a.rec_key=='v5_server_rec':
 assert len(engine.text_rec.postprocess_op.character)==18385
 assert engine.text_rec.session.session.get_outputs()[0].shape[-1]==18385
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
 session_details[stage]={'providers':session.get_providers(),'intra_op_threads':options.intra_op_num_threads,'inter_op_threads':options.inter_op_num_threads,'inputs':[{'name':v.name,'shape':v.shape} for v in session.get_inputs()],'outputs':[{'name':v.name,'shape':v.shape} for v in session.get_outputs()],'dictionary_source':'ONNX embedded character metadata' if 'character' in meta else ('official server YAML external dictionary' if stage=='rec' and a.rec_key=='v5_server_rec' else None),'dictionary_entries':len(meta['character'].splitlines()) if 'character' in meta else None,'dictionary_sha256':hashlib.sha256(meta['character'].encode()).hexdigest() if 'character' in meta else None}
session_details['rec']['decoder_dictionary_entries_including_blank']=len(engine.text_rec.postprocess_op.character)
if a.rec_key=='v5_server_rec':
 session_details['rec'].update(dictionary_entries=models[a.rec_key]['dictionary']['dictionary_entries'],dictionary_sha256=models[a.rec_key]['dictionary']['derived_sha256'],dictionary_hash_format='LF dictionary file with final LF; distinct from embedded character metadata string')
(a.output/'session-details.json').write_text(json.dumps(session_details,indent=2))
(a.output/'effective-config.yaml').write_text(OmegaConf.to_yaml(engine.cfg))
