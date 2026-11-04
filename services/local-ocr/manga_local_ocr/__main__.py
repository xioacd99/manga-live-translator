"""启动服务；首次启动只创建本地令牌，不下载模型。"""
import argparse
import os
from pathlib import Path
import re
import secrets
import stat
import sys

from .config import DEFAULT_PORT
from .models import ModelStore
from .paths import default_cache_dir, default_token_file
from .server import BoundedServer, Gateway


def read_or_create_token(path):
    path = Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        pass
    else:
        with os.fdopen(descriptor, "w", encoding="ascii") as stream:
            stream.write(secrets.token_urlsafe(32) + "\n")
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > 1024:
        raise ValueError("invalid_token_file")
    if os.name != "nt" and stat.S_IMODE(metadata.st_mode) & 0o077:
        raise ValueError("token_file_permissions_require_0600")
    token = path.read_text(encoding="ascii").strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]{32,128}", token):
        raise ValueError("invalid_token_file")
    return token


def main(argv=None):
    parser = argparse.ArgumentParser(description="仅监听 127.0.0.1 的本地 OCR；不自动下载模型。")
    parser.add_argument("--extension-id", action="append", required=True, help="允许的 Chrome 扩展 ID；可重复指定")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--cache-dir", type=Path, default=default_cache_dir())
    parser.add_argument("--token-file", type=Path, default=default_token_file())
    args = parser.parse_args(argv)
    if not 1024 <= args.port <= 65535:
        parser.error("端口必须在 1024..65535")
    if any(not re.fullmatch(r"[a-p]{32}", value) for value in args.extension_id):
        parser.error("扩展 ID 必须为 32 个 a-p 字符")
    server = None
    models = None
    try:
        token = read_or_create_token(args.token_file)
        models = ModelStore(args.cache_dir)
        server = BoundedServer(args.port, Gateway(models), token, ["chrome-extension://" + value for value in args.extension_id])
        print(f"本地 OCR 已启动：http://127.0.0.1:{args.port}", flush=True)
        print(f"令牌文件：{args.token_file}（请仅粘贴到扩展设置，不公开分享）", flush=True)
        print("模型须在扩展设置中主动下载；按 Ctrl+C 停止。", flush=True)
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        return 0
    except (OSError, ValueError):
        print("启动失败：请检查端口、扩展 ID、目录权限及令牌文件权限；不输出敏感异常详情。", file=sys.stderr)
        return 1
    finally:
        if models is not None:
            models.cancel()
        if server is not None:
            server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
