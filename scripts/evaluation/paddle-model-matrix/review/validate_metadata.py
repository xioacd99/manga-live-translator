"""只读核验输入身份、形状、字典、时延和同步采样RSS。"""
import argparse,json,hashlib,statistics
from pathlib import Path
ap=argparse.ArgumentParser(description=__doc__)
ap.add_argument('--results',type=Path,required=True)
ap.add_argument('--summary',type=Path,required=True)
ap.add_argument('--ground-truth',type=Path,required=True)
ap.add_argument('--review',type=Path,required=True)
ap.add_argument('--output',type=Path,required=True)
a=ap.parse_args()
gt=json.loads(a.ground_truth.read_text());rows=json.loads(a.summary.read_text());checks=[]
for row in rows:
 f=a.results/row['scheme']/'predictions.json';d=json.loads(f.read_text());s=json.loads((a.review/(row['scheme']+'.review-summary.json')).read_text())
 assert hashlib.sha256(f.read_bytes()).hexdigest()==row['raw_result_sha256']==s['prediction_sha256']
 assert d['status']=='completed' and len(d['images'])==10
 assert [(x['id'],x['sha256']) for x in d['images']]==[(x['id'],x['sha256']) for x in gt['images']]
 assert abs(statistics.mean(i['timing']['single_pass_seconds'] for i in d['images'])-row['mean_single_pass_seconds_completed_pages_only'])<1e-9
 assert abs(sum(i['timing']['single_pass_seconds'] for i in d['images'])-row['sum_single_pass_seconds_completed_pages_only'])<1e-9
 assert max(sum(x['rss_bytes_by_pid'].values()) for x in d['resource_samples'])==row['peak_sampled_coordinator_worker_rss_bytes']
 sess=d['initialization']['session_details'];assert sess['rec']['outputs'][0]['shape'][-1]==sess['rec']['decoder_dictionary_entries_including_blank']
 for x in ['det','rec','cls']:assert sess[x]['intra_op_threads']==sess[x]['inter_op_threads']==1 and sess[x]['providers']==['CPUExecutionProvider']
 for im in d['images']:
  if row['scheme']=='v5_server_native960':
   h,w=im['height'],im['width'];ratio=960/max(h,w);nh,nw=int(h*ratio),int(w*ratio);nh,nw=(nh+127)//128*128,(nw+127)//128*128
   assert im['resize']['preprocess']==[h,w]
   assert im['actual_detector_input_shape']==[1,3,nh,nw]
  elif d['configuration']['resize_mode']=='target':
   h,w=im['height'],im['width'];ratio=min(d['configuration']['short']/min(h,w),4096/max(h,w));nh,nw=round(h*ratio),round(w*ratio)
   assert im['resize']['preprocess']==[nh,nw]
   assert im['actual_detector_input_shape']==[1,3,round(nh/32)*32,round(nw/32)*32]
 checks.append({'scheme':row['scheme'],'input_identity':True,'source_hash':True,'time_mean_sum':True,'simultaneous_rss':True,'cpu_threads_and_dictionary':True,'target_shape':True})
a.output.parent.mkdir(parents=True,exist_ok=True)
a.output.write_text(json.dumps(checks,indent=2))
print('Validated',len(checks),'groups')
