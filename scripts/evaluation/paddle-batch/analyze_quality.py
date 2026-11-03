"""逐轮复用几何评分，输出可迁移的批量吞吐与质量汇总，不挑最佳轮。"""
import argparse
import hashlib
import importlib.util
import json
import math
import statistics
from pathlib import Path


def load_scorer(path):
    spec = importlib.util.spec_from_file_location("batch_quality_scorer", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def validate_run(run, gt, group):
    """缺轮、重复索引、身份错配或不可用计时必须拒绝，而非默默汇总。"""
    if run.get("group") != group or len(run.get("rounds", [])) != 3:
        raise ValueError("分组不符或缺少完整三轮")
    expected = gt["images"]
    for number, rnd in enumerate(run["rounds"]):
        items = rnd.get("items", [])
        if rnd.get("round") != number or sorted(item.get("index", -1) for item in items) != list(range(len(expected))):
            raise ValueError("轮次不符或图片索引缺失/重复")
        for item in items:
            image = item["image"]
            source = expected[item["index"]]
            if item.get("round") != number or image.get("id") != source["id"] or image.get("sha256") != source["sha256"]:
                raise ValueError("图片身份或输入SHA不符")
        for key in ("makespan_seconds", "first_result_received_seconds", "sampled_tree_peak_rss_bytes", "images_per_second"):
            value = rnd.get(key)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
                raise ValueError("轮次计时/同步RSS字段缺失或无效: " + key)


def analyze(ground_truth, results, output, scorer):
    """输入私有GT和原始results；仅写编辑统计，不复制参考或预测全文。"""
    ground_truth = json.loads(Path(ground_truth).read_text())
    results_directory = Path(results)
    output_directory = Path(output)
    scoring_module = load_scorer(scorer)

    # 在输出前检查四组都齐全，避免缺轮仍留下看似完整的summary。
    runs = {}
    for group in "ABCD":
        run_path = results_directory / group / "results.json"
        run = json.loads(run_path.read_text())
        validate_run(run, ground_truth, group)
        runs[group] = run

    output_directory.mkdir(parents=True, exist_ok=True)
    summary = []
    for group, run in runs.items():
        scores = []
        for round_number, round_result in enumerate(run["rounds"]):
            ordered_items = sorted(
                round_result["items"], key=lambda item: item["index"]
            )
            prediction = {
                "scheme": f"cpu_batch_{group}_round{round_number}",
                "images": [item["image"] for item in ordered_items],
            }
            score = scoring_module.score(
                ground_truth,
                prediction,
                include_wer=True,
                text_order="line-column-overlap-v2",
            )
            scores.append(score)
            metrics_path = (
                output_directory / f"{group}-round-{round_number}.metrics.json"
            )
            metrics_path.write_text(
                json.dumps(score, ensure_ascii=False, indent=2)
            )

        def values_by_round(key):
            return [score[key] for score in scores]

        warm_rounds = run["rounds"][1:]
        warm_durations = [rnd["makespan_seconds"] for rnd in warm_rounds]
        empty_regions = [
            sum(
                region["predictionCount"] == 0
                for image in score["images"]
                for region in image["regions"]
            )
            for score in scores
        ]
        configuration_keys = (
            "group",
            "workers",
            "ort_intra",
            "ort_inter",
            "rec_batch",
            "initialization_ready_wall_seconds",
        )
        row = {key: run[key] for key in configuration_keys}
        row.update({
            "CER_by_round": values_by_round("microCER"),
            "WER_by_round": values_by_round("microWER"),
            "CER_no_punctuation_by_round": values_by_round(
                "microCER_no_punctuation"
            ),
            "S_by_round": values_by_round("S"),
            "D_by_round": values_by_round("D"),
            "I_by_round": values_by_round("I"),
            "N_per_round": scores[0]["N"],
            "exact_regions_by_round": values_by_round("exactRegions"),
            "empty_regions_by_round": empty_regions,
            "first_batch_seconds": run["rounds"][0]["makespan_seconds"],
            "warm_batch_seconds": warm_durations,
            "warm_mean_batch_seconds": statistics.mean(warm_durations),
            "warm_mean_first_result_seconds": statistics.mean(
                rnd["first_result_received_seconds"] for rnd in warm_rounds
            ),
            "warm_aggregate_images_per_second": (
                2 * len(ground_truth["images"]) / sum(warm_durations)
            ),
            "mean_round_images_per_second": statistics.mean(
                rnd["images_per_second"] for rnd in warm_rounds
            ),
            "peak_sampled_tree_rss_bytes": max(
                rnd["sampled_tree_peak_rss_bytes"] for rnd in run["rounds"]
            ),
            "rounds": [
                {key: value for key, value in rnd.items() if key != "items"}
                for rnd in run["rounds"]
            ],
        })
        summary.append(row)

    (output_directory / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2)
    )
    provenance = {
        "scorer_sha256": hashlib.sha256(Path(scorer).read_bytes()).hexdigest(),
        "text_order": "line-column-overlap-v2",
        "rounds": 3,
        "warm_rounds": [1, 2],
        "images_per_round": len(ground_truth["images"]),
        "throughput": "2 * image_count / sum(warm makespans)",
        "rss": (
            "Use sampled_tree_peak_rss_bytes: simultaneous coordinator+known-workers RSS, "
            "not sum of independent process peaks."
        ),
    }
    (output_directory / "analysis-provenance.json").write_text(
        json.dumps(provenance, indent=2)
    )
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ground-truth", type=Path, required=True)
    parser.add_argument("--results", type=Path, required=True, help="包含A/B/C/D子目录的私有results目录")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--scorer", type=Path, default=Path(__file__).resolve().parents[1]/"score.py")
    args = parser.parse_args()
    analyze(args.ground_truth, args.results, args.output, args.scorer)


if __name__ == "__main__":
    main()
