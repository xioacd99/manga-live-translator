"""仅用标准库检查 AST 和元数据，不导入 OCR 模块，不运行推理。"""
import ast
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


def is_standard_bytecode_cache(path):
    """仅识别标准缓存目录直接子级、且对应真实源码的字节码缓存。"""
    if path.parent.name != "__pycache__" or path.suffix != ".pyc" or path.is_symlink():
        return False
    try:
        source = Path(importlib.util.source_from_cache(str(path)))
    except ValueError:
        return False
    return source.parent == path.parent.parent and source.is_file() and not source.is_symlink()


def public_payload_files(root):
    """只排除已识别的运行缓存；未知文件仍进入白名单和封存清单检查。"""
    return [path for path in root.rglob("*") if path.is_file() and not is_standard_bytecode_cache(path)]


class StaticChecks(unittest.TestCase):
    def test_all_python_syntax(self):
        for path in sorted(ROOT.rglob("*.py")):
            with self.subTest(path=path.relative_to(ROOT).as_posix()):
                ast.parse(path.read_text(), filename=path.name)

    def test_byte_identical_copies(self):
        changes = json.loads((ROOT / "PUBLIC-COPY-CHANGES.json").read_text())
        for record in changes["files"]:
            actual = hashlib.sha256((ROOT / record["public"]).read_bytes()).hexdigest()
            self.assertEqual(actual, record["public_sha256"])
            if record["byte_identical"]:
                self.assertEqual(actual, record["source_sha256"])
                self.assertEqual(record["exact_changes"], [])

    def test_required_assets_and_sizes(self):
        lock = json.loads((ROOT / "asset-lock.json").read_text())
        expected = {"v5_server_det", "v5_server_rec", "v6_small_det", "v6_medium_rec", "v5_latin_rec", "v5_en_rec", "legacy_cls"}
        self.assertEqual(set(lock["models"]), expected)
        for record in lock["models"].values():
            self.assertGreater(record["bytes"], 0)
            self.assertRegex(record["sha256"], r"^[0-9a-f]{64}$")
            self.assertTrue(record["url"].startswith("https://"))
            self.assertNotIn("path", record)
        for key, entries, classes in [("v5_server_rec", 18383, 18385), ("v5_latin_rec", 836, 838)]:
            record = lock["dictionaries"][key]
            self.assertEqual(record["dictionary_entries"], entries)
            self.assertEqual(record["decoder_classes_with_blank_and_space"], classes)
            self.assertEqual(record["source_field"], "PostProcess.character_dict")
            self.assertIn(record["source_revision"], record["source_url"])
            self.assertNotIn("derived_path", record)
        self.assertEqual(lock["embedded_dictionary_expectations"]["v5_en_rec"]["decoder_classes_with_blank_and_space"], 438)

    def test_downloader_lock_is_pinned(self):
        tree = ast.parse((ROOT / "prepare_assets.py").read_text())
        assignments = {node.targets[0].id: node.value for node in tree.body if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name)}
        expected = ast.literal_eval(assignments["LOCK_SHA256"])
        self.assertEqual(expected, hashlib.sha256((ROOT / "asset-lock.json").read_bytes()).hexdigest())
        imports = {node.module for node in ast.walk(tree) if isinstance(node, ast.ImportFrom)}
        imports |= {alias.name for node in ast.walk(tree) if isinstance(node, ast.Import) for alias in node.names}
        self.assertFalse(imports & {"onnxruntime", "rapidocr", "torch", "cv2"})
        self.assertNotIn("exec", {node.func.id for node in ast.walk(tree) if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)})

    def test_frozen_matrices_and_helpers(self):
        expected = {
            "server": [
                ("v5_server_native960", "v5_server_det", "v5_server_rec", "target", 960),
                ("v5_server_common2048", "v5_server_det", "v5_server_rec", "target", 2048),
                ("v6small_det_server_rec_common2048", "v6_small_det", "v5_server_rec", "target", 2048),
                ("server_det_v6medium_rec_common2048", "v5_server_det", "v6_medium_rec", "target", 2048),
            ],
            "language": [
                ("small_det_latin_rec_common2048", "v6_small_det", "v5_latin_rec", "target", 2048),
                ("small_det_en_rec_common2048", "v6_small_det", "v5_en_rec", "target", 2048),
            ],
        }
        for family, matrix in expected.items():
            source = (ROOT / f"run_{family}_matrix.py").read_text()
            tree = ast.parse(source)
            node = next(n for n in tree.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "MATRIX" for t in n.targets))
            self.assertEqual(ast.literal_eval(node.value), matrix)
            self.assertIn(f"from {family}_worker_process import worker", source)
            self.assertTrue((ROOT / f"{family}_worker_engine.py").is_file())
            # 这里只检查源码结构，不证明运行时守护一定生效。
            for fragment in ["assert len(sources)==10", "mem<6*1024**3", "mem<1.5*1024**3", "total>5*1024**3", "submitted+180", "start+180", "fill_missing(result,sources)", "mp.get_context('spawn')", "fcntl.LOCK_EX"]:
                self.assertIn(fragment, source)
        adapter = (ROOT / "server_preprocess_adapter.py").read_text()
        self.assertIn("Copyright (c) 2024 PaddlePaddle Authors", adapter)
        self.assertIn("Apache License, Version 2.0", adapter)
        self.assertIn("4c968d30b9d0d4a693d9eaaef0881c20f8d7d0e0", adapter)

    def test_common_resize_ast(self):
        def method(path):
            tree = ast.parse(path.read_text())
            cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "CapturingOCR")
            return next(n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == "preprocess_img")
        server = method(ROOT / "server_worker_engine.py")
        language = method(ROOT / "language_worker_engine.py")
        # server 的第一个分支是协议单独声明的 native960 路径。
        self.assertEqual([ast.dump(n) for n in server.body[1:]], [ast.dump(n) for n in language.body])

    def test_public_payload_whitelist(self):
        allowed_suffixes = {".py", ".json", ".md", ".txt"}
        for path in public_payload_files(ROOT):
            self.assertIn(path.suffix, allowed_suffixes, path.name)
            text = path.read_text()
            # 分段构造前缀，避免测试文件本身出现被检查的完整前缀。
            for prefix in ["/" + "workspace/", "/" + "home/", "/" + "Users/"]:
                self.assertNotIn(prefix, text, path.name)
            self.assertNotIn(path.name, {"predictions.json", "models.local.json", "session-details.json", "effective-config.yaml"})

    def test_bytecode_cache_filter_precision(self):
        # 临时目录只位于本包内，退出测试即清理；不导入任何合成缓存。
        with tempfile.TemporaryDirectory(prefix="cache-regression-", dir=ROOT) as temporary:
            root = Path(temporary)
            source = root / "module.py"
            source.write_text("# 合成源码，仅用于缓存路径回归\n")
            cache = Path(importlib.util.cache_from_source(str(source)))
            cache.parent.mkdir()
            cache.write_bytes(b"synthetic cache; never imported")
            unknown = [
                root / "foo.pyc",
                cache.parent / "unknown.bin",
                cache.parent / "unknown.json",
                cache.parent / ("missing." + cache.name.split(".", 1)[1]),
                cache.parent / "module.pyc",
                cache.parent / "nested" / cache.name,
            ]
            for path in unknown:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"synthetic unknown payload")
            self.assertTrue(is_standard_bytecode_cache(cache))
            for path in unknown:
                self.assertFalse(is_standard_bytecode_cache(path), path.name)
            # 未知 JSON 即使后缀合法，也须纳入清单比较，不能随缓存跳过。
            published = set(public_payload_files(root))
            self.assertNotIn(cache, published)
            self.assertEqual(published, {source, *unknown})

    def test_generated_manifest_engine_contract(self):
        lock = json.loads((ROOT / "asset-lock.json").read_text())
        tree = ast.parse((ROOT / "prepare_assets.py").read_text())
        prepare = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "prepare")
        assignments = {
            ast.dump(target): ast.dump(node.value)
            for node in ast.walk(prepare) if isinstance(node, ast.Assign)
            for target in node.targets
        }
        # 只比较赋值 AST，不执行准备器、下载资源或实例化模型。
        for statement in [
            "record['path'] = str(destination)",
            "spec['derived_path'] = str(dictionary_path)",
            "record['dictionary'] = spec",
            "local_models[key] = record",
        ]:
            node = ast.parse(statement).body[0]
            self.assertEqual(assignments[ast.dump(node.targets[0])], ast.dump(node.value))
        self.assertEqual(set(lock["dictionaries"]), {"v5_server_rec", "v5_latin_rec"})
        for record in lock["models"].values():
            self.assertIn("sha256", record)
        for record in lock["dictionaries"].values():
            for key in ["derived_sha256", "dictionary_entries", "derived_filename"]:
                self.assertIn(key, record)
        for filename in ["server_worker_engine.py", "language_worker_engine.py"]:
            engine = ast.parse((ROOT / filename).read_text())
            accesses = {ast.dump(n) for n in ast.walk(engine) if isinstance(n, ast.Subscript)}
            for expression in [
                "models[key]['path']", "models[key]['sha256']",
                "models[a.rec_key]['dictionary']", "dictionary['derived_path']",
                "dictionary['derived_sha256']",
                "models[a.rec_key]['dictionary']['dictionary_entries']",
            ]:
                self.assertIn(ast.dump(ast.parse(expression, mode="eval").body), accesses)

    def test_sealed_inventory(self):
        inventory = ROOT / "PUBLIC-FILES.json"
        if not inventory.exists():
            self.skipTest("inventory has not been sealed yet")
        records = json.loads(inventory.read_text())["files"]
        expected = {path.relative_to(ROOT).as_posix() for path in public_payload_files(ROOT)} - {"PUBLIC-FILES.json", "SHA256SUMS.txt"}
        self.assertEqual({record["file"] for record in records}, expected)
        for record in records:
            data = (ROOT / record["file"]).read_bytes()
            self.assertEqual(len(data), record["bytes"])
            self.assertEqual(hashlib.sha256(data).hexdigest(), record["sha256"])
        checksum_lines = (ROOT / "SHA256SUMS.txt").read_text().splitlines()
        for line in checksum_lines:
            digest, name = line.split("  ", 1)
            self.assertEqual(hashlib.sha256((ROOT / name).read_bytes()).hexdigest(), digest)


if __name__ == "__main__":
    unittest.main()
