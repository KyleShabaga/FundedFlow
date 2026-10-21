# 6 · Import trade preview

**Card:** Build 18 (CSV import wizard UI; in development). Backend: Build 17. Entry point: the header's
Import CSV action (Build 12) and Today/Journal actions.

Mockup: `Import.dc.html`. Backend: `preview_csv_import`, `commit_csv_import`, `list_csv_imports`,
`list_csv_import_problem_rows`. Rules: README "CSV trade import" and data-model.md.

## Purpose
Review every row of a CSV before anything is saved, then import it in one step.

## Layout
1. `Stepper`: Choose file → Match columns → Review rows → Import.
2. File card: name, rows, size, "read on this computer"; detected format (`performance` / `generic`) with the
   entry rule for performance exports; account select; date order (from `dateFormat`; if both M/D and D/M fit,
   ask the user to choose before showing rows).
3. Summary (`StatTile` ×5): will import (incl. restores), net P&L of new trades and fees, duplicates skipped,
   errors left out, warnings.
4. `DataTable` with a segmented filter: All / Will import / Duplicates / Errors / Warnings (counts). Columns: line,
   status, symbol, side, qty, opened, entry, exit, file P&L, net P&L, fill IDs, details.
5. Sticky confirm bar: "Nothing is saved until you import. All n trades are written together, or none are."
   Cancel, primary "Import n trades into {account}".

## Row statuses (from `rowReport`)
| Preview data | Badge | Details text |
|---|---|---|
| `new` | New (profit) | — |
| `new` + `restore` | Restore (flow) | "Matches a trade you deleted on {date}. Importing restores that original trade instead of adding a copy." |
| `new` + warnings | Warning (warn) | Each warning, e.g. "Sell filled before buy, so imported as a short", "File P&L $10.00 differs from calculated $10.50" |
| `duplicate` (`of: file`) | Duplicate (neutral) | "Same fill pair as line n" |
| `duplicate` (`of: saved`) | Duplicate | "Same fill pair as a trade saved on {date}" |
| `invalid` | Error (loss) | Each error with its column, e.g. "qty: must be greater than 0" |
| `invalid` with an `identity` error | Error (loss) | "Couldn't tell whether this row is already saved…": a pre-P0-01 trade shares its old key and its stored fill pair can't be read, so it is neither matched nor imported |
| `blank` | Hidden; counted in the file card | — |

Skipped rows (duplicates, errors) are dimmed.

## Decisions
- Duplicates match the `(buyFillId, sellFillId)` pair for performance rows exactly, including IDs that contain `:`
  (P0-01); a shared buy or sell fill alone is not a duplicate. Generic rows match on broker trade ID, else the hash of symbol, quantity, prices, timestamps
  and P&L.
- Cancel discards the preview without writing (#11). A new file starts from a clean state.
- After import: a toast, then the Import history list (`list_csv_imports`: file, counts, problem rows via
  `list_csv_import_problem_rows`). There is no command to undo a whole batch today; add one before offering Undo.

## States
- File over 10 MB or 50,000 rows: error before preview.
- Every row invalid: no import button; show the first errors and "Fix the file and choose it again".

## Build 18 implementation
Code: `apps/desktop/src/features/imports/` (`components/ImportWizardPage.tsx`, `ImportHistoryPage.tsx`,
`ImportTarget.tsx`, `wizard-state.ts`). Routes `/import` and `/import/history`; the header Import button
opens the wizard, and Accounts and account detail link to it with that account preselected. All reads and
writes go through the Build 14 hooks; every count, status, reason and P&L value shown comes from Rust.

Where this differs from the layout above (the card wins):
- **No "net P&L of new trades" tile.** The card forbids client-side financial calculations and no command
  returns that total, so the summary has five counts instead: will import (with restores), duplicates, errors,
  warnings, rows in file (with blank rows). Per-row file and net P&L stay in the table. Add a total to the
  preview command before showing one.
- **Extra columns and filter.** The table adds Fees and a Restores filter; invalid rows show their source cells.
- **Separate confirm step.** Step 4 restates every count and the destination attempt before the import button.
  Native `targetAssessment` blocks rows outside the exact attempt interval or spanning a reset; these cannot be
  overridden by a tick. In-window non-active attempts need explicit confirmation. The reviewed preview digest is
  sent to commit, which rechecks account settings, lineage and every candidate inside the write transaction.
  Input, account-context and lineage changes clear confirmation and require another preview.
- **Row limit.** The 10 MiB limit is checked on the file's bytes before it is read. The 50,000-row limit needs
  a parse, so it comes back from Rust as a blocking file issue; the wizard has no CSV parser of its own.
- **Large files.** When the preview leaves rows out (`rowsOmitted`), the counts still cover the whole file and a
  notice says how many plain new rows aren't listed.
- **Commit outcomes.** One request per click (the button is locked while it runs; no automatic retry). A lost
  answer shows "Couldn't confirm the import finished" with a link to Import history, and the wizard stays locked
  until the user says they have checked it. The completion screen shows the returned batch, not the preview.
- **Leaving mid-wizard.** The app uses a hash router without a navigation blocker, so only Cancel asks before
  discarding; nothing is saved before the import either way.
- **No Undo.** There is still no command to undo a whole batch.

Open dependencies: Build 17's fill-pair ID delimiter collision (two different pairs can share a duplicate key)
and the request schema counting the 10 MiB limit in UTF-16 units rather than UTF-8 bytes are tracked as Triage
cards; the UI checks bytes itself and shows whatever Rust decides.

## Build 18.5: drop fix and Quick import

**Drop.** Dropped and browsed files take one path (`useCsvFileChoice` → `readCsvFile`): one CSV per operation, the
existing 10 MiB byte limit, strict UTF-8, explicit messages for not-CSV, empty, unreadable, too large and several
files. Every pick has a version and only the newest read is delivered, so a slow read of an earlier file can't
replace a later one. A new file (or Remove) drops the preview, mapping, format and date choices, the destination
confirmation and any check still running for the old file; a preview that returns for an earlier request never
moves the wizard on. A file dropped outside a drop zone no longer opens in the window (shell drop guard).

**Quick import** (`/import/quick`, `QuickImportPage`), from the header Import menu, the Accounts "Import trades"
menu, each account card's menu (that attempt preselected) and the wizard's head. The trader picks the exact attempt
(same `ImportTargetPicker`: archived refused; Rust's `targetAssessment` blocks rows outside the exact attempt
interval and asks for the same tick for in-window non-active attempts, bound to that preview's token; shared broker
numbers called out) and one file. The read-only Rust preview runs as soon as both are known, with
`format: auto`, `dateFormat: auto` and the account's own time zone. The compact summary lists file and size,
destination, detected format and reason, zone, date order and reason, and the counts (will import, restores,
duplicates, errors, blank rows, warnings), with "View all rows and issues" opening the wizard's row table.
"Confirm import of n trades" re-checks the destination and commits with the wizard's hook and the preview's
`targetAcknowledgement` (same scope, so an uncertain commit locks both paths; one request per click; never
retried). Account-setting or lineage changes make the preview stale and it is checked again (read-only). A lost answer shows "Verify in import
history".

Quick import never decides anything Rust didn't: any `fileIssues` (ambiguous date order, time zone, columns, row
limit) or a **generic** CSV (columns matched by name) sends the trader to **Continue in full wizard**, which carries
the attempt, the file already read and the zone in memory (`handoff.ts`, not router history) and no confirmation;
the wizard shows why and checks the file again only when asked.

Decisions and gaps:
- **No saved import preferences exist.** There is no stored, validated per-account mapping/date-order preference
  (settings hold only generic keys). Quick import therefore relies on Rust detection plus the account's own zone;
  a remembered generic mapping would need a backend preference store (new Triage card).
- Generic CSVs always go to the wizard, even when Rust matched every column by name, so a human checks the matches.
- Native drop on packaged Windows depends on `dragDropEnabled: false` (tauri.conf.json, Build 20). It must be
  re-checked by a person dragging from Explorer on each release.
