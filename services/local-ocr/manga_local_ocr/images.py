"""先读容器尺寸，再解码；所有输入都留在内存。"""
import io
import struct
import warnings

from .config import MAX_EDGE, MAX_IMAGE_BYTES, MAX_PIXELS
from .errors import GatewayError

FORMATS = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP", "image/bmp": "BMP"}

def check_dimensions(width, height):
    if (min(width, height) < 1 or max(width, height) > MAX_EDGE
            or width * height > MAX_PIXELS or max(width, height) / min(width, height) > 128):
        raise GatewayError("image_dimensions_exceeded", 413)
    return width, height


def header_dimensions(body, content_type):
    """不创建解码器就读取尺寸，特别避免 WebP 插件提前分配画布。"""
    try:
        if content_type == "image/png":
            if len(body) < 33 or body[:8] != b"\x89PNG\r\n\x1a\n" or body[8:16] != b"\0\0\0\rIHDR":
                raise ValueError()
            return check_dimensions(*struct.unpack(">II", body[16:24]))
        if content_type == "image/bmp":
            if body[:2] != b"BM" or len(body) < 26:
                raise ValueError()
            dib = int.from_bytes(body[14:18], "little")
            if dib == 12:
                return check_dimensions(*struct.unpack("<HH", body[18:22]))
            if dib >= 40 and len(body) >= 54:
                width, height = struct.unpack("<ii", body[18:26])
                return check_dimensions(width, abs(height))
            raise ValueError()
        if content_type == "image/jpeg":
            if body[:2] != b"\xff\xd8":
                raise ValueError()
            cursor = 2
            while cursor < len(body):
                if body[cursor] != 255:
                    raise ValueError()
                while cursor < len(body) and body[cursor] == 255:
                    cursor += 1
                marker = body[cursor]
                cursor += 1
                if marker in (0, 0xD9, 0xDA):
                    raise ValueError()
                if marker == 1 or 0xD0 <= marker <= 0xD7:
                    continue
                size = int.from_bytes(body[cursor:cursor + 2], "big")
                if size < 2 or cursor + size > len(body):
                    raise ValueError()
                if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                    if size < 8:
                        raise ValueError()
                    height, width = struct.unpack(">HH", body[cursor + 3:cursor + 7])
                    return check_dimensions(width, height)
                cursor += size
            raise ValueError()
        if content_type == "image/webp":
            if len(body) < 20 or body[:4] != b"RIFF" or body[8:12] != b"WEBP" or int.from_bytes(body[4:8], "little") + 8 != len(body):
                raise ValueError()
            cursor, canvas, frame = 12, None, None
            while cursor + 8 <= len(body):
                kind = body[cursor:cursor + 4]
                size = int.from_bytes(body[cursor + 4:cursor + 8], "little")
                start, end = cursor + 8, cursor + 8 + size
                if end > len(body):
                    raise ValueError()
                if kind == b"VP8X":
                    if size != 10:
                        raise ValueError()
                    if body[start] & 2:
                        raise GatewayError("animated_image_unsupported", 415)
                    canvas = check_dimensions(int.from_bytes(body[start + 4:start + 7], "little") + 1,
                                              int.from_bytes(body[start + 7:start + 10], "little") + 1)
                elif kind == b"VP8 ":
                    if size < 10 or body[start + 3:start + 6] != b"\x9d\x01\x2a":
                        raise ValueError()
                    width, height = struct.unpack("<HH", body[start + 6:start + 10])
                    frame = check_dimensions(width & 0x3fff, height & 0x3fff)
                elif kind == b"VP8L":
                    if size < 5 or body[start] != 0x2f:
                        raise ValueError()
                    packed = int.from_bytes(body[start + 1:start + 5], "little")
                    frame = check_dimensions((packed & 0x3fff) + 1, ((packed >> 14) & 0x3fff) + 1)
                elif kind in (b"ANIM", b"ANMF"):
                    raise GatewayError("animated_image_unsupported", 415)
                cursor = end + (size & 1)
            if frame is None or (canvas is not None and canvas != frame):
                raise ValueError()
            return frame
        raise ValueError()
    except GatewayError:
        raise
    except (ValueError, IndexError, struct.error):
        raise GatewayError("invalid_image") from None


def inspect_image(body, content_type):
    if content_type not in FORMATS:
        raise GatewayError("unsupported_media_type", 415)
    if not 0 < len(body) <= MAX_IMAGE_BYTES:
        raise GatewayError("image_too_large", 413)
    expected = header_dimensions(body, content_type)
    from PIL import Image
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(body), formats=[FORMATS[content_type]]) as image:
                width, height = image.size
                check_dimensions(width, height)
                if (width, height) != expected:
                    raise GatewayError("image_dimensions_mismatch")
                if getattr(image, "n_frames", 1) != 1:
                    raise GatewayError("animated_image_unsupported", 415)
                image.verify()
        return width, height
    except GatewayError:
        raise
    except (Image.DecompressionBombWarning, Image.DecompressionBombError):
        raise GatewayError("image_dimensions_exceeded", 413) from None
    except Exception:
        raise GatewayError("invalid_image") from None

def decode_image(body, content_type):
    width, height = inspect_image(body, content_type)
    import cv2
    import numpy as np
    try:
        image = cv2.imdecode(np.frombuffer(body, np.uint8), cv2.IMREAD_COLOR)
        if image is None or image.ndim != 3 or image.shape[2] != 3:
            raise GatewayError("invalid_image")
        if (image.shape[1], image.shape[0]) not in ((width, height), (height, width)):
            raise GatewayError("image_dimensions_mismatch")
        return image
    except GatewayError:
        raise
    except Exception:
        raise GatewayError("invalid_image") from None
