#!/usr/bin/env python3
"""读取一条 GitHub issue 的最新内容并检查结构，不执行外部写入。"""
import json
import os
import re
import urllib.request
from pathlib import Path
from check_issue import validate


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('不允许重定向。')


def issue_target(event, event_name):
    if event_name == 'issues':
        number = event.get('issue', {}).get('number')
    elif event_name == 'workflow_dispatch':
        raw = event.get('inputs', {}).get('issue_number', '')
        if not isinstance(raw, str) or not re.fullmatch(r'[1-9][0-9]{0,9}', raw):
            raise ValueError('issue 编号无效。')
        number = int(raw)
    else:
        raise ValueError('不支持此事件。')
    if type(number) is not int or not 0 < number <= 9_999_999_999:
        raise ValueError('issue 编号无效。')
    return number


def fetch_issue(repository, number, token):
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository):
        raise ValueError('仓库标识无效。')
    request = urllib.request.Request(
        f'https://api.github.com/repos/{repository}/issues/{number}',
        headers={'Authorization': f'Bearer {token}', 'Accept': 'application/vnd.github+json',
                 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'manga-issue-structure-check'})
    with urllib.request.build_opener(NoRedirect).open(request, timeout=30) as response:
        data = response.read(1_000_001)
    if len(data) > 1_000_000:
        raise ValueError('响应过大。')
    return json.loads(data)


def audit(event, event_name, repository, token, fetcher=fetch_issue):
    number = issue_target(event, event_name)
    issue = fetcher(repository, number, token)
    if 'pull_request' in issue:
        return ['拉取请求不属于 issue 检查范围。']
    if issue.get('number') != number:
        raise ValueError('issue 响应与请求不符。')
    return validate(issue.get('title'), issue.get('body') or '')


def main():
    try:
        event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text(encoding='utf-8'))
        errors = audit(event, os.environ['GITHUB_EVENT_NAME'], os.environ['GITHUB_REPOSITORY'], os.environ['GH_TOKEN'])
    except Exception:
        # 异常可能包含 URL 或服务数据；不要回显异常或报告者的文本。
        errors = ['无法检查当前 issue。请检查工作流权限和 API 可用性后重试。']
    report = '## Issue 结构检查\n\n' + ('\n'.join('- ' + e for e in errors) if errors else '通过：issue 包含必填结构。')
    report += '\n\n这是只读格式检查，不代表事实已获验证。详见 docs/ISSUES.md。\n'
    print(report)
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a', encoding='utf-8') as output:
            output.write(report)
    return bool(errors)


if __name__ == '__main__':
    raise SystemExit(main())
