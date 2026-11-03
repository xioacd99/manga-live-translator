# Issue guide

Issues and pull requests are welcome. Use English for the issue title and explanation so the project can maintain consistent documentation. Manga samples and translation examples may use the languages necessary to demonstrate the problem.

These requirements apply equally to maintainers, contributors, API clients, dot, and other bots. AI assistance is welcome. The submitter is responsible for an accurate, specific report; AI-generated claims are not evidence.

## Before submitting

1. Search open and closed issues for the same problem or request. Record the search terms and outcome. Add genuinely new evidence to an existing issue rather than creating a duplicate.
2. Read the README's current project status. Planned behavior is not an implemented feature. This project may have no application release; do not invent a version or claim to have tested software that does not exist.
3. Report one problem or request per issue. Use `[Bug] <specific problem>` or `[Feature] <specific outcome>` as the title.
4. Remove credentials, personal information, private logs, and private manga content. Prefer synthetic examples or material you are permitted to share publicly. Do not publish vulnerability details, credentials, or exploit instructions in an ordinary issue.

## Bug reports

Use the Bug report form, including for errors in documentation. Include the following section headings and meaningful answers:

- Existing issue search
- Summary
- Revision or project state
- Environment
- Steps to reproduce
- Expected behavior
- Actual behavior

Use a real commit SHA, an actual released version, or a branch with an observation date. For documentation-only reports, identify the file and section; runtime environment details can be explained as inapplicable. If something is unknown, state what is unknown and why. Bare placeholders such as `N/A`, `TBD`, or `_No response_` are not answers. An honest explanation of a limitation is better than invented evidence.

Number the reproduction steps. For intermittent failures, report frequency and attempted checks. Include relevant OS/browser versions, setup, source and target languages, and provider/model names only where useful. Additional sanitized evidence is optional; do not upload unrelated files or full raw logs.

## Feature requests

Use the Feature request form and include:

- Existing issue search
- Summary
- Problem and use case
- Proposed behavior
- Acceptance criteria
- Alternatives considered

Explain the need, desired outcome, and observable conditions for completion. Do not present a proposal as completed work. State when no alternative has been found and why. A runtime version is not required for a proposal.

## API and bot submissions

The GitHub forms are a convenient editor, not a server-side API schema. API-created issues and later edits must preserve the same title convention and Markdown section headings. Start from [the bug body](bug-issue-body.md) or [the feature body](feature-issue-body.md), replace the instructional comments with accurate answers, and remove unused optional guidance.

Before submitting or changing an issue, dot and other agents must read this guide, search for duplicates, verify available facts, and validate the final title/body against the repository's shared issue checker. If required facts cannot be obtained, ask the requester or describe the specific unknown and why it cannot yet be verified. Never invent reproduction results or claim a search occurred when it did not.

Passing a format check means only that the report has the expected structure, not that its claims are true, safe, accepted, or reproducible. A maintainer still evaluates its substance.

## Reference

This guide uses the general reporting practices of [OpenAI Codex's issue guidance](https://github.com/openai/codex/blob/7e8143a8970394e38830ff7b30143da539bd0a18/docs/contributing.md) as a reference. The wording and forms here were written for this project; Codex's contribution restrictions do not apply here. This project remains MIT-licensed and welcomes pull requests.

## Local validation and read-only automation

Python 3.9 or newer is sufficient; the checker has no third-party dependencies. Save the final title and Markdown body in UTF-8 files, then run:

```sh
python3 scripts/check_issue.py --title-file TITLE.txt --body-file BODY.md
python3 -m unittest discover -s tests -v
```

The same checker runs for newly opened, edited, and reopened issues. It fetches the latest issue data and reports missing or empty fields in the Actions run result and summary. It never comments, adds labels, contacts submitters, closes issues, or edits their content. Maintainers can run the `Issue standards` workflow manually with one issue number for a read-only audit. Its token has only `contents: read` and `issues: read` permissions; no added secret is needed.

The canonical required headings are in `.github/issue-schema.json`; tests keep them aligned with the forms and API examples. The checker ignores headings in fenced logs and hidden instructional comments. It checks structure only: it cannot verify truth, English quality, whether a duplicate search really happened, or whether reproduction steps are sufficient. The agent must review those facts before submitting.

GitHub cannot enforce these form fields across every API client or later edit. Disabling the blank option only affects the chooser. Workflow checks happen after creation and depend on Actions being available. In particular, issue events created with a workflow's `GITHUB_TOKEN` do not start another issue workflow. Controlled bot callers must run the shared checker before sending; a maintainer may use the read-only manual audit to inspect an event that was not triggered. No account, including dot or a maintainer, is exempt from the written requirements.

Platform references: [issue forms](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms), [issue REST API](https://docs.github.com/en/rest/issues/issues#create-an-issue), and [GITHUB_TOKEN event behavior](https://docs.github.com/en/actions/concepts/security/github_token).
