"""只下载固定公开模型URL并核验SHA，不上传任何输入图片。"""
import argparse,json,hashlib,urllib.request
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--output-dir',type=Path,required=True);p.add_argument('--manifest',type=Path,default=Path(__file__).with_name('model-manifest.json'));a=p.parse_args();a.output_dir.mkdir(parents=True,exist_ok=True);models=json.loads(a.manifest.read_text())
for key,m in models.items():
 path=a.output_dir/(key+'.onnx')
 if not path.exists():urllib.request.urlretrieve(m['url'],path)
 if hashlib.sha256(path.read_bytes()).hexdigest()!=m['sha256']:raise SystemExit('模型SHA不符: '+key)
 m['path']=str(path.resolve());print(key,path.stat().st_size,flush=True)
(a.output_dir/'models-local.json').write_text(json.dumps(models,indent=2))
