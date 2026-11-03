"""独立实现的严格 Spotting 格式解析器，不执行上游远程代码。
每组八个 LOC 值表示四个角点，各轴归一化为 0–1000。
支持文本后直接附坐标，以及 TEXT/LOC 包装标记两种格式。
保留冻结函数的计算语义；仅中文说明和移除旧测试入口，详见来源记录。
"""
import json, re, sys
from pathlib import Path
LOC = '<\\|LOC_(\\d+)\\|>'
GROUP = '((?:<\\|LOC_\\d+\\|>\\s*){8})'

def parse_spotting(text, width, height):
    if width <= 0 or height <= 0:
        raise ValueError('Invalid image dimensions')
    text = text.replace('</s>', '').strip()
    if '<|TEXT_START|>' in text:
        pattern = '<\\|TEXT_START\\|>(.*?)<\\|TEXT_END\\|>\\s*<\\|LOC_BEGIN\\|>\\s*' + GROUP + '<\\|LOC_END\\|>'
    else:
        pattern = '(.*?)' + GROUP
    output = []
    cursor = 0
    for m in re.finditer(pattern, text, re.S):
        if text[cursor:m.start()].strip():
            raise ValueError('Unparsed content before region')
        body = m.group(1).strip()
        coords = [int(x) for x in re.findall(LOC, m.group(2))]
        if not body or len(coords) != 8 or any((x < 0 or x > 1000 for x in coords)):
            raise ValueError('Invalid text/coordinates')
        if '<|' in body or '|>' in body:
            raise ValueError('Unexpected special token in body')
        points = [[coords[i] * width / 1000, coords[i + 1] * height / 1000] for i in range(0, 8, 2)]
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        if max(xs) <= min(xs) or max(ys) <= min(ys):
            raise ValueError('Degenerate region')
        output.append({'text': body, 'normalized_coordinates': coords, 'polygon': points, 'bbox': [min(xs), min(ys), max(xs), max(ys)]})
        cursor = m.end()
    if not output or text[cursor:].strip():
        raise ValueError('Missing coordinates or incomplete/trailing output')
    return output
