# Repository Guidelines

## Project Structure & Module Organization
This repository is currently a clean slate with no source files committed. As the project takes shape, keep a simple, discoverable structure:
- `src/` for application or library code.
- `tests/` for automated tests.
- `docs/` for design notes, API docs, or specs.
- `scripts/` for developer tooling and automation.

Example path layout:
`src/`, `tests/`, `docs/architecture.md`, `scripts/lint.sh`.

## Build, Test, and Development Commands
No build or test tooling is configured yet. When adding tooling, document commands here and keep them consistent across environments. Examples:
- `make build` for a reproducible build.
- `make test` or `npm test` for the full test suite.
- `./scripts/dev.sh` for local development.

## Coding Style & Naming Conventions
No formatter or linter is configured. When you introduce one, document:
- Indentation (spaces vs. tabs, and width).
- File naming (e.g., `snake_case` for scripts, `kebab-case` for docs).
- Module/class naming patterns by language.
If a formatter is added (e.g., `prettier`, `gofmt`, `black`), treat it as the source of truth.

## Testing Guidelines
Testing framework and coverage goals are not yet defined. If you add tests:
- Match file naming to the framework’s conventions.
- Keep tests close to code (e.g., `tests/` or `src/**/__tests__/`).
- Document how to run unit vs. integration suites.

## Commit & Pull Request Guidelines
There is no Git history yet, so no established commit style. When committing:
- Use clear, imperative messages (e.g., “Add parser for X”).
- Keep PRs focused and include a short summary of changes and testing.
If the repo adds a PR template or CI checks, follow them strictly.

## Security & Configuration Tips
Avoid committing secrets. Use local env files (e.g., `.env`) and keep them in `.gitignore`. If configuration is required, document it in `docs/` and provide sample files (e.g., `.env.example`).
