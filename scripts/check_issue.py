#!/usr/bin/env python3
"""Validate issue structure without executing or printing reporter content."""
import argparse
import json
import re
from pathlib import Path

SCHEMA_PATH = Path(__file__).resolve().parents[1] / '.github' / 'issue-schema.json'
SCHEMA = json.loads(SCHEMA_PATH.read_text(encoding='utf-8'))
MAX_BODY = 100_000
PLACEHOLDERS = {'n/a', 'na', 'none', 'tbd', 'todo', 'unknown', 'not applicable', 'no response', 'fill in', '...'}


def sections(body):
    """Read level-three headings outside fenced code and HTML comments."""
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
    normalized = value.strip(' \t\r\n_*`#-.:').casefold()
    if not normalized or normalized in PLACEHOLDERS:
        return False
    if re.fullmatch(r'(?:unknown|not applicable|n/a)\s*:\s*', value, flags=re.I):
        return False
    return any(c.isalnum() for c in normalized)


def validate(title, body):
    """Return only fixed diagnostics; actor identity and labels are irrelevant."""
    if not isinstance(title, str) or not isinstance(body, str):
        return ['Title and body must be text.']
    if len(title) > 256 or len(body) > MAX_BODY:
        return ['Title or body exceeds the supported size limit.']
    kind = next((kind for kind in SCHEMA if title.startswith(f'[{kind}] ')), None)
    if kind is None or not meaningful([title[len(kind) + 3:]]):
        return ['Use [Bug] or [Feature] followed by a specific title.']
    parsed = sections(body)
    errors = []
    for heading in SCHEMA[kind]:
        values = parsed.get(heading, [])
        if len(values) != 1:
            errors.append(f'Include exactly one section: {heading}.')
        elif not meaningful(values[0]):
            errors.append(f'Provide an answer, not a placeholder: {heading}.')
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--title-file', type=Path, required=True)
    parser.add_argument('--body-file', type=Path, required=True)
    args = parser.parse_args()
    try:
        errors = validate(args.title_file.read_text(encoding='utf-8').strip(), args.body_file.read_text(encoding='utf-8'))
    except (OSError, UnicodeError):
        errors = ['Could not read UTF-8 input files.']
    print('\n'.join(errors) if errors else 'PASS: issue structure is valid; factual review is still required.')
    return bool(errors)


if __name__ == '__main__':
    raise SystemExit(main())
