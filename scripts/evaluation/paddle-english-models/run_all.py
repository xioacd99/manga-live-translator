"""七候选复现驱动；由每个runner获取相同文件锁，无云图片API。"""
import argparse,subprocess,sys
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--manifest',type=Path,required=True);p.add_argument('--models',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--lock',type=Path,required=True);p.add_argument('--legacy-python',required=True);p.add_argument('--current-python',required=True);a=p.parse_args();root=Path(__file__).parent;a.output.mkdir(parents=True,exist_ok=True)
for candidate in ['v5_multi_legacy','v5_multi_bridge','v5_english','v6_tiny','v6_small','v6_medium','v6_small_paddle_params']:
 runner=root/('run_benchmark_sensitivity.py' if candidate.endswith('paddle_params') else 'run_benchmark_main_frozen.py');python=a.legacy_python if candidate=='v5_multi_legacy' else a.current_python
 cmd=[python,str(runner),'--manifest',str(a.manifest),'--model-manifest',str(a.models),'--output',str(a.output/candidate),'--lock',str(a.lock),'--candidate',candidate]
 with (a.output/(candidate+'.log')).open('w') as log:subprocess.run(cmd,stdout=log,stderr=subprocess.STDOUT,check=True)
 print('完成',candidate,flush=True)
