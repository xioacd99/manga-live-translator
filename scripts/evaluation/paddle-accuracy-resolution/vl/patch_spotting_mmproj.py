"""在保留官方原文件的前提下，生成 Spotting 所需的 mmproj 元数据副本。
仅适用于已固定 SHA256 的官方文件，不下载文件，不改变模型张量。
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import struct

ORIGINAL_SHA256 = '204d757d7610d9b3faab10d506d69e5b244e32bf765e2bab2d0167e65e0a058a'
PATCHED_SHA256 = '8e011479092c5e82c8c1c2d85d52b9ac48df12183c5c7bc3190190732259db09'
OFFSET = 1546


def sha256(path):
    """分块校验完整文件，不将模型读入 Python 内存。"""
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main():
    cli = argparse.ArgumentParser(description='核验官方 mmproj，并生成只改 max_pixels 的副本')
    cli.add_argument('--models', type=Path, required=True, help='原始权重所在目录')
    args = cli.parse_args()
    source = args.models / 'PaddleOCR-VL-1.6-GGUF-mmproj.gguf'
    target = args.models / 'PaddleOCR-VL-1.6-GGUF-mmproj-spotting.gguf'
    if sha256(source) != ORIGINAL_SHA256:
        raise ValueError('原文件与固定官方 SHA256 不符，拒绝修改')
    if target.exists():
        if sha256(target) != PATCHED_SHA256:
            raise ValueError('目标文件存在且哈希不符，拒绝覆盖')
    else:
        with source.open('rb') as stream:
            stream.seek(1502)
            if b'clip.vision.image_max_pixels' not in stream.read(44):
                raise ValueError('固定元数据键不符')
            stream.seek(OFFSET)
            if struct.unpack('<I', stream.read(4))[0] != 1003520:
                raise ValueError('固定元数据旧值不符')
        shutil.copyfile(source, target)
        with target.open('r+b') as stream:
            stream.seek(OFFSET)
            stream.write(struct.pack('<I', 1605632))
        if sha256(target) != PATCHED_SHA256:
            raise ValueError('修正副本哈希不符，请勿用于推理')
    print(json.dumps({'original_sha256': ORIGINAL_SHA256,
                      'patched_sha256': PATCHED_SHA256,
                      'metadata_key': 'clip.vision.image_max_pixels',
                      'old_value': 1003520, 'new_value': 1605632,
                      'byte_offset': OFFSET,
                      'original_preserved': True}, indent=2))


if __name__ == '__main__':
    main()
