"""单遍固定矩阵：独立进程和共享锁，内存/单图时限安全停止并保留部分结果。"""
import os
for key in ('OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS','NUMEXPR_NUM_THREADS'):os.environ[key]='1'
import argparse,json,time,hashlib,fcntl,multiprocessing as mp,threading,queue
from pathlib import Path
from server_worker_process import worker
MATRIX=[
 ('v5_server_native960','v5_server_det','v5_server_rec','target',960),
 ('v5_server_common2048','v5_server_det','v5_server_rec','target',2048),
 ('v6small_det_server_rec_common2048','v6_small_det','v5_server_rec','target',2048),
 ('server_det_v6medium_rec_common2048','v5_server_det','v6_medium_rec','target',2048),
]

def available():
 for line in Path('/proc/meminfo').read_text().splitlines():
  if line.startswith('MemAvailable:'):return int(line.split()[1])*1024
 raise RuntimeError('MemAvailable unavailable')
def rss(pid):
 try:
  for line in Path(f'/proc/{pid}/status').read_text().splitlines():
   if line.startswith('VmRSS:'):return int(line.split()[1])*1024
 except (FileNotFoundError,ProcessLookupError):return 0
 return 0
def watch(pids,stop,danger,samples):
 while not stop.is_set():
  values={str(pid):rss(pid) for pid in pids};mem=available();total=sum(values.values())
  samples.append({'at':time.perf_counter(),'rss_bytes_by_pid':values,'sum_rss_bytes':total,'available_bytes':mem})
  if mem<1.5*1024**3 or total>5*1024**3:danger.set()
  stop.wait(.1)
def fill_missing(result,sources):
 present={x['id'] for x in result['images']}
 for src in sources:
  if src['id'] not in present:
   row={k:src[k] for k in ['id','sha256','width','height']}
   row.update(regions=[],detectorRegions=[],rawBeforeFiltering=[],resize=None,actual_detector_input_shape=None,error={'kind':'not_completed','reason':result.get('reason','group not completed')},timing={'single_pass_seconds':None,'processing_wall_seconds':None,'queue_wait_seconds':None})
   result['images'].append(row)
 order={s['id']:i for i,s in enumerate(sources)};result['images'].sort(key=lambda x:order[x['id']])
 result['completed_image_count']=sum(x.get('error') is None for x in result['images']);result['manifest_image_count']=len(sources)

def main():
 p=argparse.ArgumentParser();p.add_argument('--manifest',required=True);p.add_argument('--models',required=True);p.add_argument('--engine',required=True);p.add_argument('--output',required=True);p.add_argument('--lock',required=True);a=p.parse_args()
 sources=json.loads(Path(a.manifest).read_text());assert len(sources)==10
 for s in sources:assert hashlib.sha256(Path(s['file']).read_bytes()).hexdigest()==s['sha256']
 root=Path(a.output);root.mkdir(parents=True,exist_ok=True);ctx=mp.get_context('spawn')
 for name,det,rec,mode,short in MATRIX:
  out=root/name;out.mkdir(parents=True,exist_ok=True)
  result={'scheme':name,'status':'pending','images':[],'configuration':{'det':det,'rec':rec,'resize_mode':mode,'short':short,'cap':4096,'rec_batch':6,'ort_intra':1,'ort_inter':1},'source_manifest_sha256':hashlib.sha256(Path(a.manifest).read_bytes()).hexdigest(),'timing_scope':'one pass per image, not warm; engine wall includes decode/OCR/raw+shape observation; initialization and lock waiting excluded'}
  with open(a.lock,'a') as lock:
   print('WAIT_LOCK',name,flush=True);fcntl.flock(lock,fcntl.LOCK_EX);print('ACQUIRED',name,flush=True)
   mem=available();result['available_before_bytes']=mem
   if mem<6*1024**3:
    result.update(status='blocked',reason='MemAvailable below 6GiB before group');fill_missing(result,sources);(out/'predictions.json').write_text(json.dumps(result,indent=2))
    if name.startswith('bridge'):return
    continue
   cfg={'output':str(out),'manifest':a.manifest,'models':a.models,'engine':a.engine,'lock':a.lock,'intra':1,'batch':6,'short':short,'det':det,'rec':rec,'resize_mode':mode,'candidate':name}
   iq=ctx.Queue();oq=ctx.Queue();proc=ctx.Process(target=worker,args=(0,cfg,iq,oq));start=time.perf_counter();proc.start()
   samples=[];stop=threading.Event();danger=threading.Event();monitor=threading.Thread(target=watch,args=([os.getpid(),proc.pid],stop,danger,samples),daemon=True);monitor.start()
   def receive(deadline=None):
    while True:
     if danger.is_set():raise RuntimeError('Memory safety stop: available<1.5GiB or synchronous RSS>5GiB')
     if deadline is not None and time.perf_counter()>deadline:raise TimeoutError('Per-image wall limit 180 seconds exceeded')
     try:
      message=oq.get(timeout=.1)
      if message['kind']=='error':raise RuntimeError(message['traceback'])
      return message
     except queue.Empty:
      if proc.exitcode is not None:raise RuntimeError(f'Worker exited: {proc.exitcode}')
   try:
    ready=receive(start+180);assert ready['kind']=='ready';result['initialization']=ready;result['initialization_ready_wall_seconds']=time.perf_counter()-start
    for i,s in enumerate(sources):
     submitted=time.perf_counter();iq.put({'round':0,'index':i,'source':s,'submitted_at':submitted});r=receive(submitted+180)
     assert r['kind']=='result' and r['index']==i and r['image']['id']==s['id'] and r['image']['sha256']==s['sha256']
     image=r['image'];image['timing']={'single_pass_seconds':r['engine_wall_seconds'],'processing_wall_seconds':r['processing_wall_seconds'],'queue_wait_seconds':r['queue_wait_seconds']}
     result['images'].append(image);(out/(s['id']+'.json')).write_text(json.dumps(image,ensure_ascii=False,indent=2));print('IMAGE',name,s['id'],round(r['engine_wall_seconds'],3),flush=True)
    iq.put(None);proc.join();assert proc.exitcode==0;result['status']='completed'
   except Exception as error:
    result['status']='partial' if result['images'] else 'blocked';result['reason']=str(error);print('STOP_GROUP',name,str(error),flush=True)
   finally:
    if proc.is_alive():proc.terminate();proc.join()
    stop.set();monitor.join();iq.close();oq.close()
    result['resource_samples']=samples;result['peak_sampled_coordinator_worker_rss_bytes']=max((x['sum_rss_bytes'] for x in samples),default=0)
    result['resource_note']='100ms simultaneous coordinator+OCR worker RSS sum, can double count shared pages; excludes tracker helper; not exclusive physical CPU or container quota guarantee'
    fill_missing(result,sources)
    (out/'predictions.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
   fcntl.flock(lock,fcntl.LOCK_UN)
 result_files=[root/name/'predictions.json' for name,*_ in MATRIX]
 summary={'status':'terminal','groups':[{k:d.get(k) for k in ['scheme','status','reason','completed_image_count','manifest_image_count']} for d in [json.loads(f.read_text()) for f in result_files]],'all_groups_completed':all(json.loads(f.read_text())['status']=='completed' for f in result_files)}
 (root/'summary.json').write_text(json.dumps(summary,indent=2)+'\n');print('SERVER_TERMINAL',json.dumps(summary),flush=True)
if __name__=='__main__':main()
