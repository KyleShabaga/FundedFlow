# FundedFlow: notes for Claude Code

Windows-first, local-first trading journal: Tauri 2, React, TypeScript, Vite; SQLite behind Rust commands.
Start with `README.md`, then `docs/data-model.md` and `docs/architecture/packages.md`.

## Plan of record

The Notion roadmap board (https://app.notion.com/p/6bf1bd4b6bde831ea34e01b574543195) owns scope, build order and
acceptance criteria. Work one card at a time: branch `feat/build-<n>-<slug>`, link the card in the pull request,
stay inside the card's scope and "explicit ownership" section, and record gaps as new Triage cards instead of
widening scope. P2 and Web V2 items are not V1 work.

## Building UI

- Read `docs/design/README.md` before building or changing a screen. It has the build order, one spec per screen
  (`docs/design/screens/`), the components to use (`docs/design/components.md`) and reference images.
- Use the design system in `apps/desktop/src/design-system` (`docs/design-system.md`). If a screen needs a pattern
  it lacks, add the pattern there first, with tests and a gallery section, then use it.
- `docs/design/mockups/*.dc.html` are visual references from the design canvas. Read them for structure and copy;
  never copy their markup or `ff-app.css` into the app.
- Money is decimal text: format and sum with `format.ts` (bigint micro-units), never `number`. Unknown is `—`,
  never zero. Trading days run Monday to Friday; show times in the account's time zone.
- Authority for stored calculations (TASK-003, Option A): Rust is authoritative for inputs, trade economics,
  trading days and persistence; the TypeScript risk engine (`packages/domain/src/engine`, Build 16) is
  authoritative for risk verdicts, which Rust checks for consistency and unchanged sources but does not recompute.
  Any other new calculation in TypeScript needs parity fixtures (packages.md). If a screen needs data no command
  provides, add the command or note the gap in the spec; do not fake it in the UI.
- When a spec and its card disagree, follow the card and fix the spec in the same pull request.

## Checks

`npm run typecheck`, `npm test`, `npm run build`; in `apps/desktop/src-tauri`: `cargo test`, `cargo clippy --all-targets -- -D warnings`.
Prop-firm collector (Python, `tools/prop-firm-collector`, see its README): `uv run ruff check src tests scripts`,
`uv run mypy src tests`, `uv run pytest`.
