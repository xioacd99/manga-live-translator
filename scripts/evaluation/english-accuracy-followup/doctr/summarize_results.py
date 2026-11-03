"""只聚合已完成预测的耗时和资源，不读取GT或计算准确率。"""
import argparse
import hashlib
import json
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--output',required=True);a=p.parse_args()
source=Path(a.input);data=json.loads(source.read_text());rows=[r for r in data['images'] if r.get('error') is None]
times=[r['timing']['single_pass_seconds'] for r in rows]
summary={'scheme':data['scheme'],'status':data['status'],'completed_images':len(rows),'expected_images':data['manifest_image_count'],
 'reason':data.get('reason'),'configuration':data['configuration'],'raw_result_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),
 'mean_single_pass_seconds_completed_pages_only':sum(times)/len(times) if times else None,
 'peak_sampled_coordinator_worker_rss_bytes':data.get('peak_sampled_coordinator_worker_rss_bytes'),
 'initialization_ready_wall_seconds':data.get('initialization_ready_wall_seconds'),
 'timing_scope':data['timing_scope'],'synthetic_smoke':data['synthetic_smoke'],
 'split_crops_without_eos':sum(r.get('recognizer_diagnostics',{}).get('split_crops_without_eos',0) for r in rows),
 'word_count':sum(len(r['regions']) for r in rows)}
Path(a.output).write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n');print(json.dumps(summary,ensure_ascii=False))
