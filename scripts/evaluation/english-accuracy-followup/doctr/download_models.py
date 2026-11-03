"""从冻结官方URL下载数据文件，验证完整SHA；不执行模型或远端代码。"""
import argparse
import hashlib
import json
from pathlib import Path
import tempfile
import urllib.parse
import urllib.request
LOCK_SHA256 = "610b1a2dc53697a7b5ea635e75611a7b2fba0e6eceb1c4bf4fedd8eb23bf86f2"


def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):h.update(block)
    return h.hexdigest()


class HTTPSOnlyRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        if urllib.parse.urlsplit(newurl).scheme != 'https':
            raise ValueError('Non-HTTPS redirect refused')
        return super().redirect_request(request, fp, code, message, headers, newurl)


def prepare(output):
    source=Path(__file__).with_name('asset-lock.json').read_bytes()
    assert hashlib.sha256(source).hexdigest()==LOCK_SHA256
    lock=json.loads(source);output.mkdir(parents=True,exist_ok=True);records=[]
    for record in lock['models']:
        url=record['url'];parsed=urllib.parse.urlsplit(url)
        assert parsed.scheme=='https' and parsed.hostname=='doctr-static.mindee.com'
        assert record['name'] in ('db_resnet50','parseq')
        target=output/(record['name']+'.pt')
        if not target.exists():
            temporary=None
            try:
                with tempfile.NamedTemporaryFile(dir=output,delete=False) as stream:
                    temporary=Path(stream.name)
                    with urllib.request.build_opener(HTTPSOnlyRedirect()).open(url,timeout=90) as response:
                        if urllib.parse.urlsplit(response.geturl()).scheme!='https':raise ValueError('HTTPS required')
                        size=0
                        while block:=response.read(1024*1024):
                            size+=len(block)
                            if size>record['bytes']:raise ValueError('Unexpected model size')
                            stream.write(block)
                if temporary.stat().st_size!=record['bytes'] or digest(temporary)!=record['sha256']:raise ValueError('Model hash mismatch')
                if target.exists():raise FileExistsError(target.name)
                # 同文件系统硬链接不会覆盖已有文件。
                import os
                os.link(temporary,target)
            finally:
                if temporary is not None:temporary.unlink(missing_ok=True)
        if target.is_symlink() or target.stat().st_size!=record['bytes'] or digest(target)!=record['sha256']:raise ValueError('Existing model mismatch')
        records.append(dict(record,path=str(target.resolve())))
    manifest=output/'models.local.json'
    data=(json.dumps(records,indent=2)+'\n').encode()
    if manifest.exists() and manifest.read_bytes()!=data:raise FileExistsError('Different local manifest exists')
    manifest.write_bytes(data)
    print(manifest)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);a=p.parse_args();prepare(a.output)
