"""在调用者本地准备固定公开资源，不执行下载代码，不加载模型。

仅 --download 发起网络请求。遇到 HTTP 错误立即停止，不换源、不绕过认证，
不提供关闭 TLS 校验的模式。
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile
import urllib.parse
import urllib.request


LOCK_SHA256 = "e87b9a71c9d5de02f3e2405c5cbcddc24bd0fef8365adf112bee1b5c0ad2301f"
MODEL_KEYS = (
    "v5_server_det", "v5_server_rec", "v6_small_det", "v6_medium_rec",
    "v5_latin_rec", "v5_en_rec", "legacy_cls",
)
TRUSTED_SOURCE_HOSTS = {"huggingface.co", "www.modelscope.cn"}


def read_lock():
    data = Path(__file__).with_name("asset-lock.json").read_bytes()
    if hashlib.sha256(data).hexdigest() != LOCK_SHA256:
        raise ValueError("asset-lock.json differs from the reviewed fixed lock")
    lock = json.loads(data)
    if set(lock["models"]) != set(MODEL_KEYS):
        raise ValueError("unexpected model set")
    return lock


def file_digest(path):
    digest = hashlib.sha256()
    total = 0
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            total += len(block)
            digest.update(block)
    return total, digest.hexdigest()


def verify_file(path, size, sha256):
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"not a regular, non-symlink file: {path.name}")
    if file_digest(path) != (size, sha256):
        raise ValueError(f"size/SHA-256 mismatch: {path.name}")


class HTTPSOnlyRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        if urllib.parse.urlsplit(newurl).scheme != "https":
            raise ValueError("non-HTTPS redirect refused")
        return super().redirect_request(request, fp, code, message, headers, newurl)


def fixed_download(url, destination, size, sha256):
    parsed = urllib.parse.urlsplit(url)
    if (parsed.scheme != "https" or parsed.hostname not in TRUSTED_SOURCE_HOSTS
            or parsed.username is not None or parsed.password is not None):
        raise ValueError("untrusted source URL")
    if destination.exists() or destination.is_symlink():
        verify_file(destination, size, sha256)
        return
    opener = urllib.request.build_opener(HTTPSOnlyRedirect())
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=destination.parent, prefix=".asset-", delete=False) as stream:
            temporary = Path(stream.name)
            digest = hashlib.sha256()
            total = 0
            # 重定向可到供应商的 HTTPS 资源 CDN。使用前仍须同时验证
            # 固定文件长度和 SHA-256，不能因下载成功而省略校验。
            with opener.open(url, timeout=60) as response:
                while True:
                    block = response.read(1024 * 1024)
                    if not block:
                        break
                    total += len(block)
                    if total > size:
                        raise ValueError("asset exceeded pinned byte count")
                    digest.update(block)
                    stream.write(block)
            if total != size or digest.hexdigest() != sha256:
                raise ValueError("download size/SHA-256 mismatch")
        if destination.exists() or destination.is_symlink():
            raise FileExistsError("destination appeared during download")
        # 以硬链接原子地创建目标文件，不覆盖已有文件。
        os.link(temporary, destination)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def ordered_dictionary_bytes(yaml_data, spec):
    # 使用安全 YAML 解析器，不下载或导入远端 Python 模块。
    import yaml
    document = yaml.safe_load(yaml_data)
    characters = document["PostProcess"]["character_dict"]
    if not isinstance(characters, list) or len(characters) != spec["dictionary_entries"]:
        raise ValueError("unexpected dictionary list/count")
    if any(not isinstance(item, str) or "\n" in item or "\r" in item for item in characters):
        raise ValueError("dictionary contains a non-string or line separator")
    if sum(item == "" for item in characters) != spec["empty_entries"]:
        raise ValueError("dictionary empty-entry count changed")
    if (" " in characters) != spec["contains_ascii_space"]:
        raise ValueError("dictionary space policy changed")
    # 不过滤、排序、去重、strip、归一化，也不在此处加入 blank/space。
    data = ("\n".join(characters) + "\n").encode("utf-8")
    if len(data) != spec["derived_bytes"] or hashlib.sha256(data).hexdigest() != spec["derived_sha256"]:
        raise ValueError("derived dictionary size/SHA-256 mismatch")
    return data


def write_new_or_verify(path, data):
    if path.exists() or path.is_symlink():
        verify_file(path, len(data), hashlib.sha256(data).hexdigest())
        return
    with path.open("xb") as stream:
        stream.write(data)


def prepare(output, lock):
    output.mkdir(parents=True, exist_ok=True)
    output = output.resolve()
    local_models = {}
    for key in MODEL_KEYS:
        record = dict(lock["models"][key])
        destination = output / record["filename"]
        fixed_download(record["url"], destination, record["bytes"], record["sha256"])
        record["path"] = str(destination)
        if key in lock["dictionaries"]:
            spec = dict(lock["dictionaries"][key])
            yaml_path = output / spec["source_filename"]
            fixed_download(spec["source_url"], yaml_path, spec["source_bytes"], spec["source_sha256"])
            # 解析本地缓存文件前，再次核对同一源文件的长度和哈希。
            verify_file(yaml_path, spec["source_bytes"], spec["source_sha256"])
            data = ordered_dictionary_bytes(yaml_path.read_bytes(), spec)
            dictionary_path = output / spec["derived_filename"]
            write_new_or_verify(dictionary_path, data)
            spec["derived_path"] = str(dictionary_path)
            record["dictionary"] = spec
        local_models[key] = record
    manifest = (json.dumps(local_models, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    write_new_or_verify(output / "models.local.json", manifest)
    return output / "models.local.json"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--plan", action="store_true", help="print URLs/hashes; no downloads")
    modes.add_argument("--download", action="store_true", help="download verified assets to caller-local output")
    parser.add_argument("--output", type=Path, help="caller-local asset directory; required with --download")
    args = parser.parse_args()
    lock = read_lock()
    if args.plan:
        print(json.dumps(lock, ensure_ascii=False, indent=2))
        return
    if args.output is None:
        parser.error("--download requires --output")
    print(prepare(args.output, lock))


if __name__ == "__main__":
    main()
