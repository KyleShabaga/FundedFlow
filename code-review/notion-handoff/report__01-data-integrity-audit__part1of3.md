| Field | Value |
|---|---|
| Review date | 2026-10-22 |
| Scope status | **Complete** for source-level review of every persistence path. The **checks lane is Blocked**: no test could be run offline (see §11). |
| Repository root | `/home/user/FundedFlow` |
| Branch / HEAD | `claude/practical-turing-wmii06` at `4fee79e3fbbc2a57a5fe62731049301e64021dab` |
| Source drift | `git diff --stat 92e7980 HEAD -- . ':!code-review'` is empty, so the application source is identical to the handoff snapshot `92e7980`. The only changes since then are the Phase 1 reports in `code-review/`, committed in `24e5c9e` and `4fee79e`. |
| Working tree at start | Clean |
| Input reports | `code-review/00-repository-discovery.md` and `code-review/coverage-matrix.md`, both at `4fee79e`. They are current; no source drift. |
| Host / tools | Linux x86_64 container, bash. **Not Windows, not WSL.** Node 22.22.0, npm 10.9.4, cargo/rustc 1.97.0, Python 3.13.16, uv 0.11.32. There is no Cargo registry cache, no `target/` and no `node_modules`. |
| Instruction files | `CLAUDE.md` (root). There is no `.claude/`, `.claude/rules/` or `AGENTS.md`. No conflict with this scope. |
| Agents | The lead plus three read-only specialists, all of which returned: **L1** SQLite lifecycle (db, migrations, runtime); **L2** attachments, archive, restore, deletion, filesystem and the legal record; **L3** CSV import, store write paths, the frontend write lifecycle and settings. The lead re-read the code behind every finding rated Medium or above (§12). |
| Real user data | Not opened, copied, migrated, seeded or reset. No binary fixtures were opened. `test_csvimport/*.csv` rows were not read. |

---

## 1. Executive summary

**Committed journal data is well protected.** Every write path traced at this revision commits in one SQLite transaction or fails without partial effects:

- CSV import;
- trades, accounts and reviews;
- migrations;
- account deletion;
- restore install and rollback.

Further protections, all traced in source:

- A crash or power loss can lose at most the last few `synchronous=NORMAL` WAL commits. It cannot corrupt the database.
- Upgrades back up first and never overwrite the original backup.
- A newer journal is refused untouched.
- A second instance cannot open the journal.
- Restore stages a safety copy before replacing anything.
- Referenced screenshot bytes are never deleted.
- No case was found where a failed write is reported as success.

**No Critical or High finding, and no Stage 1 blocker (P0), was established.**

The material risks are **availability and recoverability**: a set of fail-closed checks with no repair path can lock the owner out of the journal, or out of export, restore and erase, exactly when they are needed. The remaining risks are a few gaps where **user input can be lost or duplicated at the edges**: unsaved text when the window closes, and creates repeated after an uncertain outcome followed by a restart.

Top items (P1):

1. **DATA-001.** A malformed or unfinishable deletion-cleanup marker (or restore marker) blocks every app start until files are removed by hand.
2. **DATA-002.** A stray file in `attachments/` permanently blocks restore and whole-journal erase, with a misleading message.
3. **DATA-003.** A missing or changed screenshot file permanently blocks export, restore and erase.
4. **DATA-004.** Size caps on the *live* journal (64 MiB of database pages including free pages, 500k rows, 256 MiB archive) make export, restore-over and erase impossible for a large journal, with no workaround.
5. **DATA-006, DATA-007, DATA-008.** Possible duplicate creates after an uncertain write plus a restart; a single connection mutex and a fixed 30 s deadline turn ordinary writes uncertain during long operations; unsaved review text may be lost on window close or crash.

Export is the owner's only portable backup, so DATA-003 and DATA-004 matter more than their likelihood alone suggests.

## 2. Persistence architecture assessment

The persistence footprint was confirmed in source (it extends the map in `00-repository-discovery.md` §6). All of it lives under `%APPDATA%\com.fundedflow.desktop\`:

| Store | Write mechanism (verified) | Assessment |
|---|---|---|
| `fundedflow.db` (+`-wal`/`-shm`) | One `Mutex<Option<Connection>>` (`src-tauri/src/runtime.rs:181`). PRAGMAs `foreign_keys=ON`, `recursive_triggers=OFF`, `busy_timeout=5s` (`db/mod.rs:152-157`); then `journal_mode=WAL`, `synchronous=NORMAL` set *after* the newer-schema refusal (`db/mod.rs:259-264`). Deletion temporarily uses `synchronous=FULL` (`data_controls/deletion.rs:238-246`). | Sound. No manual `BEGIN` anywhere in non-test code; only `Transaction` guards, including `transaction_with_behavior(Immediate)` at `csv_import/mod.rs:474` and `store/risk_promotion.rs:341`. A panic unwinds and the drop rolls back. |
| Migrations 1→21 | Each step and its `user_version` bump commit in one transaction (`db/mod.rs:214-242`). No migration SQL contains `PRAGMA`s or top-level `BEGIN`. | Sound (L1 Q2, lead re-read) |
| `fundedflow.db.before-v21.bak`, `…previous-<uuid>.bak` | `VACUUM INTO` through the live connection, which includes the WAL. An existing backup is copied, `sync_all`ed, then removed before the new backup (`db/mod.rs:266-284`). | Sound for preserving the original. See DATA-010 and DATA-011. |
| `fundedflow.lock` | `fs2::try_lock_exclusive`, held for the runtime's lifetime (`data_controls/mod.rs:155-168`, `runtime.rs:330-335`) | Sound: a second instance gets `open_failed` before touching any file |
| `attachments/screenshots/<uuid>.<ext>` | `.part` + `create_new` + `sync_all` + `rename`, **then** a DB transaction; the file is removed if the commit fails, ignoring errors (`store/attachments.rs:199-291`). Removal is a soft delete; bytes are kept (`:374-383`). | Bytes are never lost. Stray files are possible (DATA-002). |
| Restore staging `data-controls/<uuid>/…`, `data-controls-pending.json` | Phases `prepared → installing → committed` with a safety copy (`data_controls/restore.rs:86-156, 284-349`). The marker is written as a temp file, `sync_all`, then `persist`. | Sound, with an idempotent rollback. Leftovers are never pruned (DATA-012). |
| Deletion queue `data-controls-cleanup/<op>.json` | Written **before** the DB change with `create_new` + write + `sync_all`, *not* temp + rename (`deletion.rs:287-291`, `filesystem.rs:116-130`). Files are removed after commit only if no row owns them (`deletion.rs:321-386`). | Safe for data. Can block startup (DATA-001). |
| Export ZIP / CSV | A temp file in the destination folder, a full re-inspect, then `persist_noclobber` (`data_controls/archive.rs:214-323`, `filesystem.rs:145-150`) | Atomic and consistent: the connection mutex is held throughout. Size-capped (DATA-004). |
| `legal-acceptance.json` (config dir; the same folder on Windows) | Temp file, `sync_all`, `persist` (`legal.rs:95-107`). A corrupt record reads as "not accepted" (`legal.rs:83-92`). | Sound. **The boundary is correct:** it is not referenced by export, restore or erase (L2 Q6, grep). |
| Settings (`settings` table) | One UPSERT. Keys are validated; values are any JSON up to 64 KiB (`store/settings.rs:52-67`). The frontend validates known keys and degrades safely when reading (`features/settings/display-time-zone.ts:34-41,73`; `features/accounts/active-account.ts:31-38`). | Adequate (no finding) |
| WebView `sessionStorage` drafts | Plaintext JSON kept only while a form is dirty (`ReviewCard.tsx:105-122`, `DailyReviewPage.tsx:92-105`, `rulebooks/components/unsaved.ts:11-29`) | Not durable across a restart (DATA-008) |

## 3. Detailed data-flow analysis

The flows below were traced along this path: creation → validation → state → save → load → modify → delete → migration → recovery.

**Manual trade (W4).**

1. The form (`TradeFormDialog.tsx`) passes through `useFeatureMutation`, which takes a per-account scope lock and a 30 s deadline (`features/shared/submissions.ts:4`).
2. `tauri-repository.ts` validates with Zod and sends `create_trade`.
3. Rust `trades::create` runs a single `INSERT` (`store/trades.rs:127-169, 261`), deriving the trading day and P&L in Rust.
4. Update: `update_with` checks `expected_updated_at` (sent by `TradeFormDialog.tsx:186`) in one transaction with a `trade_corrections` row (`trades.rs:363-430`).
5. Delete and restore are soft, in one transaction.
6. **Gap:** create has no idempotency key (DATA-006).

**CSV import (W5).**

1. Preview → SHA-256 token over the full account row, the lineage, the request (including the content SHA) and the per-row classification (`csv_import/target.rs:148-180`).
2. Commit → an IMMEDIATE transaction re-runs analyze, classify and assess, re-verifies the token, writes the batch, rows, trades, round trips and restores, then commits (`csv_import/mod.rs:472-574`).
3. A retry after a commit that actually succeeded is refused, because the token changes once the rows become duplicates (`target.rs:199-201`, test `target_tests.rs:168`).
4. `UNIQUE(account_id, dedup_key)` is a backstop (`migrations/0001_core_schema.sql:383`).
5. **Atomic and duplicate-safe.** Side effect: the refusal logs a misleading `failed` batch (DATA-013).

**Reviews, daily reviews and rulebook drafts (W6–W8).** Saves check `expected_revision` or `updated_at` in a transaction:

- `store/reviews.rs:299-313`;
- `store/daily_reviews.rs:809-820, 917, 1110, 1138`;
- `store/rulebooks.rs:520-530, 645, 701`.

The UI stashes dirty text in `sessionStorage` and warns before restoring an older draft over a newer revision. The trade review card re-stashes edits typed during a save (`ReviewCard.tsx:268-275`); the daily review page does not (DATA-009).

**Accounts, journal entries, ledger, library.**

- Updates run in transactions. `accounts::update` re-derives the account's trades in the same transaction (`store/accounts.rs:293-326`).
- These writes have **no revision check**: the last save wins (DATA-015).
- Journal delete is a hard `DELETE` (`store/journal.rs:203`).
- Ledger writes append revisions.

**Screenshots (W6).** The flow is: validate in a read transaction → write the file → commit the rows (§2). A crash between the rename and the commit leaves an unreferenced file (DATA-002).

**Export, restore and deletion (W12–W14).** Traced in L2 Q2–Q4; summarized in §2 and §5.

**Startup and upgrade (W1).** `Runtime::initialize` holds the connection mutex. `open()` then runs these steps (`runtime.rs:326-361`):

1. Take the lock.
2. Run `data_controls::recover` (restore).
3. Read the version read-only.
4. `db::open_file`: refuse a newer journal, set WAL, back up, migrate.
5. Run `data_controls::recover_cleanup` (deletion queue).

Any failure is categorized and becomes retryable `Failed`, except `newer_schema`.

**Frontend state vs stored state.**

- `normalizeError(write=true)` maps a `database`-kind or unknown error to `uncertain-outcome` (`features/shared/errors.ts:24-37`).
- A late success after the deadline keeps the scope locked as uncertain (`submissions.ts:33-37`; test `submissions.test.ts:15`).
- A Zod failure on a write response is also uncertain (`operations.ts:26-31`).
- **A failed save cannot appear successful** (L3 C1; Confirmed).

