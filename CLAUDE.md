# FundedFlow: notes for Claude Code

Windows-first, local-first trading journal: Tauri 2, React, TypeScript, Vite; SQLite behind Rust commands.
Start with `README.md`, then `docs/data-model.md` and `docs/architecture/packages.md`.

## Building UI

- Read `docs/design/README.md` before building or changing a screen. It has the build order, one spec per screen
  (`docs/design/screens/`), the components to use (`docs/design/components.md`) and reference images.
- Use the design system in `apps/desktop/src/design-system` (`docs/design-system.md`). If a screen needs a pattern
  it lacks, add the pattern there first, with tests and a gallery section, then use it.
- `docs/design/mockups/*.dc.html` are visual references from the design canvas. Read them for structure and copy;
  never copy their markup or `ff-app.css` into the app.
- Money is decimal text: format and sum with `format.ts` (bigint micro-units), never `number`. Unknown is `—`,
  never zero. Trading days run Monday to Friday; show times in the account's time zone.
- Rust is authoritative for stored calculations. A new calculation in TypeScript needs parity fixtures
  (packages.md). If a screen needs data no command provides, add the command or note the gap in the spec; do not
  fake it in the UI.
- When a screen ships, update its row in `docs/design/README.md`.

## Checks

`npm run typecheck`, `npm test`, `npm run build`; in `apps/desktop/src-tauri`: `cargo test`, `cargo clippy --all-targets -- -D warnings`.
