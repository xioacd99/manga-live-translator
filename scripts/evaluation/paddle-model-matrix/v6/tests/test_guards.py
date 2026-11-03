"""合成资源阈值与缺页测试；不加载OCR模型、不包含漫画或GT。"""
import importlib.util
import json
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import run_matrix


class OneSample:
    def __init__(self):
        self.stopped = False

    def is_set(self):
        return self.stopped

    def wait(self, timeout):
        self.stopped = True


class GuardsTests(unittest.TestCase):
    def test_memory_thresholds_and_simultaneous_sum(self):
        gib = 1024 ** 3
        cases = [
            (2 * gib, {1: 2 * gib, 2: 2 * gib}, False),
            (1 * gib, {1: gib, 2: gib}, True),
            (2 * gib, {1: 3 * gib, 2: 3 * gib}, True),
            (1.5 * gib, {1: 2 * gib, 2: 3 * gib}, False),
        ]
        for memory, process_rss, expected_stop in cases:
            with self.subTest(memory=memory, rss=process_rss):
                danger = threading.Event()
                samples = []
                with patch.object(run_matrix, "available", return_value=memory), patch.object(run_matrix, "rss", side_effect=process_rss.get):
                    run_matrix.watch([1, 2], OneSample(), danger, samples)
                self.assertEqual(danger.is_set(), expected_stop)
                self.assertEqual(samples[0]["sum_rss_bytes"], sum(process_rss.values()))
                self.assertEqual(len(samples), 1)

    def test_partial_result_preserves_full_manifest_and_error(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            sources = [{"id": f"SYN{i}", "sha256": f"{i:064x}", "width": 10, "height": 10} for i in range(10)]
            (root / "sources.json").write_text(json.dumps(sources))
            group = root / "results" / "synthetic"
            group.mkdir(parents=True)
            image = dict(sources[0], regions=[], detectorRegions=[], error=None, timing={"single_pass_seconds": 1.0})
            raw = {"scheme": "synthetic", "status": "partial", "images": [image], "configuration": {}, "reason": "synthetic 180-second timeout"}
            (group / "predictions.json").write_text(json.dumps(raw))
            subprocess.run([sys.executable, str(ROOT / "finalize_results.py"), "--manifest", str(root / "sources.json"), "--results", str(root / "results")], check=True, capture_output=True)
            full = json.loads((group / "predictions-full-manifest.json").read_text())
            self.assertEqual(len(full["images"]), 10)
            self.assertEqual([image["id"] for image in full["images"]], [source["id"] for source in sources])
            self.assertIsNone(full["images"][0]["error"])
            for image, source in zip(full["images"][1:], sources[1:]):
                self.assertEqual(image["sha256"], source["sha256"])
                self.assertEqual(image["regions"], [])
                self.assertIn("timeout", image["error"])
            self.assertEqual(json.loads((group / "predictions.json").read_text()), raw)


if __name__ == "__main__":
    unittest.main()
