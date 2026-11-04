"""无公开监听、无 URL 代理、带认证与资源上限的 HTTP 协议。"""
import hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import re
import secrets
import socket
from socketserver import ThreadingMixIn
import threading
import time

from .config import (DETECTOR_REVISION, MAX_CLIENTS, MAX_EDGE, MAX_IMAGE_BYTES,
                     MAX_PIXELS, MODEL_REVISION, PROTOCOL_VERSION)
from .engine import NativeEngine
from .errors import GatewayError
from .images import decode_image

ROUTES = {"/health": "GET", "/status": "GET", "/models/download": "POST",
          "/models/cancel": "POST", "/cancel": "POST", "/ocr": "POST", "/detect": "POST"}

class Gateway:
    def __init__(self, models, engine=None, decoder=decode_image):
        self.models = models
        self.engine = engine or NativeEngine(models)
        self.decoder = decoder
        self._inference = threading.Lock()
        self._state_lock = threading.Lock()
        self._generation = 0
        self._active = None

    def status(self):
        with self._state_lock:
            active = self._active
        download = self.models.snapshot()
        ready, detector_ready = self.models.ready("ocr"), self.models.ready("detector")
        return {"protocolVersion": PROTOCOL_VERSION, "service": "manga-local-ocr", "ready": ready,
                "detectorReady": detector_ready, "state": "running" if active else ("ready" if ready else "needs_models"),
                "activeOperation": active, "modelRevision": MODEL_REVISION, "detectorRevision": DETECTOR_REVISION,
                "engine": self.engine.states(), "download": download,
                "limits": {"maxImageBytes": MAX_IMAGE_BYTES, "maxPixels": MAX_PIXELS,
                           "maxEdge": MAX_EDGE, "maxConcurrentInference": 1, "maxQueuedInference": 0}}

    def cancel(self):
        with self._state_lock:
            self._generation += 1
            active = self._active
        download = self.models.cancel()
        return {"cancelled": True, "inferencePending": active is not None, "downloadPending": download,
                "note": "running_inference_finishes_but_result_is_discarded"}

    def infer(self, operation, body, content_type):
        if not self._inference.acquire(blocking=False):
            raise GatewayError("inference_busy", 429)
        try:
            with self._state_lock:
                generation = self._generation
                self._active = operation
            component = "ocr" if operation == "ocr" else "detector"
            if not self.models.ready(component):
                raise GatewayError("models_not_ready", 409)
            started = time.perf_counter()
            if hasattr(self.engine, "prepare"):
                self.engine.prepare()
            image = self.decoder(body, content_type)
            with self._state_lock:
                if generation != self._generation:
                    raise GatewayError("inference_cancelled", 409)
            regions = getattr(self.engine, operation)(image)
            with self._state_lock:
                if generation != self._generation:
                    raise GatewayError("inference_cancelled", 409)
            result = {"regions": regions, "width": int(image.shape[1]), "height": int(image.shape[0]),
                      "sha256": hashlib.sha256(body).hexdigest(), "engineSeconds": time.perf_counter() - started}
            if operation == "ocr":
                result["modelRevision"] = MODEL_REVISION
            else:
                result.update(detectorRevision=DETECTOR_REVISION, experimental=True)
            return result
        finally:
            with self._state_lock:
                self._active = None
            self._inference.release()

class BoundedServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True
    block_on_close = False
    request_queue_size = MAX_CLIENTS
    allow_reuse_address = False

    def __init__(self, port, gateway, token, origins):
        if not re.fullmatch(r"[A-Za-z0-9_-]{32,128}", token):
            raise ValueError("invalid_token")
        if not origins or any(not re.fullmatch(r"chrome-extension://[a-p]{32}", o) for o in origins):
            raise ValueError("invalid_extension_origin")
        self.gateway, self.token, self.origins = gateway, token, frozenset(origins)
        self._clients = threading.BoundedSemaphore(MAX_CLIENTS)
        super().__init__(("127.0.0.1", port), Handler)

    def process_request(self, request, client_address):
        if not self._clients.acquire(blocking=False):
            try:
                request.settimeout(1)
                request.sendall(b'HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 23\r\nContent-Type: application/json\r\nCache-Control: no-store\r\n\r\n{"error":"server_busy"}')
            except OSError:
                pass
            finally:
                self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self._clients.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._clients.release()

    def handle_error(self, request, client_address):
        # BaseServer 默认输出 traceback；其中可能包含依赖路径，故不记录请求。
        pass

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "MangaLocalOCR"
    sys_version = ""

    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def log_message(self, *args):
        pass

    def send_error(self, code, message=None, explain=None):
        self.reply(code, {"error": "invalid_http_request"})

    def single_header(self, name):
        values = self.headers.get_all(name, [])
        if len(values) > 1:
            raise GatewayError("duplicate_header", 400)
        return values[0] if values else None

    def reply(self, status, data=None, extra=None):
        raw = b"" if data is None else json.dumps(data, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()
        self.close_connection = True
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Connection", "close")
        origins = self.headers.get_all("Origin", []) if hasattr(self, "headers") else []
        if len(origins) == 1 and origins[0] in self.server.origins:
            self.send_header("Access-Control-Allow-Origin", origins[0])
            self.send_header("Vary", "Origin")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if raw:
            try:
                self.wfile.write(raw)
            except (BrokenPipeError, ConnectionResetError, TimeoutError):
                pass

    def check(self, authenticate=True):
        if self.client_address[0] != "127.0.0.1" or self.single_header("Host") != f"127.0.0.1:{self.server.server_port}":
            raise GatewayError("host_rejected", 403)
        origin = self.single_header("Origin")
        if origin is not None and origin not in self.server.origins:
            raise GatewayError("origin_rejected", 403)
        if authenticate:
            authorization = self.single_header("Authorization") or ""
            if not secrets.compare_digest(authorization.encode(), ("Bearer " + self.server.token).encode()):
                raise GatewayError("unauthorized", 401)
        if self.path not in ROUTES:
            raise GatewayError("route_not_found", 404)

    def body(self, limit):
        if self.single_header("Transfer-Encoding") is not None:
            raise GatewayError("transfer_encoding_rejected", 400)
        length = self.single_header("Content-Length")
        if length is None or not re.fullmatch(r"[0-9]{1,10}", length):
            raise GatewayError("content_length_required", 411)
        size = int(length)
        if size > limit:
            raise GatewayError("request_too_large", 413)
        deadline, chunks, remaining = time.monotonic() + 30, [], size
        while remaining:
            timeout = min(10, deadline - time.monotonic())
            if timeout <= 0:
                raise GatewayError("request_timeout", 408)
            self.connection.settimeout(timeout)
            chunk = self.rfile.read1(min(65536, remaining))
            if not chunk:
                raise GatewayError("incomplete_body", 400)
            chunks.append(chunk)
            remaining -= len(chunk)
        return b"".join(chunks)

    def json_body(self):
        raw = self.body(1024)
        if not raw:
            return {}
        if self.single_header("Content-Type") != "application/json":
            raise GatewayError("unsupported_media_type", 415)
        try:
            value = json.loads(raw)
        except (ValueError, UnicodeError):
            raise GatewayError("invalid_json", 400) from None
        if not isinstance(value, dict):
            raise GatewayError("invalid_json", 400)
        return value

    def guarded(self, function):
        try:
            function()
        except GatewayError as error:
            self.reply(error.status, {"error": error.code})
        except (socket.timeout, TimeoutError):
            self.reply(408, {"error": "request_timeout"})
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True
        except Exception:
            self.reply(500, {"error": "internal_error"})

    def do_OPTIONS(self):
        self.guarded(self.options)

    def options(self):
        self.check(False)
        if self.single_header("Origin") not in self.server.origins:
            raise GatewayError("origin_required", 403)
        method = self.single_header("Access-Control-Request-Method")
        headers = self.single_header("Access-Control-Request-Headers") or ""
        requested = {h.strip().lower() for h in headers.split(",") if h.strip()}
        if method != ROUTES[self.path] or not requested.issubset({"authorization", "content-type"}):
            raise GatewayError("preflight_rejected", 403)
        extra = {"Access-Control-Allow-Methods": method, "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "600"}
        if self.single_header("Access-Control-Request-Private-Network") == "true":
            extra["Access-Control-Allow-Private-Network"] = "true"
        self.reply(204, extra=extra)

    def do_GET(self):
        self.guarded(self.get)

    def get(self):
        self.check()
        if ROUTES[self.path] != "GET":
            raise GatewayError("method_not_allowed", 405)
        self.reply(200, self.server.gateway.status())

    def do_POST(self):
        self.guarded(self.post)

    def post(self):
        self.check()
        if ROUTES[self.path] != "POST":
            raise GatewayError("method_not_allowed", 405)
        gateway = self.server.gateway
        if self.path in ("/ocr", "/detect"):
            content_type = self.single_header("Content-Type")
            body = self.body(MAX_IMAGE_BYTES)
            self.reply(200, gateway.infer(self.path[1:], body, content_type))
            return
        payload = self.json_body()
        if self.path == "/models/download":
            if set(payload) - {"components"}:
                raise GatewayError("invalid_request", 400)
            components = payload.get("components", ["ocr", "detector"])
            if not isinstance(components, list) or not 1 <= len(components) <= 2 or any(not isinstance(c, str) for c in components):
                raise GatewayError("invalid_components", 400)
            started = gateway.models.start(components)
            self.reply(202, {"started": started, "download": gateway.models.snapshot()})
        elif self.path == "/models/cancel":
            if payload:
                raise GatewayError("invalid_request", 400)
            self.reply(200, {"cancelled": gateway.models.cancel(), "download": gateway.models.snapshot()})
        else:
            if payload:
                raise GatewayError("invalid_request", 400)
            self.reply(200, gateway.cancel())
