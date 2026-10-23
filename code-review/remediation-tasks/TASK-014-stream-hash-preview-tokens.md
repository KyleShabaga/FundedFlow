# TASK-014 — Fix: restore/deletion preview tokens hash the live journal without a capped full dump

| Field | Value |
|---|---|
| Status | Ready for Approval (r5) |
| Type | Fix |
| Audit priority | P1 (P0 if TASK-010 escalates) |
| Roadmap lane | Unassigned (owner) |
| Mandatory gate | No |
| Severity | Medium |
| Confidence | High |
| Canonical issue | ISSUE-002 (part b) (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | DATA-004 |
| Source card / date | Stage 1 audit 2026-10-22 |
| Wave | W1 |
| Effort / risk | M / High (destructive flows' safety token) |
| Verification platform | Any OS |
| Path convention | Paths starting `src-tauri/` are under `apps/desktop/`; `features/`, `lib/`, `journeys/`, `design-system/` are under `apps/desktop/src/` unless written in full |
| Inspected source revision | 9430f2a (application source identical to 92e7980) |
| Specification revision | r5 (2026-10-22; r4 + board review fixes) |
| Execution log | `code-review/11-remediation-execution-log.md` — created by the first task executed after approval (template in 08 index §I); every task appends its evidence there |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / a7310fd (HEAD). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | — (none; requires Kyle's explicit approval of this task ID and specification revision) |

## Purpose / risk
Restore inspect (`src-tauri/src/data_controls/restore.rs:56-67, 77`) and deletion preview (`deletion.rs:133`) call `archive::dump(live)` and inherit its caps, so a large journal cannot be erased or restored over. Restore-over has a second cap on the confirm path: `prepare` takes the local safety copy with `archive::snapshot(c, safety.db)` (`restore.rs:126`), which refuses a file over `MAX_ENTRY` (`archive.rs:196-198`). Fixing only the token would let inspect return a valid preview and token that confirm then rejects with `LimitExceeded` (the preview-passes, confirm-fails pattern of ISSUE-003).

## Trigger / reproduction
Large live journal.

## Root cause / evidence
Live-side token derived from a capped, fully materialised dump; the restore safety copy reuses the export snapshot and its archive entry cap.

## Expected change scope
`src-tauri/src/data_controls/restore.rs` (`content_hash`, `counts`), `src-tauri/src/data_controls/deletion.rs` (`preview`), possibly a streaming hash helper in `archive.rs`; tests. Also replace `archive::dump(&simulation)` at `deletion.rs:175` and the per-account counts at `deletion.rs:190-205`. Restore safety copy: `archive.rs` `snapshot` (`:174-200`) gains an uncapped local variant (for example a size-limit parameter, `None` for the local safety copy) used only by `restore.rs::prepare` (`:126`); export (`archive.rs:231`) keeps the capped call unchanged. Named fixture: `packages/domain/test/fixtures/data-controls-wire.json`, one value (`requiredFreeBytes` of `inspect_journal_archive`, step 5).

## Out of scope
Export-side caps (export at `archive.rs:231` stays capped) and archive format: TASK-009 decision (5) keeps archive v1 strict, and any format change is a separate versioned change.
The in-memory `clone_db` used by the account simulation (`deletion.rs:82-92`; RAM use grows with the journal) and computing the hash inside one read transaction are not changed here (audit SHOULD and NIT); record them as a new Triage card.

## Implementation approach
1. Before branching: create or link the Notion roadmap Triage card for this task (CLAUDE.md plan of record); branch `feat/build-<n>-<slug>` and link the card in the PR. (Notion writes need their own approval; Block 4A.)
2. Introduce a streaming, deterministic hash of live table contents covering the same tables as `dump` and including rowids, in the same table/row order, without the size cap.
3. Use it for the restore `token` and the deletion preview tokens.
4. Compute per-table counts before and after the account simulation (`deletion.rs:133, 175-181`), the blocked-path per-account counts (`:190-205`) and the journal-scope counts (`:214-217`) with `count(*)` queries, not a full dump; `replacedEntities` output must stay byte-identical. `packages/domain/test/fixtures/data-controls-wire.json` changes only as step 5 allows (the `inspect_journal_archive` entry's `requiredFreeBytes`); every other value, including every `replacedEntities` count, is byte-identical.
5. Restore safety copy (audit MUST, option (a)): the local pre-restore safety copy (`restore.rs:126`) is exempt from the archive entry cap, because it never enters an archive. Use an uncapped variant of `archive::snapshot`; keep everything else `snapshot` does (refuse an existing destination, `journal_mode=DELETE`, owner-only permissions on Unix, `sync_all`, and TASK-013's free-page removal of the temporary snapshot). Before taking it, check free space at the operation folder with `space()` (`filesystem.rs:110`) for twice `page_count × page_size` of the live journal, which also covers committed pages still in the WAL that the backup copies (the backup copies free pages before TASK-013's free-page removal runs, and that removal needs room for a second copy); a shortfall fails before `data-controls-pending.json` is written, leaving only the inert operation folder that any `prepare` failure leaves today (`restore.rs:112`). Export keeps the capped `snapshot` (TASK-009 decision (5)). Inspect must report the same requirement, so preview cannot pass where `prepare` then fails with `InsufficientSpace`: today `inspect` checks only `space(root, MAX_TOTAL * 4)` (`restore.rs:70`) and advertises a fixed `required_free_bytes` of `MAX_TOTAL * 4 + 16 MiB` (`restore.rs:80`); both gain twice the live journal size (`page_count × page_size`, the same figure `prepare` checks, which covers the database and the committed WAL pages). Formula: `inspect` checks `space(root, MAX_TOTAL * 4 + 2 × page_count × page_size)` (`space` adds its own 16 MiB margin, `filesystem.rs:110-113`) and advertises `required_free_bytes = MAX_TOTAL * 4 + 16 MiB + 2 × page_count × page_size`. Put the required-bytes calculation in one pure function (inputs `page_count` and `page_size`; outputs the figure `inspect` checks, the figure it advertises and the figure `prepare` checks) used by both `inspect` and `prepare`, because `space()` calls `fs2::available_space` directly (`filesystem.rs:110-113`) and cannot be driven by a test; alternatively inject the available-space figure into the check.
   Wire fixture knock-on (named fixture): `required_free_bytes` is serialized as `requiredFreeBytes` and pinned in `packages/domain/test/fixtures/data-controls-wire.json:162` (`1090519040` = `MAX_TOTAL * 4 + 16 MiB`); `normalize()` does not mask it (`src-tauri/src/data_controls/wire_tests.rs:4-28`) and the wire test calls `inspect` (`wire_tests.rs:63-70`, output at `:83`). The value stays deterministic, so no masking is added: the test's live journal is a fresh migrated journal after a whole-journal erase (`wire_tests.rs:43-62`), so the new value is `1090519040 + 2 × page_count × page_size` of that small journal, fixed for a given schema and bundled SQLite. This card therefore regenerates this one fixture, and its diff is limited to that one `requiredFreeBytes` value in the `inspect_journal_archive` entry. Merge order with TASK-016, which also regenerates this file: whichever of TASK-014 and TASK-016 merges second rebases onto the other and regenerates with the same command, and its diff is limited to its own change. A later migration that changes the fresh journal's page count moves this value too (TASK-042 r2 covers that case).
6. Hash framing (audit SHOULD): the hash input is unambiguous: a domain tag (for example `live-content-v1`); per table, the table name and its column names; per row, a rowid-or-none marker; per cell, a type tag plus a length-prefixed value (so Integer `1` and Text `"1"` differ and no concatenation collides). Enumerate tables through one helper shared with `dump()`, so TASK-012's allow-list applies to both and cannot drift. Invalid UTF-8 text keeps `dump`'s `Integrity` result. The blocked-path `count(*)` keeps today's rule (`deletion.rs:191-200`): the first column named `account_id` or `owner_account_id`, Text equality with the account id.
7. Tests: erase preview and restore inspect succeed on a journal over the dump cap; token changes when any row (incl. rowid-only change) changes; restore-over a journal whose **used** data exceeds `MAX_ENTRY` (for example large text in an existing column of a disposable journal): inspect → `prepare` succeeds and writes `safety.db` larger than `MAX_ENTRY`; `recover` installs; a separate run through `recover_failing` (`restore.rs:351-353`) rolls back and the live journal's content hash equals the pre-restore hash; export of the same journal still returns `LimitExceeded` (guard); `prepare` with insufficient space for the safety copy fails before writing `data-controls-pending.json`; `inspect` on an over-cap journal returns `required_free_bytes` that includes twice the live journal size, and with free space below that figure `inspect` itself returns `InsufficientSpace` (not only `prepare`); a unit test asserts the pure required-bytes function from step 5 for given `page_count` and `page_size`, and the `InsufficientSpace` cases use that function or an injected available-space figure, not the test machine's real free space.

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-013; TASK-010 result (priority).
- Likely shared-file conflicts: `restore.rs`/`deletion.rs` with TASK-015/016/017; `archive.rs` `snapshot` with TASK-013.
- TASK-013 coordination: TASK-013 r4 VACUUMs the temporary snapshot before the size check at `archive.rs:196-198`. That removes free pages only, so it does **not** cover this case: a journal whose used data exceeds 64 MiB still fails there. This card's uncapped variant keeps whatever free-page removal TASK-013 lands (VACUUM of the temporary snapshot, or `VACUUM INTO`).

## Acceptance criteria (pass/fail)
- [ ] New over-cap preview tests pass; fail before.
- [ ] Restore-over test: a live journal with used data over `MAX_ENTRY` → inspect, `prepare` and `recover` succeed; the rollback run restores it with an unchanged content hash. The test fails before the change (`prepare` returns `LimitExceeded`).
- [ ] Guard test: export of that journal still returns `LimitExceeded`.
- [ ] Test: `prepare` with too little free space for the safety copy fails before any pending-restore marker is written.
- [ ] Test: for a live journal over the dump cap, `inspect`'s `required_free_bytes` includes twice the live journal size (database + WAL, as `page_count × page_size`), and with free space below that figure `inspect` returns `InsufficientSpace` (preview does not pass where `prepare` would fail). Fails before the change (`inspect` checks only `MAX_TOTAL * 4` at `restore.rs:70` and advertises a fixed figure at `restore.rs:80`).
- [ ] Hash test: Integer `1` and Text `"1"` in the same cell give different tokens; moving a value between adjacent cells changes the token.
- [ ] Stale-token tests still pass (`data_controls/tests.rs` stale-preview cases).
- [ ] Full Rust and root checks → exit 0.
- [ ] Unit test of the pure required-bytes function (step 5): the figures `inspect` checks and advertises and the figure `prepare` checks, for given `page_count` and `page_size`. The `InsufficientSpace` tests do not depend on the test machine's real free space (`space()` reads `fs2::available_space` directly, `filesystem.rs:110-113`).
- [ ] Named fixture `packages/domain/test/fixtures/data-controls-wire.json`: its diff is limited to the `requiredFreeBytes` value of the `inspect_journal_archive` entry (`:162`), now `1090519040 + 2 × page_count × page_size` of the wire test's journal (step 5); every `replacedEntities` count and every other value is byte-identical (diff reviewed in the PR).
- [ ] Fixture regeneration (this card names `data-controls-wire.json`): regenerate it with the single wire test only, never the whole suite, because `wire_tests.rs:90` rewrites the fixture whenever `FUNDEDFLOW_UPDATE_FIXTURES` is set (`is_some`, any value) and other tests rewrite other fixtures under the same variable. In `apps/desktop/src-tauri` (bash): `FUNDEDFLOW_UPDATE_FIXTURES=1 cargo test --offline --locked --lib data_controls::wire_tests::native_data_control_outputs_match_portable_wire_fixture -- --exact` → exit 0 (PowerShell: set `$env:FUNDEDFLOW_UPDATE_FIXTURES='1'`, run the same command, then `Remove-Item Env:FUNDEDFLOW_UPDATE_FIXTURES`). Then, with the variable unset, `cargo test --offline --locked` → exit 0. `git diff --name-only` shows `data-controls-wire.json` as the only changed fixture file. If TASK-016 merged first, rebase onto it and regenerate with the same command; the diff against the rebased base is still limited to that one value.
- [ ] Apart from that single-test regeneration, keep `FUNDEDFLOW_UPDATE_FIXTURES` **unset (not `0`)** for every check; never regenerate any other fixture.

## Verification plan
Existing stale-preview and erase tests in `data_controls/tests.rs`; `current_schema_tests.rs`.

Standard checks (run serially, frontend build before Rust):
- Repository root: `npm run check:boundaries -w @fundedflow/domain` → exit 0
- Repository root: `npm run typecheck` → exit 0
- Repository root: `npm test` → exit 0 (domain + desktop Vitest incl. journeys/axe, test:notices, test:ci-scripts)
- Repository root: `npm run build` → exit 0 (includes the dev-tools dist check)
- Repository root: `npm run check:dist -w @fundedflow/domain` → exit 0
- `apps/desktop/src-tauri`: `cargo test --offline --locked` → exit 0 (after `npm run build`, run serially)
- `apps/desktop/src-tauri`: `cargo clippy --offline --locked --all-targets -- -D warnings` → exit 0

## Safety, rollback and side effects
Use only disposable test journals and temporary directories created by tests. Never open, migrate, copy, seed or reset the real `%APPDATA%\com.fundedflow.desktop` journal. Do not edit shipped migrations, `test_csvimport/Performance.csv` or `src-tauri/src/db/fixtures/*.db`.

## Definition of done
Code merged through an approved PR on a `feat/build-<n>-<slug>` branch per CLAUDE.md; diff reviewed; new regression tests fail before and pass after the change; every acceptance criterion has recorded evidence (command, directory, exit code); Windows-only criteria have owner/VM evidence. Compiling or passing unrelated tests is not completion.

## Changes in r3
- Audit priority: "P1" → "P1 (P0 if TASK-010 escalates)", and TASK-010 result (priority) added to prerequisites: the approved TASK-010 decision says that if 64 MiB is reachable within 12 months ISSUE-002 escalates to P0 and the TASK-013/014 priorities are updated (TASK-013 already carried this; TASK-014 did not).
- Out of scope: replaced "archive format, owner decision" with the approved TASK-009 decision (5): archive v1 stays strict; a format change is a separate versioned change.
- Fixture rule: "unset" → "unset (not `0`)" per 10 §8.3 ("Fixture rule on all cards"), because `wire_tests.rs:90` rewrites the fixture whenever the variable is set; this card's byte-identical fixture criterion depends on it.

## Changes in r4
- Purpose, root cause, scope, step 5, tests and criteria: the local restore safety copy (`restore.rs:126` → `archive::snapshot`, capped at `archive.rs:196-198`) is exempt from the archive entry cap, with a `space()` check and an over-cap prepare + recover + rollback test (audit MUST, TASK-014; option (a), which keeps the card's purpose; option (b) would narrow it). TASK-013 r4 does not cover this: its VACUUM removes free pages only. Export stays capped.
- Step 6: unambiguous hash framing, one table enumerator shared with `dump()`, invalid UTF-8 → `Integrity`, and the blocked-path `account_id`/`owner_account_id` rule (audit SHOULD, hash framing; audit NIT on `deletion.rs:191-200`).
- Conflicts: `archive.rs` `snapshot` shared with TASK-013 (follows from the MUST).
- Fixture rule unchanged: `FUNDEDFLOW_UPDATE_FIXTURES` unset (not `0`).
- Steps 3-4: `deletion.rs:175` is a dump used only to count removed rows (`:176-181`), not a hash comparison; it moves to the `count(*)` step with the before/after (`:133, 175-181`), blocked-path (`:190-205`) and journal-scope (`:214-217`) counts (independent review (review4), reviewer A N1).
- Step 5: the free-space check uses twice `page_count × page_size`, which covers WAL content, instead of the main file size (independent review (review4), reviewer A N2).
- Out of scope: the skipped audit SHOULD on `clone_db` RAM use (`deletion.rs:82-92`) and NIT on hashing inside one read transaction are recorded for a Triage card (independent review (review4), reviewer A N3).

## Changes in r5
- Step 5, tests and criteria: `inspect`'s free-space check (`restore.rs:70`) and advertised `required_free_bytes` (`restore.rs:80`, fixed `MAX_TOTAL * 4 + 16 MiB`) include twice the live journal size (database + WAL), with a test that an over-cap journal with insufficient space is reported by `inspect`, not only by `prepare` (board review 2026-10-22).
- Steps 4-5 and criteria: the step 5 change alters `requiredFreeBytes`, pinned in `data-controls-wire.json:162` and not masked by `normalize()` (`wire_tests.rs:4-28`; the test calls `inspect`), which contradicted "fixture unchanged" and "byte-identical, never regenerate". The fixture is now named, its diff limited to that one value (`1090519040 + 2 × page_count × page_size` of the wire test's fresh journal, deterministic), regenerated with TASK-016's targeted single-test command and then a full run with the variable unset; `replacedEntities` stays byte-identical; merge order with TASK-016 stated. The required-bytes calculation becomes a pure function with a unit test, because `space()` calls `fs2::available_space` directly (`filesystem.rs:110-113`) (board review re-check 2026-10-22).

## Independent review notes
Independent review r1: CHANGES (applied, 08 §H). Independent re-check r2: READY.
Independent review (currency pass, 2026-10-22): two reviewers plus a re-check of the blocking fixes; READY at r3.
Independent review (approved-task audit fixes, 2026-10-22): three reviewers plus a re-check of the blocking fixes; READY at r4.
Board review (2026-10-22, against main 92e7980): APPROVE WITH NOTE; notes folded in at r5. Independent re-check of r5: pending.
