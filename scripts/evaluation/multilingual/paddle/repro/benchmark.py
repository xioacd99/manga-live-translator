"""独立基准复现；输入留在本地，只有模型下载使用网络。"""
import time
START=time.perf_counter()
import os
for k in ('OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS'):os.environ[k]='1'
import argparse,json,hashlib,math,fcntl,platform,sys
from pathlib import Path

def cli():
 p=argparse.ArgumentParser()
 p.add_argument('--manifest',type=Path,required=True,help='JSON array with id,file,sha256,width,height')
 p.add_argument('--model-dir',type=Path,required=True)
 p.add_argument('--rtdetr',type=Path,help='Required for crop modes; JSON object with images list')
 p.add_argument('--lock',type=Path,required=True,help='Shared Unix flock path for ALL candidates')
 p.add_argument('--output',type=Path,required=True)
 p.add_argument('--mode',choices=['full','rec-only','inner-db-rec'],default='full')
 p.add_argument('--download-models',action='store_true',help='Download missing pinned official-derived RapidAI ONNX files')
 return p.parse_args()

def main():
 a=cli();a.output.mkdir(parents=True,exist_ok=True);a.model_dir.mkdir(parents=True,exist_ok=True)
 metadata=json.loads(Path(__file__).with_name('models.json').read_text())
 for m in metadata['models']:
  path=a.model_dir/m['name']
  if not path.exists():
   if not a.download_models:raise SystemExit(f'Missing model: {path}; supply file or --download-models')
   import urllib.request
   urllib.request.urlretrieve(m['download_url'],path)
  if hashlib.sha256(path.read_bytes()).hexdigest()!=m['sha256']:raise SystemExit(f'Model SHA256 mismatch: {path}')
 sources=json.loads(a.manifest.read_text());paths={}
 for s in sources:
  path=Path(s['file']);path=path if path.is_absolute() else a.manifest.parent/path
  if hashlib.sha256(path.read_bytes()).hexdigest()!=s['sha256']:raise SystemExit(f'Image SHA256 mismatch: {s["id"]}')
  paths[s['id']]=path
 upstream={}
 if a.mode!='full':
  if not a.rtdetr:raise SystemExit('Crop modes require --rtdetr')
  upstream={x['id']:x for x in json.loads(a.rtdetr.read_text())['images']}
 a.lock.parent.mkdir(parents=True,exist_ok=True)
 with a.lock.open('a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX);locked=time.perf_counter()
  import cv2,numpy as np
  from rapidocr import RapidOCR,OCRVersion,EngineType,LangDet,LangRec,ModelType
  from rapidocr.ch_ppocr_rec import TextRecInput
  from omegaconf import OmegaConf
  imported=time.perf_counter()
  params={'Det.engine_type':EngineType.ONNXRUNTIME,'Det.lang_type':LangDet.CH,'Det.model_type':ModelType.MOBILE,'Det.ocr_version':OCRVersion.PPOCRV5,'Rec.engine_type':EngineType.ONNXRUNTIME,'Rec.lang_type':LangRec.CH,'Rec.model_type':ModelType.MOBILE,'Rec.ocr_version':OCRVersion.PPOCRV5,'EngineConfig.onnxruntime.intra_op_num_threads':1,'EngineConfig.onnxruntime.inter_op_num_threads':1}
  for stage,model in zip(['Det','Rec','Cls'],metadata['models']):params[f'{stage}.model_path']=str(a.model_dir/model['name'])
  engine=RapidOCR(params=params);initialized=time.perf_counter()
  (a.output/'effective-config.yaml').write_text(OmegaConf.to_yaml(engine.cfg))
  def bbox(q):
   xs=[p[0] for p in q];ys=[p[1] for p in q];return dict(x=min(xs),y=min(ys),width=max(xs)-min(xs),height=max(ys)-min(ys))
  images=[]
  for s in sources:
   if a.mode!='full':assert upstream[s['id']]['sha256']==s['sha256']
   runs=[]
   for repeat in range(3):
    t=time.perf_counter();regions=[]
    if a.mode=='full':
     r=engine(str(paths[s['id']]),use_det=True,use_cls=True,use_rec=True)
     if r.boxes is not None:
      regions=[dict(bbox=bbox(q),quad=q,text=txt,confidence=float(score)) for q,txt,score in zip(r.boxes.tolist(),r.txts,r.scores)]
    else:
     im=cv2.imdecode(np.frombuffer(paths[s['id']].read_bytes(),np.uint8),cv2.IMREAD_COLOR);crops=[];boxes=[]
     for p in upstream[s['id']]['regions']:
      b=p['bbox'];x=max(0,math.floor(b['x']));y=max(0,math.floor(b['y']));x2=min(im.shape[1],math.ceil(b['x']+b['width']));y2=min(im.shape[0],math.ceil(b['y']+b['height']))
      if x2<=x or y2<=y:continue
      crops.append(im[y:y2,x:x2].copy());boxes.append((p,x,y,x2,y2))
     if a.mode=='rec-only' and crops:
      r=engine.text_rec(TextRecInput(img=crops))
      for (p,x,y,x2,y2),txt,score in zip(boxes,r.txts,r.scores):regions.append(dict(bbox=dict(x=x,y=y,width=x2-x,height=y2-y),text=txt,confidence=float(score),parentRegionId=p.get('regionId')))
     elif a.mode=='inner-db-rec':
      for crop,(p,x,y,x2,y2) in zip(crops,boxes):
       r=engine(crop,use_det=True,use_cls=True,use_rec=True)
       if r.boxes is None:continue
       for q,txt,score in zip(r.boxes.tolist(),r.txts,r.scores):
        q=[[qx+x,qy+y] for qx,qy in q];regions.append(dict(bbox=bbox(q),quad=q,text=txt,confidence=float(score),parentRegionId=p.get('regionId')))
    runs.append(dict(run=repeat,wall_seconds=time.perf_counter()-t,regions=regions))
   # 单独导出不计时的原始检测框，不改变已测OCR结果。
   if a.mode=='full':
    det=engine(str(paths[s['id']]),use_det=True,use_cls=False,use_rec=False)
    detectorRegions=[] if det.boxes is None else [dict(bbox=bbox(q),quad=q,confidence=float(score)) for q,score in zip(det.boxes.tolist(),det.scores)]
   else:detectorRegions=upstream[s['id']]['regions']
   item={k:s[k] for k in ['id','sha256','width','height']}
   item.update(regions=runs[0]['regions'],detectorRegions=detectorRegions,runs=runs,error=None,timing=dict(first_pass_seconds=runs[0]['wall_seconds'],warm_seconds=[r['wall_seconds'] for r in runs[1:]],warm_mean_seconds=sum(r['wall_seconds'] for r in runs[1:])/2,upstream_detector_timing=upstream.get(s['id'],{}).get('timing')))
   images.append(item);(a.output/f'{s["id"]}.json').write_text(json.dumps(item,ensure_ascii=False,indent=2));print(s['id'],[r['wall_seconds'] for r in runs],flush=True)
  scheme={'full':'paddle_db_rec','rec-only':'rtdetr_paddle_rec_only','inner-db-rec':'rtdetr_paddle_inner_db_rec'}[a.mode]
  result=dict(scheme=scheme,images=images,environment=dict(platform=platform.platform(),python=sys.version,cpu_threads=1,import_seconds=imported-locked,model_init_seconds=initialized-imported,lock_wait_excluded=True),timing_scope='Full: image decode + DB + classifier + recognition. Crop modes: decode + crops + Paddle, excludes RTDETR; upstream time attached, not measured pipeline total.')
  (a.output/'predictions.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
