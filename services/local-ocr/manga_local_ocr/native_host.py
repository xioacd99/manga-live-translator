"""浏览器拥有的 Native Messaging 进程；管道关闭即销毁本进程的 HTTP 服务。"""
import argparse
import json
import os
from pathlib import Path
import queue
import re
import secrets
import stat
import struct
import sys
import threading

HOST_NAME = "com.manga_live_translator.local_ocr"
MAX_MESSAGE_BYTES = 1024
MAX_CONFIG_BYTES = 4096
ORIGIN_PATTERN = re.compile(r"chrome-extension://[a-p]{32}/")


class ProtocolError(ValueError):
    pass


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ProtocolError("duplicate_key")
        result[key] = value
    return result


def strict_json(raw):
    def reject_constant(_):
        raise ProtocolError("invalid_json")
    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object,
                          parse_constant=reject_constant)
    except (ValueError, UnicodeError, RecursionError):
        raise ProtocolError("invalid_json") from None


def read_exact(stream, size, allow_eof=False):
    chunks = bytearray()
    while len(chunks) < size:
        part = stream.read(size - len(chunks))
        if not part:
            if allow_eof and not chunks:
                return None
            raise ProtocolError("truncated_message")
        chunks.extend(part)
    return bytes(chunks)


def read_message(stream):
    header = read_exact(stream, 4, allow_eof=True)
    if header is None:
        return None
    size, = struct.unpack("=I", header)
    if not 1 <= size <= MAX_MESSAGE_BYTES:
        raise ProtocolError("message_too_large")
    value = strict_json(read_exact(stream, size))
    if (not isinstance(value, dict) or set(value) != {"type"}
            or not isinstance(value["type"], str) or value["type"] not in ("start", "stop")):
        raise ProtocolError("invalid_message")
    return value


def write_message(stream, value):
    raw = json.dumps(value, separators=(",", ":"), allow_nan=False).encode("utf-8")
    if len(raw) > MAX_MESSAGE_BYTES:
        raise ProtocolError("message_too_large")
    stream.write(struct.pack("=I", len(raw)) + raw)
    stream.flush()


def load_configuration(path, origin):
    metadata = path.lstat()
    if (not stat.S_ISREG(metadata.st_mode) or metadata.st_size > MAX_CONFIG_BYTES
            or (os.name != "nt" and stat.S_IMODE(metadata.st_mode) & 0o077)):
        raise ProtocolError("invalid_configuration")
    with path.open("rb") as stream:
        value = strict_json(stream.read(MAX_CONFIG_BYTES + 1))
    if (not isinstance(value, dict) or set(value) != {"version", "allowed_origins", "cache_dir"}
            or type(value["version"]) is not int or value["version"] != 1):
        raise ProtocolError("invalid_configuration")
    origins = value["allowed_origins"]
    if (not isinstance(origins, list) or not 1 <= len(origins) <= 16
            or any(not isinstance(item, str) or not ORIGIN_PATTERN.fullmatch(item) for item in origins)
            or len(set(origins)) != len(origins) or origin not in origins):
        raise ProtocolError("origin_rejected")
    if not isinstance(value["cache_dir"], str) or not Path(value["cache_dir"]).is_absolute():
        raise ProtocolError("invalid_configuration")
    return Path(value["cache_dir"])


def create_server(cache_dir, origin, token):
    # 延迟导入，避免库在协议输出隔离之前写入 stdout；也不触发模型下载。
    from .models import ModelStore
    from .server import BoundedServer, Gateway
    models = ModelStore(cache_dir)
    return BoundedServer(0, Gateway(models), token, [origin[:-1]])


def isolate_protocol_output():
    # 保留唯一协议 fd；同时隔离 Python 日志及原生库直接写入的 fd 1/2。
    # 不向浏览器日志泄露漫画、路径、令牌或第三方库 traceback。
    if os.name == "nt":
        import msvcrt
        msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
        msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
    protocol_fd = os.dup(sys.stdout.fileno())
    with open(os.devnull, "wb") as sink:
        os.dup2(sink.fileno(), sys.stdout.fileno())
        os.dup2(sink.fileno(), sys.stderr.fileno())
    return os.fdopen(protocol_fd, "wb", buffering=0)


class BrowserSession:
    def __init__(self, cache_dir, origin, output):
        self.cache_dir, self.origin, self.output = cache_dir, origin, output
        self.server = None
        self.token = secrets.token_urlsafe(32)
        self.commands = queue.Queue(maxsize=8)

    def terminate(self, code):
        def cleanup():
            server = self.server
            if server is not None:
                try:
                    server.gateway.cancel()
                    server.shutdown()
                finally:
                    server.server_close()
        # ORT 内核、下载 socket 或库的非 daemon 线程不能延长浏览器退出。
        # 只触及本进程的对象；不扫描 PID、不杀固定端口、不删除他人临时文件。
        try:
            worker = threading.Thread(target=cleanup, name="native-cleanup", daemon=True)
            worker.start()
            worker.join(0.25)
        finally:
            os._exit(code)

    def read_commands(self):
        try:
            while True:
                message = read_message(sys.stdin.buffer)
                if message is None or message["type"] == "stop":
                    self.terminate(0)
                self.commands.put_nowait(message)
        except (OSError, ValueError, queue.Full):
            self.terminate(1)

    def run(self):
        # 独立读管道：即使初始化/写响应阻塞，EOF 仍能终止整个进程。
        reader = threading.Thread(target=self.read_commands, name="native-input", daemon=True)
        reader.start()
        try:
            while True:
                self.commands.get()
                if self.server is None:
                    self.server = create_server(self.cache_dir, self.origin, self.token)
                    worker = threading.Thread(target=self.server.serve_forever,
                                              kwargs={"poll_interval": 0.05}, daemon=True)
                    worker.start()
                write_message(self.output, {"type": "ready",
                    "endpoint": f"http://127.0.0.1:{self.server.server_port}", "token": self.token})
        except (Exception, KeyboardInterrupt):
            self.terminate(1)


def main(argv=None):
    output = isolate_protocol_output()
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("origin")
    try:
        args = parser.parse_args(argv)
        cache_dir = load_configuration(args.config, args.origin)
    except (OSError, ValueError, SystemExit):
        os._exit(1)
    BrowserSession(cache_dir, args.origin, output).run()


if __name__ == "__main__":
    main()
