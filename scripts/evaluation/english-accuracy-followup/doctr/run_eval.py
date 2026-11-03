"""单次整页评测及共享锁/资源守护。失败页保留原始十图分母，不重试调参。"""
import argparse
import fcntl
import hashlib
import json
import multiprocessing as mp
import os
from pathlib import Path
import queue
import threading
import time
import traceback


def available():
    return next(int(x.split()[1])*1024 for x in Path('/proc/meminfo').read_text().splitlines() if x.startswith('MemAvailable:'))


def rss(pid):
    try:
        return next(int(x.split()[1])*1024 for x in Path(f'/proc/{pid}/status').read_text().splitlines() if x.startswith('VmRSS:'))
    except (FileNotFoundError, ProcessLookupError, StopIteration):
        return 0


def worker(cfg, iq, oq):
    try:
        started = time.perf_counter()
        from engine import DoctrEngine
        engine = DoctrEngine(cfg['models'])
        oq.put({'kind':'ready','initialization':engine.initialization,'initialization_wall_seconds':time.perf_counter()-started})
        while (job := iq.get()) is not None:
            start=time.perf_counter()
            row=engine.run(job['source'],cfg['output'])
            row['timing'].update(processing_wall_seconds=time.perf_counter()-start,queue_wait_seconds=start-job['submitted_at'])
            oq.put({'kind':'result','image':row})
    except BaseException:
        oq.put({'kind':'error','traceback':traceback.format_exc()})


def fill_missing(result, sources):
    existing={x['id'] for x in result['images']}
    for source in sources:
        if source['id'] not in existing:
            row={k:source[k] for k in ('id','sha256','width','height')}
            row.update(regions=[],detectorRegions=[],rawBeforeFiltering=[],
                error={'kind':'not_completed','reason':result.get('reason','not completed')},
                timing={'single_pass_seconds':None})
            result['images'].append(row)
    order={s['id']:i for i,s in enumerate(sources)}
    result['images'].sort(key=lambda x:order[x['id']])
    result['completed_image_count']=sum(x.get('error') is None for x in result['images'])
    result['manifest_image_count']=len(sources)


def main():
    p=argparse.ArgumentParser()
    for arg in ('manifest','models','output','lock'):p.add_argument('--'+arg,required=True)
    p.add_argument('--synthetic-smoke',action='store_true')
    a=p.parse_args();sources=json.loads(Path(a.manifest).read_text())
    assert len(sources)==(1 if a.synthetic_smoke else 10)
    assert len({s['id'] for s in sources})==len(sources)
    for source in sources:
        assert hashlib.sha256(Path(source['file']).read_bytes()).hexdigest()==source['sha256']
    out=Path(a.output);assert not out.exists(),'Never overwrite a prior run';out.mkdir(parents=True)
    result={'scheme':'doctr_db_resnet50_parseq_official1024_cpu1','status':'pending','images':[],
        'source_manifest_sha256':hashlib.sha256(Path(a.manifest).read_bytes()).hexdigest(),
        'configuration':{'det':'db_resnet50','rec':'parseq','det_shape':[3,1024,1024],'rec_shape':[3,32,128],
            'det_batch':1,'rec_batch':8,'cpu_threads':1,'repetitions':1,'detector_unit':'word'},
        'timing_scope':'One pass per source; single_pass includes RGB decode, predictor including preprocessing and observational hooks, projection; excludes raw JSON disk write, initialization and lock wait. Not warm repetitions.',
        'synthetic_smoke':a.synthetic_smoke}
    with open(a.lock,'a') as lock:
        print('WAIT_LOCK',flush=True);fcntl.flock(lock,fcntl.LOCK_EX);print('ACQUIRED_LOCK',flush=True)
        result['available_before_bytes']=available()
        if result['available_before_bytes']<6*1024**3:
            result.update(status='blocked',reason='MemAvailable below 6GiB at group start');fill_missing(result,sources)
            (out/'predictions.json').write_text(json.dumps(result,indent=2)+'\n');return
        ctx=mp.get_context('spawn');iq=ctx.Queue();oq=ctx.Queue();proc=ctx.Process(target=worker,args=({'models':a.models,'output':a.output},iq,oq))
        samples=[];stop=threading.Event();danger=threading.Event()
        def monitor():
            while not stop.is_set():
                sample={'at':time.perf_counter(),'available_bytes':available(),'sum_rss_bytes':rss(os.getpid())+rss(proc.pid)}
                samples.append(sample)
                if sample['available_bytes']<1.5*1024**3 or sample['sum_rss_bytes']>5*1024**3:danger.set()
                stop.wait(.1)
        def receive(deadline,stage):
            while True:
                if danger.is_set():raise RuntimeError('Memory guard: available<1.5GiB or coordinator+worker RSS>5GiB')
                if time.perf_counter()>deadline:raise TimeoutError(stage+' exceeded 180 seconds')
                try:
                    value=oq.get(timeout=.1)
                    if value['kind']=='error':raise RuntimeError(value['traceback'])
                    return value
                except queue.Empty:
                    if proc.exitcode is not None:raise RuntimeError('Worker exited '+str(proc.exitcode))
        start=time.perf_counter();proc.start();thread=threading.Thread(target=monitor,daemon=True);thread.start()
        try:
            ready=receive(start+180,'Initialization');assert ready['kind']=='ready'
            result['initialization']=ready['initialization'];result['initialization_ready_wall_seconds']=time.perf_counter()-start
            print('READY',round(result['initialization_ready_wall_seconds'],3),flush=True)
            for source in sources:
                submitted=time.perf_counter();iq.put({'source':source,'submitted_at':submitted})
                reply=receive(submitted+180,'Image '+source['id']);assert reply['kind']=='result'
                row=reply['image'];assert row['id']==source['id'] and row['sha256']==source['sha256']
                result['images'].append(row);(out/(source['id']+'.json')).write_text(json.dumps(row,ensure_ascii=False,indent=2)+'\n')
                print('IMAGE',source['id'],round(row['timing']['single_pass_seconds'],3),'WORDS',len(row['regions']),'EOS_MISSING',row['recognizer_diagnostics']['split_crops_without_eos'],flush=True)
            iq.put(None);proc.join(timeout=30);assert proc.exitcode==0
            result['status']='completed'
        except BaseException as error:
            result.update(status='partial' if result['images'] else 'blocked',reason=str(error));print('STOP',str(error),flush=True)
        finally:
            if proc.is_alive():proc.terminate();proc.join(timeout=10)
            if proc.is_alive():proc.kill();proc.join()
            stop.set();thread.join();iq.close();oq.close()
            result['resource_samples']=samples
            result['peak_sampled_coordinator_worker_rss_bytes']=max((s['sum_rss_bytes'] for s in samples),default=0)
            result['resource_note']='100ms coordinator+worker RSS sum; may double-count shared pages, excludes resource tracker; not exclusive CPU/hard memory isolation'
            fill_missing(result,sources)
            (out/'predictions.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
        print('TERMINAL',result['status'],result['completed_image_count'],result['manifest_image_count'],flush=True)


if __name__=='__main__':main()
