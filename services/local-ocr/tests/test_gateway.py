"""合成图片和内存请求测试，不下载模型、不上传图片。"""
import hashlib
from http.client import HTTPMessage
import io
import json
import os
from pathlib import Path
import struct
import sys
import tempfile
import threading
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from manga_local_ocr.__main__ import read_or_create_token
from manga_local_ocr.config import MAX_IMAGE_BYTES, MODELS, MODEL_REVISION, DETECTOR_REVISION, OCR_CONFIG
from manga_local_ocr.engine import NativeEngine, stable_id
from manga_local_ocr.errors import GatewayError
from manga_local_ocr.images import inspect_image
from manga_local_ocr.models import ModelStore, SafeRedirect, allowed_download_url, file_matches
from manga_local_ocr.server import BoundedServer, Gateway, Handler

TOKEN = "a" * 43
ORIGIN = "chrome-extension://" + "a" * 32


def fixture():
    from PIL import Image
    stream = io.BytesIO()
    Image.new("RGB", (64, 32), "white").save(stream, format="PNG")
    return stream.getvalue()


class FakeResponse(io.BytesIO):
    status = 200
    def __init__(self, body, headers=None):
        super().__init__(body)
        self.headers = headers if headers is not None else {"Content-Length": str(len(body))}


class FakeEngine:
    def states(self):
        return {"ocr": "loaded", "detector": "loaded"}
    def ocr(self, image):
        return []
    detect = ocr


class FakeStore:
    def __init__(self):
        self.available = True
    def ready(self, component):
        return self.available
    def snapshot(self):
        return {"state": "idle", "models": []}
    def cancel(self):
        return False
    def start(self, components):
        if any(c not in ("ocr", "detector") for c in components):
            raise GatewayError("invalid_components", 400)
        return True


class ProtocolTests(unittest.TestCase):
    def setUp(self):
        self.handler = object.__new__(Handler)
        self.handler.server = mock.Mock(server_port=8787, token=TOKEN, origins={ORIGIN}, gateway=Gateway(FakeStore(), FakeEngine()))
        self.handler.client_address = ("127.0.0.1", 12345)
        self.handler.path = "/status"
        self.handler.headers = HTTPMessage()
        for k, v in {"Host": "127.0.0.1:8787", "Authorization": "Bearer " + TOKEN, "Origin": ORIGIN}.items():
            self.handler.headers[k] = v
        self.handler.reply = mock.Mock()
        self.handler.connection = mock.Mock()
        self.handler.rfile = io.BytesIO()

    def set_header(self, key, value):
        del self.handler.headers[key]
        if value is not None:
            self.handler.headers[key] = value

    def post(self, path, payload=b"", content_type="application/json"):
        self.handler.path = path
        self.set_header("Content-Length", str(len(payload)))
        self.set_header("Content-Type", content_type)
        self.handler.rfile = io.BytesIO(payload)
        self.handler.do_POST()
        return self.handler.reply.call_args.args

    def test_authenticated_status(self):
        self.handler.do_GET()
        status, body = self.handler.reply.call_args.args
        self.assertEqual(status, 200)
        self.assertTrue(body["ready"])
        self.assertEqual(body["modelRevision"], MODEL_REVISION)
        self.assertNotIn(TOKEN, json.dumps(body))

    def test_no_origin_requires_token(self):
        self.set_header("Origin", None)
        self.handler.check()
        self.set_header("Authorization", None)
        with self.assertRaisesRegex(GatewayError, "unauthorized"):
            self.handler.check()

    def test_origin_is_exact(self):
        for value in ["null", "https://example.com", ORIGIN + "/", "chrome-extension://" + "b" * 32]:
            with self.subTest(value=value):
                self.set_header("Origin", value)
                with self.assertRaisesRegex(GatewayError, "origin_rejected"):
                    self.handler.check()

    def test_host_is_exact(self):
        for value in [None, "localhost:8787", "127.0.0.1:80", "127.0.0.1.evil:8787", "127.0.0.1:8787@evil", "127.0.0.1:8787."]:
            with self.subTest(value=value):
                self.set_header("Host", value)
                with self.assertRaisesRegex(GatewayError, "host_rejected"):
                    self.handler.check()

    def test_duplicate_headers_rejected(self):
        for key in ["Host", "Origin", "Authorization"]:
            with self.subTest(key=key):
                value = self.handler.headers[key]
                self.handler.headers[key] = value
                with self.assertRaisesRegex(GatewayError, "duplicate_header"):
                    self.handler.check()
                self.set_header(key, value)

    def test_non_ascii_auth_is_safely_denied(self):
        self.set_header("Authorization", "Bearer é")
        self.handler.do_GET()
        self.assertEqual(self.handler.reply.call_args.args, (401, {"error": "unauthorized"}))

    def test_query_route_cannot_carry_url_or_token(self):
        self.handler.path = "/ocr?url=https://example.com"
        with self.assertRaisesRegex(GatewayError, "route_not_found"):
            self.handler.check()

    def test_preflight_without_token(self):
        self.handler.path = "/ocr"
        self.set_header("Authorization", None)
        self.set_header("Access-Control-Request-Method", "POST")
        self.set_header("Access-Control-Request-Headers", "authorization, content-type")
        self.set_header("Access-Control-Request-Private-Network", "true")
        self.handler.do_OPTIONS()
        self.assertEqual(self.handler.reply.call_args.args, (204,))
        self.assertEqual(self.handler.reply.call_args.kwargs["extra"]["Access-Control-Allow-Private-Network"], "true")

    def test_preflight_rejects_unexpected_headers_or_no_origin(self):
        self.handler.path = "/ocr"
        self.set_header("Access-Control-Request-Method", "POST")
        self.set_header("Access-Control-Request-Headers", "x-arbitrary")
        self.handler.do_OPTIONS()
        self.assertEqual(self.handler.reply.call_args.args[0], 403)
        self.set_header("Access-Control-Request-Headers", "authorization")
        self.set_header("Origin", None)
        self.handler.do_OPTIONS()
        self.assertEqual(self.handler.reply.call_args.args[0], 403)

    def test_size_checked_before_body_read(self):
        self.set_header("Content-Length", str(MAX_IMAGE_BYTES + 1))
        self.handler.rfile = mock.Mock()
        with self.assertRaisesRegex(GatewayError, "request_too_large"):
            self.handler.body(MAX_IMAGE_BYTES)
        self.handler.rfile.read1.assert_not_called()

    def test_duplicate_length_and_chunked_rejected(self):
        self.set_header("Content-Length", "0")
        self.handler.headers["Content-Length"] = "1"
        with self.assertRaisesRegex(GatewayError, "duplicate_header"):
            self.handler.body(5)
        self.set_header("Content-Length", "0")
        self.set_header("Transfer-Encoding", "chunked")
        with self.assertRaisesRegex(GatewayError, "transfer_encoding_rejected"):
            self.handler.body(5)

    def test_missing_and_truncated_length(self):
        with self.assertRaisesRegex(GatewayError, "content_length_required"):
            self.handler.body(5)
        self.set_header("Content-Length", "5")
        self.handler.rfile = io.BytesIO(b"ab")
        with self.assertRaisesRegex(GatewayError, "incomplete_body"):
            self.handler.body(5)

    def test_explicit_model_download_and_reject_custom_url(self):
        self.assertEqual(self.post("/models/download")[0], 202)
        self.assertEqual(self.post("/models/download", b'{"url":"https://example.com"}')[0], 400)
        self.assertEqual(self.post("/models/download", b'{"components":["unknown"]}')[0], 400)

    def test_cancellation_endpoints(self):
        self.assertEqual(self.post("/models/cancel")[0], 200)
        self.assertEqual(self.post("/cancel")[0], 200)
        self.assertEqual(self.post("/cancel", b'{"url":"bad"}')[0], 400)

    def test_safe_errors(self):
        self.handler.server.gateway.status = mock.Mock(side_effect=ValueError("PRIVATE_SECRET"))
        self.handler.do_GET()
        self.assertEqual(self.handler.reply.call_args.args, (500, {"error": "internal_error"}))


class ImageTests(unittest.TestCase):
    def test_valid_header(self):
        self.assertEqual(inspect_image(fixture(), "image/png"), (64, 32))

    def test_supported_containers_checked_before_decoder(self):
        from PIL import Image
        for format_name, mime, options in [
            ("JPEG", "image/jpeg", {}), ("JPEG", "image/jpeg", {"progressive": True}),
            ("PNG", "image/png", {}), ("BMP", "image/bmp", {}),
            ("WEBP", "image/webp", {}), ("WEBP", "image/webp", {"lossless": True}),
        ]:
            with self.subTest(format=format_name, options=options):
                stream = io.BytesIO()
                Image.new("RGB", (64, 32), "white").save(stream, format=format_name, **options)
                self.assertEqual(inspect_image(stream.getvalue(), mime), (64, 32))
        stream = io.BytesIO()
        Image.new("RGBA", (64, 32), (1, 2, 3, 120)).save(stream, format="WEBP")
        self.assertEqual(inspect_image(stream.getvalue(), "image/webp"), (64, 32))

    def test_webp_canvas_bound_before_pillow_open(self):
        from PIL import Image
        payload = b"\0" * 4 + (99999).to_bytes(3, "little") + (99999).to_bytes(3, "little")
        chunks = b"VP8X" + len(payload).to_bytes(4, "little") + payload
        body = b"RIFF" + (4 + len(chunks)).to_bytes(4, "little") + b"WEBP" + chunks
        with mock.patch.object(Image, "open", side_effect=AssertionError("decoder must not open")):
            with self.assertRaisesRegex(GatewayError, "image_dimensions_exceeded"):
                inspect_image(body, "image/webp")

    def test_content_type_must_match(self):
        with self.assertRaisesRegex(GatewayError, "invalid_image"):
            inspect_image(fixture(), "image/jpeg")
        with self.assertRaisesRegex(GatewayError, "unsupported_media_type"):
            inspect_image(fixture(), "text/plain")

    def test_huge_dimensions_rejected_before_decode(self):
        from PIL import Image
        raw = bytearray(fixture())
        raw[16:24] = struct.pack(">II", 100000, 100000)
        import zlib
        raw[29:33] = struct.pack(">I", zlib.crc32(raw[12:29]))
        with mock.patch.object(Image.Image, "load", side_effect=AssertionError("must not decode")):
            with self.assertRaisesRegex(GatewayError, "image_dimensions_exceeded"):
                inspect_image(bytes(raw), "image/png")

    def test_animation_rejected(self):
        from PIL import Image
        stream = io.BytesIO()
        frames = [Image.new("RGB", (64, 32), color) for color in ("white", "black")]
        frames[0].save(stream, format="PNG", save_all=True, append_images=frames[1:])
        with self.assertRaisesRegex(GatewayError, "animated_image_unsupported"):
            inspect_image(stream.getvalue(), "image/png")


class ModelTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.content = b"fixed model fixture"
        self.model = {"id": "test", "component": "ocr", "bytes": len(self.content),
                      "sha256": hashlib.sha256(self.content).hexdigest(),
                      "url": "https://www.modelscope.cn/fixed-model"}

    def store(self, content=None, headers=None):
        response = FakeResponse(self.content if content is None else content, headers)
        return ModelStore(self.directory.name, [self.model], opener=mock.Mock(open=mock.Mock(return_value=response)))

    def test_download_cache_and_no_implicit_fetch(self):
        store = self.store()
        store._opener.open.assert_not_called()
        store.start(["ocr"])
        store.wait(5)
        self.assertEqual(store.snapshot()["state"], "completed")
        self.assertTrue(store.ready("ocr"))
        self.assertTrue(file_matches(store.path(self.model), self.model))
        self.assertEqual(list(store.verified_paths("ocr")), ["test"])
        store.start(["ocr"])
        store.wait(5)
        self.assertEqual(store._opener.open.call_count, 1)
        self.assertEqual(list(Path(self.directory.name).glob("*.part")), [])

    def test_bad_checksum_never_cached(self):
        store = self.store(b"x" * len(self.content))
        store.start(["ocr"])
        store.wait(5)
        self.assertEqual(store.snapshot()["error"], "model_checksum_mismatch")
        self.assertFalse(store.ready("ocr"))
        self.assertFalse(store.path(self.model).exists())
        self.assertEqual(list(Path(self.directory.name).iterdir()), [])

    def test_oversize_download_rejected(self):
        store = self.store(self.content + b"extra", {})
        store.start(["ocr"])
        store.wait(5)
        self.assertEqual(store.snapshot()["error"], "model_download_size_mismatch")
        self.assertFalse(store.path(self.model).exists())

    def test_cancel_removes_partial(self):
        store = self.store()
        entered, release = threading.Event(), threading.Event()
        response = store._opener.open.return_value
        original = response.read
        def read(size):
            chunk = original(2)
            entered.set()
            release.wait(5)
            return chunk
        response.read = read
        store.start(["ocr"])
        self.assertTrue(entered.wait(5))
        self.assertFalse(store.start(["ocr"]))
        self.assertTrue(store.cancel())
        release.set()
        store.wait(5)
        self.assertEqual(store.snapshot()["state"], "cancelled")
        self.assertEqual(list(Path(self.directory.name).iterdir()), [])

    def test_tampered_cached_model_is_not_loaded(self):
        store = self.store()
        store.start(["ocr"])
        store.wait(5)
        store.path(self.model).write_bytes(b"bad")
        with self.assertRaisesRegex(GatewayError, "models_not_ready"):
            store.verified_paths("ocr")
        self.assertFalse(store.ready("ocr"))

    def test_redirect_allowlist(self):
        for url in ["http://huggingface.co/a", "https://evil.test/a", "https://127.0.0.1/a", "https://user@huggingface.co/a", "https://huggingface.co:8443/a"]:
            self.assertFalse(allowed_download_url(url))
            with self.assertRaisesRegex(GatewayError, "model_download_redirect_rejected"):
                SafeRedirect().redirect_request(None, None, 302, "", {}, url)
        self.assertTrue(allowed_download_url("https://cas-bridge.xethub.hf.co/a?public=signature"))
        self.assertTrue(allowed_download_url("https://us.aws.cdn.hf.co/a?public=signature"))

    def test_failure_does_not_expose_secret(self):
        store = self.store()
        store._opener.open.side_effect = RuntimeError("PRIVATE_SECRET")
        store.start(["ocr"])
        store.wait(5)
        self.assertEqual(store.snapshot()["error"], "model_download_failed")
        self.assertNotIn("PRIVATE_SECRET", json.dumps(store.snapshot()))


class InferenceTests(unittest.TestCase):
    def test_serialized_cancelled_results_not_returned(self):
        entered, release = threading.Event(), threading.Event()
        engine = FakeEngine()
        def run(image):
            entered.set()
            release.wait(5)
            return []
        engine.ocr = run
        image = mock.Mock(shape=(32, 64, 3))
        decoder = mock.Mock(return_value=image)
        gateway = Gateway(FakeStore(), engine, decoder)
        result = []
        def task():
            try:
                result.append(gateway.infer("ocr", b"fixture", "image/png"))
            except GatewayError as error:
                result.append(error.code)
        thread = threading.Thread(target=task)
        thread.start()
        self.assertTrue(entered.wait(5))
        with self.assertRaisesRegex(GatewayError, "inference_busy"):
            gateway.infer("detect", b"fixture", "image/png")
        self.assertEqual(decoder.call_count, 1)
        self.assertTrue(gateway.cancel()["inferencePending"])
        release.set()
        thread.join(5)
        self.assertEqual(result, ["inference_cancelled"])
        self.assertIsNone(gateway.status()["activeOperation"])
        self.assertEqual(gateway.infer("detect", b"fixture", "image/png")["detectorRevision"], DETECTOR_REVISION)

    def test_model_not_ready_cannot_decode_or_fetch(self):
        store = FakeStore()
        store.available = False
        decoder = mock.Mock()
        gateway = Gateway(store, FakeEngine(), decoder)
        with self.assertRaisesRegex(GatewayError, "models_not_ready"):
            gateway.infer("ocr", b"fixture", "image/png")
        decoder.assert_not_called()

    def test_ids_independent_of_order(self):
        polygon = [{"x": 1, "y": 2}, {"x": 10, "y": 2}, {"x": 10, "y": 8}, {"x": 1, "y": 8}]
        self.assertEqual(stable_id("r-", polygon, "Hello"), stable_id("r-", list(polygon), "Hello"))
        self.assertNotEqual(stable_id("r-", polygon, "Hello"), stable_id("r-", polygon, "World"))

    def test_fixed_native_parameters(self):
        self.assertEqual(OCR_CONFIG["Det.mean"], [0.485, 0.456, 0.406])
        self.assertEqual(OCR_CONFIG["Det.thresh"], 0.2)
        self.assertEqual(OCR_CONFIG["Det.box_thresh"], 0.45)
        self.assertEqual(OCR_CONFIG["Det.unclip_ratio"], 1.4)
        self.assertEqual(OCR_CONFIG["Rec.rec_batch_num"], 6)
        self.assertEqual(sum(m["bytes"] for m in MODELS), 307816501)


class TokenTests(unittest.TestCase):
    def test_private_token_created_and_reused(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "token"
            token = read_or_create_token(path)
            self.assertEqual(token, read_or_create_token(path))
            self.assertRegex(token, r"^[A-Za-z0-9_-]{43}$")
            if os.name != "nt":
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
                path.chmod(0o644)
                with self.assertRaisesRegex(ValueError, "0600"):
                    read_or_create_token(path)

    def test_symlink_token_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "token"
            read_or_create_token(path)
            link = Path(directory) / "link"
            try:
                link.symlink_to(path)
            except OSError:
                self.skipTest("当前系统不支持此符号链接测试")
            with self.assertRaisesRegex(ValueError, "invalid_token_file"):
                read_or_create_token(link)


if __name__ == "__main__":
    unittest.main()
