"""静态验证路径参数化与固定请求预算，不导入运行入口、不启动服务。"""
import ast
import base64
from pathlib import Path
import unittest


class RuntimeContractTests(unittest.TestCase):
    """仅求值受限的命令列表和合成请求表达式，检查迁移时未误用旧路径。"""

    def setUp(self):
        self.tree = ast.parse(Path(__file__).with_name('run_eval.py').read_text())

    def expression(self, name):
        for node in ast.walk(self.tree):
            if isinstance(node, ast.Assign) and any(
                    isinstance(target, ast.Name) and target.id == name for target in node.targets):
                return ast.Expression(node.value)
        self.fail('未找到固定赋值：' + name)

    def command(self):
        return eval(compile(self.expression('cmd'), '<静态命令>', 'eval'),
                    {'__builtins__': {'str': str}, 'runtime': Path('runtime-marker'),
                     'models': Path('models-marker'), 'port': 18087})

    def test_runtime_and_model_paths_separate(self):
        cmd = self.command()
        self.assertEqual(cmd[0], 'runtime-marker/llama-server')
        self.assertEqual(cmd[cmd.index('-m') + 1], 'models-marker/PaddleOCR-VL-1.6-GGUF.gguf')
        self.assertEqual(cmd[cmd.index('--mmproj') + 1],
                         'models-marker/PaddleOCR-VL-1.6-GGUF-mmproj-spotting.gguf')

    def test_fixed_server_flags(self):
        cmd = self.command()
        required = {'--host': '127.0.0.1', '--port': '18087', '--ctx-size': '8192',
                    '--n-predict': '4096', '--threads': '4', '--threads-batch': '4',
                    '--n-gpu-layers': '0', '--parallel': '1', '--cache-ram': '0'}
        for key, value in required.items():
            self.assertEqual(cmd[cmd.index(key) + 1], value)
        for flag in ['--special', '--no-warmup', '--no-mmproj-offload', '--no-webui']:
            self.assertIn(flag, cmd)

    def test_fixed_request_budget(self):
        payload = eval(compile(self.expression('payload'), '<合成请求>', 'eval'),
                       {'__builtins__': {}, 'base64': base64, 'image': b'synthetic-only'})
        self.assertEqual(payload['max_tokens'], 4096)
        self.assertEqual(payload['temperature'], 0)
        self.assertEqual(payload['top_k'], 1)
        self.assertEqual(payload['repeat_penalty'], 1.0)
        self.assertEqual(payload['seed'], 0)
        self.assertFalse(payload['stream'])
        self.assertFalse(payload['cache_prompt'])
        self.assertEqual(payload['messages'][0]['content'][1]['text'], 'Spotting:')


if __name__ == '__main__':
    unittest.main()
