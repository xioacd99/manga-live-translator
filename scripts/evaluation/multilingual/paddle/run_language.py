"""三种 Paddle 路线驱动；复用已校验模型缓存，不上传输入。"""
import argparse,subprocess,sys,json
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--dataset',type=Path,required=True);p.add_argument('--model-dir',type=Path,required=True);p.add_argument('--lock',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--modes',nargs='+',choices=['full','rec-only','inner-db-rec'],default=['full','rec-only','inner-db-rec']);p.add_argument('--rtdetr',type=Path);a=p.parse_args()
runner=Path(__file__).parent/'repro/benchmark.py'
for mode in a.modes:
 cmd=[sys.executable,str(runner),'--manifest',str(a.dataset/'sources.json'),'--model-dir',str(a.model_dir),'--lock',str(a.lock),'--output',str(a.output/mode),'--mode',mode]
 if mode!='full':cmd.extend(['--rtdetr',str(a.rtdetr or a.dataset/'rtdetr-regions.json')])
 a.output.mkdir(parents=True,exist_ok=True)
 with (a.output/(mode+'.log')).open('w') as log:subprocess.run(cmd,stdout=log,stderr=subprocess.STDOUT,check=True)
 print('Completed',mode,flush=True)
