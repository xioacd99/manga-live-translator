"""固定局部坐标扩边，边界裁切；不接触文本或GT。"""
import numpy as np


def expanded_quad(points, image_shape, width_scale, height_scale):
    height, width = image_shape[:2]
    if height < 2 or width < 2:
        raise ValueError('图像宽高须至少2像素')
    original = np.asarray(points, dtype=np.float32)
    if original.shape != (4, 2) or not np.isfinite(original).all():
        raise ValueError('四边形须为有限4×2坐标')
    center = original.mean(axis=0)
    horizontal = ((original[1] - original[0]) + (original[2] - original[3])) / 4
    vertical = ((original[3] - original[0]) + (original[2] - original[1])) / 4
    horizontal *= width_scale
    vertical *= height_scale
    expanded = np.array([
        center - horizontal - vertical,
        center + horizontal - vertical,
        center + horizontal + vertical,
        center - horizontal + vertical,
    ], dtype=np.float32)
    bounded = expanded.copy()
    bounded[:, 0] = np.clip(bounded[:, 0], 0, width - 1)
    bounded[:, 1] = np.clip(bounded[:, 1], 0, height - 1)
    edges = [np.linalg.norm(bounded[(i + 1) % 4] - bounded[i]) for i in range(4)]
    fallback = min(edges) < 1
    if fallback:
        bounded = original.copy()
        bounded[:, 0] = np.clip(bounded[:, 0], 0, width - 1)
        bounded[:, 1] = np.clip(bounded[:, 1], 0, height - 1)
        if min(np.linalg.norm(bounded[(i + 1) % 4] - bounded[i]) for i in range(4)) < 1:
            raise ValueError('扩边及原始四边形均退化，拒绝静默制造裁剪')
    return bounded, {'clamped': bool(np.any(expanded != bounded)), 'fallback_original': bool(fallback)}
