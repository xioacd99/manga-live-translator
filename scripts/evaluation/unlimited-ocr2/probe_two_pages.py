#!/usr/bin/env python3
"""使用原生 MLX-VLM 本地处理两张合成页；不执行模型仓库 Python。"""
import argparse,json,os,pathlib,sys,time,traceback,resource,hashlib,dataclasses,re
ap=argparse.ArgumentParser(description=__doc__)
ap.add_argument('--models',type=pathlib.Path,required=True)
ap.add_argument('--output',type=pathlib.Path,required=True)
args=ap.parse_args()
OUT=args.output.resolve();OUT.mkdir(parents=True,exist_ok=True)
os.environ.update(HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',HF_HUB_DISABLE_TELEMETRY='1',TOKENIZERS_PARALLELISM='false')
os.sched_setaffinity(0, sorted(os.sched_getaffinity(0))[:4])
T=time.perf_counter()
def emit(stage,**kw):
 d={'stage':stage,'elapsed_s':time.perf_counter()-T,**kw}; print(json.dumps(d,ensure_ascii=False),flush=True)
 with (OUT/'stages.jsonl').open('a') as f:f.write(json.dumps(d,ensure_ascii=False)+'\n')
def write_json(name,d):(OUT/name).write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
try:
 import mlx.core as mx
 mx.set_default_device(mx.cpu)
 import transformers.dynamic_module_utils as dynamic
 def no_remote_code(*args,**kwargs):raise RuntimeError('HF dynamic remote Python execution is forbidden in this probe')
 dynamic.get_class_from_dynamic_module=no_remote_code
 from mlx_vlm import load,stream_generate
 from mlx_vlm.prompt_utils import apply_chat_template
 from mlx_vlm.generate.common import generation_stream
 from PIL import Image,ImageDraw,ImageFont
 modelpath=args.models.resolve()
 assert modelpath.is_dir() and not list(modelpath.glob('*.py'))
 info=json.loads((modelpath/'download-manifest.json').read_text())
 assert len(info)==10 and next(x for x in info if x['name']=='model.safetensors')['sha256']=='c623d9e83bf3f7035770beeb3110f57dc3ff4bf86e7ce871a858f840d329ed11'
 cfg=json.loads((modelpath/'config.json').read_text());assert cfg['sparse_attention_config']['training_stage']=='dash'
 emit('runtime_ready',device=str(mx.default_device()),generation_stream=str(generation_stream),affinity=sorted(os.sched_getaffinity(0)),environment={k:os.getenv(k) for k in ['OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS','TOKENIZERS_PARALLELISM']},thread_limit_verified=False)
 pages=[]
 for i,words in enumerate([['HELLO WORLD','PAGE ONE'],['SECOND PAGE','GOOD MORNING']],1):
  im=Image.new('RGB',(768,512),'white');draw=ImageDraw.Draw(im);font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',48)
  for j,word in enumerate(words):draw.text((64,100+110*j),word,font=font,fill='black')
  p=OUT/f'page_{i}.png';im.save(p);pages.append(str(p))
 emit('synthetic_pages_ready',count=2,size=[768,512])
 t=time.perf_counter();model,processor=load(str(modelpath),lazy=False,strict=True,trust_remote_code=False)
 mx.eval(model.parameters());mx.synchronize()
 load_seconds=time.perf_counter()-t
 classes={'model':type(model).__module__+'.'+type(model).__name__,'processor':type(processor).__module__+'.'+type(processor).__name__,'attention':type(model.language_model.model.layers[0].self_attn).__module__+'.'+type(model.language_model.model.layers[0].self_attn).__name__}
 assert '.unlimited_ocr.' in classes['model'] and classes['attention'].endswith('.DashAttention'),classes
 emit('model_loaded',seconds=load_seconds,classes=classes,maxrss_bytes=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*1024)
 prompt=apply_chat_template(processor,model.config,'Multi page parsing.',num_images=2).strip()
 write_json('protocol.json',{'runtime':'mlx-vlm 0.7.11 / mlx-cpu 0.32.4','device':str(mx.default_device()),'model_revision':'ac04b808479927cc42ea82e06f55ebecd2b0a623','max_tokens':256,'temperature':0.0,'top_p':1.0,'top_k':0,'cropping':False,'base_size':1024,'image_size':1024,'prefill_step_size':2048,'skip_special_tokens':False,'prompt':prompt,'affinity':sorted(os.sched_getaffinity(0)),'thread_limit_verified':False,'raw_user_images_used':False,'trust_remote_code':False,'load_seconds_synchronized':load_seconds,'memory_limit_bytes':6000000000,'timeout_seconds':900,'repeat_count':1})
 mx.synchronize();t=time.perf_counter();cpu0=time.process_time();chunks=[];last=None;first=None
 with (OUT/'stream.jsonl').open('w') as f:
  for r in stream_generate(model,processor,prompt,image=pages,max_tokens=256,temperature=0.0,top_p=1.0,top_k=0,cropping=False,base_size=1024,image_size=1024,prefill_step_size=2048,skip_special_tokens=False):
   if first is None:first=time.perf_counter()-t;emit('first_response',seconds=first)
   rec={k:getattr(r,k) for k in ['text','prompt_tokens','generation_tokens','total_tokens','finish_reason','token_ids']};rec['wall_s']=time.perf_counter()-t
   rec['token']=int(r.token.item()) if hasattr(r.token,'item') else r.token
   f.write(json.dumps(rec,ensure_ascii=False)+'\n');f.flush();chunks.append(r.text);last=r
 mx.synchronize(generation_stream);mx.synchronize()
 wall=time.perf_counter()-t;cpu=time.process_time()-cpu0
 text=''.join(chunks);(OUT/'output.txt').write_text(text)
 ids=last.token_ids if last is not None else [];raw=processor.tokenizer.decode(ids,skip_special_tokens=False);(OUT/'raw-token-decode.txt').write_text(raw)
 result={'status':'completed','load_seconds_synchronized':load_seconds,'request_seconds_synchronized':wall,'cpu_seconds':cpu,'first_response_seconds':first,'maxrss_bytes':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*1024,'device':str(mx.default_device()),'finish_reason':last.finish_reason if last else None,'prompt_tokens':last.prompt_tokens if last else None,'generated_tokens':last.generation_tokens if last else None,'classes':classes,'page_markers':text.count('<PAGE>'),'block_markers':text.count('<BLOCK>'),'fork_markers':text.count('<FORK>'),'output_chars':len(text),'output_sha256':hashlib.sha256(text.encode()).hexdigest(),'box_literals':re.findall(r'\[\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\]',text),'accuracy_claim':False}
 write_json('result.json',result);emit('complete',**result)
except Exception as e:
 tb=traceback.format_exc();(OUT/'exception.txt').write_text(tb);write_json('result.json',{'status':'failed','exception_type':type(e).__name__,'message':str(e),'elapsed_s':time.perf_counter()-T,'maxrss_bytes':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*1024});emit('failed',exception=str(e));raise
