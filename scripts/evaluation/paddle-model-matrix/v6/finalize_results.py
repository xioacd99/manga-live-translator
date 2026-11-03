"""对终态输出补齐完整输入身份；不读GT，不把资源失败删出分母。"""
import argparse,copy,hashlib,json,statistics
from pathlib import Path

def main():
 p=argparse.ArgumentParser();p.add_argument('--manifest',required=True);p.add_argument('--results',required=True);a=p.parse_args()
 sources=json.loads(Path(a.manifest).read_text());root=Path(a.results);summary=[]
 for f in sorted(root.glob('*/predictions.json')):
  original=json.loads(f.read_text());assert original['status'] in ['completed','partial','blocked']
  by_id={x['id']:x for x in original['images']};assert len(by_id)==len(original['images'])
  full=copy.deepcopy(original);full['images']=[]
  for s in sources:
   if s['id'] in by_id:
    image=by_id[s['id']];assert image['sha256']==s['sha256']
   else:
    image={k:s[k] for k in ['id','sha256','width','height']};image.update(regions=[],detectorRegions=[],error='not completed: '+original.get('reason',original['status']))
   full['images'].append(image)
  full['raw_result_sha256']=hashlib.sha256(f.read_bytes()).hexdigest();full['missing_policy']='Full 10-image manifest; missing pages have empty output and explicit error. Keep full GT denominator.'
  (f.parent/'predictions-full-manifest.json').write_text(json.dumps(full,ensure_ascii=False,indent=2))
  ready=original.get('initialization');dictionary_ok=None
  if ready:
   assert ready['opencv_threads']==1
   for stage,session in ready['session_details'].items():
    assert session['providers']==['CPUExecutionProvider'] and session['intra_op_threads']==session['inter_op_threads']==1
   rec=ready['session_details']['rec'];dictionary_ok=rec['outputs'][0]['shape'][-1]==rec['decoder_dictionary_entries_including_blank'];assert dictionary_ok
  durations=[x['timing']['single_pass_seconds'] for x in original['images']]
  summary.append({'scheme':original['scheme'],'status':original['status'],'completed_images':len(original['images']),'expected_images':len(sources),'reason':original.get('reason'),'mean_single_pass_seconds_completed_pages_only':statistics.mean(durations) if durations else None,'sum_single_pass_seconds_completed_pages_only':sum(durations),'peak_sampled_coordinator_worker_rss_bytes':original.get('peak_sampled_coordinator_worker_rss_bytes'),'initialization_ready_wall_seconds':original.get('initialization_ready_wall_seconds'),'dictionary_class_count_matches':dictionary_ok,'configuration':original['configuration'],'raw_result_sha256':full['raw_result_sha256']})
 (root.parent/'summary-no-gt.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary,indent=2))
if __name__=='__main__':main()
