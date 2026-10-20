# FundedFlow

FundedFlow is a Windows-first, local-first trading journal built with Tauri 2, React, TypeScript, and Vite. Local application capabilities and SQLite persistence stay behind Rust commands; the frontend does not access SQL or require a cloud service.

## Prerequisites

- Windows 10 (1803+) or Windows 11 with Microsoft Edge WebView2 Runtime
- Node.js LTS (22 or newer) and npm
- Rust stable with the `x86_64-pc-windows-msvc` target
- Visual Studio Build Tools with the **Desktop development with C++** workload
- Git

## Repository layout

| Path | Package | Contents |
|---|---|---|
| `apps/desktop` | `@fundedflow/desktop` | React UI, Tauri host (`src-tauri`), typed command gateway |
| `packages/domain` | `@fundedflow/domain` | Framework-free Zod contracts and money primitives shared by every host |

The UI design system (tokens, bundled fonts, components, money formatting) is in `apps/desktop/src/design-system`; see [`docs/design-system.md`](docs/design-system.md). Screen designs, build order and per-screen specs are in [`docs/design/`](docs/design/README.md). The **Design system** button on the start screen shows every component.

npm workspaces with one root `package-lock.json`. Package boundaries, the money/time wire contract and the Rust ↔ TypeScript parity fixtures: [`docs/architecture/packages.md`](docs/architecture/packages.md).

## Start developing

Run everything from the repository root:

```powershell
npm ci
npm run tauri dev
```

`npm run tauri dev` builds `packages/domain` first and keeps it compiling in watch mode, so edits there reach the running app.

## Build

```powershell
npm run build
npm run tauri build
```

`npm run build` builds `@fundedflow/domain` and then the desktop frontend (`tsc` + Vite). `tauri build` does the same before compiling the Rust app.

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server only (browser preview at http://localhost:1420, no Tauri commands) |
| `npm run typecheck` | Builds domain, type-checks domain sources/tests and the desktop app |
| `npm test` | Domain unit and parity tests (Vitest) |
| `npm run check` | Domain boundary check and a plain-Node import of the built package |
| `npm run dev:domain` | `tsc --watch` for `packages/domain` on its own |

FundedFlow is a desktop app: its React UI runs inside the app's own window, not in a web browser. SQLite is bundled through `rusqlite` and accessed only through Rust commands.

## Local data

FundedFlow stores accounts, trades, journal entries and CSV import history in a single SQLite file in the per-user app data directory: `%APPDATA%\com.fundedflow.desktop\fundedflow.db` on Windows. Nothing is stored in the install directory or the repository, and nothing leaves the machine.

- Schema, relationships, delete rules, migrations, CSV column mapping, duplicate detection and P&L assumptions: [`docs/data-model.md`](docs/data-model.md)
- Migrations: `apps/desktop/src-tauri/migrations/*.sql`, embedded and applied at startup by `apps/desktop/src-tauri/src/db` (a backup copy is written before an upgrade)
- Rust: `apps/desktop/src-tauri/src/store` (accounts, trades, journal), `apps/desktop/src-tauri/src/csv_import`, `apps/desktop/src-tauri/src/commands.rs`
- TypeScript: `packages/domain/src/contracts` (types and Zod schemas, re-exported by `apps/desktop/src/lib/data/schemas.ts`) and `apps/desktop/src/lib/data/api.ts` (typed command wrappers)
- `apps/desktop/src/components/DataModelPanel.tsx` is a small developer panel on the start screen for trying these out

## CSV trade import

Open the developer panel, pick an account, choose a CSV under **CSV import**, review the preview, then confirm. Nothing is saved before you confirm, and the file never leaves the computer: it is read in the app and validated by the Rust backend.

**Supported formats** (detected automatically, or chosen in the Format menu):

| Format | Recognised by | Maps to a trade |
|---|---|---|
| Performance export (paired fills, e.g. Tradovate) | `symbol`, `qty`, `buyPrice`, `sellPrice`, `boughtTimestamp`, `soldTimestamp` (+ optional `buyFillId`, `sellFillId`, `pnl`, `duration`, `_priceFormat`, `_priceFormatType`, `_tickSize`) | One completed round trip. The fill that happened first is the entry: buy first = long, sell first = short. Original prices, both timestamps, fill IDs, duration and contract metadata are stored as supplied. |
| Generic trade CSV | Symbol, side, quantity, entry time, entry price (+ optional exit time/price, fees, P&L, trade ID, notes). Common broker names such as `Ticker`, `Action`, `Open Time`, `Close Price`, `Commission`, `P&L` are matched automatically; any field can be mapped by hand. | One trade per row. |

**Validation.** Each row is checked separately: symbol, quantity > 0, finite prices, money such as `$26.00` or `$(36.00)`, durations such as `32sec`, `1min 17sec` or `1hr 2min`, and timestamps. Each file uses exactly one date format (`YYYY-MM-DD`, `M/D/YYYY` or `D/M/YYYY`). If both M/D and D/M fit every date, the import asks you to choose. Rows with errors are listed with the column name and are not imported. Warnings, such as a sell fill timestamped before its buy fill or an exported P&L that differs from the calculated one, are shown but do not block the row.

**Duplicates.** Rows are checked against earlier lines in the file and against active trades already saved to the account. An eligible row matching a soft-deleted trade is identified as a restore in the preview; confirming the import restores the original trade rather than inserting a duplicate. The key is the `(buyFillId, sellFillId)` pair for performance rows (a shared buy fill alone is not a duplicate), the broker trade ID for generic rows, and otherwise a hash of symbol, quantity, prices, timestamps and P&L. The preview says which line or saved trade each duplicate matches.

**Saving.** Imports are atomic: the import record, every row (with its original cells, errors and warnings) and every trade are written in one SQLite transaction in the local database above, or none are. Limits: 10 MB and 50,000 rows per file.

Full rules, field mappings and known limitations: [`docs/data-model.md#csv-import`](docs/data-model.md#csv-import). The test fixture `test_csvimport/Performance.csv` is read by the Rust tests and must stay unedited.

## Tests

CI (Windows) runs the same steps:

```powershell
npm ci
npm run check:boundaries -w @fundedflow/domain
npm run typecheck
npm test
npm run build
npm run check:dist -w @fundedflow/domain
cd apps/desktop/src-tauri
cargo test
cargo clippy --all-targets -- -D warnings
```

`cargo test` covers schema, repositories, CSV import (including the `Performance.csv` fixture) and the golden parity fixtures in `packages/domain/test/fixtures`, which Vitest runs too. After an intentional Rust change, regenerate the expected outputs with `$env:FUNDEDFLOW_UPDATE_FIXTURES=1; cargo test --lib parity` and review the diff.
