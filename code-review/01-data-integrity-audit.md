# FundedFlow Stage 1 audit, Phase 2 of 6: local data integrity, persistence and crash recovery

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

## 4. Findings

### 4.1 Summary table

| ID | Severity | Location | Problem | Impact | Confidence | Stage 1 Priority |
|---|---|---|---|---|---|---|
| DATA-001 | Medium | `src-tauri/src/runtime.rs:336-356`; `data_controls/deletion.rs:287-291, 321-386`; `data_controls/restore.rs:296-300, 337-339` | A deletion-cleanup marker that cannot be finished, or a malformed restore marker, makes every journal open fail. The cleanup marker is not written atomically. | Journal inaccessible until files are removed by hand. The data is intact. | High (code) | P1 |
| DATA-002 | Medium | `store/attachments.rs:213, 264-291`; `restore.rs:129, 242-255`; `deletion.rs:211-213`; `apps/desktop/src/features/data-controls/api/data-controls.ts:50` | A stray or unreferenced file under `attachments/` blocks restore (the confirm step, after a preview that passed) and whole-journal erase, with a misleading message and no sweep | Restore and erase unavailable. No data loss. | High | P1 |
| DATA-003 | Medium | `data_controls/archive.rs:154-173` (callers: export `:246`, `restore.rs:127`, `deletion.rs:211`) | Any attachment row whose file is missing or changed fails `inventory`. Soft-deleted rows are included. | Cannot export (the only backup), restore over the damage, or erase. No repair path. | High (code), Low-Medium (likelihood) | P1 |
| DATA-004 | Medium | `archive.rs:72-91, 239, 258, 271`; `deletion.rs:133`; `restore.rs:77`; `store/attachments.rs:34-35` | Size caps apply to the **live** journal: database pages ≤ 64 MiB including the freelist, ≤ 500k rows, `data.json` ≤ 64 MiB, archive ≤ 256 MiB. Screenshots are uncapped journal-wide, and `dump(live)` also gates the erase and restore previews. | A large or never-vacuumed journal cannot be exported, restored over or erased. The error is generic. | High (code), Medium (likelihood over time) | P1 |
| DATA-005 | Medium | `src-tauri/src/runtime.rs:260-324`; `commands.rs:509-513` | A panic on the init thread skips `running.store(false)`, so the status stays `initializing` and `begin_initialize` refuses every Retry | The app is unusable until restarted; a deterministic panic means it never recovers. The data rolls back intact. | High (mechanism), Low (likelihood) | P2 |
| DATA-006 | Medium | `store/trades.rs:261`; `store/ledger.rs:185`; `store/journal.rs` create; `features/shared/submissions.ts:47-52` | Creates have no idempotency key, and the uncertainty lock lives only in memory | After an uncertain create and a restart, re-entering the item duplicates a trade or ledger entry, which changes P&L or balances | Medium | P1 |
| DATA-007 | Medium | `runtime.rs:242-250, 389-400`; `submissions.ts:4`; `operations.ts:6`; `features/data-controls/hooks/data-controls.ts:1-24` | One connection mutex is held for whole long operations (export, restore prepare, import commit), while the frontend deadline is a fixed 30 s from submit; the import commit gets 30 s against the preview's 60 s | Unrelated writes become "uncertain" and then land later, which widens DATA-006. No corruption. | Medium | P1 (cross-ref Phase 3, R-01) |
| DATA-008 | Medium | `features/shared/hooks/use-leave-guard.ts:38-46` (only `beforeunload`); no `onCloseRequested` or `CloseRequested` in `apps/desktop/src` or `src-tauri/src`; sessionStorage drafts | Closing the window or a crash can drop unsaved review, daily-review or rulebook text. Drafts don't survive a restart, nothing autosaves, and the trade form has no leave guard. | Loss of unsaved user text | Medium (code Confirmed; WebView2 close behaviour Unverified) | P1 |
| DATA-009 | Low | `features/daily-reviews/components/DailyReviewPage.tsx:171, 305-308, 373` | Text typed while a daily-review save is pending may be dropped when the form remounts on the new revision. ReviewCard handles this case; the daily review does not. | Loss of a few keystrokes or sentences | Low-Medium | P2 |
| DATA-010 | Low | `runtime.rs:145-164`; `db/mod.rs:271-283` | After a retried partial upgrade fails again on its first step, the message says "not changed… copy from before the upgrade is `before-v21.bak`", but that file now holds the half-upgraded state. The original is the unnamed `previous-<uuid>.bak`. | Manual recovery could restore the wrong copy. The original still exists. | High | P2 |
| DATA-011 | Low | `db/mod.rs:274-283` | A failed backup (disk full, crash) leaves partial `previous-*.bak` or `before-v*.bak` files that look like real recovery points | Junk recovery files, disk use | High | P2 |
| DATA-012 | Low | `restore.rs:83, 108-150, 355-360`; `deletion.rs:93-131, 236` | Restore operation directories and safety copies (including those from failed prepares), work directories and `.bak` files are never pruned. They keep deleted-account data. Any non-UUID entry under `data-controls/` blocks every deletion preview. The 1 GiB free-space check ignores uncapped safety attachments. | Disk growth; privacy expectation (disclosed); a deletion block | High | P2 |
| DATA-013 | Low | `csv_import/mod.rs:608-623` | A refused commit (stale or duplicate retry, a blocked target) records a `failed` batch for a file that may already be imported | History shows "Failed" during the uncertain-outcome review. No trades are affected. | High | P2 |
| DATA-014 | Low | `restore.rs:314-317, 333-343`; `runtime.rs:336-340` | A crash after a full install but before `committed` rolls back **silently**. An invalid `prepared` stage reports "blocked" once, and a plain Retry then succeeds. | The user may believe a restore applied when it did not | High | P3 |
| DATA-015 | Low | `store/accounts.rs:293-326`; `store/journal.rs:182-201`; `store/ledger.rs:210`; `store/library.rs` | These updates are last-save-wins, with no expected revision. An account edit includes `status`. | A stale dialog could revert a newer change. Unlikely with one window and modal flows. | Low | P3 |
| DATA-016 | Informational | `migrations/0021_risk_promotions.sql:13`; `db/mod.rs:215, 224` | Latent: a future rebuild of `account_snapshots` (the DROP/RENAME pattern in `0012:57`, `0015:105`) would cascade-delete every `risk_promotions` row, because `foreign_keys` is ON inside the migration transaction. Safe today. | Future migration data loss | High | P3 (rule or guard for future migrations) |
| DATA-017 | Informational | `db/mod.rs:263-264`; `data_controls/filesystem.rs:134-144` | WAL with `synchronous=NORMAL` can lose the last commits on power loss; the WAL result is not checked against `"wal"`; directory sync is a no-op on Windows | The last few seconds of edits may be lost on power loss; no corruption | Medium | P3 |
| DATA-018 | Informational | `deletion.rs:296-307`; `restore.rs:260-270`; `archive.rs:214-323` | Whole-journal erase does not `wal_checkpoint`. A crashed `replace_database` or export leaves a plaintext temp journal copy (data root or export folder) that erase does not remove. | Residual copies after erase; the UI already says erase is not forensic | Medium | P3 |
| DATA-019 | Informational | `db/mod.rs:255-262` | A newer journal already in WAL mode may get `-wal`/`-shm` sidecars, or a checkpoint, from the read-write open before it is refused. The runtime's read-only `read_version` runs first. | No data change | Medium (Unverified) | P3 |
| DATA-020 | Informational (owner decision) | `csv_import/dedup.rs:13-15` | Rows without broker IDs that are identical in every normalized field collapse into one trade, by design | Two genuinely identical trades without IDs import as one | High | Owner decision |

**Severity calibration.** No finding reached Critical or High: none can permanently destroy committed data under a realistic trigger. Medium is used for loss of access to data or recovery functions, and for loss or duplication of user input at the edges.

### 4.2 Finding details

#### DATA-001: cleanup or restore marker failures block every journal open

- **Verification:** Confirmed. The lead re-read `runtime.rs:336-356`, `deletion.rs:287-291, 321-345` and `filesystem.rs:116-130`.
- **Canonical:** Lane 1 F2 and lane 2 F3 report this same issue; they are duplicates of DATA-001. Preliminary risk R-05.
- **Trace.** `Runtime::open` → `open_file` (the journal is migrated and healthy) → `recover_cleanup(&conn, root)`. Any error drops the connection and reports `OpenFailed`, with the message "Pending deletion cleanup could not finish… Resolve filesystem or disk-space problems, then retry."
- **Triggers:**
  - a truncated or empty marker: `write_new` is `create_new` + write + `sync_all`, not temp + rename, so a crash mid-write leaves a partial file;
  - an unparseable file, a file over 1 MiB, or a non-regular entry in the queue;
  - a listed key that is now a directory or reparse point;
  - a persistent `remove_file` failure (Windows AV or indexer lock).
- **The same pattern for restore:** a `data-controls-pending.json` with an unknown phase, or one whose operation directory is missing, returns `RecoveryRequired` on every start (`restore.rs:300, 337-339`). Fail-closed is **correct** while a restore is in the `installing` phase; it is not justified for cleanup of unreferenced files.
- **Impact.** The whole journal is unavailable on every start. The message does not name the folder or file. Data is intact; recovery means deleting or repairing a file in `%APPDATA%` by hand.
- **Safeguards:** retryable status; the shell, Settings and the recovery notice stay available.
- **Smallest correction:**
  1. Write cleanup markers via temp + `persist`.
  2. At startup, quarantine an unparseable marker (move it to `data-controls-cleanup/quarantine/`) and continue.
  3. Treat a per-file removal failure as a non-fatal `cleanup_pending` status that still opens the journal.
  4. Put the file path in `failure.detail`.
- **Regression tests:**
  - a zero-byte or malformed `data-controls-cleanup/<uuid>.json` → `Runtime::start` reaches Ready and the marker is quarantined;
  - a listed attachment that is locked or replaced by a directory → Ready with cleanup pending;
  - a `pending.json` with an unknown phase → an actionable message naming the file.

#### DATA-002: a stray attachment file blocks restore and erase

- **Verification:** Confirmed. The lead re-read `attachments.rs:199-291`, `restore.rs:115-140, 242-255` and `deletion.rs:209-214`.
- **Canonical:** this is lane 2 F2. Preliminary risk R-02.
- **Trace.** `validate_managed` requires the set of files under `attachments/` to equal the DB inventory **exactly**. Callers:
  - restore `prepare` → `copy_managed` (comment: "rejecting stray/unsafe files: no unbacked-up bytes can disappear");
  - the whole-journal erase preview.

  `inspect` does not run this check, so the restore preview passes and the confirm then fails.
- **Triggers, all realistic on a desktop:**
  - power loss shortly after adding a screenshot: the synced, renamed file survives while the `synchronous=NORMAL` commit is lost;
  - a crash between rename and commit;
  - an ignored `remove_file` failure after a failed commit (`attachments.rs:289`);
  - a leftover `.part` file from a crash during the write (it sits in the same directory).
- **Impact.** Restore and erase return `UnsupportedOwnership`, whose UI text ("history is shared or can't be separated safely", `data-controls.ts:50`) does not describe the problem. There is no startup sweep. No data is lost.
- **Smallest correction.** Treat unreferenced files that match `screenshots/<uuid>.<ext>` or `.<uuid>.part` as *preserved extras*: copy them into the safety copy, or move them to `attachments/.orphaned/`, instead of rejecting. Give the case its own error code and message.
- **Regression test.** Plant an extra `attachments/screenshots/<uuid>.png` and a `.part` file. Assert that restore `prepare` and the erase preview succeed or report the specific code, and that the extra bytes are preserved.

#### DATA-003: a missing or changed screenshot blocks export, restore and erase

- **Verification:** Confirmed. The lead re-read `archive.rs:138-173`.
- **Canonical:** this is lane 2 F1.
- **Trace.** `inventory` hashes every `attachments` row's file. It does not filter `deleted_at`, so soft-deleted screenshots are required too. A missing file, a size mismatch or a hash mismatch returns `MissingAttachment` and aborts export, restore `prepare` and the erase preview.
- **Triggers:** antivirus quarantine; the user tidying AppData; disk damage; power loss where the row commit survives but the rename does not (less likely than the reverse).
- **Impact.** The owner cannot make an export, which is the only portable backup, and cannot restore a good archive over a journal that has this problem. Reads show the image as "missing", so the journal itself still works.
- **Smallest correction.**
  - Restore: record missing or changed live files in the safety inventory as "already missing" rather than failing.
  - Export: offer an explicit acknowledged "export without N missing screenshots" option, or a "detach missing screenshots" repair command that soft-marks them.
- **Regression test.** Delete one live screenshot file, then assert that export reports it and can proceed when acknowledged, and that restore `prepare` and the erase preview succeed.

#### DATA-004: size caps on the live journal block export, restore-over and erase

- **Verification:** Confirmed in code. How often it occurs is a hypothesis. The lead re-read `archive.rs:72-91` and `deletion.rs:132-133`.
- **Canonical:** this is lane 2 F4. Preliminary risk R-07.
- **Trace.** `dump(live)` rejects journals where `page_count × page_size > 64 MiB`. That count includes freelist pages, and no VACUUM ever runs. It also rejects journals with more than 500k rows. `dump(live)` is called by:
  - export;
  - the deletion preview (`deletion.rs:133`), so **erase is gated too**;
  - restore inspect (`restore.rs:77`).

  Export additionally caps `data.json` at 64 MiB (JSON overhead makes this bind before the database cap) and the archive at 256 MiB. Screenshots are limited only per trade (10 MiB × 20).
- **Impact.** Ordinary use can plausibly exceed these limits: many screenshots; `import_rows` storing the original cells of up to 50k rows per file; append-only histories. Export, restore-over and erase then fail with a generic `LimitExceeded`, with no workaround and no indication of which part is too large.
- **Smallest correction.**
  1. Hash the live side for preview tokens by streaming, without materializing `dump` and without the size cap.
  2. Report which component exceeds which limit.
  3. Run `VACUUM` into the export snapshot or measure the used pages, not the page count.
  4. Revisit the 256 MiB total (zip64 or a split export) before screenshot volume makes it routine.
- **Regression tests:**
  - a live journal with over 64 MiB of free pages → the erase preview and export succeed;
  - a journal over a cap → the error names the component.

#### DATA-005: a panic during initialization disables Retry

- **Verification:** Confirmed as a latent issue; the lead re-read `runtime.rs:260-324` and `commands.rs:500-513`.
- **Canonical:** this is lane 1 F1. Preliminary risk R-10.
- **Trace.** `initialize_in_background` spawns a thread that calls `initialize()`. A panic in `open()` unwinds past `self.running.store(false)` and the status update. The status stays `Initializing`, `begin_initialize` swaps `running` (still `true`) and returns `false`, so `retry_runtime` only reports the status.
- **Likelihood:** no panic site was found on the current init path (`db`, `steps.rs`, `restore::recover`, `recover_cleanup` all use `Result`), so the trigger needs a future regression or an unexpected library panic.
- **Fix.** Wrap the body in `catch_unwind` or a drop guard that records `Failed`/`OpenFailed` with the panic text and clears `running`.
- **Regression test.** A test hook or panicking `Step::Rust` → state `Failed`, and `begin_initialize()` returns true.

#### DATA-006: duplicate creates after an uncertain outcome and a restart

- **Verification:** Partially Confirmed (code traced; not exercised).
- **Canonical:** this is lane 3 B1. Preliminary risk R-11.
- **Trace.** `create_trade`, `create_ledger_entry` and `create_journal_entry` carry no client request ID. The frontend's uncertain lock and `TradeWriteReview` prevent resubmission within one session. The lock lives in a `WeakMap` keyed by the `QueryClient` (`submissions.ts:47-52`) and is lost on restart.
- **Trigger.** A create times out (often because of DATA-007) and lands later. The owner restarts and re-enters it.
- **Impact.** Two rows: P&L is inflated, or a deposit or withdrawal counts twice in balance figures.
- **Not affected:** CSV import and screenshots (duplicate SHA → `Conflict`).
- **Fix.** A client-generated `requestId` (made when the form opens) stored in a UNIQUE column, so a retry returns the existing row. A cheaper interim fix is a "similar entry saved N minutes ago" warning.
- **Regression test.** `create` twice with the same `requestId` → one row.

#### DATA-007: long operations hold the single connection while unrelated writes time out

- **Verification:** Partially Confirmed (code traced; timing not measured).
- **Canonical:** lane 3 C2 and A5. **It overlaps Phase 3 R-01** (blocking work inside async commands); Phase 3 should treat DATA-007 as the canonical data-integrity view and add the threading analysis.
- **Trace.**
  - `with_controls` and `with` hold the mutex for the whole operation: export hashing up to 256 MiB, restore `prepare` (two inspections plus copies), or an import commit (two analyses plus 50k inserts).
  - Data controls have no frontend deadline. Other writes do: 30 s from submit.
  - The import commit uses the same 30 s, although the preview, which does less work, is given 60 s.
- **Impact:** confusing uncertain locks on unrelated scopes (setting changes, review saves), and a wider window for DATA-006. No corruption: every write still runs atomically, later.
- **Fix.** Disable feature writes while a data-control operation or import commit is running (the UI already knows), and give the commit at least the preview's deadline.
- **Regression tests:**
  - a hook test asserting the commit deadline is at least `PREVIEW_TIMEOUT_MS`;
  - a test that other write controls are disabled while a data-control operation runs.

#### DATA-008: unsaved text can be lost when the window closes or the app crashes

- **Verification:** Partially Confirmed.
  - Confirmed in code: the only close guard is `beforeunload`; there is no Tauri `onCloseRequested` or Rust `WindowEvent::CloseRequested` handler; drafts are in sessionStorage; nothing autosaves; `TradeFormDialog` has no leave guard.
  - Unverified: whether WebView2 under Tauri 2 honours a `beforeunload` prompt on a title-bar close. **This must be checked on Windows in Phase 5.**
- **Canonical:** this is lane 3 C4.
- **Impact:** loss of a trade review, daily reflection or rulebook draft typed since the last save.
- **Fix.**
  1. Register `getCurrentWindow().onCloseRequested` and veto while the shared leave-guard set is active (this needs `core:window:allow-close` handling; check the capability in Phase 3).
  2. Optionally keep drafts in `localStorage`, keyed by account, record and revision, and cleared on save.
- **Tests:**
  - a component test that a dirty form vetoes close-requested;
  - a Windows manual check of title-bar close with a dirty review.

#### DATA-009 to DATA-020

The table in §4.1 is sufficient for these. Smallest fixes:

| ID | Smallest fix |
|---|---|
| DATA-009 | Mirror `ReviewCard`'s re-keep-after-save logic, or disable inputs while saving. Test: type during a pending save, then assert the text is kept or offered. |
| DATA-010 | Keep the earliest backup at the stable name and give retry backups the uuid name, or name the oldest `previous-*` file in the message. Test: two consecutive failures through the runtime, then assert the message names the original. |
| DATA-011 | Remove the partial `retained` or `backup` file on error; write the backup to a temp name and rename it. |
| DATA-012 | Remove the op dir when `prepare` fails. Add a "remove local recovery copies" action. Ignore, rather than reject, non-UUID entries. |
| DATA-013 | Don't record `failed` for token or target refusals, or use a distinct `refused` status. Extend `target_tests.rs:168` to assert a single batch. |
| DATA-014 | Write `last-restore-result.json` and show the outcome after the open. |
| DATA-015 | Add `expected_updated_at` to `accounts::update`. Low priority. |
| DATA-016 | Adopt a migration rule, or a `Migration` variant that disables foreign keys outside the transaction and runs `foreign_key_check` before commit. Add a generic upgrade test asserting row counts for every table. |
| DATA-017 | Assert the WAL result. Optionally flush the directory handle on Windows. |
| DATA-018 | `wal_checkpoint(TRUNCATE)` after erase; stage `replace_database` temp files under the op dir. |
| DATA-019 | Have `open_file` read `user_version` read-only first (as `runtime::read_version` already does). |
| DATA-020 | Owner confirms the policy. |

## 5. Crash and recovery assessment

| Scenario | Outcome (traced) | Committed data recoverable? |
|---|---|---|
| Kill or crash during an ordinary write | The transaction is not committed, so the WAL frames are ignored on the next open | Yes |
| Power loss after a commit | `synchronous=NORMAL` WAL: the last commits may be lost, but the database is not corrupted (DATA-017) | Yes, up to the last checkpointed or synced commit |
| Windows shutdown or logoff | No `RunEvent` hook (`lib.rs:172-209`). The process ends and the WAL is replayed on the next open. Only in-flight commands and unsaved UI text are lost (DATA-008). | Yes |
| Crash during migration | That step's transaction rolls back. The next start continues; the backup was taken first. | Yes (`upgrade_tests.rs:347, 369`) |
| Crash during `VACUUM INTO` | A partial `.bak` is renamed to `previous-*` on the next start and a fresh backup is written. The journal is untouched. | Yes (junk file: DATA-011) |
| Failed migration | `migration_failed`, retryable; `reached > from` is reported honestly | Yes (message caveat: DATA-010) |
| Newer schema | Refused before any persistent write (`db/mod.rs:257-262`, `runtime.rs:403-407`; tests `runtime/tests.rs:100, 240`) | Yes |
| Second instance | `open_failed` before any file access (`runtime.rs:330-335`) | Yes |
| Corrupt or unreadable journal | `open_failed`; the file is left byte-for-byte unchanged (test `runtime/tests.rs:72`). Recovery is manual: restore an export or a `.bak`. | Via export or `.bak` only |
| Crash during restore install | Phase `installing` → idempotent rollback from `safety.db` (which includes the WAL) on the next start. R-04 (removing the WAL before the rename) is **not an issue**. | Yes |
| Rollback itself fails | The marker stays `installing`; every start says "preserve the operation directory"; `safety.db` and `safety-attachments` remain | Yes, manually |
| Crash during account or journal deletion | Marker before commit → owned files are never removed; erase-only recovery copies are removed only when the `app_meta` erase marker matches | Yes (but DATA-001 can block startup) |
| Crash during screenshot add | Stray file (DATA-002); the row is not committed | Yes (other data); availability impact |
| Panic on the init thread | Stuck `initializing` until restart (DATA-005) | Yes |
| Disk full | Errors propagate everywhere (`?`). No silent success found. Free-space prechecks only for export, CSV export and restore (`filesystem.rs:110`). | Yes |
| Data directory unavailable or no permission | `data_directory` category, retryable | Yes |

**Possible unrecoverable *in-app* states.** These need manual file intervention; none of them loses committed data:

- DATA-001: a bad cleanup or pending marker;
- a failed restore rollback;
- DATA-002 and DATA-003: restore and erase permanently blocked;
- DATA-004: export, restore and erase blocked by size.

## 6. Backup, restore and migration considerations

- **Pre-upgrade backup** is appropriate and proportionate. It is a consistent copy that includes the WAL, the original is retained across retries, and `upgrade_tests.rs` proves that restoring it gives back the old version. There are no automatic pruning or retention limits, which is documented (`docs/data-model.md:532-538`). Fix the stale message (DATA-010) and partial-file cleanup (DATA-011) rather than adding infrastructure.
- **Restore** is well engineered:
  - the token binds the archive hash and a live dump;
  - prepare re-inspects and re-hashes the source, so the exact validated bytes are installed;
  - a safety copy is taken before the intent marker;
  - rollback is idempotent.

  The gaps are availability (DATA-002, DATA-003, DATA-004) and UX (DATA-014).
- **Data format compatibility:**
  - Archive v1 is validated against a reference schema built by migrating to the archive's version, then migrated forward (`restore.rs:115-119`).
  - Older journals are covered by the real v3, v4 and v8 fixtures.
  - A journal or archive from a newer app is refused.
- **Reinstall and upgrade.** NSIS `currentUser`; the data lives in `%APPDATA%`, outside the install directory. Uninstall offers "Delete the application data" (`README.md` §Windows installer). Whether that checkbox removes all of the data folder (backups, staging, `legal-acceptance.json`) is a **Phase 5** packaging check; it was not verifiable from source.
- **Export as a backup.** It is the only user-facing portable backup. Its reliability therefore depends on DATA-003 and DATA-004. No additional backup infrastructure is recommended. Making export robust to those two findings is sufficient for owner use.

## 7. Already resolved or not an issue (verified)

| Item | Evidence |
|---|---|
| Migration step and version commit atomically; no PRAGMA or BEGIN inside migration SQL | `db/mod.rs:214-242` (lead read) |
| Newer-schema refusal before WAL or any write | `db/mod.rs:255-262`; `runtime/tests.rs:100, 240` |
| Original pre-upgrade backup survives a retry | `db/mod.rs:269-281`; `upgrade_tests.rs:369, 397` |
| Cross-process lock; the second instance touches nothing | `runtime.rs:330-335`; `data_controls/mod.rs:155-168` |
| No manual transactions; panics roll back through the `Transaction` drop; poisoned lock recovered | Grep (L1 Q6); `runtime.rs:188-193` |
| CSV commit atomic; token bound to content, account, lineage and dedup state; no duplicate trades on retry | `csv_import/mod.rs:472-574`, `target.rs:148-204`; tests `tests.rs:233`, `regression_tests.rs:231`, `target_tests.rs:108, 168, 316` |
| A failed save never looks successful | `errors.ts:24-37`, `submissions.ts:33-37`, `operations.ts:26-31`; `submissions.test.ts:15` |
| Revision checks on trade update, reviews, daily reviews and rulebook drafts | §3 |
| Restore WAL removal before rename (R-04) | Covered by the `installing` rollback from `safety.db` (`restore.rs:256-272, 330-349`) |
| Restore staleness and TOCTOU | `restore.rs:93-107`; `archive.rs:456` |
| ZIP traversal and bombs; Windows reserved names | `filesystem.rs:33-67`, `archive.rs:329-464`; `security_tests.rs` |
| Referenced screenshot bytes are never deleted | `attachments.rs:374-383`; `deletion.rs:336-338` |
| `legal-acceptance.json` atomic, and outside export, restore and erase | `legal.rs:95-107`; grep |

## 8. Recommended corrections, in order

These are a basis for Stage 2 planning only; nothing was implemented.

1. **Recovery availability (DATA-001, DATA-002, DATA-003):**
   - make the cleanup marker atomic and non-blocking;
   - quarantine bad markers;
   - preserve stray attachment files instead of rejecting them;
   - tolerate and report missing screenshots in restore and export;
   - give each case a distinct message.

   This is one small, cohesive change set in `data_controls`.
2. **Size caps (DATA-004):** stream-hash the live tokens, measure used pages, and make the limit error name the component.
3. **Input loss and duplication (DATA-008, DATA-006, DATA-007):**
   - a native close-requested veto;
   - request IDs for creates;
   - disable writes during long operations;
   - align the commit deadline with the preview's.
4. **P2 polish:**
   - DATA-005: a panic guard;
   - DATA-009, DATA-010, DATA-011, DATA-012 (prune and ignore non-UUID entries), DATA-013.
5. **P3 / informational:** DATA-014 to DATA-019; record the owner's decision on DATA-020.

## 9. Missing regression tests

Tests that do exist are listed in the §7 evidence and in the lane notes; for example `runtime/tests.rs` has 14 and `data_controls/tests.rs` has 21. Tests that do not exist:

| Missing test | For |
|---|---|
| A malformed, empty, oversized or non-regular cleanup marker at startup | DATA-001 |
| A locked file in the cleanup list | DATA-001 |
| A pending marker with an unknown phase, or a missing op dir | DATA-001 |
| A stray `screenshots/<uuid>.png` or `.part` file blocking restore and erase | DATA-002 |
| A crash between rename and commit; a failed `remove_file` after a failed commit | DATA-002 |
| A missing or changed live screenshot during export, restore and erase | DATA-003 |
| A live journal over 64 MiB of pages (incl. free pages), and the `data.json` and total caps | DATA-004 |
| A panic on the init path → Retry still works | DATA-005 |
| A create retried with the same request ID | DATA-006 |
| The commit deadline is at least the preview deadline; writes are disabled during data-control operations | DATA-007 |
| A dirty form vetoes native close (component); a manual title-bar close on Windows | DATA-008 |
| Editing a daily review during a pending save | DATA-009 |
| A second failure after a retry, with message accuracy | DATA-010 |
| Partial-backup cleanup on disk full | DATA-011 |
| A failed prepare leaves no op dir; a non-UUID entry under `data-controls/` | DATA-012 |
| A stale-token retry records no misleading `failed` batch | DATA-013 |
| A crash after install and before `committed` | DATA-014 |
| A rollback failure | DATA-014 |
| A row-count preservation check for every table across all migrations, `risk_promotions` included | DATA-016 |
| A newer journal in WAL mode | DATA-019 |

## 10. Reconciliation register (carried forward from Phase 1 §12; Phase 2 delta)

The scope snapshot in `00-repository-discovery.md` §12.1 still applies. Notion was not refreshed.

| Prior ID / source | Claimed state | Phase 2 evidence (HEAD 4fee79e = source 92e7980) | Verification | Remaining |
|---|---|---|---|---|
| P0-01 to P0-04 (Final Push V1, 2026-10-22) | Merged | P0-02 risk promotion is in an IMMEDIATE transaction (`store/risk_promotion.rs:341`), append-only (migration 21). P0-04 CSV limits and identity are enforced in `csv_import` (`parse.rs:8-9`, `dedup.rs:40-61`). Commit atomicity and preview binding are verified (§3). | Partially Confirmed (source; tests not run) | Phase 5 runs the tests. P0-01 and P0-03 are not examined in this phase. |
| Build 26.5–26.7 recovery reliability (`docs/architecture/build-26.5-26.7-recovery-reliability.md`) | Implemented; packaged acceptance pending | The runtime state machine, failure categories and retry behaviour match the docs. New gaps: DATA-001 and DATA-005. | Partially Confirmed | Manual recovery acceptance on Windows (open gate) |
| Builds 24–25 data controls (`docs/handoffs/build-24-*.md`) | Implemented | Export, restore and deletion are implemented and well guarded. Availability gaps: DATA-001 to DATA-004 and DATA-012. `docs/data-model.md:362` still says permanent delete is "Not implemented" (R-26; stale doc). | Partially Confirmed | Stage 2 to fix; Phase 6 to record the doc drift |
| P0-13 / NA-3 owner-only notice v1.1 | Open | Unchanged. The legal record's persistence is sound and correctly outside journal export, restore and erase. | Confirmed open | Integrate the v1.1 text (not authorized here) |
| Manual recovery / offline acceptance | Open (unrun gate) | Source supports recovery. DATA-001 and DATA-008 must be part of the manual checklist: a bad marker, and title-bar close with unsaved text. | Unrun gate | Phase 5 gate register |
| Other open baseline items (candidate installer, accessibility, cohort, P0-09, NA-7, P0-18, P0-10, D5, 0BSD, P0-05) | Open or owner disposition | Not in Phase 2 scope; unchanged | — | As in Phase 1 §12.2 |

**Separation of categories:**

| Category | Items |
|---|---|
| Confirmed defects | DATA-001, -002, -003, -004, -005 (latent), -010, -011, -012, -013, -014 |
| Partially confirmed or hypotheses | DATA-006, -007, -008 (WebView2 close behaviour), -009, -015, -017, -018, -019 |
| Latent or design | DATA-016 |
| Owner decision | DATA-020; whether disclosed retention of deleted-account data in recovery copies (DATA-012) is acceptable |
| Unrun gates | Windows manual recovery; title-bar close check; uninstall data-retention check |
| Deferred | None added |
| Escalation | **None required.** No evidence was found of a serious loss of committed data or a security issue. |

**Preliminary risk mapping** (from Phase 1):

| Phase 1 risk | Outcome in Phase 2 |
|---|---|
| R-02 | DATA-002 |
| R-03 | DATA-017 (Low, Unverified as a loss path) |
| R-04 | Not an issue |
| R-05 | DATA-001 |
| R-06 | DATA-011, DATA-012 |
| R-07 | DATA-004 |
| R-09 | DATA-018; shutdown itself is safe |
| R-10 | DATA-005 |
| R-11 | DATA-006 |
| R-12 | DATA-007 |
| R-13 | Code confirmed but fails safe (lane 3 C3); left to Phase 4 |
| R-14 | Partly DATA-007 |
| R-18 | DATA-008 / DATA-009 (stale-draft overwrite is warned and consented: not an issue) |
| R-28 | DATA-016 |
| R-01 | Phase 3 (data view: DATA-007) |
| R-08 | Phase 3 |

## 11. Checks, verification limits and remaining uncertainties

### Commands executed

All commands are read-only and offline, run from the repository root unless stated.

| Command | Result |
|---|---|
| `git branch --show-current`; `git rev-parse HEAD`; `git status --porcelain -uall`; `git diff --stat 92e7980 HEAD -- . ':!code-review'` | Exit 0. Branch `claude/practical-turing-wmii06`, HEAD `4fee79e`, clean tree, no source diff. |
| `echo ${FUNDEDFLOW_UPDATE_FIXTURES-unset}` | `unset` |
| `ls ~/.cargo/registry`, `apps/desktop/src-tauri/target`, `node_modules` | All absent |
| `sed -n`, `grep -rn` over `apps/desktop/src-tauri/src` and `apps/desktop/src` (run from `apps/desktop/src-tauri` and the root) | Exit 0 |

### Skipped checks

- `cargo test --offline --locked` (in `apps/desktop/src-tauri`): **skipped**. There is no Cargo registry cache or vendored dependencies; fetching crates would need the network, which is not authorized.
- `npm test`: **skipped**. There is no `node_modules`; `npm ci` would download.
- No isolated disposable-data experiments were possible without the toolchain dependencies.

All findings are therefore **source-traced, not executed**. Confirmed means the execution path was read in code.

### Platform

Linux. No NTFS, WebView2 or `%APPDATA%` behaviour was observed. The following stay **Unverified** until Windows evidence exists (Phase 5):

- Windows rename, persist and replace semantics;
- the effect of antivirus and indexer locks;
- `beforeunload` on a title-bar close (DATA-008).

### Remaining uncertainties

- Whether real journals reach the caps in DATA-004, and how fast.
- Whether a 50k-row import commit exceeds 30 s on typical hardware (DATA-007).
- Whether the bundled SQLite fsyncs `VACUUM INTO` output before migration commits (L1, Low confidence).
- What the NSIS uninstall "Delete the application data" option removes.
- Store modules not individually traced: `catalogue`, `authoring`, `offers` and `evidence` internals beyond their transaction pattern, `snapshots` / `freshness` / `insights` (read-only paths). Lane 3 covered their write pattern by sampling.

## 12. Agent assignments and lead verification

| Lane | Scope | Returned | Lead re-verification |
|---|---|---|---|
| L1 SQLite lifecycle | db, steps, migrations, runtime, store transaction sampling, settings | Yes | `db/mod.rs:145-286`, `runtime.rs:138-175, 255-362`, `commands.rs:500-515` read in full. DATA-005 and DATA-010 confirmed; DATA-001 (L1 F2) confirmed. |
| L2 Files, archive, restore | attachments, data_controls/*, legal | Yes | `attachments.rs:190-300`, `restore.rs:115-140, 160-349`, `archive.rs:66-95, 138-173`, `deletion.rs:128-136, 200-220, 284-295, 318-345`, `filesystem.rs:116-150` read. DATA-001 to DATA-004 confirmed; R-04 confirmed not an issue. |
| L3 Import, store, frontend | csv_import, store write paths, frontend submissions and drafts, settings | Yes | `csv_import/mod.rs:608-624` read (DATA-013). Grep confirmed no `onCloseRequested`/`CloseRequested` and no request-ID fields (DATA-006, DATA-008). |

There were no conflicts between lanes. L1 F2 and L2 F3 were merged into DATA-001, and L1 F8 and L2 F7 into DATA-014.
