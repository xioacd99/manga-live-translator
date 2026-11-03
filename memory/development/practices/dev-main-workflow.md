# Developing on dev Before Releasing from main

- Status: resolved
- Updated: 2026-11-03 (Asia/Shanghai)
- Scope and environment: branch workflow for this repository; documentation change, not a manga translation feature.
- Context: use dev for routine development and merge tested changes into main for release.
- Evidence: dev was created from the verified main commit [0cbb377](https://github.com/xioacd99/manga-live-translator/commit/0cbb377b69a844299b0e8926a06282cc2a73d494), preserving the existing hooks and issue standards.
- Decision: keep this workflow documentation update on dev. Require tests on the final development changes and explicit authorization for a later main merge or release.
- Verification: the complete current tooling suite, `python3 -m unittest discover -s tests -v`, passed 42 tests in an isolated workspace. Relative documentation links were checked. No application benchmarks were run.
- Applicability: inspect the active branch and latest remote tips before work. Recheck divergence and affected tests before an authorized merge; do not assume dev and main still match.
- Limitations: branch conventions are instructions, not branch protection. Creating dev does not alter the default branch, permissions, or protections, and does not activate hooks in a local clone. A development history entry is not a published release.
- References: [development guidelines](../../../AGENTS.md), [project overview](../../../README.md), [change-record hooks](../../../docs/change-record-hooks.md).
- Superseded by: not applicable.
