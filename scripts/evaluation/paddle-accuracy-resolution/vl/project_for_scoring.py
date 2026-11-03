"""仅做显式输出结构投影，删除没有独立检测阶段时的空 detectorRegions。
不修改任何识别文字、坐标、失败状态或时延，也不执行评分。
运行后生成的文件可能含使用者图片中的文字，不属于公开复现包内容。
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    cli = argparse.ArgumentParser(description='将原始输出投影为供既有评分器读取的最终 Spotting 区域')
    cli.add_argument('--input', type=Path, required=True, help='复现运行生成的 predictions.json')
    cli.add_argument('--output', type=Path, required=True, help='新的本地投影 JSON 文件')
    args = cli.parse_args()
    if args.output.exists():
        raise ValueError('输出已存在，拒绝覆盖')
    original = json.loads(args.input.read_text())
    projected = copy.deepcopy(original)
    for record in projected['images']:
        if record.get('detectorRegions') != []:
            raise ValueError('检测字段不是预期空列表，请人工检查')
        del record['detectorRegions']
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(projected, indent=2, ensure_ascii=False))
    manifest = {'input_sha256': sha256(args.input), 'output_sha256': sha256(args.output),
                'image_count': len(original['images']),
                'only_change': '仅删除每图空 detectorRegions，其余值完全保留。',
                'interpretation': '定位指标描述最终 Spotting 区域，不是独立 DB 原始检测召回。'}
    args.output.with_suffix('.projection-manifest.json').write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False))
    print(json.dumps(manifest, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
