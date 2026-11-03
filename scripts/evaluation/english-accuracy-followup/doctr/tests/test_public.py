"""公开包轻量检查；不加载torch、模型或私有图片。"""
import ast
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from engine import box
from run_eval import fill_missing


def cache_file(path):
    if path.parent.name!='__pycache__' or path.suffix!='.pyc' or path.is_symlink():return False
    try:source=Path(importlib.util.source_from_cache(str(path)))
    except ValueError:return False
    return source.is_file() and not source.is_symlink()


class Tests(unittest.TestCase):
    def test_syntax(self):
        for path in ROOT.rglob('*.py'):ast.parse(path.read_text())
    def test_scale(self):
        result=box(((.1,.2),(.4,.6)),1000,500)
        for key,value in {'x':100,'y':100,'width':300,'height':200}.items():self.assertAlmostEqual(result[key],value)
    def test_invalid_box(self):
        with self.assertRaises(AssertionError):box(((0,0),(float('nan'),1)),100,100)
    def test_full_failure_denominator(self):
        sources=[dict(id=str(i),sha256=str(i),width=10,height=20) for i in range(10)]
        result={'images':[],'reason':'synthetic failure'};fill_missing(result,sources)
        self.assertEqual(result['manifest_image_count'],10);self.assertEqual(result['completed_image_count'],0)
    def test_locked_models(self):
        source=(ROOT/'asset-lock.json').read_bytes();tree=ast.parse((ROOT/'download_models.py').read_text())
        node=next(n for n in tree.body if isinstance(n,ast.Assign) and isinstance(n.targets[0],ast.Name) and n.targets[0].id=='LOCK_SHA256')
        self.assertEqual(ast.literal_eval(node.value),hashlib.sha256(source).hexdigest())
        self.assertEqual({r['name'] for r in json.loads(source)['models']},{'db_resnet50','parseq'})
    def test_no_private_payload(self):
        for path in ROOT.rglob('*'):
            if not path.is_file() or cache_file(path):continue
            self.assertIn(path.suffix,{'.py','.md','.json','.txt'})
            text=path.read_text()
            for prefix in ['/'+'workspace/','/'+'home/','/'+'Users/']:self.assertNotIn(prefix,text,path.name)
            self.assertNotIn(path.name,{'predictions.json','models.local.json'})
    def test_verified_cache_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'sample.py').write_text('pass\n')
            cache=Path(importlib.util.cache_from_source(str(root/'sample.py')))
            cache.parent.mkdir();cache.write_bytes(b'cache')
            self.assertTrue(cache_file(cache))
            self.assertFalse(cache_file(root/'sample.pyc'))
            (root/'sample.py').unlink();self.assertFalse(cache_file(cache))
    def test_exact_package_and_module_versions(self):
        source=(ROOT/'engine.py').read_text()
        self.assertIn("version('python-doctr') == '1.1.0'",source)
        self.assertIn("doctr.__version__ == 'v1.1.0'",source)
    def test_runtime_identity(self):
        records=json.loads((ROOT/'SOURCE-HASHES.json').read_text())['runtime_files']
        self.assertEqual({r['path'] for r in records},{'engine.py','run_eval.py','summarize_results.py'})
        for row in records:
            self.assertTrue(row['byte_identical'])
            self.assertEqual(row['executed_sha256'],row['public_sha256'])
            self.assertEqual(hashlib.sha256((ROOT/row['path']).read_bytes()).hexdigest(),row['public_sha256'])
    def test_inventory(self):
        path=ROOT/'PUBLIC-FILES.json'
        if not path.exists():self.skipTest('Final package not sealed yet')
        records=json.loads(path.read_text())
        actual={p.relative_to(ROOT).as_posix() for p in ROOT.rglob('*') if p.is_file() and not cache_file(p)}-{'PUBLIC-FILES.json','SHA256SUMS.txt'}
        self.assertEqual({r['path'] for r in records},actual)
        for r in records:self.assertEqual(hashlib.sha256((ROOT/r['path']).read_bytes()).hexdigest(),r['sha256'])

if __name__=='__main__':unittest.main()
