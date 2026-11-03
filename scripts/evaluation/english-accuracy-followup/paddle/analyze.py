"""本地独立评分与视图长度偏差检查；不把GT用于结果选择。"""
import argparse
import importlib.util
import json
import statistics
from pathlib import Path


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--ground-truth',required=True)
    parser.add_argument('--results',required=True)
    parser.add_argument('--baseline',required=True)
    parser.add_argument('--scorer',required=True)
    parser.add_argument('--output',required=True)
    args=parser.parse_args()
    spec=importlib.util.spec_from_file_location('scorer',args.scorer)
    scorer=importlib.util.module_from_spec(spec);spec.loader.exec_module(scorer)
    gt=json.loads(Path(args.ground_truth).read_text())
    baseline=json.loads(Path(args.baseline).read_text())
    base_by_id={image['id']:image for image in baseline['images']}
    out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
    summary=[]
    for path in sorted(Path(args.results).glob('*/predictions-full-manifest.json')):
        prediction=json.loads(path.read_text())
        metrics=scorer.score(gt,prediction,include_wer=True,text_order='line-column-overlap-v2')
        (out/(prediction['scheme']+'.metrics.json')).write_text(json.dumps(metrics,ensure_ascii=False,indent=2))
        no_raw=0
        by_id={image['id']:image for image in prediction['images']}
        for reference in gt['images']:
            targets=[region for region in reference['regions'] if region.get('type') in ['dialogue','caption']]
            ignored=[region['bbox'] for region in reference.get('ignoreRegions',[])]
            assigned=set()
            for raw in by_id[reference['id']].get('rawBeforeFiltering',[]):
                if scorer.ignore(raw['bbox'],ignored):continue
                candidates=[(scorer.intersection(raw['bbox'],target['bbox'])/scorer.area(raw['bbox']),scorer.iou(raw['bbox'],target['bbox']),i) for i,target in enumerate(targets)]
                if candidates:
                    overlap,_,index=max(candidates)
                    if overlap>=.5:assigned.add(index)
            no_raw+=sum(i not in assigned and region.get('certainty')=='certain' and isinstance(region.get('text'),str) for i,region in enumerate(targets))
        times=[image['timing']['single_pass_seconds'] for image in prediction['images'] if image.get('timing')]
        bias={'chosen_counts':[0,0,0],'changed_lines':0,'shorter_lines':0,'longer_lines':0,'same_length_changed_lines':0,'original_total_characters':0,'selected_total_characters':0,'original_branch_identical_to_baseline':None}
        bias['length_definition']='NFKC normalized, all Unicode whitespace removed'
        raw_bias={'changed_lines':0,'shorter_lines':0,'longer_lines':0,'same_length_changed_lines':0,'original_total_characters':0,'selected_total_characters':0,'length_definition':'Python len of raw OCR text, including whitespace'}
        original_checks=[]
        for image in prediction['images']:
            if image.get('crop_mode')!='confidence':continue
            original_raw=base_by_id[image['id']]['rawBeforeFiltering']
            original_checks.append(len(original_raw)==len(image['view_outputs']))
            for index,row in enumerate(image['view_outputs']):
                base=row['views'][0];selected=row['views'][row['chosen_view']]
                bias['chosen_counts'][row['chosen_view']]+=1
                raw_old=len(base['text']);raw_new=len(selected['text'])
                raw_bias['original_total_characters']+=raw_old;raw_bias['selected_total_characters']+=raw_new
                if base['text']!=selected['text']:
                    raw_bias['changed_lines']+=1;raw_bias['shorter_lines']+=raw_new<raw_old;raw_bias['longer_lines']+=raw_new>raw_old;raw_bias['same_length_changed_lines']+=raw_new==raw_old
                old=len(scorer.normalize(base['text']));new=len(scorer.normalize(selected['text']))
                bias['original_total_characters']+=old;bias['selected_total_characters']+=new
                if base['text']!=selected['text']:
                    bias['changed_lines']+=1
                    bias['shorter_lines']+=new<old;bias['longer_lines']+=new>old;bias['same_length_changed_lines']+=new==old
                if index<len(original_raw):
                    observed=image['rawBeforeFiltering'][index]
                    previous=original_raw[index]
                    original_checks.append(base['text']==previous['text'] and base['confidence']==previous['confidence'] and observed['bbox']==previous['bbox'] and observed['quad']==previous['quad'])
        if original_checks:bias['original_branch_identical_to_baseline']=all(original_checks)
        bias['raw_string_length']=raw_bias
        row={key:metrics[key] for key in ['scheme','microCER','microWER','S','D','I','N','exactRegions']}
        row.update(status=prediction['status'],empty_targets=sum(region['predictionCount']==0 for image in metrics['images'] for region in image['regions']),no_assigned_raw_line_proxy=no_raw,mean_single_pass_seconds=statistics.mean(times) if times else None,sum_single_pass_seconds=sum(times),peak_sampled_rss_bytes=prediction.get('peak_sampled_coordinator_worker_rss_bytes'),length_bias=bias)
        summary.append(row)
    (out/'summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary,indent=2))


if __name__=='__main__':main()
