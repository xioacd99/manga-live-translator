"""固定来源、校验后原子写入的显式模型下载器。"""
import copy
import hashlib
import os
from pathlib import Path
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from .config import MODELS
from .errors import GatewayError

# 只允许上游发布站点及其已知大文件 CDN；从不接收调用者 URL。
DOWNLOAD_HOSTS = frozenset({
    "www.modelscope.cn", "modelscope.cn", "cdn.modelscope.cn",
    "huggingface.co", "cdn-lfs.huggingface.co", "cdn-lfs-us-1.huggingface.co",
    "cdn-lfs.hf.co", "cdn-lfs-us-1.hf.co", "cas-bridge.xethub.hf.co", "us.aws.cdn.hf.co",
})

def allowed_download_url(url):
    parsed = urllib.parse.urlsplit(url)
    return (parsed.scheme == "https" and parsed.hostname in DOWNLOAD_HOSTS
            and parsed.port in (None, 443) and not parsed.username and not parsed.password and not parsed.fragment)

class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not allowed_download_url(newurl):
            raise GatewayError("model_download_redirect_rejected", 503)
        return super().redirect_request(req, fp, code, msg, headers, newurl)

def file_matches(path, model):
    try:
        if path.is_symlink() or not path.is_file() or path.stat().st_size != model["bytes"]:
            return False
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest() == model["sha256"]
    except OSError:
        return False

class ModelStore:
    def __init__(self, root, models=MODELS, opener=None):
        self.root = Path(root)
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.models = tuple(models)
        self._lock = threading.Lock()
        self._cancel = threading.Event()
        self._thread = None
        self._state = "idle"
        self._error = None
        self._opener = opener or urllib.request.build_opener(SafeRedirect())
        self._rows = {m["id"]: {"id": m["id"], "component": m["component"],
            "bytesTotal": m["bytes"], "bytesDownloaded": 0, "sha256": m["sha256"], "state": "missing"} for m in self.models}
        for model in self.models:
            if file_matches(self.path(model), model):
                self._update(model, state="cached", bytesDownloaded=model["bytes"])

    def path(self, model):
        return self.root / f'{model["id"]}-{model["sha256"]}.onnx'

    def _update(self, model, **fields):
        with self._lock:
            self._rows[model["id"]].update(fields)

    def snapshot(self):
        with self._lock:
            rows = copy.deepcopy(list(self._rows.values()))
            return {"state": self._state, "error": self._error,
                    "bytesDownloaded": sum(m["bytesDownloaded"] for m in rows),
                    "bytesTotal": sum(m["bytesTotal"] for m in rows), "models": rows}

    def ready(self, component):
        with self._lock:
            rows = [m for m in self._rows.values() if m["component"] == component]
            return bool(rows) and all(m["state"] == "cached" for m in rows)

    def verified_paths(self, component):
        paths = {}
        for model in self.models:
            if model["component"] != component:
                continue
            path = self.path(model)
            if not file_matches(path, model):
                self._update(model, state="missing", bytesDownloaded=0)
                raise GatewayError("models_not_ready", 409)
            paths[model["id"]] = path
        return paths

    def start(self, components=("ocr", "detector")):
        if not components or any(c not in ("ocr", "detector") for c in components):
            raise GatewayError("invalid_components", 400)
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return False
            self._cancel = threading.Event()
            self._state, self._error = "downloading", None
            self._thread = threading.Thread(target=self._run, args=(tuple(components),), name="model-download", daemon=True)
            self._thread.start()
        return True

    def cancel(self):
        with self._lock:
            active = self._thread is not None and self._thread.is_alive()
            if active:
                self._cancel.set()
                self._state = "cancelling"
            return active

    def wait(self, timeout=None):
        thread = self._thread
        if thread is not None:
            thread.join(timeout)

    def _run(self, components):
        try:
            for model in self.models:
                if model["component"] not in components:
                    continue
                if self._cancel.is_set():
                    raise GatewayError("download_cancelled", 409)
                if file_matches(self.path(model), model):
                    self._update(model, state="cached", bytesDownloaded=model["bytes"])
                    continue
                self._download_one(model)
            with self._lock:
                self._state = "cancelled" if self._cancel.is_set() else "completed"
        except GatewayError as error:
            with self._lock:
                self._state = "cancelled" if self._cancel.is_set() else "error"
                self._error = None if self._cancel.is_set() else error.code
        except Exception:
            with self._lock:
                self._state = "cancelled" if self._cancel.is_set() else "error"
                self._error = None if self._cancel.is_set() else "model_download_failed"

    def _download_one(self, model):
        if not allowed_download_url(model["url"]):
            raise GatewayError("model_download_source_rejected", 503)
        temporary = None
        downloaded = 0
        self._update(model, state="downloading", bytesDownloaded=0)
        try:
            request = urllib.request.Request(model["url"], headers={"User-Agent": "MangaLocalOCR/0.1", "Accept-Encoding": "identity"})
            deadline = time.monotonic() + 15 * 60
            with self._opener.open(request, timeout=20) as response:
                if response.status != 200 or response.headers.get("Content-Encoding", "identity") != "identity":
                    raise GatewayError("model_download_response_invalid", 503)
                length = response.headers.get("Content-Length")
                if length is not None and (not length.isdigit() or int(length) != model["bytes"]):
                    raise GatewayError("model_download_size_mismatch", 503)
                digest = hashlib.sha256()
                with tempfile.NamedTemporaryFile(mode="wb", prefix=".download-", suffix=".part", dir=self.root, delete=False) as stream:
                    temporary = Path(stream.name)
                    while True:
                        if self._cancel.is_set():
                            raise GatewayError("download_cancelled", 409)
                        if time.monotonic() > deadline:
                            raise GatewayError("model_download_timeout", 503)
                        chunk = response.read(64 * 1024)
                        if not chunk:
                            break
                        downloaded += len(chunk)
                        if downloaded > model["bytes"]:
                            raise GatewayError("model_download_size_mismatch", 503)
                        digest.update(chunk)
                        stream.write(chunk)
                        self._update(model, bytesDownloaded=downloaded)
                    stream.flush()
                    os.fsync(stream.fileno())
                if self._cancel.is_set():
                    raise GatewayError("download_cancelled", 409)
                if downloaded != model["bytes"] or digest.hexdigest() != model["sha256"]:
                    raise GatewayError("model_checksum_mismatch", 503)
                temporary.replace(self.path(model))
                self._update(model, state="cached", bytesDownloaded=model["bytes"])
        except Exception:
            self._update(model, state="missing", bytesDownloaded=0)
            raise
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
