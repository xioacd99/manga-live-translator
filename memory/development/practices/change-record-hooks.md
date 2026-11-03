# Checking Change Records at Commit and Push

- Status: resolved
- Updated: 2026-11-03 (Asia/Shanghai)
- Scope and environment: repository-local Git hooks; validated with Git 2.52.0 and Python 3.12.14 on Linux using isolated repositories and local bare remotes.
- Context: require each development commit to update PUBLISH.md and a real project-memory record without generating meaningless prose automatically.
- Evidence: the integration suite exercises staged-only changes, missing records, whitespace-only edits, renames, deletions, symlinks, executable-mode changes, paths with spaces, first and incremental pushes, multiple refs, root commits, merges, force pushes, tags, remote failures, and incomplete history.
- Verified cause of the design risks: checking only HEAD or the final pushed tree misses earlier commits and other outgoing refs. Rechecking all reachable history would incorrectly reject published initialization commits. A bare filename check accepts index/template-only edits without a development record.
- Decision: inspect staged blobs for commit checks; inspect each newly introduced commit from pre-push input against its first parent. Exclude currently advertised remote ancestry and the fixed pre-policy baseline. Fail closed when ancestry cannot be inspected reliably.
- Verification: `python3 -m unittest discover -s tests -v` passed all 21 tests during implementation. Shell syntax checks and Python compilation also passed. No translation performance benchmarks were run or claimed.
- Applicability: hooks must be enabled explicitly per clone. The pre-commit amend check uses current HEAD, while pre-push checks the resulting commit's parent. Missing objects require a deliberate fetch; shallow and partial clones are unsupported.
- Limitations: structural checks cannot prove that a note is accurate. Local hooks are bypassable and do not enforce GitHub/API writes. Remote snapshots can race with concurrent updates. Only Linux was tested.
- References: [hook behavior and installation](../../../docs/change-record-hooks.md), [validator](../../../scripts/check_change_records.py), [integration tests](../../../tests/test_change_records.py).
- Superseded by: not applicable.
