#!/usr/bin/env python3
"""Read one current GitHub issue and report structure without external writes."""
import json
import os
import re
import urllib.request
from pathlib import Path
from check_issue import validate


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Redirects are not allowed.')


def issue_target(event, event_name):
    if event_name == 'issues':
        number = event.get('issue', {}).get('number')
    elif event_name == 'workflow_dispatch':
        raw = event.get('inputs', {}).get('issue_number', '')
        if not isinstance(raw, str) or not re.fullmatch(r'[1-9][0-9]{0,9}', raw):
            raise ValueError('Invalid issue number.')
        number = int(raw)
    else:
        raise ValueError('Unsupported event.')
    if type(number) is not int or not 0 < number <= 9_999_999_999:
        raise ValueError('Invalid issue number.')
    return number


def fetch_issue(repository, number, token):
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository):
        raise ValueError('Invalid repository.')
    request = urllib.request.Request(
        f'https://api.github.com/repos/{repository}/issues/{number}',
        headers={'Authorization': f'Bearer {token}', 'Accept': 'application/vnd.github+json',
                 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'manga-issue-structure-check'})
    with urllib.request.build_opener(NoRedirect).open(request, timeout=30) as response:
        data = response.read(1_000_001)
    if len(data) > 1_000_000:
        raise ValueError('Response too large.')
    return json.loads(data)


def audit(event, event_name, repository, token, fetcher=fetch_issue):
    number = issue_target(event, event_name)
    issue = fetcher(repository, number, token)
    if 'pull_request' in issue:
        return ['Pull requests are outside the issue-checking scope.']
    if issue.get('number') != number:
        raise ValueError('Unexpected issue response.')
    return validate(issue.get('title'), issue.get('body') or '')


def main():
    try:
        event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text(encoding='utf-8'))
        errors = audit(event, os.environ['GITHUB_EVENT_NAME'], os.environ['GITHUB_REPOSITORY'], os.environ['GH_TOKEN'])
    except Exception:
        # Exceptions may contain URLs or service data; do not echo them or reporter text.
        errors = ['Could not audit the current issue. Check workflow permissions and API availability, then rerun.']
    report = '## Issue structure check\n\n' + ('\n'.join('- ' + e for e in errors) if errors else 'PASS: required issue structure is present.')
    report += '\n\nThis is a read-only format check, not verification of factual accuracy. See docs/ISSUES.md.\n'
    print(report)
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a', encoding='utf-8') as output:
            output.write(report)
    return bool(errors)


if __name__ == '__main__':
    raise SystemExit(main())
