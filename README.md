# Manga Live Translator

High-performance, low-latency online manga translation with natural, context-aware LLM translations.

## Status

An unreleased dev-branch preview now implements local English OCR, opt-in LLM text translation, reversible browser overlays, and bounded layered caches. The goals below are not measured performance or quality claims. See the [build, usage, verification and limitations guide](docs/development/preview.md).

## Goals

- **High performance and low latency:** minimize the wait between opening a manga page and reading its translation.
- **Natural LLM translation:** use large language models to produce fluent dialogue that respects context.
- **Online reading:** make automatic translation convenient for reading manga in the browser.

## First implementation plan

Read the [first requirements and implementation plan](docs/plans/v0.1/README.md) for the proposed MVP, architecture, cache design, research sources, evaluation gates, and decisions awaiting review. The plan remains the requirements baseline; the preview guide distinguishes implemented scope from outstanding acceptance gates.

## Contributing

Issues and pull requests are welcome! Share ideas, report problems, or contribute improvements. Read the [issue guide](docs/ISSUES.md) and use the bug or feature form. People, maintainers, dot, and other bots follow the same format.

## Branch workflow

Development happens on dev. Run the applicable tests on the final changes, then merge tested work into main for release. Run `npm test`, `npm run test:tooling`, `npm run build` and the synthetic browser smoke as described in the preview guide. Changes on dev are not automatically released; merging or publishing remains an explicit step. See [AGENTS.md](AGENTS.md) for the development workflow.

## Development knowledge

Before development, read this README, [MEMORY.md](MEMORY.md), and [AGENTS.md](AGENTS.md), in that order. MEMORY.md indexes the project's development lessons, pitfalls, decisions, and testing experience.

## Commit and push checks

Each development commit must update PUBLISH.md and a real memory/ record. Versioned commit, merge, and push hooks check this requirement. They are not enabled automatically by cloning. See [installation, behavior, and tests](docs/change-record-hooks.md); opt in per clone with `git config --local core.hooksPath .githooks` after reviewing any existing hooks.

## Update history

See [PUBLISH.md](PUBLISH.md) for changes to the project. Released updates will be recorded by version and date, including additions, improvements, fixes, compatibility changes, and upgrade notes where relevant.

## License

Licensed under the [MIT License](LICENSE). You may use, modify, distribute, and use this software commercially, provided you retain the copyright and permission notices. See LICENSE for the full terms, including the warranty disclaimer.
