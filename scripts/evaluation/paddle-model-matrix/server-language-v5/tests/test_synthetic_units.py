"""纯合成字典辅助函数测试：初次打包未运行，缓存修复时已执行全部四项。

不包含图片字节、推理、私有数据或实际图片清单。
除 Python 标准库外，只需 PyYAML。
"""
import hashlib
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class DictionaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location("public_prepare_assets", ROOT / "prepare_assets.py")
        cls.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.module)

    def spec(self, values):
        data = ("\n".join(values) + "\n").encode("utf-8")
        return {"dictionary_entries": len(values), "empty_entries": values.count(""), "contains_ascii_space": " " in values, "derived_bytes": len(data), "derived_sha256": hashlib.sha256(data).hexdigest()}, data

    def test_preserves_order_duplicates_and_unicode(self):
        spec, expected = self.spec(["Z", "é", "Z"])
        actual = self.module.ordered_dictionary_bytes("PostProcess:\n  character_dict: ['Z', 'é', 'Z']\n", spec)
        self.assertEqual(actual, expected)

    def test_reordered_dictionary_rejected(self):
        spec, _ = self.spec(["Z", "é"])
        with self.assertRaises(ValueError):
            self.module.ordered_dictionary_bytes("PostProcess:\n  character_dict: ['é', 'Z']\n", spec)

    def test_no_numeric_coercion(self):
        spec, _ = self.spec(["7"])
        with self.assertRaises(ValueError):
            self.module.ordered_dictionary_bytes("PostProcess:\n  character_dict: [7]\n", spec)

    def test_line_separator_rejected(self):
        spec, _ = self.spec(["a\nb"])
        with self.assertRaises(ValueError):
            self.module.ordered_dictionary_bytes('PostProcess:\n  character_dict: ["a\\nb"]\n', spec)


if __name__ == "__main__":
    unittest.main()
