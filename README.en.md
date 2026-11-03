<div align="center">

# Manga Live Translator

Manga translation for online reading, aiming for low latency and natural, context-aware LLM translations.

[简体中文](README.md) | English

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

</div>

## Current status

The unreleased preview on the `dev` branch implements local English OCR, opt-in LLM text translation, a reversible browser translation overlay, and capacity-limited layered caches. The goals below are not measured performance or quality claims. See the [development preview guide](docs/development/preview.md) for build and usage instructions, verification, and limitations.

A [synthetic browser integration test](https://github.com/xioacd99/manga-live-translator/actions/runs/41581846987) passed with real packaged OCR and mocked image acquisition and model-service boundaries. Real website compatibility and translation quality remain to be validated.

## Project goals

- **High performance and low latency:** Reduce the wait between opening a manga page and reading a translation.
- **Natural LLM translations:** Produce fluent dialogue that preserves context using large language models.
- **Online reading:** Make automatic manga translation in the browser more convenient.

## Initial implementation plan

The [initial requirements and implementation plan](docs/plans/v0.1/README.md) covers the proposed MVP, architecture, cache design, research sources, acceptance gates, and decisions awaiting review. The plan remains the requirements baseline; the preview guide distinguishes implemented scope from outstanding acceptance work.

## Contributions welcome

Issues and Pull Requests are welcome for ideas, bug reports, and improvements. Please read the [issue guide](docs/ISSUES.md) and use the bug report or feature request form. Contributors, maintainers, dot, and other bots follow the same format.

## Development language

Development communication, new or modified project documentation, code comments, docstrings, and Issues default to Chinese. This replaces the previous English-only convention. Historical English research, plans, and license-source records remain available as needed; this does not mean the entire project has been translated into Chinese. Identifiers, APIs, commands, and third-party originals are preserved. An English README is provided separately; other historical documents remain in their existing languages until translated.

## Branch workflow

Development takes place on `dev`. Run the applicable tests against the final changes, and merge verified work into `main` for release only after explicit authorization. Follow the preview guide to run `npm test`, `npm run test:tooling`, `npm run build`, and the synthetic browser smoke test. Changes on `dev` do not automatically constitute a release; merging or releasing requires separate explicit authorization. See [AGENTS.md](AGENTS.md) for the full workflow.

## Development knowledge

Before development, read this README, [MEMORY.md](MEMORY.md), and [AGENTS.md](AGENTS.md), in that order. MEMORY.md indexes project experience, pitfalls, decisions, and testing lessons.

## Commit and push checks

Every development commit must update both PUBLISH.md and an actual experience record under `memory/`. Versioned commit, merge, and push hooks check this requirement, but cloning does not enable them automatically. See the [hook guide](docs/change-record-hooks.md) for installation, behavior, and tests. After checking for existing hooks, enable them in each clone with `git config --local core.hooksPath .githooks`.

## Change history

See [PUBLISH.md](PUBLISH.md) for project changes. Updates are recorded by version and date, describing additions, improvements, fixes, compatibility changes, and upgrade notes where applicable.

## License

The project uses the [MIT License](LICENSE). You may use, modify, distribute, and commercially use the software subject to retaining the copyright and license notices. See LICENSE for the full terms and disclaimer; the license text remains unchanged.

## Experimental page preparation

See the [Chinese Issue #2 implementation guide](docs/development/issue-2.md) for conservative region OCR and bounded, opt-in page preparation. Prefetch is disabled by default. The heuristic detector is not a trained segmentation model; real-comic quality and M4 performance remain unverified.
