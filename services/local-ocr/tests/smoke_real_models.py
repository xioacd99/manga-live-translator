"""显式下载后，用原创合成图测试真实四模型；不调用翻译、不保存图或全文。"""
import argparse
import http.client
import io
import json
from pathlib import Path
import secrets
import sys
import threading
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from manga_local_ocr.__main__ import default_cache_dir
from manga_local_ocr.models import ModelStore
from manga_local_ocr.server import BoundedServer, Gateway


def fixture():
    from PIL import Image, ImageDraw, ImageFont
    image = Image.new("RGB", (960, 640), "#dadada")
    draw = ImageDraw.Draw(image)
    draw.rectangle((25, 25, 935, 615), fill="white", outline="black", width=5)
    draw.ellipse((100, 170, 860, 470), fill="white", outline="black", width=5)
    font = ImageFont.load_default(size=58)
    draw.text((260, 265), "HELLO WORLD", fill="black", font=font)
    stream = io.BytesIO()
    image.save(stream, format="PNG")
    return stream.getvalue()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-dir", type=Path, default=default_cache_dir())
    parser.add_argument("--download", action="store_true", help="显式允许下载固定公共模型")
    parser.add_argument("--output", type=Path, help="只写非全文验证摘要 JSON")
    parser.add_argument("--in-process", action="store_true", help="仅模型进程内验证，不冒称 HTTP 或浏览器验证")
    args = parser.parse_args()
    models = ModelStore(args.cache_dir)
    if args.download:
        models.start()
        deadline = time.monotonic() + 3600
        previous = None
        while models.snapshot()["state"] in ("downloading", "cancelling"):
            state = models.snapshot()
            percent = state["bytesDownloaded"] * 100 // state["bytesTotal"]
            if percent != previous:
                print(json.dumps({"stage": "download", "percent": percent}), flush=True)
                previous = percent
            if time.monotonic() > deadline:
                models.cancel()
                raise RuntimeError("model_download_timeout")
            time.sleep(0.5)
        if models.snapshot()["state"] != "completed":
            raise RuntimeError(models.snapshot()["error"] or "models_not_ready")
    if not models.ready("ocr") or not models.ready("detector"):
        raise RuntimeError("models_not_ready: run with --download or provide verified cache")
    gateway = Gateway(models)
    body = fixture()
    server = None
    results = {}
    try:
        if not args.in_process:
            token = secrets.token_urlsafe(32)
            origin = "chrome-extension://" + "a" * 32
            server = BoundedServer(0, gateway, token, [origin])
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
        for operation in ("ocr", "detect"):
            started = time.perf_counter()
            if args.in_process:
                result = gateway.infer(operation, body, "image/png")
            else:
                connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=240)
                connection.request("POST", "/" + operation, body, {
                    "Authorization": "Bearer " + token, "Origin": origin, "Content-Type": "image/png"})
                response = connection.getresponse()
                result = json.loads(response.read())
                connection.close()
                if response.status != 200:
                    raise RuntimeError(result.get("error", "http_failed"))
            results[operation] = {"regionCount": len(result["regions"]), "wallSeconds": time.perf_counter() - started,
                                  "revision": result.get("modelRevision", result.get("detectorRevision"))}
            if operation == "ocr":
                text = " ".join(region["sourceText"] for region in result["regions"])
                if "HELLO" not in text.upper() or "WORLD" not in text.upper():
                    raise RuntimeError("synthetic_ocr_text_mismatch")
            # 空气泡列表是合法输出，不能为合成图虚构质量验收门槛。
            if result["width"] != 960 or result["height"] != 640:
                raise RuntimeError("invalid_image_dimensions")
        evidence = {"passed": True, "scope": "real_models_in_process" if args.in_process else "real_models_loopback_http",
                    "syntheticFixture": True, "results": results,
                    "models": [{"id": model["id"], "sha256": model["sha256"], "bytes": model["bytes"]} for model in models.models]}
        if args.output is not None:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(evidence, indent=2), flush=True)
    finally:
        if server is not None:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    main()
