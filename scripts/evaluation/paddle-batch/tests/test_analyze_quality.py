"""仅合成ASCII文本与方框，验证汇总定义，不包含漫画或真实GT。"""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("batch_analysis", ROOT/"analyze_quality.py")
analysis = importlib.util.module_from_spec(spec)
spec.loader.exec_module(analysis)


def fixture():
    bbox = {"x": 1, "y": 1, "width": 20, "height": 10}
    gt = {"language": "en", "images": []}
    for i in range(10):
        gt["images"].append({"id": f"SYN{i}", "sha256": f"{i:064x}", "width": 100, "height": 100,
            "fullyAnnotated": True, "regions": [{"id": "r", "type": "dialogue", "certainty": "certain", "bbox": bbox, "text": "HELLO"}]})
    runs = {}
    for group in "ABCD":
        rounds = []
        for number, duration in enumerate([99, 10, 30]):
            items = [{"round": number, "index": i, "image": {"id": g["id"], "sha256": g["sha256"],
                "regions": [{"bbox": bbox, "text": "HELXO" if group == "A" else "HELLO", "confidence": .9}], "error": None}} for i, g in enumerate(gt["images"])]
            rounds.append({"round": number, "makespan_seconds": duration, "images_per_second": 10/duration,
                "first_result_received_seconds": [9, 2, 4][number], "first_image_completion_seconds": [8, 1, 3][number],
                "sampled_tree_peak_rss_bytes": [100, 200, 150][number], "independent_worker_peak_sum": 9000, "items": items})
        runs[group] = {"group": group, "workers": 2 if group == "D" else 1, "ort_intra": 2 if group == "C" else 1,
            "ort_inter": 1, "rec_batch": 1 if group == "A" else 6, "initialization_ready_wall_seconds": .5, "rounds": rounds}
    return gt, runs


class AnalysisTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.gt, self.runs = fixture()
        (self.root/"gt.json").write_text(json.dumps(self.gt))
        for group, run in self.runs.items():
            folder = self.root/"results"/group
            folder.mkdir(parents=True)
            (folder/"results.json").write_text(json.dumps(run))

    def analyze(self):
        return analysis.analyze(self.root/"gt.json", self.root/"results", self.root/"output", ROOT.parent/"score.py")

    def test_warm_throughput_ttfr_and_simultaneous_rss(self):
        row = self.analyze()[0]
        self.assertEqual(row["warm_aggregate_images_per_second"], 20/(10+30))
        self.assertNotEqual(row["warm_aggregate_images_per_second"], row["mean_round_images_per_second"])
        self.assertEqual(row["warm_mean_first_result_seconds"], 3)
        self.assertEqual(row["peak_sampled_tree_rss_bytes"], 200)
        self.assertEqual(row["first_batch_seconds"], 99)

    def test_quality_boundary_keeps_a_separate_from_bcd(self):
        rows = self.analyze()
        self.assertEqual(rows[0]["CER_by_round"], [.2, .2, .2])
        for row in rows[1:]:
            self.assertEqual(row["CER_by_round"], [0, 0, 0])
        self.assertEqual(rows[0]["N_per_round"], 50)
        self.assertEqual(rows[0]["S_by_round"], [10, 10, 10])
        self.assertEqual(len(list((self.root/"output").glob("*.metrics.json"))), 12)

    def test_missing_round_rejected_before_summary(self):
        run = self.runs["D"]
        run["rounds"].pop()
        (self.root/"results/D/results.json").write_text(json.dumps(run))
        with self.assertRaises(ValueError):
            self.analyze()
        self.assertFalse((self.root/"output/summary.json").exists())

    def test_duplicate_index_and_wrong_hash_rejected(self):
        for mutation in ["index", "hash", "round"]:
            run = copy.deepcopy(self.runs["A"])
            item = run["rounds"][1]["items"][0]
            if mutation == "index": item["index"] = 1
            if mutation == "hash": item["image"]["sha256"] = "wrong"
            if mutation == "round": item["round"] = 2
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                analysis.validate_run(run, self.gt, "A")

    def test_missing_synchronous_rss_rejected(self):
        run = copy.deepcopy(self.runs["A"])
        del run["rounds"][0]["sampled_tree_peak_rss_bytes"]
        with self.assertRaises(ValueError):
            analysis.validate_run(run, self.gt, "A")


if __name__ == "__main__":
    unittest.main()
