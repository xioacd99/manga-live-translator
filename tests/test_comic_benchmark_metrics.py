import unittest,random,copy
from scripts.evaluation.score import normalize,edits,matching,score,score_image

def box(x=0,y=0,w=100,h=100):return dict(x=x,y=y,width=w,height=h)
def target(text='甲乙',bbox=None,certainty='certain',id='g1'):
 return dict(id=id,type='dialogue',certainty=certainty,text=text,bbox=bbox or box())
def ground(regions=None,fully=True):return dict(id='x',sha256='fixed',width=500,height=500,fullyAnnotated=fully,regions=[target()] if regions is None else regions,ignoreRegions=[])
def prediction(text='甲乙',bbox=None):return dict(id='x',sha256='fixed',regions=[dict(text=text,bbox=bbox or box())])

class EditsTests(unittest.TestCase):
 def test_empty(self):
  self.assertEqual(edits('',''),dict(S=0,D=0,I=0,N=0))
  self.assertEqual(edits('甲乙',''),dict(S=0,D=2,I=0,N=2))
  self.assertEqual(edits('','甲乙'),dict(S=0,D=0,I=2,N=0))
 def test_operations(self):
  self.assertEqual(edits('abc','axc'),dict(S=1,D=0,I=0,N=3))
  self.assertEqual(edits('abc','ac'),dict(S=0,D=1,I=0,N=3))
  self.assertEqual(edits('abc','abzc'),dict(S=0,D=0,I=1,N=3))
 def test_tie_policy(self):self.assertEqual(edits('ab','ba'),dict(S=2,D=0,I=0,N=2))
 def test_random_distance_and_length(self):
  random.seed(14)
  for _ in range(150):
   a=''.join(random.choices('甲乙丙。',k=random.randrange(10)));b=''.join(random.choices('甲乙丙。',k=random.randrange(10)))
   prev=list(range(len(b)+1))
   for i,x in enumerate(a,1):
    cur=[i]
    for j,y in enumerate(b,1):cur.append(min(cur[-1]+1,prev[j]+1,prev[j-1]+(x!=y)))
    prev=cur
   e=edits(a,b);self.assertEqual(e['S']+e['D']+e['I'],prev[-1]);self.assertEqual(e['N']-e['D']+e['I'],len(b))
 def test_normalize(self):
  self.assertEqual(normalize('Ａ\u3000甲\n，乙…'),'A甲,乙...')
  self.assertEqual(normalize('Ａ\u3000甲\n，乙…',True),'A甲乙')
  self.assertNotEqual(normalize('后'),normalize('後'))
  self.assertNotEqual(normalize('A'),normalize('a'))

class GeometryTests(unittest.TestCase):
 def test_maximum_cardinality_not_greedy(self):
  # p0 can match both; p1 can match only g0, requiring reassignment.
  gt=[box(0,0,10,10),box(10,0,10,10)]
  pred=[box(0,0,20,10),box(0,0,10,10)]
  self.assertEqual(matching(pred,gt,.5),2)
 def test_threshold_inclusive(self):self.assertEqual(matching([box(0,0,20,10)],[box(0,0,10,10)],.5),1)
 def test_single_prediction_not_two_true_positives(self):self.assertEqual(matching([box(0,0,20,10)],[box(0,0,10,10),box(10,0,10,10)],.5),1)
 def test_line_granularity_penalty_is_visible(self):
  g=ground();p=prediction(bbox=box(0,0,100,20));r=score_image(g,p)
  self.assertEqual(r['CER'],0);self.assertEqual(r['detector']['0.5']['TP'],0);self.assertEqual(r['weakOverlapTargetCount'],1)
 def test_multi_line_aggregation(self):
  g=ground();p=prediction();p['regions']=[dict(text='乙',bbox=box(0,50,100,20)),dict(text='甲',bbox=box(0,0,100,20))]
  self.assertEqual(score_image(g,p)['CER'],0)
 def test_vertical_aggregation(self):
  g=ground();g['regions'][0]['orientation']='vertical-rtl';p=prediction();p['regions']=[dict(text='乙',bbox=box(0,0,20,80)),dict(text='甲',bbox=box(50,0,20,80))]
  self.assertEqual(score_image(g,p)['CER'],0)
 def test_ignore_and_uncertain(self):
  g=ground([target(),target(None,box(100,0,100,100),'uncertain','g2')]);g['ignoreRegions']=[dict(bbox=box(200,0,100,100))]
  p=prediction();p['regions'] += [dict(text='垃圾',bbox=box(100,0,100,100)),dict(text='噪声',bbox=box(200,0,100,100))]
  r=score_image(g,p);self.assertEqual(r['CER'],0);self.assertEqual(r['N'],2);self.assertEqual(r['detectorTargets'],2);self.assertEqual(r['detector']['0.5']['FP'],0)
 def test_partial_no_fp_precision_or_f1(self):
  g=ground(fully=False);p=prediction();p['regions'].append(dict(text='额外',bbox=box(200,0,20,20)))
  r=score_image(g,p);self.assertEqual(r['I'],0)
  for d in r['detector'].values():
   self.assertIsNone(d['FP']);self.assertIsNone(d['precision']);self.assertIsNone(d['F1'])
 def test_complete_extra_prediction_insertions(self):
  g=ground();p=prediction();p['regions'].append(dict(text='额外！',bbox=box(200,0,20,20)))
  r=score_image(g,p);self.assertEqual(r['I'],3);self.assertEqual(r['noPunctuationEdits']['I'],2);self.assertEqual(r['CER'],1.5)
 def test_invalid_bbox(self):
  for b in [box(w=0),box(h=-1),box(x=-1),box(x=float('nan')),box(x=float('inf')),box(x=450)]:
   with self.subTest(b=b),self.assertRaises(ValueError):score_image(ground(),prediction(bbox=b))

class AggregateTests(unittest.TestCase):
 def test_missing_failed_empty_keep_denominator(self):
  for images in [[],[dict(id='x',regions=[],error='timeout')],[dict(id='x',regions=[])]]:
   r=score({'images':[ground()]},{'images':images});self.assertEqual(r['D'],2);self.assertEqual(r['N'],2);self.assertEqual(r['microCER'],1);self.assertEqual(r['macroCER'],1)
 def test_no_reference_no_divide_by_zero(self):
  for images in [[],[ground([])],[ground([target(None,certainty='uncertain')])],[ground([target('')])]]:
   r=score({'images':images},{'images':[]});self.assertIsNone(r['microCER']);self.assertIsNone(r['macroCER']);self.assertIsNone(r['microCER_no_punctuation'])
 def test_micro_macro_different(self):
  a=ground([target('甲')]);b=ground([target('甲乙丙')]);b['id']='y'
  r=score({'images':[a,b]},{'images':[prediction('甲')]});self.assertEqual(r['microCER'],.75);self.assertEqual(r['macroCER'],.5)
 def test_hash_mismatch(self):
  p=prediction();p['sha256']='wrong'
  with self.assertRaises(ValueError):score({'images':[ground()]},{'images':[p]})
 def test_duplicate_ids(self):
  with self.assertRaises(ValueError):score({'images':[ground(),ground()]},{'images':[]})
  with self.assertRaises(ValueError):score({'images':[ground()]},{'images':[prediction(),prediction()]})
 def test_no_punctuation_aggregate(self):
  r=score({'images':[ground([target('甲，乙。')])]},{'images':[prediction('甲乙')]})
  self.assertEqual(r['microCER'],.5);self.assertEqual(r['microCER_no_punctuation'],0);self.assertEqual(r['noPunctuationEdits']['N'],2)

if __name__=='__main__':unittest.main()
