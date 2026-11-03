"""无权重、无网络的静态协议检查。"""
import ast,json,pathlib,unittest
P=pathlib.Path(__file__).resolve().parent
class Contract(unittest.TestCase):
 def test_python_parse(self):
  for name in ['probe_two_pages.py','run_guarded_probe.py','download_model.py','cpu_ops_probe.py']:ast.parse((P/name).read_text())
 def test_only_model_data(self):
  m=json.loads((P/'model-files.json').read_text());self.assertEqual(len(m['siblings']),10);self.assertFalse(any(x['rfilename'].endswith('.py') for x in m['siblings']))
 def test_weight_hash(self):
  m=json.loads((P/'model-files.json').read_text());w=next(x for x in m['siblings'] if x['rfilename']=='model.safetensors');self.assertEqual(w['size'],2459096904);self.assertEqual(w['lfs']['sha256'],'c623d9e83bf3f7035770beeb3110f57dc3ff4bf86e7ce871a858f840d329ed11')
 def test_safety_and_protocol(self):
  s=(P/'probe_two_pages.py').read_text();self.assertIn('trust_remote_code=False',s);self.assertNotIn('trust_remote_code=True',s);self.assertIn('max_tokens=256',s);self.assertIn('cropping=False',s);self.assertIn('mx.synchronize(generation_stream)',s)
 def test_guard(self):
  s=(P/'run_guarded_probe.py').read_text();self.assertIn('rss>6000000000',s);self.assertIn('time.perf_counter()-t>900',s);self.assertIn('fcntl.LOCK_EX',s)
 def test_no_private_workspace_paths(self):
  for p in P.glob('*.py'):self.assertNotIn('/'+'workspace'+'/',p.read_text())
if __name__=='__main__':unittest.main()
