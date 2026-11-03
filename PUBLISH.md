# Update History

This file records completed changes under date-version headings (`YYYY-MM-DD - vX.Y.Z`), with bullet points directly beneath each heading. Dates use Asia/Shanghai.

Each entry describes the changes made, with additions, improvements, fixes, compatibility changes, and upgrade notes where relevant. Planned features are not listed as completed changes.

## 2026-11-03 - v0.0.0

- Created dev from main at 0cbb377b69a844299b0e8926a06282cc2a73d494 and documented development on dev, testing before merge, and main as the release branch. This workflow update is committed on dev only; it does not merge into main or publish a release.
- Added a development record documenting branch separation, verification steps, and the need for explicit merge/release authorization.

- English bug and feature Issue Forms, API body examples, and a shared issue guide applying equally to people, maintainers, dot, and other bots.
- Dependency-free issue-structure validator with offline tests and a read-only opened/edited/reopened/manual audit workflow; reports results without commenting, labeling, closing, or modifying issues.
- Documented API/form bypass limits, GITHUB_TOKEN event suppression, factual-review obligations, and safe treatment of untrusted issue content. These are contribution-tooling changes, not a translation implementation or software release.

- Initial README documenting the project goals: high-performance, low-latency online manga translation and natural, context-aware LLM translation.
- Early-stage status notice distinguishing goals from implemented features and measured performance.
- Contribution invitation welcoming issues and pull requests.
- MIT License allowing modification, distribution, and commercial use subject to its terms.
- This update history, linked from the README, using date-version section headings and direct bullet points.
- Agent development guidelines covering project goals, evidence-based performance claims, licensing, contributions, and documentation updates.
- English-only project documentation, code comments, and docstrings are required by the development guidelines; manga and translation languages remain unrestricted.
- Root MEMORY.md index and a multi-level memory/ knowledge tree for architecture decisions, development pitfalls and practices, and performance testing.
- Reusable record template covering evidence, cause, fix, verification, applicability, references, status, and update date; category indexes explicitly state that no implementation lessons exist yet.
- Required reading order of README.md, MEMORY.md, and AGENTS.md before development, followed by task-relevant records; guidelines for maintaining useful, current, public-safe project knowledge.
- Versioned commit, merge, and push hooks requiring PUBLISH.md and real memory/ record content updates, with a fixed pre-policy history baseline and fail-closed remote-history inspection.
- Python standard-library validator, 21 isolated integration tests, explicit per-clone installation instructions, and a verified development record documenting behavior and limitations.
- Project initialization: v0.0.0 covers documentation and developer tooling only. No manga translation application release or Git tag has been published, and no application upgrade procedure exists yet.
