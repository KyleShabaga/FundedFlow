# FundedFlow

FundedFlow is a Windows-first, local-first trading journal built with Tauri 2, React, TypeScript, and Vite. Local application capabilities and SQLite persistence stay behind Rust commands; the frontend does not access SQL or require a cloud service.

## Prerequisites

- Windows 10 (1803+) or Windows 11 with Microsoft Edge WebView2 Runtime
- Node.js LTS and npm
- Rust stable with the `x86_64-pc-windows-msvc` target
- Visual Studio Build Tools with the **Desktop development with C++** workload
- Git

## Start developing

```powershell
npm install
npm run tauri dev
```

## Build

```powershell
npm run build
npm run tauri build
```

Vite serves the development frontend on loopback only. The packaged desktop app does not run a local HTTP server. SQLite is bundled through `rusqlite` and accessed only through Rust commands.

## Local data

FundedFlow stores accounts, trades, journal entries and CSV import history in a single SQLite file in the per-user app data directory: `%APPDATA%\com.fundedflow.desktop\fundedflow.db` on Windows. Nothing is stored in the install directory or the repository, and nothing leaves the machine.

- Schema, relationships, delete rules, migrations, CSV column mapping, duplicate detection and P&L assumptions: [`docs/data-model.md`](docs/data-model.md)
- Migrations: `src-tauri/migrations/*.sql`, embedded and applied at startup by `src-tauri/src/db` (a backup copy is written before an upgrade)
- Rust: `src-tauri/src/store` (accounts, trades, journal), `src-tauri/src/csv_import`, `src-tauri/src/commands.rs`
- TypeScript: `src/lib/data/schemas.ts` (types and Zod schemas) and `src/lib/data/api.ts` (typed command wrappers)
- `src/components/DataModelPanel.tsx` is a small developer panel on the start screen for trying these out

Run the Rust tests (schema, repositories, CSV import) and the frontend type-check:

```powershell
cd src-tauri
cargo test
cd ..
npm run build
```
