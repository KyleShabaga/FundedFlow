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
| `blank` | Hidden; counted in the file card | — |

Skipped rows (duplicates, errors) are dimmed.

## Decisions
- Duplicates match the `(buyFillId, sellFillId)` pair for performance rows; a shared buy or sell fill alone is
  not a duplicate. Generic rows match on broker trade ID, else the hash of symbol, quantity, prices, timestamps
  and P&L.
- Cancel discards the preview without writing (#11). A new file starts from a clean state.
- After import: a toast, then the Import history list (`list_csv_imports`: file, counts, problem rows via
  `list_csv_import_problem_rows`). There is no command to undo a whole batch today; add one before offering Undo.

## States
- File over 10 MB or 50,000 rows: error before preview.
- Every row invalid: no import button; show the first errors and "Fix the file and choose it again".
