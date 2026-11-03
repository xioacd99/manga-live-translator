"""固定几何配对的漫画 OCR 评测；不包含或发布参考全文。"""
import json,unicodedata,math,argparse,hashlib
from pathlib import Path

def normalize(text,drop_punctuation=False):
    return ''.join(c for c in unicodedata.normalize('NFKC',text or '') if not c.isspace() and not(drop_punctuation and unicodedata.category(c).startswith('P')))

def edits(ref,hyp):
    # 固定平局策略：替换、删除、插入。保留 S/D/I 而不是只给距离。
    n,m=len(ref),len(hyp);dp=[[0]*(m+1) for _ in range(n+1)]
    for i in range(n+1):dp[i][0]=i
    for j in range(m+1):dp[0][j]=j
    for i in range(1,n+1):
        for j in range(1,m+1):dp[i][j]=min(dp[i-1][j-1]+(ref[i-1]!=hyp[j-1]),dp[i-1][j]+1,dp[i][j-1]+1)
    s=d=ins=0;i=n;j=m
    while i or j:
        if i and j and dp[i][j]==dp[i-1][j-1]+(ref[i-1]!=hyp[j-1]):s+=ref[i-1]!=hyp[j-1];i-=1;j-=1
        elif i and dp[i][j]==dp[i-1][j]+1:d+=1;i-=1
        else:ins+=1;j-=1
    return dict(S=s,D=d,I=ins,N=n)

def intersection(a,b):return max(0,min(a['x']+a['width'],b['x']+b['width'])-max(a['x'],b['x']))*max(0,min(a['y']+a['height'],b['y']+b['height'])-max(a['y'],b['y']))
def area(a):return a['width']*a['height']

def validate_bbox(bbox):
    if not isinstance(bbox,dict) or not all(isinstance(bbox.get(k),(int,float)) and not isinstance(bbox.get(k),bool) and math.isfinite(bbox[k]) for k in ['x','y','width','height']):
        raise ValueError('BBox must contain finite numeric x/y/width/height')
    if bbox['x']<0 or bbox['y']<0 or bbox['width']<=0 or bbox['height']<=0:
        raise ValueError('BBox must have nonnegative origin and positive area')

def iou(a,b):
    v=intersection(a,b);return v/(area(a)+area(b)-v) if v else 0

def ignore(pred,boxes):return any(intersection(pred,g)/area(pred)>=.5 for g in boxes)
def matching(pred,gt,threshold):
    adj=[[j for j in sorted(range(len(gt)),key=lambda j:(-iou(p,gt[j]),j)) if iou(p,gt[j])>=threshold] for p in pred];matched={}
    def visit(i,seen):
        for j in adj[i]:
            if j in seen:continue
            seen.add(j)
            if j not in matched or visit(matched[j],seen):matched[j]=i;return True
        return False
    for i in range(len(pred)):visit(i,set())
    return len(matched)

def ordered(regions,orientation='horizontal'):
    if str(orientation).startswith('vertical'):return sorted(regions,key=lambda r:(-(r['bbox']['x']+r['bbox']['width']/2),r['bbox']['y']))
    return sorted(regions,key=lambda r:(r['bbox']['y'],r['bbox']['x']))

def score_image(gt,pred):
    for r in gt.get('regions',[])+gt.get('ignoreRegions',[])+pred.get('regions',[])+pred.get('detectorRegions',[]):
        validate_bbox(r.get('bbox'))
        b=r['bbox']
        if gt.get('width') and gt.get('height') and (b['x']+b['width']>gt['width']+1e-6 or b['y']+b['height']>gt['height']+1e-6):
            raise ValueError('BBox outside source image')
    target=[g for g in gt['regions'] if g.get('type') in ['dialogue','caption']]
    ignored=[g['bbox'] for g in gt.get('ignoreRegions',[])]
    regions=[p for p in pred.get('regions',[]) if not ignore(p['bbox'],ignored)]
    groups=[[] for _ in target];unmatched=[]
    for p in regions:
        candidates=[(intersection(p['bbox'],g['bbox'])/area(p['bbox']),iou(p['bbox'],g['bbox']),i) for i,g in enumerate(target)]
        candidates.sort(reverse=True)
        if candidates and candidates[0][0]>=.5:groups[candidates[0][2]].append(p)
        else:unmatched.append(p)
    totals={k:0 for k in ['S','D','I','N']};nopunct=dict(totals);rows=[];exact=0;count=0
    for g,items in zip(target,groups):
        if g.get('certainty')!='certain' or not isinstance(g.get('text'),str):continue
        hypothesis=''.join(p.get('text','') for p in ordered(items,g.get('orientation','horizontal')))
        ref=normalize(g['text']);hyp=normalize(hypothesis)
        e=edits(ref,hyp);e2=edits(normalize(g['text'],True),normalize(hypothesis,True))
        for k in totals:totals[k]+=e[k];nopunct[k]+=e2[k]
        exact+=ref==hyp;count+=1
        rows.append(dict(id=g['id'],**e,exact=ref==hyp,predictionCount=len(items)))
    extra=sum(len(normalize(p.get('text',''))) for p in unmatched) if gt.get('fullyAnnotated') else 0
    extra2=sum(len(normalize(p.get('text',''),True)) for p in unmatched) if gt.get('fullyAnnotated') else 0
    totals['I']+=extra;nopunct['I']+=extra2
    boxes=[p['bbox'] for p in pred.get('detectorRegions',pred.get('regions',[])) if not ignore(p['bbox'],ignored)]
    gtboxes=[g['bbox'] for g in target];metrics={}
    for threshold in [.3,.5]:
        tp=matching(boxes,gtboxes,threshold);fp=len(boxes)-tp;fn=len(gtboxes)-tp
        metrics[str(threshold)]={'TP':tp,'FP':fp if gt.get('fullyAnnotated') else None,'FN':fn,'precision':tp/(tp+fp) if tp+fp and gt.get('fullyAnnotated') else None,'recall':tp/(tp+fn) if tp+fn else None,'F1':2*tp/(2*tp+fp+fn) if (2*tp+fp+fn) and gt.get('fullyAnnotated') else None}
    # 单个预测框与目标框存在较强包含关系的数量，仅作弱重叠诊断。
    # 不是联合覆盖率：段落内一个很短的行框也可能使该目标计数。不能解释为召回率或mAP。
    covered=sum(any(intersection(g,p)/area(g)>=.5 or intersection(g,p)/area(p)>=.8 for p in boxes) for g in gtboxes)
    return dict(id=gt['id'],sha256=gt['sha256'],fullyAnnotated=gt.get('fullyAnnotated',False),**totals,CER=(totals['S']+totals['D']+totals['I'])/totals['N'] if totals['N'] else None,CER_no_punctuation=(nopunct['S']+nopunct['D']+nopunct['I'])/nopunct['N'] if nopunct['N'] else None,noPunctuationEdits=nopunct,exactRegions=exact,referenceRegions=count,unmatchedInsertionCharacters=extra,detector=metrics,weakOverlapTargetCount=covered,detectorTargets=len(gtboxes),regions=rows,error=pred.get('error'),timing=pred.get('timing',{}))

def score(gt,data):
    for name,images in [('ground truth',gt['images']),('predictions',data['images'])]:
        ids=[i['id'] for i in images]
        if len(ids)!=len(set(ids)):raise ValueError('Duplicate image ID in '+name)
    indexed={p['id']:p for p in data['images']};rows=[]
    for g in gt['images']:
        p=indexed.get(g['id'],{'id':g['id'],'regions':[],'error':'missing prediction'})
        if p.get('sha256') and p['sha256']!=g['sha256']:raise ValueError('Input hash mismatch: '+g['id'])
        rows.append(score_image(g,p))
    totals={k:sum(r[k] for r in rows) for k in ['S','D','I','N']};micro=(totals['S']+totals['D']+totals['I'])/totals['N'] if totals['N'] else None
    valid_cer=[r['CER'] for r in rows if r['CER'] is not None]
    nopunct={k:sum(r['noPunctuationEdits'][k] for r in rows) for k in ['S','D','I','N']}
    return dict(scheme=data.get('scheme'),normalization='NFKC; remove Unicode whitespace; preserve punctuation/case/script',matching='geometry only, prediction overlap >=0.5 assigned once; strict detection maximum-cardinality IoU matching',**totals,microCER=micro,macroCER=sum(valid_cer)/len(valid_cer) if valid_cer else None,noPunctuationEdits=nopunct,microCER_no_punctuation=(nopunct['S']+nopunct['D']+nopunct['I'])/nopunct['N'] if nopunct['N'] else None,exactRegions=sum(r['exactRegions'] for r in rows),referenceRegions=sum(r['referenceRegions'] for r in rows),images=rows)
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('ground_truth');p.add_argument('predictions');p.add_argument('output');a=p.parse_args()
    result=score(json.loads(Path(a.ground_truth).read_text()),json.loads(Path(a.predictions).read_text()));Path(a.output).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
