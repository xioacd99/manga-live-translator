#!/usr/bin/env python3
"""校验 issue 结构，不执行或输出报告者提供的内容。"""
import argparse
import json
import re
from pathlib import Path

SCHEMA_PATH = Path(__file__).resolve().parents[1] / '.github' / 'issue-schema.json'
SCHEMA = json.loads(SCHEMA_PATH.read_text(encoding='utf-8'))
MAX_BODY = 100_000
PLACEHOLDERS = {'n/a', 'na', 'none', 'tbd', 'todo', 'unknown', 'not applicable', 'no response', 'fill in', '...', '无', '暂无', '待定', '待补充', '待填写', '未知', '不适用', '无回复', '请填写', '略', '省略', '没有', '未提供'}


def sections(body):
    """读取代码围栏和 HTML 注释之外的三级标题。"""
    body = re.sub(r'<!--.*?(?:-->|\Z)', '', body, flags=re.S)
    result, current, fence = {}, None, None
    for line in body.replace('\r\n', '\n').splitlines():
        match = re.match(r'^ {0,3}(`{3,}|~{3,})(.*)$', line)
        if match:
            marks, rest = match.groups()
            if fence is None:
                fence = (marks[0], len(marks))
            elif marks[0] == fence[0] and len(marks) >= fence[1] and not rest.strip():
                fence = None
            if current is not None:
                result[current][-1].append(line)
            continue
        heading = re.match(r'^### ([^\n]+?)\s*#*\s*$', line) if fence is None else None
        if heading:
            current = heading.group(1).strip()
            result.setdefault(current, []).append([])
        elif current is not None:
            result[current][-1].append(line)
    return result


def meaningful(lines):
    value = '\n'.join(line for line in lines if not re.match(r'^\s*(`{3,}|~{3,})', line))
    value = re.sub(r'<[^>]*>', '', value).strip()
    normalized = value.strip(' \t\r\n_*`#-.:：。…').casefold()
    if not normalized or normalized in PLACEHOLDERS:
        return False
    if re.fullmatch(r'(?:unknown|not applicable|n/a)\s*:\s*', value, flags=re.I):
        return False
    return any(c.isalnum() for c in normalized)


def validate(title, body):
    """只返回固定诊断；提交者身份与标签不影响校验。"""
    if not isinstance(title, str) or not isinstance(body, str):
        return ['标题和正文必须是文本。']
    if len(title) > 256 or len(body) > MAX_BODY:
        return ['标题或正文超出支持的长度限制。']
    prefixes = {prefix: kind for kind, spec in SCHEMA.items()
                for prefix in (kind, spec['title'])}
    prefix = next((p for p in prefixes if title.startswith(f'[{p}] ')), None)
    if prefix is None or not meaningful([title[len(prefix) + 3:]]):
        return ['请使用 [缺陷] 或 [功能] 加具体标题（兼容 [Bug] 和 [Feature]）。']
    parsed = sections(body)
    errors = []
    for heading, historical in SCHEMA[prefixes[prefix]]['sections'].items():
        # 同一语义的小节只能出现一次，不能通过中英标题并列绕过重复校验。
        values = parsed.get(heading, []) + parsed.get(historical, [])
        if len(values) != 1:
            errors.append(f'请提供且仅提供一个小节：{heading}。')
        elif not meaningful(values[0]):
            errors.append(f'请填写实际内容，而非占位符：{heading}。')
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--title-file', type=Path, required=True)
    parser.add_argument('--body-file', type=Path, required=True)
    args = parser.parse_args()
    try:
        errors = validate(args.title_file.read_text(encoding='utf-8').strip(), args.body_file.read_text(encoding='utf-8'))
    except (OSError, UnicodeError):
        errors = ['无法读取 UTF-8 输入文件。']
    print('\n'.join(errors) if errors else '通过：issue 结构有效；仍须核查事实。')
    return bool(errors)


if __name__ == '__main__':
    raise SystemExit(main())
