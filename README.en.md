<div align="center">

# Manga Live Translator

Manga translation for online reading, aiming for low latency and natural, context-aware LLM translations.

[简体中文](README.md) | English

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

</div>

## Current status

Unreleased `dev` preview: a Chrome extension calls an authenticated Python service on 127.0.0.1. Full-page PP-OCRv6 medium1536 and the report's FP32 RT-DETR run locally. Optional DeepSeek/OpenAI translation sends ordered text only after explicit consent. See [setup](services/local-ocr/README.md) and the [eight algorithm modules](README.md#八个算法模块) in the canonical Chinese README.

After one-time installation of the Native Messaging host and explicit permission, managed mode starts the local service on Enable and releases it when the last normal browser window closes or the browser exits. Separate browser connections use separate ports and tokens. Manual services remain user-managed. The installer supports macOS/Linux; Windows uses manual mode. See [lifecycle boundaries](docs/development/native-lifecycle.md). Translation API keys remain session-only.

Modules: (1) text detection/OCR, (2) bubble detection, (3) grouping/reading order, (4) context/text translation, (5) exact layered caching, (6) small-window prefetch, (7) conservative solid-color cleanup, (8) measured adaptive typesetting. Complex backgrounds and insufficient space keep the original image and use full-text cards. No Magpie integration, image upload to providers, automatic paid retries, or production/M4 quality claim.

The former Tesseract/WASM browser tests are historical. New browser smoke uses a real browser with synthetic loopback HTTP and mocked text-provider responses, not real-model quality evidence. See [current validation and limits](docs/development/native-pipeline.md).

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

Prefetch is disabled by default and bounded to loaded visible/nearby images. Local preparation and remote text translation require separate permissions and budgets. Python model downloads are explicit and SHA-256-verified; four assets total about293.6MiB. [Current preview guide](docs/development/preview.md).
