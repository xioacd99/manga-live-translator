"""固定几何评分的可迁移入口；不运行OCR，不导出参考/预测全文。"""
import argparse,json,sys,hashlib,fcntl
from pathlib import Path
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--scorer',type=Path,required=True)
parser.add_argument('--ground-truth',type=Path,required=True)
parser.add_argument('--results',type=Path,required=True)
parser.add_argument('--output',type=Path,required=True)
parser.add_argument('--lock',type=Path,required=True)
parser.add_argument('--groups',nargs='+',required=True)
args=parser.parse_args()
import importlib.util
spec=importlib.util.spec_from_file_location('frozen_scorer',args.scorer)
score=importlib.util.module_from_spec(spec);spec.loader.exec_module(score)
root=args.results;gtpath=args.ground_truth
assert hashlib.sha256(gtpath.read_bytes()).hexdigest()=='984017f90ce822edb0c480207ed29ec8ec5ded587ba37f7ec40b3eb35e22753f'
gt=json.loads(gtpath.read_text());rows=[]
with open(args.lock,'a') as lock:
 print('WAIT_LOCK',flush=True);fcntl.flock(lock,fcntl.LOCK_EX);print('ACQUIRED',flush=True)
 for name in args.groups:
  p=root/name/'predictions.json';data=json.loads(p.read_text());s=score.score(gt,data,True,'line-column-overlap-v2')
  assert s['N']==2215
  output=args.output;output.mkdir(parents=True,exist_ok=True)
  row={'scheme':name,'status':data['status'],'completed_images':sum(im.get('error') is None for im in data['images']),'prediction_sha256':hashlib.sha256(p.read_bytes()).hexdigest(),**{k:s[k] for k in ['microCER','microWER','S','D','I','N','exactRegions']}}
  row['empty_regions']=sum(r['predictionCount']==0 for im in s['images'] for r in im['regions'])
  row['per_image']=[]
  byid={im['id']:im for im in data['images']}
  for gi,mi in zip(gt['images'],s['images']):
   targets=[x for x in gi['regions'] if x.get('type') in ['dialogue','caption']]; counts=[0]*len(targets)
   ignored=[x['bbox'] for x in gi.get('ignoreRegions',[])]
   for pred in byid.get(gi['id'],{}).get('detectorRegions',[]):
    box=pred['bbox']
    if score.ignore(box,ignored):continue
    candidates=sorted([(score.intersection(box,t['bbox'])/score.area(box),score.iou(box,t['bbox']),i) for i,t in enumerate(targets)],reverse=True)
    if candidates and candidates[0][0]>=.5:counts[candidates[0][2]]+=1
   no_raw=sum(n==0 for t,n in zip(targets,counts) if t.get('certainty')=='certain' and isinstance(t.get('text'),str))
   row['per_image'].append({**{k:mi[k] for k in ['id','CER','WER','S','D','I','N']},'empty_regions':sum(x['predictionCount']==0 for x in mi['regions']),'no_assigned_raw_line_proxy':no_raw})
  row['no_assigned_raw_line_proxy']=sum(im['no_assigned_raw_line_proxy'] for im in row['per_image'])
  (output/(name+'.review-summary.json')).write_text(json.dumps(row,indent=2))
  rows.append({k:v for k,v in row.items() if k!='per_image'})
 print(json.dumps(rows),flush=True)
