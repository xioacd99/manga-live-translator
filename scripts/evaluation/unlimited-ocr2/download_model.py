#!/usr/bin/env python3
"""只下载固定提交的模型数据，不获取或执行 Hugging Face Python。"""
import argparse,hashlib,json,pathlib,time,urllib.request
BASE=pathlib.Path(__file__).resolve().parent
REPO='mlx-community/Unlimited-OCR-2-4bit'
REV='ac04b808479927cc42ea82e06f55ebecd2b0a623'
ALLOW=['model.safetensors','config.json','processor_config.json','tokenizer_config.json','tokenizer.json','special_tokens_map.json','chat_template.jinja','generation_config.json','model.safetensors.index.json','README.md']
ap=argparse.ArgumentParser(description=__doc__)
ap.add_argument('--output',type=pathlib.Path,required=True)
args=ap.parse_args()
metadata=json.loads((BASE/'model-files.json').read_text())
assert metadata['sha']==REV
siblings={x['rfilename']:x for x in metadata['siblings']}
out=args.output.resolve();out.mkdir(parents=True,exist_ok=True)
records=[]
for name in ALLOW:
    entry=siblings[name];target=out/name;url=f'https://huggingface.co/{REPO}/resolve/{REV}/{name}'
    assert not name.endswith('.py')
    start=time.perf_counter();h=hashlib.sha256();g=hashlib.sha1(f"blob {entry['size']}\0".encode());n=0
    if target.exists():
        source=target.open('rb');download=False
    else:
        # HTTP 403 会原样抛出并停止；不换源或重试被拒绝的请求。
        source=urllib.request.urlopen(url,timeout=90);download=True
    part=target.with_suffix(target.suffix+'.part')
    try:
        writer=part.open('wb') if download else None
        try:
            while b:=source.read(2*1024*1024):
                n+=len(b);h.update(b);g.update(b)
                if writer:writer.write(b)
        finally:
            if writer:writer.close()
            source.close()
        assert n==entry['size'],(name,n,entry['size'])
        if 'lfs' in entry: assert h.hexdigest()==entry['lfs']['sha256'],name
        else: assert g.hexdigest()==entry['blobId'],name
        if download:part.replace(target)
        record={'name':name,'url':url,'bytes':n,'sha256':h.hexdigest(),'seconds':time.perf_counter()-start,'downloaded':download};records.append(record)
        print(json.dumps(record),flush=True)
        (out/'download-manifest.json').write_text(json.dumps(records,indent=2)+'\n')
    except Exception:
        raise
assert not list(out.glob('*.py'))
