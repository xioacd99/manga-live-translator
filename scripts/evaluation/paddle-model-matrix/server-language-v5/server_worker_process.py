"""server候选的独立worker接口；具体矩阵与共享锁由协调器冻结管理。"""
import os
for k in ['OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS','NUMEXPR_NUM_THREADS']:os.environ[k]='1'
import argparse,json,time,sys,hashlib,fcntl,multiprocessing as mp,threading,traceback,queue
from pathlib import Path
def worker(wid,cfg,iq,oq):
 try:
  out=Path(cfg['output'])/f'worker-{wid}';out.mkdir(parents=True,exist_ok=True)
  sys.path.insert(0,str(Path(cfg['engine']).resolve().parent))
  sys.argv=[cfg['engine'],'--manifest',cfg['manifest'],'--model-manifest',cfg['models'],'--output',str(out),'--lock',cfg['lock'],'--candidate',cfg['candidate'],'--short-side',str(cfg['short']),'--det-key',cfg['det'],'--rec-key',cfg['rec'],'--resize-mode',cfg['resize_mode'],'--intra',str(cfg['intra']),'--rec-batch',str(cfg['batch'])]
  g={'__name__':'benchmark_worker_engine','__file__':cfg['engine']};t=time.perf_counter();exec(compile(Path(cfg['engine']).read_text(),cfg['engine'],'exec'),g)
  e=g['engine'];oq.put({'kind':'ready','worker':wid,'pid':os.getpid(),'initialization_wall_seconds':time.perf_counter()-t,'import_seconds':g['IMPORTED']-g['LOCKED'],'model_init_seconds':g['INITIALIZED']-g['IMPORTED'],'session_details':g['session_details'],'opencv_threads':g['cv2'].getNumThreads(),'rapidocr':g['version'],'onnxruntime':g['onnxruntime'].__version__,'model_selection':{k:g['models'][k] for k in [*g['selection'],'legacy_cls']}})
  while True:
   job=iq.get()
   if job is None:break
   start=time.perf_counter();s=job['source'];t=time.perf_counter();r=e(s['file']);infer=time.perf_counter()-t
   regions=[] if r.boxes is None else [{'bbox':g['bbox'](q),'quad':q,'text':text,'confidence':float(score)} for q,text,score in zip(r.boxes.tolist(),r.txts,r.scores)]
   raw=e.last_raw
   result={k:s[k] for k in ['id','sha256','width','height']}
   result.update({'regions':regions,'detectorRegions':[{'bbox':v['bbox'],'quad':v['quad'],'confidence':v['detectorConfidence']} for v in raw],'rawBeforeFiltering':raw,'resize':e.last_resize,'actual_detector_input_shape':e.text_det.session.last_shape,'error':None})
   end=time.perf_counter()
   oq.put({'kind':'result','worker':wid,'round':job['round'],'index':job['index'],'submitted_at':job['submitted_at'],'start_at':start,'complete_at':end,'queue_wait_seconds':start-job['submitted_at'],'processing_wall_seconds':end-start,'engine_wall_seconds':infer,'image':result})
 except BaseException:
  oq.put({'kind':'error','worker':wid,'traceback':traceback.format_exc()})
