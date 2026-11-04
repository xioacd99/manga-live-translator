"""用户主动运行的 Native Messaging 注册工具；默认仅处理当前用户目录。"""
import argparse
import json
import os
from pathlib import Path
import re
import shlex
import stat
import sys

from .native_host import HOST_NAME
from .paths import default_cache_dir, default_data_dir

BROWSERS = ("chrome", "chromium", "chrome-for-testing")


def default_manifest_dir(browser, platform=None, home=None, environ=None):
    platform = sys.platform if platform is None else platform
    home = Path.home() if home is None else Path(home)
    environ = os.environ if environ is None else environ
    if platform == "darwin":
        suffix = {"chrome": "Google/Chrome", "chromium": "Chromium",
                  "chrome-for-testing": "Google/ChromeForTesting"}[browser]
        return home / "Library" / "Application Support" / suffix / "NativeMessagingHosts"
    if platform.startswith("linux"):
        suffix = {"chrome": "google-chrome", "chromium": "chromium",
                  "chrome-for-testing": "google-chrome-for-testing"}[browser]
        return Path(environ.get("XDG_CONFIG_HOME", home / ".config")) / suffix / "NativeMessagingHosts"
    raise ValueError("当前安装器只支持 macOS/Linux；Windows 注册及可执行启动器尚未验证")


def absolute_path(value):
    result = Path(value).expanduser().absolute()
    if any(ord(char) < 32 for char in str(result)):
        raise ValueError("目录不能包含控制字符")
    return result


def build_plan(extension_ids, browser, data_dir, manifest_dir, cache_dir, python_executable=None):
    if (not extension_ids or len(extension_ids) > 16
            or any(not re.fullmatch(r"[a-p]{32}", item) for item in extension_ids)
            or len(set(extension_ids)) != len(extension_ids)):
        raise ValueError("扩展 ID 必须为不重复的 32 个 a-p 字符；不支持通配来源")
    data_dir, manifest_dir, cache_dir = map(absolute_path, (data_dir, manifest_dir, cache_dir))
    # 不 resolve 虚拟环境 Python 的符号链接，否则会绕开安装了本包的环境。
    python = absolute_path(sys.executable if python_executable is None else python_executable)
    if not python.is_file() or not os.access(python, os.X_OK):
        raise ValueError("当前 Python 不是可执行文件")
    configuration = data_dir / "config.json"
    wrapper = data_dir / "manga-local-ocr-host"
    manifest = manifest_dir / (HOST_NAME + ".json")
    origins = ["chrome-extension://" + item + "/" for item in extension_ids]
    config_content = {"version": 1, "allowed_origins": origins, "cache_dir": str(cache_dir)}
    manifest_content = {"name": HOST_NAME, "description": "Manga Live Translator local OCR",
                        "path": str(wrapper), "type": "stdio", "allowed_origins": origins}
    command = " ".join(shlex.quote(part) for part in
                       (str(python), "-I", "-m", "manga_local_ocr.native_host", "--config", str(configuration)))
    files = [
        {"path": str(configuration), "mode": 0o600, "content": json.dumps(config_content, indent=2) + "\n"},
        {"path": str(wrapper), "mode": 0o700, "content": '#!/bin/sh\nexec ' + command + ' "$@"\n'},
        {"path": str(manifest), "mode": 0o600, "content": json.dumps(manifest_content, indent=2) + "\n"},
    ]
    return {"host": HOST_NAME, "browser": browser, "files": files}


def apply_plan(plan):
    # 先检查全部目标，避免无提示覆盖另一个扩展/解释器/缓存配置的现有注册。
    existing = set()
    for item in plan["files"]:
        path = Path(item["path"])
        try:
            metadata = path.lstat()
        except FileNotFoundError:
            continue
        if (not stat.S_ISREG(metadata.st_mode) or metadata.st_size > 16384
                or path.read_text(encoding="utf-8") != item["content"]
                or stat.S_IMODE(metadata.st_mode) != item["mode"]):
            raise ValueError("目标已有不同文件或权限；请先检查并手动移除旧注册，不会自动覆盖：" + str(path))
        existing.add(path)
    for item in plan["files"]:
        path = Path(item["path"])
        if path in existing:
            continue
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, item["mode"])
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(item["content"])
        path.chmod(item["mode"])


def main(argv=None):
    parser = argparse.ArgumentParser(description="用户主动注册浏览器本地 OCR 伴随程序，不注册系统自启动。")
    parser.add_argument("--extension-id", action="append", required=True)
    parser.add_argument("--browser", choices=BROWSERS, default="chrome")
    parser.add_argument("--manifest-dir", type=Path, help="自定义浏览器用户数据目录下的 NativeMessagingHosts 目录")
    parser.add_argument("--data-dir", type=Path, help="存放此浏览器专用配置和启动脚本的目录")
    parser.add_argument("--cache-dir", type=Path, default=default_cache_dir())
    parser.add_argument("--dry-run", action="store_true", help="仅显示精确文件计划；不创建目录或注册")
    args = parser.parse_args(argv)
    try:
        default_directory = default_manifest_dir(args.browser)
        plan = build_plan(args.extension_id, args.browser,
                          args.data_dir or default_data_dir() / "native-host" / args.browser,
                          args.manifest_dir or default_directory, args.cache_dir)
        if args.dry_run:
            print(json.dumps(plan, indent=2, ensure_ascii=False))
        else:
            apply_plan(plan)
            print("本机伴随程序已注册；在扩展中启用自动翻译时启动，连接关闭时退出。")
            print("未启动 OCR、未下载模型、未安装系统自启动；请保留此 Python 环境。")
            print("注册文件：" + plan["files"][-1]["path"])
        return 0
    except (OSError, ValueError) as error:
        print("安装失败：" + str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
