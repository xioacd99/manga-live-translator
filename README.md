# Manga Live Translator

High-performance, low-latency online manga translation with natural, context-aware LLM translations.

## Status

This project is at an early stage. The points below describe our goals, not implemented features or measured performance results.

## Goals

- **High performance and low latency:** minimize the wait between opening a manga page and reading its translation.
- **Natural LLM translation:** use large language models to produce fluent dialogue that respects context.
- **Online reading:** make automatic translation convenient for reading manga in the browser.

## Contributing

Issues and pull requests are welcome! Share ideas, report problems, or contribute improvements. Read the [issue guide](docs/ISSUES.md) and use the bug or feature form. People, maintainers, dot, and other bots follow the same format.

## Development knowledge

Before development, read this README, [MEMORY.md](MEMORY.md), and [AGENTS.md](AGENTS.md), in that order. MEMORY.md indexes the project's development lessons, pitfalls, decisions, and testing experience.

## Commit and push checks

Each development commit must update PUBLISH.md and a real memory/ record. Versioned commit, merge, and push hooks check this requirement. They are not enabled automatically by cloning. See [installation, behavior, and tests](docs/change-record-hooks.md); opt in per clone with `git config --local core.hooksPath .githooks` after reviewing any existing hooks.

## Update history

See [PUBLISH.md](PUBLISH.md) for changes to the project. Released updates will be recorded by version and date, including additions, improvements, fixes, compatibility changes, and upgrade notes where relevant.

## License

Licensed under the [MIT License](LICENSE). You may use, modify, distribute, and use this software commercially, provided you retain the copyright and permission notices. See LICENSE for the full terms, including the warranty disclaimer.
