"""Offline checks for public issue forms, the shared parser, and read-only audit."""
import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import check_issue
import audit_issue


def body(kind='Feature', value='A concrete observed or proposed behavior.'):
    return '\n\n'.join('### ' + h + '\n\n' + value for h in check_issue.SCHEMA[kind])


class IssueStandardsTests(unittest.TestCase):
    def test_valid_forms(self):
        for kind in check_issue.SCHEMA:
            self.assertEqual([], check_issue.validate(f'[{kind}] Describe useful behavior', body(kind)))

    def test_no_body(self):
        self.assertTrue(check_issue.validate('[Bug] A problem', ''))

    def test_title(self):
        for title in ('', '[Bug] ', '[Feature] TBD', 'A request', '[Other] A request'):
            self.assertTrue(check_issue.validate(title, body()))

    def test_nontext_and_limits(self):
        for title, text in ((None, body()), ('[Bug] A bug', None), ('[Bug] A bug', 'x'*100001)):
            self.assertTrue(check_issue.validate(title, text))

    def test_placeholders(self):
        for value in ('N/A', '_No response_', 'TBD', 'Unknown', '<!-- fill me -->', '```text\n\n```', '---', 'Unknown:'):
            self.assertTrue(check_issue.validate('[Feature] Useful change', body(value=value)), value)

    def test_honest_unknown(self):
        self.assertEqual([], check_issue.validate('[Feature] Useful change', body(value='Unknown: no provider has been selected yet.')))

    def test_crlf_and_optional_omitted(self):
        self.assertEqual([], check_issue.validate('[Feature] Useful change', body().replace('\n','\r\n')))

    def test_duplicate_heading(self):
        self.assertTrue(check_issue.validate('[Feature] Useful change', body()+'\n### Summary\nAnother summary'))

    def test_fenced_headings(self):
        text=body()+'\n```log\n### Summary\nnot a new field\n```\n'
        self.assertEqual([], check_issue.validate('[Feature] Useful change', text))
        text=body()+'\n~~~~text\n### Summary\n~~~\n### Summary\n~~~~\n'
        self.assertEqual([], check_issue.validate('[Feature] Useful change', text))

    def test_hidden_headings(self):
        self.assertTrue(check_issue.validate('[Feature] Useful change', '<!--\n'+body()+'\n-->'))
        self.assertEqual([], check_issue.validate('[Feature] Useful change', body()+'\n<!--\n### Summary\n-->'))

    def test_nested_headings(self):
        self.assertEqual([], check_issue.validate('[Feature] Useful change', body()+'\n#### Additional detail\nMore detail'))

    def test_content_is_data(self):
        text=body(value='$(touch /tmp/issue-injection)\n${{ secrets.TOKEN }}\n"; process.exit(1); //')
        self.assertEqual([], check_issue.validate('[Feature] Useful change', text))
        self.assertNotIn('touch', '\n'.join(check_issue.validate('bad', text)))

    def test_form_and_examples_match_schema(self):
        for kind, filename in [('Bug','01-bug.yml'), ('Feature','02-feature.yml')]:
            form=(ROOT/'.github/ISSUE_TEMPLATE'/filename).read_text()
            example=(ROOT/'docs'/f'{kind.lower()}-issue-body.md').read_text()
            for heading in check_issue.SCHEMA[kind]:
                self.assertEqual(1, form.count('label: '+heading+'\n'))
                self.assertEqual(1, example.count('### '+heading+'\n'))
            self.assertEqual(len(check_issue.SCHEMA[kind]), form.count('required: true'))

    def test_actor_and_labels_do_not_exempt(self):
        for login in ('owner', 'dot[bot]', 'other'):
            event={'issue':{'number':1,'body':body(),'user':{'login':login},'labels':['approved']}}
            errors=audit_issue.audit(event,'issues','owner/repo','token',lambda *args:{'number':1,'title':'bad','body':''})
            self.assertTrue(errors)

    def test_fresh_api_state(self):
        event={'issue':{'number':1,'title':'bad','body':''}}
        result=audit_issue.audit(event,'issues','owner/repo','token',lambda *args:{'number':1,'title':'[Feature] Useful change','body':body()})
        self.assertEqual([],result)

    def test_dispatch_number_validation(self):
        for raw in ('1; echo nope','../1','0','-1','1\n',True,1):
            with self.assertRaises(ValueError):
                audit_issue.issue_target({'inputs':{'issue_number':raw}},'workflow_dispatch')
        self.assertEqual(1,audit_issue.issue_target({'inputs':{'issue_number':'1'}},'workflow_dispatch'))
        with self.assertRaises(ValueError):
            audit_issue.issue_target({'issue':{'number':True}},'issues')

    def test_pr_excluded(self):
        errors=audit_issue.audit({'issue':{'number':1}},'issues','owner/repo','token',lambda *args:{'pull_request':{}})
        self.assertTrue(errors)

    def test_bad_repository_and_redirect(self):
        with self.assertRaises(ValueError):
            audit_issue.fetch_issue('bad/repo/../../','1','token')
        with self.assertRaises(ValueError):
            audit_issue.NoRedirect().redirect_request(None,None,302,'',{},'https://example.com')

    def test_cli_pass_and_fail(self):
        with tempfile.TemporaryDirectory() as d:
            title, text=Path(d)/'title',Path(d)/'body'
            title.write_text('[Feature] Useful change'); text.write_text(body())
            args=[sys.executable,str(ROOT/'scripts/check_issue.py'),'--title-file',str(title),'--body-file',str(text)]
            self.assertEqual(0,subprocess.run(args,capture_output=True).returncode)
            text.write_text('missing')
            self.assertEqual(1,subprocess.run(args,capture_output=True).returncode)

    def test_audit_errors_do_not_echo_data(self):
        with patch.dict(os.environ,{'GITHUB_EVENT_PATH':'/missing'}), contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertTrue(audit_issue.main())
        self.assertNotIn('/missing',output.getvalue())

    def test_workflow_read_only(self):
        text=(ROOT/'.github/workflows/issue-standards.yml').read_text()
        for forbidden in ('issues: write','contents: write','pull_request_target','github.event.issue.body','github.event.issue.title','schedule:'):
            self.assertNotIn(forbidden,text)
        self.assertIn('persist-credentials: false',text)
        self.assertIn('issues: read',text)


if __name__=='__main__':
    unittest.main()
