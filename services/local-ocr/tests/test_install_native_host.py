"""安装计划仅写临时夹具目录；不会向真实浏览器注册持久访问。"""
import contextlib
import io
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from manga_local_ocr.install_native_host import (HOST_NAME, apply_plan, build_plan,
                                                 default_manifest_dir, main)

EXTENSION_ID = "a" * 32


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def plan(self, extension_id=EXTENSION_ID, python_executable=None):
        return build_plan([extension_id], "chrome", self.root / "host's folder",
                          self.root / "browser" / "NativeMessagingHosts", self.root / "shared models",
                          python_executable=python_executable)

    def test_os_browser_manifest_locations(self):
        home = Path("/test/home")
        self.assertEqual(default_manifest_dir("chrome", "darwin", home, {}),
                         home / "Library/Application Support/Google/Chrome/NativeMessagingHosts")
        self.assertEqual(default_manifest_dir("chromium", "darwin", home, {}),
                         home / "Library/Application Support/Chromium/NativeMessagingHosts")
        self.assertEqual(default_manifest_dir("chrome-for-testing", "darwin", home, {}),
                         home / "Library/Application Support/Google/ChromeForTesting/NativeMessagingHosts")
        for browser, directory in [("chrome", "google-chrome"), ("chromium", "chromium"),
                                   ("chrome-for-testing", "google-chrome-for-testing")]:
            self.assertEqual(default_manifest_dir(browser, "linux", home, {}),
                             home / ".config" / directory / "NativeMessagingHosts")
            self.assertEqual(default_manifest_dir(browser, "linux", home, {"XDG_CONFIG_HOME": "/config"}),
                             Path("/config") / directory / "NativeMessagingHosts")
        with self.assertRaises(ValueError):
            default_manifest_dir("chrome", "win32", home, {})

    def test_plan_has_exact_origin_private_modes_and_exec_wrapper(self):
        plan = self.plan()
        config, wrapper, manifest = plan["files"]
        self.assertEqual(plan["host"], HOST_NAME)
        expected_origin = ["chrome-extension://" + EXTENSION_ID + "/"]
        self.assertEqual(json.loads(config["content"])["allowed_origins"], expected_origin)
        self.assertEqual(json.loads(manifest["content"])["allowed_origins"], expected_origin)
        self.assertEqual(json.loads(manifest["content"])["path"], wrapper["path"])
        self.assertEqual([item["mode"] for item in plan["files"]], [0o600, 0o700, 0o600])
        self.assertIn("\nexec ", wrapper["content"])
        self.assertIn(" -I -m manga_local_ocr.native_host --config ", wrapper["content"])
        self.assertTrue(wrapper["content"].endswith(' "$@"\n'))
        self.assertNotIn("8787", wrapper["content"])
        self.assertEqual(list(self.root.iterdir()), [])

    def test_virtual_environment_interpreter_symlink_is_preserved(self):
        if os.name == "nt":
            self.skipTest("POSIX 启动脚本专用测试")
        interpreter = self.root / "venv" / "bin" / "python"
        interpreter.parent.mkdir(parents=True)
        interpreter.symlink_to(sys.executable)
        plan = self.plan(python_executable=interpreter)
        self.assertIn(str(interpreter), plan["files"][1]["content"])
        self.assertNotEqual(str(interpreter), str(interpreter.resolve()))

    def test_write_fixture_then_idempotent_no_overwrite(self):
        plan = self.plan()
        apply_plan(plan)
        before = {}
        for item in plan["files"]:
            path = Path(item["path"])
            self.assertEqual(path.read_text(), item["content"])
            if os.name != "nt":
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), item["mode"])
            before[path] = path.stat().st_mtime_ns
        apply_plan(plan)
        for path, timestamp in before.items():
            self.assertEqual(path.stat().st_mtime_ns, timestamp)
        self.assertFalse((self.root / "shared models").exists())

    def test_different_existing_registration_refuses_before_any_writes(self):
        plan = self.plan()
        manifest = Path(plan["files"][-1]["path"])
        manifest.parent.mkdir(parents=True)
        manifest.write_text('{"name":"another extension registration"}')
        with self.assertRaises(ValueError):
            apply_plan(plan)
        self.assertEqual(manifest.read_text(), '{"name":"another extension registration"}')
        self.assertFalse(Path(plan["files"][0]["path"]).parent.exists())

    def test_changed_extension_allowlist_is_not_silently_replaced(self):
        original = self.plan()
        apply_plan(original)
        with self.assertRaises(ValueError):
            apply_plan(self.plan(extension_id="b" * 32))
        for item in original["files"]:
            self.assertEqual(Path(item["path"]).read_text(), item["content"])

    def test_symlink_or_public_config_is_rejected(self):
        if os.name == "nt":
            self.skipTest("POSIX 符号链接与权限专用测试")
        plan = self.plan()
        config = Path(plan["files"][0]["path"])
        config.parent.mkdir(parents=True)
        destination = self.root / "unrelated"
        destination.write_text("keep")
        config.symlink_to(destination)
        with self.assertRaises(ValueError):
            apply_plan(plan)
        self.assertEqual(destination.read_text(), "keep")
        config.unlink()
        config.write_text(plan["files"][0]["content"])
        config.chmod(0o644)
        with self.assertRaises(ValueError):
            apply_plan(plan)

    def test_invalid_extension_ids_rejected_without_writes(self):
        for extension_id in ["*", "a" * 31, "q" * 32, "chrome-extension://" + EXTENSION_ID + "/", EXTENSION_ID + "; echo bad"]:
            with self.subTest(value=extension_id), self.assertRaises(ValueError):
                self.plan(extension_id=extension_id)
        self.assertEqual(list(self.root.iterdir()), [])

    def test_cli_dry_run_does_not_register_or_create_directories(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            status = main(["--extension-id", EXTENSION_ID, "--browser", "chromium", "--dry-run",
                           "--manifest-dir", str(self.root / "profile/NativeMessagingHosts"),
                           "--data-dir", str(self.root / "managed-host"),
                           "--cache-dir", str(self.root / "models")])
        self.assertEqual(status, 0)
        self.assertEqual(json.loads(output.getvalue())["browser"], "chromium")
        self.assertEqual(list(self.root.iterdir()), [])

    def test_cli_install_only_requested_fixture_directories(self):
        with contextlib.redirect_stdout(io.StringIO()):
            status = main(["--extension-id", EXTENSION_ID,
                           "--manifest-dir", str(self.root / "profile/NativeMessagingHosts"),
                           "--data-dir", str(self.root / "managed-host"),
                           "--cache-dir", str(self.root / "models")])
        self.assertEqual(status, 0)
        self.assertTrue((self.root / "profile/NativeMessagingHosts" / (HOST_NAME + ".json")).is_file())
        self.assertFalse((self.root / "models").exists())


if __name__ == "__main__":
    unittest.main()
