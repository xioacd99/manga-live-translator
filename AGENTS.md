# Development Guidelines

## Project direction

- Build an online manga translation experience focused on high performance and low latency.
- Use LLMs to improve translation fluency and preserve dialogue context.
- Keep goals and planned features clearly separate from implemented behavior. The project is currently at an early stage.
- Support performance claims with reproducible tests. State the test conditions and limitations; never invent benchmark results or publish untested performance numbers.

## License and contributions

- Keep the project under the MIT License, allowing modification, distribution, and commercial use under its terms. Preserve the required copyright and permission notices.
- Welcome issues and pull requests. Keep that invitation visible in the README.
- Check dependency and third-party code licenses before incorporating them, and preserve required notices. Do not import GPL-licensed code and present it as MIT-licensed code. Resolve any licensing incompatibility before adding the material.

## Documentation and update history

- Keep README.md accurate and synchronized with the implementation, project status, contribution guidance, and license. Maintain its link to PUBLISH.md.
- Update PUBLISH.md with every project change. Explain the actual additions, improvements, fixes, compatibility changes, and upgrade requirements, as applicable.
- Put completed but unreleased changes under Unreleased. When a release actually occurs, organize its changes under the real version and release date (YYYY-MM-DD).
- Do not claim planned work is complete or invent a release, version, date, or upgrade procedure.
- Keep these guidelines synchronized with explicit changes to the project's requirements.
