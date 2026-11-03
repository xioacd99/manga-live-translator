"""持共享锁，采样 RSS，并限制合成探针时间和内存。"""
import argparse,fcntl,json,os,pathlib,signal,subprocess,time,sys
BASE=pathlib.Path(__file__).resolve().parent
ap=argparse.ArgumentParser(description=__doc__)
ap.add_argument('--models',type=pathlib.Path,required=True)
ap.add_argument('--output',type=pathlib.Path,required=True)
ap.add_argument('--lock',type=pathlib.Path,required=True)
ap.add_argument('--python',default=sys.executable)
args=ap.parse_args()
out=args.output.resolve();out.mkdir(parents=True,exist_ok=True)
lock=open(args.lock,'a')
print('Waiting for inference lock',flush=True);fcntl.flock(lock,fcntl.LOCK_EX);print('Acquired inference lock',flush=True)
env=os.environ|{'OMP_NUM_THREADS':'4','OPENBLAS_NUM_THREADS':'4','MKL_NUM_THREADS':'4','TOKENIZERS_PARALLELISM':'false'}
t=time.perf_counter();samples=[];termination=None
with (out/'console.log').open('w') as log:
 p=subprocess.Popen([args.python,'-u',str(BASE/'probe_two_pages.py'),'--models',str(args.models.resolve()),'--output',str(out)],stdout=log,stderr=subprocess.STDOUT,env=env,start_new_session=True)
 while p.poll() is None:
  try:
   data=dict(line.split(':',1) for line in pathlib.Path(f'/proc/{p.pid}/status').read_text().splitlines() if ':' in line)
   rss=int(data.get('VmRSS','0 kB').split()[0])*1024;threads=int(data.get('Threads',0));samples.append({'seconds':time.perf_counter()-t,'rss_bytes':rss,'threads':threads})
   if rss>6000000000:termination='rss_above_6000000000_bytes'
   if time.perf_counter()-t>900:termination='wall_timeout_900_seconds'
   if termination:
    os.killpg(p.pid,signal.SIGTERM)
    try:p.wait(timeout=10)
    except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL)
    break
  except FileNotFoundError:pass
  time.sleep(.1)
 code=p.wait()
summary={'exit_code':code,'termination':termination,'wall_seconds':time.perf_counter()-t,'peak_sampled_rss_bytes':max((x['rss_bytes'] for x in samples),default=0),'max_observed_threads':max((x['threads'] for x in samples),default=0),'sampling_interval_seconds':.1,'affinity_cpu_limit':4,'mlx_thread_limit_verified':False}
(out/'resource-summary.json').write_text(json.dumps(summary,indent=2)+'\n');(out/'rss-samples.json').write_text(json.dumps(samples)+'\n');print(json.dumps(summary),flush=True)
fcntl.flock(lock,fcntl.LOCK_UN);lock.close()
raise SystemExit(code)
