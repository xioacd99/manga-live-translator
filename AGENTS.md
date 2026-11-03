# Development Guidelines

## Project direction

- Build an online manga translation experience focused on high performance and low latency.
- Use LLMs to improve translation fluency and preserve dialogue context.
- Keep goals and planned features clearly separate from implemented behavior. The project is currently at an early stage.
- Support performance claims with reproducible tests. State the test conditions and limitations; never invent benchmark results or publish untested performance numbers.

## Language

- Write all project documentation in English, including README.md, PUBLISH.md, AGENTS.md, and development guides.
- Write code comments and docstrings in English.
- This convention does not restrict manga input languages, translation target languages, or non-English content required by test data and fixtures.

## License and contributions

- Keep the project under the MIT License, allowing modification, distribution, and commercial use under its terms. Preserve the required copyright and permission notices.
- Welcome issues and pull requests. Keep that invitation visible in the README.
- Check dependency and third-party code licenses before incorporating them, and preserve required notices. Do not import GPL-licensed code and present it as MIT-licensed code. Resolve any licensing incompatibility before adding the material.

## Documentation and update history

- Keep README.md accurate and synchronized with the implementation, project status, contribution guidance, and license. Maintain its link to PUBLISH.md.
- Update PUBLISH.md with every project change. Explain the actual additions, improvements, fixes, compatibility changes, and upgrade requirements, as applicable.
- Format every update section in PUBLISH.md as `## YYYY-MM-DD - vX.Y.Z`, using the actual update date in Asia/Shanghai and the applicable version. Place detailed change bullets directly below the heading; do not use Unreleased headings or Added/Changed subheadings.
- Clearly label documentation-only initialization records. A versioned history entry does not mean a software release or Git tag has been published.
- Do not claim planned work is complete or invent a release, version, date, or upgrade procedure.
- Keep these guidelines synchronized with explicit changes to the project's requirements.
