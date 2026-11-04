"""真实环回 HTTP 安全边界；推理用合成替身，不冒充模型质量测试。"""
import http.client
import json
from pathlib import Path
import sys
import threading
import unittest
from unittest import mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from manga_local_ocr.server import BoundedServer, Gateway
from test_gateway import FakeEngine, FakeStore, ORIGIN, TOKEN


class LoopbackTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        gateway = Gateway(FakeStore(), FakeEngine(), mock.Mock(return_value=mock.Mock(shape=(32, 64, 3))))
        try:
            cls.server = BoundedServer(0, gateway, TOKEN, [ORIGIN])
        except PermissionError:
            raise unittest.SkipTest("当前执行环境拒绝监听环回 socket；未重试或绕过")
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(5)

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        final = {"Authorization": "Bearer " + TOKEN, "Origin": ORIGIN}
        final.update(headers or {})
        connection.request(method, path, body, final)
        response = connection.getresponse()
        raw = response.read()
        output = (response.status, json.loads(raw) if raw else None, dict(response.getheaders()))
        connection.close()
        return output

    def test_authenticated_status_wire(self):
        status, result, headers = self.request("GET", "/status")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(headers["Access-Control-Allow-Origin"], ORIGIN)
        self.assertNotIn(TOKEN, json.dumps(result))

    def test_bad_auth_host_origin_wire(self):
        for key, value, expected in [("Authorization", "", 401), ("Host", "evil.test", 403), ("Origin", "https://evil.test", 403)]:
            with self.subTest(key=key):
                status, _, _ = self.request("GET", "/health", headers={key: value})
                self.assertEqual(status, expected)

    def test_ocr_and_detector_wire(self):
        for path in ("/ocr", "/detect"):
            status, result, _ = self.request("POST", path, b"synthetic-test-double", {"Content-Type": "image/png"})
            self.assertEqual(status, 200)
            self.assertEqual(result["regions"], [])
            self.assertEqual(result["width"], 64)

    def test_options_does_not_require_bearer(self):
        status, _, headers = self.request("OPTIONS", "/ocr", headers={
            "Authorization": "", "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Authorization, Content-Type"})
        self.assertEqual(status, 204)
        self.assertEqual(headers["Access-Control-Allow-Origin"], ORIGIN)

    def test_no_get_model_download(self):
        status, result, _ = self.request("GET", "/models/download")
        self.assertEqual(status, 405)
        self.assertEqual(result, {"error": "method_not_allowed"})


if __name__ == "__main__":
    unittest.main()
