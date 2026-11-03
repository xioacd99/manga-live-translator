"""预冻结四组CPU吞吐实验：整批轮次、独立worker、队列和同步RSS采样。"""
import os
for k in ['OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS','NUMEXPR_NUM_THREADS']:os.environ[k]='1'
import argparse,json,time,sys,hashlib,fcntl,multiprocessing as mp,threading,traceback,queue
from pathlib import Path
GROUPS={'A':(1,1,1),'B':(1,1,6),'C':(1,2,6),'D':(2,1,6)}
def worker(wid,cfg,iq,oq):
 try:
  out=Path(cfg['output'])/f'worker-{wid}';out.mkdir(parents=True,exist_ok=True)
  sys.argv=[cfg['engine'],'--manifest',cfg['manifest'],'--model-manifest',cfg['models'],'--output',str(out),'--lock',cfg['lock'],'--candidate','v6_small_paddle_params','--short-side','2048','--intra',str(cfg['intra']),'--rec-batch',str(cfg['batch'])]
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
def rss(pid):
 try:
  for line in Path(f'/proc/{pid}/status').read_text().splitlines():
   if line.startswith('VmRSS:'):return int(line.split()[1])*1024
 except (FileNotFoundError,ProcessLookupError):return 0
 return 0
def sampler(pids,stop,output,safety,check_safety):
 while not stop.is_set():
  t=time.perf_counter();values={str(pid):rss(pid) for pid in pids};mem=available();output.append({'at':t,'rss_bytes_by_pid':values,'sum_rss_bytes':sum(values.values()),'available_bytes':mem})
  if check_safety and (mem<1.5*1024**3 or sum(values.values())>5*1024**3):safety.set()
  stop.wait(.1)
def available():
 for l in Path('/proc/meminfo').read_text().splitlines():
  if l.startswith('MemAvailable:'):return int(l.split()[1])*1024
 raise RuntimeError('MemAvailable unavailable')
def main():
 p=argparse.ArgumentParser();p.add_argument('--manifest',required=True);p.add_argument('--models',required=True);p.add_argument('--engine',required=True);p.add_argument('--output',required=True);p.add_argument('--lock',required=True);p.add_argument('--groups',nargs='+',default=list(GROUPS),choices=list(GROUPS));a=p.parse_args()
 sources=json.loads(Path(a.manifest).read_text());assert len(sources)==10
 for s in sources:assert hashlib.sha256(Path(s['file']).read_bytes()).hexdigest()==s['sha256']
 root=Path(a.output);root.mkdir(parents=True,exist_ok=True);ctx=mp.get_context('spawn')
 for group in a.groups:
  workers,intra,batch=GROUPS[group];out=root/group;out.mkdir(parents=True,exist_ok=True)
  with open(a.lock,'a') as lock:
   print('WAIT_LOCK',group,flush=True);fcntl.flock(lock,fcntl.LOCK_EX);print('ACQUIRED',group,flush=True)
   mem=available()
   if group=='D' and mem<6*1024**3:
    (out/'status.json').write_text(json.dumps({'status':'blocked','reason':'MemAvailable below 6GiB before two-worker initialization','available_bytes':mem},indent=2));continue
   cfg={'output':str(out),'manifest':a.manifest,'models':a.models,'engine':a.engine,'lock':a.lock,'intra':intra,'batch':batch}
   iq=ctx.Queue();oq=ctx.Queue();ps=[ctx.Process(target=worker,args=(w,cfg,iq,oq)) for w in range(workers)];launch=time.perf_counter()
   for proc in ps:proc.start()
   samples=[];stop=threading.Event();safety=threading.Event();monitor=threading.Thread(target=sampler,args=([os.getpid()]+[x.pid for x in ps],stop,samples,safety,group=='D'),daemon=True);monitor.start();ready=[]
   def next_output():
    while True:
     if safety.is_set():raise RuntimeError('D safety stop: available below 1.5GiB or simultaneous tree RSS above 5GiB')
     try:return oq.get(timeout=.2)
     except queue.Empty:
      if any(x.exitcode is not None and x.exitcode!=0 for x in ps):raise RuntimeError('Worker exited unexpectedly')
   try:
    for _ in ps:
     r=next_output();assert r['kind']=='ready',r;ready.append(r)
    ready_wall=time.perf_counter()-launch
    rounds=[]
    for rnd in range(3):
     t0=time.perf_counter()
     for i,s in enumerate(sources):iq.put({'round':rnd,'index':i,'source':s,'submitted_at':time.perf_counter()})
     done=[]
     for _ in sources:
      r=next_output();received=time.perf_counter();assert r['kind']=='result',r;r['received_at']=received;done.append(r)
     end=time.perf_counter();done.sort(key=lambda x:x['index'])
     active=[x for x in samples if t0<=x['at']<=end]
     rr={'round':rnd,'start_at':t0,'end_at':end,'makespan_seconds':end-t0,'first_image_completion_seconds':min(x['complete_at'] for x in done)-t0,'first_result_received_seconds':min(x['received_at'] for x in done)-t0,'images_per_second':len(sources)/(end-t0),'sampled_tree_peak_rss_bytes':max((x['sum_rss_bytes'] for x in active),default=None),'sample_count':len(active),'items':done}
     rounds.append(rr);(out/f'round-{rnd}.json').write_text(json.dumps(rr,ensure_ascii=False,indent=2));print('ROUND_DONE',group,rnd,round(end-t0,3),flush=True)
    for _ in ps:iq.put(None)
    for proc in ps:proc.join()
    assert all(proc.exitcode==0 for proc in ps)
    stop.set();monitor.join()
    result={'scheme':f'cpu_batch_{group}','group':group,'workers':workers,'ort_intra':intra,'ort_inter':1,'rec_batch':batch,'opencv_threads':1,'blas_threads':1,'source_manifest_sha256':hashlib.sha256(Path(a.manifest).read_bytes()).hexdigest(),'engine_script_sha256':hashlib.sha256(Path(a.engine).read_bytes()).hexdigest(),'initialization_ready_wall_seconds':ready_wall,'worker_initialization':ready,'available_before_bytes':mem,'rounds':rounds,'rss_samples':samples,'rss_note':'100ms sampled sum of simultaneous coordinator+worker RSS. Shared physical pages may be counted in each process; not unique physical memory and not sum of independent peaks.','timing_note':'makespan includes submission/queue/IPC/result collection; initialization and lock waiting excluded. Processing wall includes engine+result extraction; engine includes raw capture and actual tensor shape observer. Per-round output writing occurs after timing. Round0 first batch, rounds1/2 warm batches.'}
    (out/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
   except BaseException:
    (out/'failure.json').write_text(json.dumps({'status':'failed','traceback':traceback.format_exc(),'rss_samples':samples},indent=2));raise
   finally:
    for proc in ps:
     if proc.is_alive():proc.terminate();proc.join()
    stop.set();monitor.join();iq.close();oq.close()
   fcntl.flock(lock,fcntl.LOCK_UN)
if __name__=='__main__':main()
