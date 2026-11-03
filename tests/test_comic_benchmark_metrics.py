import unittest,random,copy
from scripts.evaluation.score import normalize,edits,matching,score,score_image,words,versioned_ordered

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

class EnglishWordTests(unittest.TestCase):
 def english(self,text='Hello world!',fully=True):
  g=ground([target(text)],fully=fully);g['language']='en';return g
 def test_unicode_space_nfkc_case_punctuation(self):
  self.assertEqual(words('Ｈｅｌｌｏ\u3000WORLD!\n next\tword'),['Hello','WORLD!','next','word'])
  r=score_image(self.english(),prediction('hello world'),include_wer=True)
  self.assertEqual(r['wordEdits'],dict(S=2,D=0,I=0,N=2));self.assertEqual(r['WER'],1)
 def test_internal_spaces_and_region_join(self):
  g=self.english('Hello brave new world!');p=prediction()
  p['regions']=[dict(text='Hello  brave',bbox=box(0,0,50,20)),dict(text='new\tworld!',bbox=box(0,30,50,20))]
  r=score_image(g,p,include_wer=True);self.assertEqual(r['WER'],0);self.assertEqual(r['wordEdits']['N'],4)
 def test_word_insertions_and_deletions(self):
  r=score_image(self.english(),prediction('Hello brave world!'),include_wer=True)
  self.assertEqual(r['wordEdits'],dict(S=0,D=0,I=1,N=2));self.assertEqual(r['WER'],.5)
  r=score_image(self.english(),prediction('Hello'),include_wer=True)
  self.assertEqual(r['wordEdits'],dict(S=0,D=1,I=0,N=2))
 def test_whitespace_differences_are_words_not_characters(self):
  r=score_image(self.english('ice cream'),prediction('icecream'),include_wer=True)
  self.assertEqual(r['CER'],0);self.assertEqual(r['WER'],1)
 def test_unmatched_words_only_fully_annotated(self):
  p=prediction('Hello world!');p['regions'].append(dict(text='extra two',bbox=box(200,0,40,20)))
  for fully in [True,False]:
   r=score_image(self.english(fully=fully),p,include_wer=True)
   self.assertEqual(r['unmatchedInsertionWords'],2 if fully else 0)
   self.assertEqual(r['WER'],1 if fully else 0)
 def test_uncertain_and_ignored_do_not_become_word_insertions(self):
  g=self.english();g['regions'].append(target(None,box(100,0,100,100),'uncertain','uncertain'))
  g['ignoreRegions']=[dict(bbox=box(200,0,100,100))]
  p=prediction('Hello world!');p['regions'] += [dict(text='unknown text',bbox=box(100,0,100,100)),dict(text='ignored text',bbox=box(200,0,100,100))]
  r=score_image(g,p,include_wer=True);self.assertEqual(r['wordEdits'],dict(S=0,D=0,I=0,N=2))
 def test_missing_and_failed_predictions_keep_word_denominator(self):
  for images in [[],[dict(id='x',regions=[],error='timeout')]]:
   r=score({'images':[self.english()]},{'images':images},include_wer=True)
   self.assertEqual(r['wordEdits'],dict(S=0,D=2,I=0,N=2));self.assertEqual(r['microWER'],1)
 def test_non_english_is_explicitly_unsupported(self):
  for language in ['ja','zh',None,'en-US']:
   g=ground();g['language']=language;r=score_image(g,prediction(),include_wer=True)
   self.assertIsNone(r['WER']);self.assertIsNone(r['wordEdits']);self.assertFalse(r['werSupported'])
 def test_empty_and_uncertain_reference_wer_is_null(self):
  for regions in [[],[target('')],[target(None,certainty='uncertain')]]:
   g=self.english();g['regions']=regions;r=score_image(g,dict(regions=[]),include_wer=True)
   self.assertTrue(r['werSupported']);self.assertIsNone(r['WER']);self.assertEqual(r['wordEdits']['N'],0)
 def test_language_inheritance_and_mixed_aggregate(self):
  a=self.english('one');b=self.english('one two three');b['id']='y'
  j=ground();j['id']='ja';j['language']='ja'
  del a['language']
  r=score({'language':'en','images':[a,b,j]},{'images':[prediction('one')]},include_wer=True)
  self.assertEqual(r['microWER'],.75);self.assertEqual(r['macroWER'],.5)
  self.assertEqual(r['werSupportedImages'],2);self.assertEqual(r['werUnsupportedImages'],1)
  self.assertEqual(r['wordEdits']['N'],4)
 def test_all_unsupported_aggregate(self):
  r=score({'images':[ground()]},{'images':[]},include_wer=True)
  self.assertIsNone(r['microWER']);self.assertIsNone(r['macroWER']);self.assertIsNone(r['wordEdits'])

class OrderingVersionTests(unittest.TestCase):
 def test_jittered_same_line_optin_changes_both_metrics(self):
  g=ground([target('Hello world!')]);g['language']='en'
  p=prediction();p['regions']=[dict(text='world!',bbox=box(50,9,40,20)),dict(text='Hello',bbox=box(0,10,40,20))]
  legacy=score_image(g,p,include_wer=True);new=score_image(g,p,include_wer=True,text_order='line-overlap-v1')
  self.assertGreater(legacy['CER'],0);self.assertGreater(legacy['WER'],0)
  self.assertEqual(new['CER'],0);self.assertEqual(new['WER'],0);self.assertEqual(new['textOrdering'],'line-overlap-v1')
 def test_separate_lines_and_fixed_anchor_avoid_transitive_merging(self):
  items=[dict(text='A',bbox=box(30,0,10,20)),dict(text='B',bbox=box(60,8,10,20)),dict(text='C',bbox=box(0,16,10,20))]
  self.assertEqual([r['text'] for r in versioned_ordered(items,version='line-overlap-v1')],['A','B','C'])
 def test_no_text_content_used_to_sort(self):
  items=[dict(text='z',bbox=box(0,1,10,20)),dict(text='a',bbox=box(20,0,10,20))]
  self.assertEqual([r['text'] for r in versioned_ordered(items,version='line-overlap-v1')],['z','a'])
 def test_vertical_remains_legacy_order(self):
  items=[dict(text='left',bbox=box(0,0,20,80)),dict(text='right',bbox=box(50,5,20,80))]
  self.assertEqual(versioned_ordered(items,'vertical-rtl','line-overlap-v1'),versioned_ordered(items,'vertical-rtl','legacy-yx'))
 def test_invalid_version_fails_even_empty_input(self):
  with self.assertRaises(ValueError):score({'images':[]},{'images':[]},text_order='unknown')
 def test_default_output_exactly_matches_historical_chinese_snapshot(self):
  # 完整旧输出快照：默认不得新增 WER 或排序版本字段，也不得改变数值。
  edits0=dict(S=0,D=0,I=0,N=2)
  detector={str(t):dict(TP=1,FP=0,FN=0,precision=1.,recall=1.,F1=1.) for t in [.3,.5]}
  image=dict(id='x',sha256='fixed',fullyAnnotated=True,**edits0,CER=0.,CER_no_punctuation=0.,noPunctuationEdits=edits0,exactRegions=1,referenceRegions=1,unmatchedInsertionCharacters=0,detector=detector,weakOverlapTargetCount=1,detectorTargets=1,regions=[dict(id='g1',**edits0,exact=True,predictionCount=1)],error=None,timing={})
  expected=dict(scheme=None,normalization='NFKC; remove Unicode whitespace; preserve punctuation/case/script',matching='geometry only, prediction overlap >=0.5 assigned once; strict detection maximum-cardinality IoU matching',**edits0,microCER=0.,macroCER=0.,noPunctuationEdits=edits0,microCER_no_punctuation=0.,exactRegions=1,referenceRegions=1,images=[image])
  self.assertEqual(score({'images':[ground()]},{'images':[prediction()]}),expected)

class OcrEvaluationScopeTests(unittest.TestCase):
 def test_excluded_ocr_keeps_detection_but_never_adds_edits(self):
  for language in ['ja','en']:
   g=ground([target(None,certainty='uncertain')]);g.update(language=language,ocrEvaluation=False)
   p=prediction('unknown');p['regions'].append(dict(text='extra words',bbox=box(200,0,40,20)))
   r=score_image(g,p,include_wer=True)
   self.assertFalse(r['ocrEvaluated']);self.assertEqual({k:r[k] for k in ['S','D','I','N']},dict(S=0,D=0,I=0,N=0))
   self.assertIsNone(r['CER']);self.assertIsNone(r['CER_no_punctuation']);self.assertIsNone(r['WER'])
   self.assertEqual(r['detector']['0.5']['TP'],1);self.assertEqual(r['detector']['0.5']['FP'],1)
   self.assertEqual(r['unmatchedInsertionCharacters'],0)
 def test_mixed_evaluated_and_excluded_images_do_not_pollute_aggregate(self):
  a=ground([target('one two')]);a['language']='en'
  b=ground([target(None,certainty='uncertain')]);b.update(id='excluded',language='en',ocrEvaluation=False)
  p=prediction('noise words',bbox=box(200,0,40,20));p['id']='excluded'
  normal=prediction('one')
  r=score({'images':[a,b]},{'images':[normal,p]},include_wer=True)
  baseline=score({'images':[a]},{'images':[normal]},include_wer=True)
  for key in ['S','D','I','N','microCER','macroCER','microCER_no_punctuation','wordEdits','microWER','macroWER']:
   self.assertEqual(r[key],baseline[key],key)
  self.assertEqual(r['ocrEvaluatedImages'],1);self.assertEqual(r['ocrExcludedImages'],1)
 def test_false_also_excludes_certain_text_and_explicit_true_evaluates(self):
  g=ground();g['ocrEvaluation']=False
  self.assertEqual(score_image(g,prediction('错'))['N'],0)
  g['ocrEvaluation']=True;r=score_image(g,prediction('错'))
  self.assertTrue(r['ocrEvaluated']);self.assertEqual(r['N'],2)
 def test_invalid_scope_flag_rejected(self):
  for flag in [None,0,1,'false']:
   g=ground();g['ocrEvaluation']=flag
   with self.assertRaises(ValueError):score_image(g,prediction())
 def test_missing_flag_preserves_legacy_uncertain_insertion_behavior(self):
  g=ground([target(None,certainty='uncertain')]);p=prediction('extra',bbox=box(200,0,40,20))
  r=score_image(g,p);self.assertNotIn('ocrEvaluated',r);self.assertEqual(r['I'],5)

class VerticalColumnV2Tests(unittest.TestCase):
 def test_synthetic_vertical_character_jitter_reproduces_legacy_defect(self):
  # 四个合成字框，不读取任何实际识别结果或参考样本来选阈值。
  items=[dict(text='甲',bbox=box(50,0,20,15)),dict(text='乙',bbox=box(52,20,20,15)),dict(text='丙',bbox=box(10,0,20,15)),dict(text='丁',bbox=box(12,20,20,15))]
  legacy=versioned_ordered(items,'vertical','legacy-yx')
  self.assertEqual(''.join(r['text'] for r in legacy),'乙甲丁丙')
  self.assertEqual(versioned_ordered(items,'vertical','line-overlap-v1'),legacy)
  self.assertEqual(''.join(r['text'] for r in versioned_ordered(items,'vertical','line-column-overlap-v2')),'甲乙丙丁')
  g=ground([target('甲乙丙丁')]);g['regions'][0]['orientation']='vertical';g['language']='ja'
  p=dict(regions=items)
  self.assertGreater(score_image(g,p,text_order='line-overlap-v1')['CER'],0)
  result=score_image(g,p,text_order='line-column-overlap-v2',include_wer=True)
  self.assertEqual(result['CER'],0);self.assertIsNone(result['WER']);self.assertEqual(result['textOrdering'],'line-column-overlap-v2')
 def test_multiple_words_in_each_column_and_input_permutations(self):
  items=[dict(text='right-top',bbox=box(80,0,20,30)),dict(text='right-bottom',bbox=box(78,40,20,30)),dict(text='left-top',bbox=box(20,0,20,30)),dict(text='left-bottom',bbox=box(22,40,20,30))]
  expected=['right-top','right-bottom','left-top','left-bottom']
  for _ in range(20):
   shuffled=random.Random(_).sample(items,len(items))
   self.assertEqual([r['text'] for r in versioned_ordered(shuffled,'vertical-rtl','line-column-overlap-v2')],expected)
 def test_fixed_anchor_prevents_column_chaining(self):
  items=[dict(text='A',bbox=box(80,30,20,10)),dict(text='B',bbox=box(72,60,20,10)),dict(text='C',bbox=box(64,0,20,10))]
  self.assertEqual([r['text'] for r in versioned_ordered(items,'vertical','line-column-overlap-v2')],['A','B','C'])
 def test_exact_overlap_threshold_and_width_variation(self):
  items=[dict(text='lower',bbox=box(50,30,20,10)),dict(text='upper',bbox=box(40,0,20,10))]
  self.assertEqual([r['text'] for r in versioned_ordered(items,'vertical','line-column-overlap-v2')],['upper','lower'])
  items[1]['bbox']=box(51,0,16,10)
  self.assertEqual([r['text'] for r in versioned_ordered(items,'vertical','line-column-overlap-v2')],['upper','lower'])
 def test_v2_horizontal_exactly_matches_v1(self):
  rng=random.Random(42)
  for _ in range(50):
   items=[dict(text=str(i),bbox=box(rng.randrange(100),rng.randrange(100),rng.randrange(5,30),rng.randrange(5,30))) for i in range(15)]
   self.assertEqual(versioned_ordered(items,'horizontal','line-column-overlap-v2'),versioned_ordered(items,'horizontal','line-overlap-v1'))
 def test_no_content_or_confidence_used(self):
  items=[dict(text='a',confidence=.99,bbox=box(52,20,20,10)),dict(text='z',confidence=.01,bbox=box(50,0,20,10))]
  self.assertEqual([r['text'] for r in versioned_ordered(items,'vertical','line-column-overlap-v2')],['z','a'])
 def test_empty_single_and_old_default_unchanged(self):
  self.assertEqual(versioned_ordered([],'vertical','line-column-overlap-v2'),[])
  item=dict(text='x',bbox=box())
  self.assertEqual(versioned_ordered([item],'vertical','line-column-overlap-v2'),[item])
  g=ground();p=prediction()
  self.assertEqual(score_image(g,p),score_image(g,p,text_order='legacy-yx'))

if __name__=='__main__':unittest.main()
