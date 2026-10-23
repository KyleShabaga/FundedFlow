# FundedFlow

FundedFlow is a Windows-first, local-first trading journal built with Tauri 2, React, TypeScript, and Vite. Local application capabilities and SQLite persistence stay behind Rust commands; the frontend does not access SQL or require a cloud service.

## Prerequisites

**To install and run FundedFlow:** Windows 10 or 11. The installer ensures the Microsoft Edge WebView2 runtime is present (see [Windows installer](#windows-installer)).

**To develop FundedFlow:**

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
| `tools/prop-firm-collector` | `fundedflow-collector` (Python) | Build 29 standalone collector: public prop-firm pages as unverified evidence, plus (Build 29.25) comparison-site observations ([README](tools/prop-firm-collector/README.md)) |

The UI design system (tokens, bundled fonts, components, money formatting) is in `apps/desktop/src/design-system`; see [`docs/design-system.md`](docs/design-system.md). Screen designs, build order and per-screen specs are in [`docs/design/`](docs/design/README.md). In development, open `#/settings/developer` for the component gallery and data-model tooling. These tools are excluded from production builds.

The product root supplies Today and a Settings placeholder inside the desktop shell, with Accounts
(Build 15), the rulebook editor (Build 19), CSV import (Build 18) and the Journal with trade detail, reviews and the
Library (Build 20; [`docs/architecture/build-20-trade-journal.md`](docs/architecture/build-20-trade-journal.md)), the daily review with plan adherence (Build 22; [`docs/architecture/build-22-daily-review.md`](docs/architecture/build-22-daily-review.md)) and Insights with exact contributing-trade drill-down (Build 23; [`docs/architecture/build-23-insights.md`](docs/architecture/build-23-insights.md)). Local runtime failure leaves navigation and recovery available; an already-open data screen retains
its local draft while its controls are disabled. Build 12 evidence, browser smoke instructions and pending
Windows checks are in [`docs/build-12-verification.md`](docs/build-12-verification.md).

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
| `npm test` | Domain unit/parity tests and desktop component tests (Vitest) |
| `npm run check` | Domain boundary check and a plain-Node import of the built package |
| `npm run notices` / `npm run check:notices` | Regenerate `apps/desktop/THIRD_PARTY_NOTICES.txt` (shipped in the installer and shown in Settings) after any dependency change, or check it is current as CI does. Needs `cargo install cargo-about --version 0.9.2 --locked --features cli` |
| `npm run dev:domain` | `tsc --watch` for `packages/domain` on its own |
| `npm run dev:test-journal` | `tauri dev` on an isolated, git-ignored test journal, with the developer-only **Add Fake Data** and **Reset All Data** sidebar actions enabled ([`docs/development/dev-tools.md`](docs/development/dev-tools.md)) |
| `npm run seed:test-journal` / `npm run reset:test-journal` | Seed or reset that test journal from the command line (FundedFlow closed) |

FundedFlow is a desktop app: its React UI runs inside the app's own window, not in a web browser. SQLite is bundled through `rusqlite` and accessed only through Rust commands.

## Windows installer

`npm run tauri build` produces an unsigned NSIS installer, `FundedFlow_<version>_x64-setup.exe`, in `apps/desktop/src-tauri/target/release/bundle/nsis/`. NSIS is the only bundle target.

The [Release installer workflow](.github/workflows/release-installer.yml) builds the same installer on `windows-latest`. It runs manually (`workflow_dispatch`), on `v*` tags (the tag must equal `v<version>` from `tauri.conf.json`), and on pull requests that change `tauri.conf.json` or the workflow. Nothing is published: it uploads a workflow artifact named `fundedflow-<version>-<short sha>-windows-nsis`, kept for 30 days, containing the installer and `SHA256SUMS.txt`. Find it on the workflow run's page under **Artifacts**; the run summary also shows the hash and source commit.

**Installing, verifying and updating (end users):**

1. Download the installer and `SHA256SUMS.txt`. Check the file with `Get-FileHash .\FundedFlow_<version>_x64-setup.exe -Algorithm SHA256`; the hash must match the line in `SHA256SUMS.txt`.
2. Run the installer. It is not code-signed, so SmartScreen shows "Windows protected your PC": choose **More info**, then **Run anyway**. No administrator rights are needed (per-user install).
3. If WebView2 is missing, the installer downloads it from Microsoft once.
4. Updates are manual: verify and run the newer installer. If it offers to uninstall the old version first, leave **Delete the application data** unticked to keep your journal. FundedFlow does not check for updates.

Full wording, uninstall behaviour and the clean-machine smoke checklist: [Install and verify](docs/build-26.75-evidence.md#install-and-verify-for-the-na-7-release-notes) in `docs/build-26.75-evidence.md`.

## Local data

FundedFlow stores accounts, trades, journal entries and CSV import history in a single SQLite file in the per-user app data directory: `%APPDATA%\com.fundedflow.desktop\fundedflow.db` on Windows. Nothing is stored in the install directory or the repository, and nothing leaves the machine. The first-run privacy notice and agreement (NA-3) records this install's acceptance in `legal-acceptance.json` in the same folder; it is not journal data ([spec](docs/design/screens/16-first-run.md)).

- Schema, relationships, delete rules, migrations, CSV column mapping, duplicate detection and P&L assumptions: [`docs/data-model.md`](docs/data-model.md)
- Migrations: `apps/desktop/src-tauri/migrations/*.sql`, embedded and applied at startup by `apps/desktop/src-tauri/src/db` (a backup copy is written before an upgrade)
- Rust: `apps/desktop/src-tauri/src/store` (accounts, trades, journal), `apps/desktop/src-tauri/src/csv_import`, `apps/desktop/src-tauri/src/commands.rs`
- TypeScript: `packages/domain/src/contracts` (types and Zod schemas, re-exported by `apps/desktop/src/lib/data/schemas.ts`) and `apps/desktop/src/lib/data/api.ts` (typed command wrappers)
- `apps/desktop/src/components/DataModelPanel.tsx` is available under **Data model** at `#/settings/developer` in development for trying these out

Financial evidence, immutable ledger corrections and exact balance reconciliation: [Build 15.5 backend/API handoff](docs/handoffs/build-15-5.md). These operations are backend APIs; Claude owns their future UI.

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

**Destination attempt.** Rust checks every importable row's exact entry and exit against the selected attempt's
reset interval, including rows omitted from display and the saved timestamps of restores. Outside/spanning rows
block import; historical imports within a non-active attempt require confirmation. Commit requires the reviewed
preview digest and rejects changed inputs, account settings, lineage or dedup state. See the
[exact-attempt handoff](docs/handoffs/build-18-exact-import-attempts.md) for policy and acceptance evidence.

Full rules, field mappings and known limitations: [`docs/data-model.md#csv-import`](docs/data-model.md#csv-import). The test fixture `test_csvimport/Performance.csv` is synthetic data in the broker Performance export format (generation rules in [`docs/architecture/build-17-csv-backend.md`](docs/architecture/build-17-csv-backend.md)). The Rust tests read it; it changes only through an approved roadmap card.

## Tests

Build 10.5 audit baseline, fixes, verification results and retained acceptance gates:
[`docs/build-10-5-closeout.md`](docs/build-10-5-closeout.md) and the
[`acceptance matrix`](docs/build-10-5-acceptance-matrix.md). Automated evidence does not replace packaged
Windows workflow verification or an explicitly approved real-journal-copy upgrade.

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

followed by `npm run check:notices`. A separate `dependency-audit` job runs in parallel (and daily at 06:17 UTC on
`main`): `npm audit --omit=dev --audit-level=high` and `cargo audit --deny unsound`, each through
`scripts/audit-guard.mjs`. A high or critical npm advisory, or a RustSec vulnerability or unsound advisory, fails it.
If npm's advisory endpoint or the RustSec database can't be reached after 3 attempts (each killed after 120 s), the
audit is reported as **not run** (a warning annotation and a line in the job summary): on pull requests and pushes
the job still passes, so an outage can't block code checks or merges; on the scheduled and manual
(`workflow_dispatch`) runs it fails.

`cargo test` covers schema, repositories, CSV import (including the synthetic `Performance.csv` fixture) and the golden parity fixtures in `packages/domain/test/fixtures`, which Vitest runs too. After an intentional Rust change, regenerate the expected outputs with `$env:FUNDEDFLOW_UPDATE_FIXTURES=1; cargo test --lib parity` and review the diff.

## License and ownership

Copyright (c) 2026 Kyle Shabaga. All rights reserved.

FundedFlow is proprietary software. Its source code is publicly viewable, but it is **not open source**: being able to read it on GitHub does not give you a license to copy, modify, redistribute, sublicense or commercially use it, or to make derivative works. See [LICENSE](LICENSE) for the full terms.

- Viewing the code, and the forking that GitHub's Terms of Service allow for public repositories, are fine.
- Anything beyond that, including reuse in another project or commercial licensing, needs written permission from the copyright holder. To ask, open an issue in this repository or contact [@KyleShabaga](https://github.com/KyleShabaga) through GitHub.
- Third-party libraries, crates and fonts used by FundedFlow keep their own licenses and notices; the FundedFlow license does not apply to them.
