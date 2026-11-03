import os
os.environ['OMP_THREAD_LIMIT']='1'
os.environ['OMP_NUM_THREADS']='1'
import ctypes as C, ctypes.util, csv, io, json, time, hashlib, pathlib, subprocess, fcntl, platform
import numpy as np
from PIL import Image
import argparse
P=argparse.ArgumentParser(description='本地中文Tesseract与RTDETR裁剪OCR复现；不上传图片。')
P.add_argument('--sources',required=True,type=pathlib.Path,help='十图来源JSON；需含id和file/path/local_path及sha256')
P.add_argument('--model-dir',required=True,type=pathlib.Path,help='含chi_sim、chi_sim_vert和detector-v4-s_int8.onnx')
P.add_argument('--ort-dir',required=True,type=pathlib.Path,help='已安装的onnxruntime-web包根目录')
P.add_argument('--repo-root',required=True,type=pathlib.Path,help='产品仓库根目录，含extension/adapters/pretrained-regions.js')
P.add_argument('--output',required=True,type=pathlib.Path,help='仅本地保存结果的目录')
P.add_argument('--lock',type=pathlib.Path,help='各候选共同使用的推理锁；默认output父目录/inference.lock')
ARGS=P.parse_args()
for key in ['sources','model_dir','ort_dir','repo_root','output']:
 setattr(ARGS,key,getattr(ARGS,key).resolve())
ROOT=ARGS.output;ROOT.mkdir(parents=True,exist_ok=True)
SRC=ARGS.sources.parent
SCRIPT_DIR=pathlib.Path(__file__).resolve().parent
for name,meta in json.loads((SCRIPT_DIR/'model-provenance.json').read_text())['files'].items():
 if name.endswith('.traineddata'):
  file=ARGS.model_dir/name
  assert file.stat().st_size==meta['bytes'] and hashlib.sha256(file.read_bytes()).hexdigest()==meta['sha256'],f'模型校验失败: {name}'
assert hashlib.sha256((ARGS.repo_root/'extension/adapters/pretrained-regions.js').read_bytes()).hexdigest()==json.loads((SCRIPT_DIR/'runtime-metadata.json').read_text())['production_module_sha256'],'产品检测适配模块版本不一致，请使用固定版本'
assert hashlib.sha256((ARGS.model_dir/'detector-v4-s_int8.onnx').read_bytes()).hexdigest()=='5fe9e4f576e49d4e7e8b0e029d6d3cdc252abd4694113e1cae120e62c931ea79','检测模型校验失败'
ms=lambda:time.perf_counter()*1000
class Tess:
 def __init__(self):
  t=ms(); self.lib=C.CDLL(ctypes.util.find_library('tesseract')); l=self.lib
  for name,args,ret in [('TessVersion',[],C.c_char_p),('TessBaseAPICreate',[],C.c_void_p),('TessBaseAPIInit3',[C.c_void_p,C.c_char_p,C.c_char_p],C.c_int),('TessBaseAPISetPageSegMode',[C.c_void_p,C.c_int],None),('TessBaseAPISetImage',[C.c_void_p,C.c_void_p,C.c_int,C.c_int,C.c_int,C.c_int],None),('TessBaseAPIRecognize',[C.c_void_p,C.c_void_p],C.c_int),('TessBaseAPIGetTsvText',[C.c_void_p,C.c_int],C.c_void_p),('TessBaseAPIGetUTF8Text',[C.c_void_p],C.c_void_p),('TessDeleteText',[C.c_void_p],None),('TessBaseAPIDelete',[C.c_void_p],None),('TessBaseAPIClearAdaptiveClassifier',[C.c_void_p],None)]:
   f=getattr(l,name);f.argtypes=args;f.restype=ret
  self.api=l.TessBaseAPICreate(); assert l.TessBaseAPIInit3(self.api,str(ARGS.model_dir).encode(),b'chi_sim')==0
  self.init_ms=ms()-t; self.version=l.TessVersion().decode()
 def recognize(self,im,psm):
  t=ms(); a=np.ascontiguousarray(im.convert('RGB')); h,w,_=a.shape;l=self.lib
  l.TessBaseAPIClearAdaptiveClassifier(self.api);l.TessBaseAPISetPageSegMode(self.api,psm)
  l.TessBaseAPISetImage(self.api,a.ctypes.data,w,h,3,w*3);assert l.TessBaseAPIRecognize(self.api,None)==0
  p=l.TessBaseAPIGetTsvText(self.api,0);tsv=C.string_at(p).decode();l.TessDeleteText(p)
  p=l.TessBaseAPIGetUTF8Text(self.api);text=C.string_at(p).decode();l.TessDeleteText(p)
  words=[]
  for r in csv.DictReader(io.StringIO(tsv),fieldnames=['level','page_num','block_num','par_num','line_num','word_num','left','top','width','height','conf','text'],delimiter='\t',quoting=csv.QUOTE_NONE):
   if int(r['level'])==5 and (r.get('text') or '').strip(): words.append({'text':r['text'],'confidence':float(r['conf']),'bbox':{k:int(r[v]) for k,v in [('x','left'),('y','top'),('width','width'),('height','height')]}})
  return {'text':text,'words':words,'recognition_ms':ms()-t,'psm':psm}
 def close(self):self.lib.TessBaseAPIDelete(self.api)
def sources():
 d=json.loads(ARGS.sources.read_text()); d=d if isinstance(d,list) else d.get('samples',d.get('sources',d.get('images')))
 assert len(d)==10, f'Expected exactly 10 new Chinese samples, got {len(d)}'
 out=[]
 for i,s in enumerate(d):
  p=s.get('local_path',s.get('path',s.get('file',s.get('filename')))); p=pathlib.Path(p)
  if not p.is_absolute():p=SRC/p if (SRC/p).exists() else SRC/'images'/p
  assert p.exists(),p
  assert hashlib.sha256(p.read_bytes()).hexdigest()==s['sha256'],f'来源图片hash不符: {p}'
  out.append({'id':s.get('id',p.stem),'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
 return out

def main():
 samples=sources();run={ 'samples':samples,'provenance':json.loads((SCRIPT_DIR/'model-provenance.json').read_text()),'notes':['All compute local, no uploads. Copyright sample images and OCR text are temporary local benchmark data.','CPU-only OMP_THREAD_LIMIT=1. Persistent libtesseract instance reused across first/warm1/warm2, not CLI process per image.','First pass is first image use, not cold OS cache. Separate runtime initialization measured. Adaptive classifier cleared before every call.','Whole image original resolution PSM11; only if no recognized non-whitespace text then PSM3.','Detected text crops padded by 4 original pixels on each side, resized 2x using Pillow bicubic; PSM6; no empty-crop fallback.','Detector matches production tile plan/decoding/selection, ONNXRuntime Web WASM 1 thread; Pillow bilinear RGB resize differs from browser canvas.'], 'environment':{'platform':platform.platform(),'python':platform.python_version()}}
 with open(ARGS.lock or ROOT.parent/'inference.lock','w') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX)
  tess=Tess();run['tesseract_version']=tess.version;run['tesseract_init_ms']=tess.init_ms
  run['whole_image']=[]
  for sample in samples:
   im=Image.open(sample['path']).convert('RGB');r={'id':sample['id'],'runs':[]}
   for repeat in range(3):
    t=ms();o=tess.recognize(im,11)
    if not o['text'].strip():
     initial=o;o=tess.recognize(im,3);o['fallback_initial_psm11_ms']=initial['recognition_ms']
    o['total_ms']=ms()-t;o['phase']=['first','warm1','warm2'][repeat];r['runs'].append(o)
   run['whole_image'].append(r);print('whole',sample['id'],flush=True)
   (ROOT/'results-partial.json').write_text(json.dumps(run,ensure_ascii=False,indent=2))
  tess.close()
  # Generate raw tile pixels using same production tile plan. Include this separate preprocessing in detector timing.
  prep=[];rawdir=ROOT/'tile-rgb';rawdir.mkdir(exist_ok=True)
  for sample in samples:
   t=ms();im=Image.open(sample['path']).convert('RGB');w,h=im.size
   th=min(h,max(1, int(w*1.5+0.5))) if h>w*2 else h;stride=max(1,int(th*0.8));tiles=[];y=0
   while True:
    p=rawdir/f'{sample["id"]}-{y}.rgb'
    p.write_bytes(im.crop((0,y,w,y+th)).resize((640,640),Image.Resampling.BILINEAR).tobytes());tiles.append({'x':0,'y':y,'width':w,'height':th,'raw':str(p)})
    if y+th==h:break
    y=min(y+stride,h-th)
   prep.append({**sample,'width':w,'height':h,'tiles':tiles,'preprocess_ms':ms()-t})
  (ROOT/'detector-input.json').write_text(json.dumps(prep))
  subprocess.run(['node',str(SCRIPT_DIR/'detect.mjs'),str(ROOT),str(ARGS.model_dir),str(ARGS.ort_dir),str(ARGS.repo_root)],check=True)
  run['detector']=json.loads((ROOT/'detector-results.json').read_text());
  shared={'scheme':'rtdetr-v4-s-int8','images':[{**sample,'width':Image.open(sample['path']).width,'height':Image.open(sample['path']).height,'regions':det['runs'][0]['selection']['regions'],'raw_candidates':det['runs'][0]['candidates'],'timing':{'runs':[{k:v for k,v in r.items() if k not in ['selection','candidates']} for r in det['runs']],'preprocess_ms':det['preprocess_ms']},'error':None} for sample,det in zip(samples,run['detector']['samples'])]};(ROOT/'rtdetr-regions.json').write_text(json.dumps(shared,ensure_ascii=False,indent=2));
  tess=Tess();run['cropped_tesseract_init_ms']=tess.init_ms;run['cropped']=[]
  for sample,det in zip(samples,run['detector']['samples']):
   im=Image.open(sample['path']).convert('RGB');r={'id':sample['id'],'runs':[]}
   for repeat in range(3):
    t=ms();regions=[];ocr_ms=0;prep_ms=0
    selected=det['runs'][repeat]['selection']['regions']
    if not selected: selected=[{'regionId':'fallback-whole','bbox':{'x':0,'y':0,'width':im.width,'height':im.height},'confidence':None}]
    for region in selected:
     tprep=ms();b=region['bbox'];x=max(0,b['x']-4);y=max(0,b['y']-4);rgt=min(im.width,b['x']+b['width']+4);btm=min(im.height,b['y']+b['height']+4)
     crop=im.crop((x,y,rgt,btm));crop=crop.resize((crop.width*2,crop.height*2),Image.Resampling.BICUBIC);prep_ms+=ms()-tprep
     o=tess.recognize(crop,6);ocr_ms+=o['recognition_ms']
     for word in o['words']:
      cb=word['bbox'];word['bbox']={'x':x+cb['x']/2,'y':y+cb['y']/2,'width':cb['width']/2,'height':cb['height']/2}
     regions.append({**region,**o,'crop_bbox':{'x':x,'y':y,'width':rgt-x,'height':btm-y}})
    dr=det['runs'][repeat];r['runs'].append({'phase':['first','warm1','warm2'][repeat],'regions':regions,'text':'\n'.join(q['text'] for q in regions),'recognition_ms':ocr_ms,'crop_preprocess_ms':prep_ms,'detector_ms':dr['total_ms']+det['preprocess_ms'],'total_ms':ms()-t+dr['total_ms']+det['preprocess_ms']})
   run['cropped'].append(r);print('crop',sample['id'],len(selected),flush=True);(ROOT/'results-partial.json').write_text(json.dumps(run,ensure_ascii=False,indent=2))
  tess.close();(ROOT/'results.json').write_text(json.dumps(run,ensure_ascii=False,indent=2));export_predictions(run);print('DONE',flush=True)
def export_predictions(run):
 for key,scheme in [('whole_image','tesseract-best-whole-psm11'),('cropped','rtdetr-tesseract-best-crop2x-psm6')]:
  images=[]
  for sample,result in zip(run['samples'],run[key]):
   im=Image.open(sample['path']);r=result['runs'][0]
   regions=r['words'] if key=='whole_image' else [w for q in r['regions'] for w in q['words']]
   entry={**sample,'width':im.width,'height':im.height,'regions':regions,'text':r['text'],'timing':{'runs':[{k:v for k,v in x.items() if k.endswith('_ms') or k=='phase'} for x in result['runs']]},'error':None}
   if key=='cropped':entry['detectorRegions']=next(x for x in run['detector']['samples'] if x['id']==sample['id'])['runs'][0]['selection']['regions']
   images.append(entry)
  (ROOT/(scheme+'-predictions.json')).write_text(json.dumps({'scheme':scheme,'images':images,'environment':run['environment'],'tesseract_version':run['tesseract_version'],'tesseract_init_ms':run['tesseract_init_ms'],'notes':run['notes']},ensure_ascii=False,indent=2))
if __name__=='__main__':main()
