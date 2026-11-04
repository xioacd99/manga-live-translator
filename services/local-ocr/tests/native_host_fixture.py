"""仅测试入口：可控阻塞和噪音替身，不属于安装包、不冒充真实 ORT。"""
import os
from pathlib import Path
import sys
import threading
import time
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from manga_local_ocr import native_host

mode = sys.argv.pop(1)
original = native_host.create_server


def create_server(cache_dir, origin, token):
    if mode == "slow-start":
        time.sleep(60)
    if mode in ("slow-inference", "noisy", "slow-cleanup"):
        from manga_local_ocr.server import BoundedServer, Gateway
        from test_gateway import FakeStore

        class Engine:
            def states(self):
                return {"ocr": "unloaded", "detector": "unloaded"}

            def ocr(self, image):
                os.write(1, b"unframed library stdout\n")
                os.write(2, b"library stderr should not contain user content\n")
                if mode == "slow-inference":
                    time.sleep(60)
                return []
            detect = ocr

        gateway = Gateway(FakeStore(), Engine(), lambda *args: SimpleNamespace(shape=(32, 64, 3)))
        if mode == "slow-cleanup":
            gateway.cancel = lambda: time.sleep(60)
        # 模拟第三方库创建非 daemon 后台线程，正常 Python 退出会被它阻塞。
        threading.Thread(target=lambda: time.sleep(60), daemon=False).start()
        os.write(1, b"library initialization stdout\n")
        return BoundedServer(0, gateway, token, [origin[:-1]])
    return original(cache_dir, origin, token)


native_host.create_server = create_server
native_host.main()
