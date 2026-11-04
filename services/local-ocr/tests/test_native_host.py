"""真实子进程、Native Messaging 帧与 HTTP 生命周期；不下载真实模型。"""
import http.client
import io
import json
import os
from pathlib import Path
import queue
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from manga_local_ocr.native_host import (MAX_MESSAGE_BYTES, ProtocolError, load_configuration,
                                         read_message, write_message)
from manga_local_ocr.server import BoundedServer, Gateway
from test_gateway import FakeEngine, FakeStore, ORIGIN, TOKEN

ROOT = Path(__file__).resolve().parents[1]
CALLER = ORIGIN + "/"


def frame(raw):
    return struct.pack("=I", len(raw)) + raw


class FramingTests(unittest.TestCase):
    def test_valid_frames_and_clean_eof(self):
        stream = io.BytesIO()
        write_message(stream, {"type": "start"})
        write_message(stream, {"type": "stop"})
        stream.seek(0)
        self.assertEqual(read_message(stream), {"type": "start"})
        self.assertEqual(read_message(stream), {"type": "stop"})
        self.assertIsNone(read_message(stream))

    def test_partial_reads(self):
        class ShortStream(io.BytesIO):
            def read(self, size):
                return super().read(min(1, size))
        self.assertEqual(read_message(ShortStream(frame(b'{"type":"start"}'))), {"type": "start"})

    def test_rejects_truncation_sizes_and_untrusted_fields(self):
        cases = [b"\x01", struct.pack("=I", 0), struct.pack("=I", MAX_MESSAGE_BYTES + 1),
                 struct.pack("=I", 99) + b"{}", frame(b"[]"), frame(b"null"), frame(b"\xff"),
                 frame(b'{"type":"start","type":"stop"}'), frame(b'{"type":NaN}'),
                 frame(b'{"type":"start","port":8787}'), frame(b'{"type":"exec"}'),
                 frame(b'{"type":"start","args":["rm"]}'), frame(b'{"type":"start","cache_dir":"/tmp"}'),
                 frame(b'{"type":"start","url":"https://evil.test"}'), frame(b'{"type":{}}'),
                 frame(b'{"type":true}'), frame(b'{"type":"start"} trailing')]
        for raw in cases:
            with self.subTest(raw=raw), self.assertRaises(ProtocolError):
                read_message(io.BytesIO(raw))


class NativeProcessTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            probe = socket.socket()
            probe.bind(("127.0.0.1", 0))
            probe.close()
        except PermissionError:
            raise unittest.SkipTest("当前环境拒绝环回监听；未重试或绕过")

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.config = self.root / "config.json"
        self.config.write_text(json.dumps({"version": 1, "allowed_origins": [CALLER],
                                          "cache_dir": str(self.root / "models")}))
        self.config.chmod(0o600)
        self.children = []

    def tearDown(self):
        for child in self.children:
            if child.poll() is None:
                child.kill()
            child.wait(timeout=5)
            for stream in (child.stdin, child.stdout, child.stderr):
                if stream and not stream.closed:
                    stream.close()
        self.temporary.cleanup()

    def spawn(self, caller=CALLER, fixture=None):
        command = [sys.executable]
        if fixture:
            command += [str(ROOT / "tests" / "native_host_fixture.py"), fixture]
        else:
            command += ["-m", "manga_local_ocr.native_host"]
        command += ["--config", str(self.config), caller]
        env = os.environ.copy()
        env["PYTHONPATH"] = str(ROOT)
        child = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, env=env)
        self.children.append(child)
        return child

    def send(self, child, message):
        write_message(child.stdin, message)

    def receive(self, child, timeout=5):
        result = queue.Queue()
        def read():
            try:
                header = child.stdout.read(4)
                if len(header) != 4:
                    raise AssertionError("没有完整的本机响应帧")
                size, = struct.unpack("=I", header)
                if not 1 <= size <= MAX_MESSAGE_BYTES:
                    raise AssertionError("输出被日志或异常帧污染")
                result.put(json.loads(child.stdout.read(size)))
            except Exception as error:
                result.put(error)
        threading.Thread(target=read, daemon=True).start()
        value = result.get(timeout=timeout)
        if isinstance(value, Exception):
            raise value
        return value

    def start(self, child):
        self.send(child, {"type": "start"})
        ready = self.receive(child)
        self.assertEqual(set(ready), {"type", "endpoint", "token"})
        self.assertEqual(ready["type"], "ready")
        self.assertRegex(ready["token"], r"^[A-Za-z0-9_-]{43}$")
        self.assertRegex(ready["endpoint"], r"^http://127\.0\.0\.1:[0-9]+$")
        return ready

    def request(self, ready, path="/status", method="GET", token=None, origin=ORIGIN, body=None):
        target = urlsplit(ready["endpoint"])
        connection = http.client.HTTPConnection("127.0.0.1", target.port, timeout=5)
        try:
            headers = {"Authorization": "Bearer " + (ready["token"] if token is None else token),
                       "Origin": origin, "Content-Type": "image/png"}
            connection.request(method, path, body=body, headers=headers)
            response = connection.getresponse()
            return response.status, json.loads(response.read())
        finally:
            connection.close()

    def assert_closed(self, ready):
        with self.assertRaises(OSError):
            connection = socket.create_connection(("127.0.0.1", urlsplit(ready["endpoint"]).port), timeout=0.5)
            connection.close()

    def test_start_ready_no_download_idempotency_auth_and_eof(self):
        child = self.spawn()
        ready = self.start(child)
        status, body = self.request(ready)
        self.assertEqual(status, 200)
        self.assertFalse(body["ready"])
        self.assertEqual(body["download"]["state"], "idle")
        self.assertEqual(body["engine"], {"ocr": "unloaded", "detector": "unloaded"})
        self.assertEqual(list((self.root / "models").iterdir()), [])
        self.assertFalse((self.root / "token").exists())
        self.assertEqual(self.request(ready, token="wrong")[0], 401)
        self.assertEqual(self.request(ready, origin="chrome-extension://" + "b" * 32)[0], 403)
        self.send(child, {"type": "start"})
        self.assertEqual(self.receive(child), ready)
        child.stdin.close()
        self.assertEqual(child.wait(timeout=3), 0)
        self.assert_closed(ready)
        self.assertEqual(child.stdout.read(), b"")
        self.assertEqual(child.stderr.read(), b"")

    def test_explicit_stop_exits(self):
        child = self.spawn()
        ready = self.start(child)
        self.send(child, {"type": "stop"})
        self.assertEqual(child.wait(timeout=3), 0)
        self.assert_closed(ready)

    def test_rejects_uninstalled_and_malformed_caller(self):
        for origin in ["chrome-extension://" + "b" * 32 + "/", ORIGIN,
                       "https://evil.test/", CALLER + "../", CALLER + "?x", "*"]:
            with self.subTest(origin=origin):
                child = self.spawn(caller=origin)
                self.assertEqual(child.wait(timeout=3), 1)
                self.assertEqual(child.stdout.read(), b"")
        self.assertFalse((self.root / "models").exists())

    def test_invalid_frames_close_existing_service(self):
        child = self.spawn()
        ready = self.start(child)
        child.stdin.write(frame(b'{"type":"start","port":8787}'))
        child.stdin.flush()
        self.assertEqual(child.wait(timeout=3), 1)
        self.assert_closed(ready)

    def test_oversized_header_rejected_without_reading_body(self):
        child = self.spawn()
        child.stdin.write(struct.pack("=I", MAX_MESSAGE_BYTES + 1))
        child.stdin.flush()
        self.assertEqual(child.wait(timeout=3), 1)
        self.assertFalse((self.root / "models").exists())

    def test_partial_frame_eof_exits(self):
        child = self.spawn()
        ready = self.start(child)
        child.stdin.write(struct.pack("=I", 100) + b"{")
        child.stdin.close()
        self.assertEqual(child.wait(timeout=3), 1)
        self.assert_closed(ready)

    def test_eof_during_startup_does_not_wait_for_initialization(self):
        child = self.spawn(fixture="slow-start")
        self.send(child, {"type": "start"})
        time.sleep(0.2)
        child.stdin.close()
        self.assertEqual(child.wait(timeout=3), 0)
        self.assertEqual(child.stdout.read(), b"")

    def test_cleanup_deadlock_cannot_hold_process_alive(self):
        child = self.spawn(fixture="slow-cleanup")
        ready = self.start(child)
        child.stdin.close()
        self.assertEqual(child.wait(timeout=3), 0)
        self.assert_closed(ready)

    def test_native_library_stdout_and_stderr_never_corrupt_protocol(self):
        child = self.spawn(fixture="noisy")
        ready = self.start(child)
        self.assertEqual(self.request(ready, "/ocr", "POST", body=b"fixture")[0], 200)
        self.send(child, {"type": "start"})
        self.assertEqual(self.receive(child), ready)
        self.send(child, {"type": "stop"})
        self.assertEqual(child.wait(timeout=3), 0)
        self.assertEqual(child.stdout.read(), b"")
        self.assertEqual(child.stderr.read(), b"")

    def begin_slow_inference(self, child, ready):
        done = threading.Event()
        def infer():
            try:
                self.request(ready, "/ocr", "POST", body=b"fixture")
            except (OSError, http.client.HTTPException):
                pass
            finally:
                done.set()
        threading.Thread(target=infer, daemon=True).start()
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            if self.request(ready)[1]["activeOperation"] == "ocr":
                return done
            time.sleep(0.02)
        self.fail("合成阻塞推理未启动")

    def test_eof_terminates_inflight_inference_and_non_daemon_thread(self):
        child = self.spawn(fixture="slow-inference")
        ready = self.start(child)
        done = self.begin_slow_inference(child, ready)
        child.stdin.close()
        self.assertEqual(child.wait(timeout=3), 0)
        self.assertTrue(done.wait(2))
        self.assert_closed(ready)

    def test_abrupt_process_kill_closes_inflight_http(self):
        child = self.spawn(fixture="slow-inference")
        ready = self.start(child)
        done = self.begin_slow_inference(child, ready)
        child.kill()
        child.wait(timeout=3)
        self.assertTrue(done.wait(2))
        self.assert_closed(ready)

    def test_separate_host_and_manual_server_survive_other_host_exit(self):
        manual = BoundedServer(0, Gateway(FakeStore(), FakeEngine()), TOKEN, [ORIGIN])
        worker = threading.Thread(target=manual.serve_forever, daemon=True)
        worker.start()
        try:
            first, second = self.spawn(), self.spawn()
            first_ready, second_ready = self.start(first), self.start(second)
            self.assertNotEqual(first_ready["endpoint"], second_ready["endpoint"])
            self.assertNotEqual(first_ready["token"], second_ready["token"])
            self.assertEqual(self.request(second_ready, token=first_ready["token"])[0], 401)
            first.stdin.close()
            self.assertEqual(first.wait(timeout=3), 0)
            self.assert_closed(first_ready)
            self.assertEqual(self.request(second_ready)[0], 200)
            self.assertEqual(self.request({"endpoint": f"http://127.0.0.1:{manual.server_port}", "token": TOKEN})[0], 200)
            self.send(second, {"type": "stop"})
            self.assertEqual(second.wait(timeout=3), 0)
            self.assertEqual(self.request({"endpoint": f"http://127.0.0.1:{manual.server_port}", "token": TOKEN})[0], 200)
        finally:
            manual.shutdown()
            manual.server_close()
            worker.join(3)


class ConfigurationTests(unittest.TestCase):
    def test_exact_config_schema_and_private_permissions(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config = root / "config.json"
            valid = {"version": 1, "allowed_origins": [CALLER], "cache_dir": str(root / "models")}
            config.write_text(json.dumps(valid))
            config.chmod(0o600)
            self.assertEqual(load_configuration(config, CALLER), root / "models")
            for changes in [{"allowed_origins": ["*"]}, {"allowed_origins": [ORIGIN]},
                            {"allowed_origins": [CALLER, CALLER]}, {"version": True},
                            {"cache_dir": "relative"}, {"args": []}, {"allowed_origins": []}]:
                config.write_text(json.dumps({**valid, **changes}))
                with self.subTest(changes=changes), self.assertRaises(ProtocolError):
                    load_configuration(config, CALLER)
            config.write_text(json.dumps(valid))
            if os.name != "nt":
                config.chmod(0o644)
                with self.assertRaises(ProtocolError):
                    load_configuration(config, CALLER)
                config.chmod(0o600)
                link = root / "link"
                link.symlink_to(config)
                with self.assertRaises(ProtocolError):
                    load_configuration(link, CALLER)


if __name__ == "__main__":
    unittest.main()
