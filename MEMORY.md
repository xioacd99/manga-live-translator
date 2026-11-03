# Project Memory

This is the public index of reusable development knowledge for Manga Live Translator. Record actual project experience, not speculative bugs or unimplemented results. Developer-tooling experience is recorded below; no manga translation implementation findings or benchmarks exist yet.

## Start here

Before every development task, read [README.md](README.md), this file, and [AGENTS.md](AGENTS.md), in that order. Then read the relevant category indexes and linked records below.

## Knowledge tree

- [Architecture](memory/architecture/README.md)
  - [Decisions](memory/architecture/decisions/README.md): choices, alternatives, and their rationale, including the [first implementation research boundaries](memory/architecture/decisions/initial-plan-research.md).
- [Development](memory/development/README.md)
  - [Pitfalls](memory/development/pitfalls/README.md): observed problems, causes, fixes, and verification.
  - [Practices](memory/development/practices/README.md): techniques that proved useful in actual work.
- [Testing](memory/testing/README.md)
  - [Performance](memory/testing/performance/README.md): reproducible measurements and their limitations.
- [Record template](memory/templates/record.md)

## Maintaining records

- Each development commit must update a real record below memory/ alongside PUBLISH.md. Record verified findings or newly checked applicability and limitations, not filler. Update an existing entry instead of repeating it; do not create filler records.
- Use the template, link the new record from its category index, and keep this index current when categories change.
- Distinguish verified causes from hypotheses. Use open, resolved, or superseded status; update stale entries and link their replacements.
- Keep all records in English. Use Asia/Shanghai dates.
- These files are public. Never include API keys, tokens, passwords, private logs, or users' manga content. Use sanitized examples and public project references.
