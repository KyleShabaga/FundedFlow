# Build 17 CSV backend hardening and parity handoff

Source: [Build 17](https://app.notion.com/p/3fe1bd4b6bde810da797e8277b9011c9).
Branch `feat/build-17-csv-regressions`, isolated worktree `/workspace/FundedFlow-build17`, starts from main
`475807db1cf17aad0d1416067993d01a7b3b47a9` (merged Build 12). Builds 13 (#33) and 14 (#32) were open during the
audit. No unfinished changes were imported. The original checkout and Build 14 worktree are untouched.

## Audit: reuse rather than reconstruction

The card's earlier static audit referenced schema v10 at `07a18b8`; this verified base is schema **v13**.
No migration changes are needed. Rust `csv_import/{parse,detect,values,normalize,dedup,mod}.rs` already owns
RFC 4180 parsing, automatic/explicit column mapping, date selection, row validation, financial derivation via
the existing domain/store helpers, deduplication, read-only preview, atomic commit and history. The existing
`test_csvimport/Performance.csv` is unchanged. Its original 67-row compatibility tests remain in use.

The production path remains `JournalRepository.imports` → existing Tauri adapter/commands → Rust → SQLite.
The request/preview/batch DTO schemas, decimal primitives and repository port in `@fundedflow/domain` already
exist. They do **not** implement CSV parsing, timezone interpretation, row normalization or dedup algorithms.
The developer CSV panel and Build 13/14 hooks are existing frontend work, outside this backend scope.

| Requirement | Evidence before / work in this branch |
| --- | --- |
| Generic and paired-fill formats, mapping, source cells, errors/warnings | Existing parser/importer and unchanged Performance fixture; new synthetic baseline covers both formats |
| Account-scoped IDs and fallback identity | New native preview/commit tests cover generic broker IDs, fill pairs and both format-specific fallback keys across two accounts, including a deleted trade in one account |
| 10 MiB inclusive UTF-8 byte cap | New exact-cap and one-byte-over native preview/commit tests; multibyte source metadata survives losslessly at the cap |
| 50,000 data rows inclusive | New boundary commit persists all 50,000 row records; 50,001 rejects without committing a truncated prefix |
| Preview overflow | New >2,000 test summarizes only a clean new row and retains late invalid, warning, blank, duplicate and restore rows; commit persists omitted rows too |
| Preview is read-only; commit revalidates | Preview-exit subprocess leaves no import records; commit reclassifies after an intervening import/deletion |
| Atomicity and restart/reimport | Existing late ABORT test plus new file-backed ROLLBACK test revert both a restoration and a new insert; reopening and reimporting remain idempotent |
| Zero-trade outcomes | All-invalid and blank-only batches commit row history; duplicate-only batches retain linked IDs and survive repeated file reopen |
| Immutable provenance | New edit/delete/restore/corrected-source/reopen test retains original trade/batch/row references, cells, mapping and paired-fill source values; immutability triggers reject changes |
| Source differences and date policy | New mixed-locale rows keep the single-file format; fee/note corrections stay duplicates, equivalent decimal/time text canonicalizes, changed actual milliseconds or format can create new fallback identities |
| Portable algorithm parity | Not implemented/claimed. Versioned Rust baseline plus existing TypeScript DTO/primitive checks provide a future parity corpus; coordinated extraction remains pending |
| Real provider cohort and packaged Windows acceptance | Pending Build 3 source confirmation and Windows/Tauri acceptance; synthetic fixtures and native Linux SQLite tests are not that evidence |

## Independently scoped fixes

1. **Duration overflow:** clock-form duration accumulation previously used unchecked multiply/add and could
   panic in debug or wrap in release. It now uses checked arithmetic. Performance rows also reject durations
   beyond signed i64 storage before the u64→i64 database conversion. Invalid durations remain row errors so
   other valid rows can commit. No second duration or financial normalizer was added.
2. **Minimum money warning:** formatting a P&L mismatch called `i64::abs()` on i64::MIN. It now formats the
   signed decimal using the existing helper before moving the sign around the dollar symbol. The exact
   persisted value and P&L calculation are unchanged.
3. **Unrepresentable paired-fill order:** distinct fill instants inside the same stored millisecond could
   preview as a valid ordered trade but conflict with SQLite's paired-source ordering CHECK. These rows now
   report a millisecond-precision validation issue and retain original cells as invalid import history.
   No timestamps, side, P&L or existing dedup identities are silently changed to force a fit.

Regression tests reproduced the two numeric panics and the incorrect preview classification before fixing
them. Existing per-row/generic validation can emit both `entryTime` and `entryAt` for one bad timestamp; tests
check the date-format error without treating that existing message shape as a new stable issue-code contract.

## Golden baseline and how to use it

`test_csvimport/build17/normalization-v1.json` is a language-neutral **test artifact**, not a new production
request DTO, API, normalization implementation or approved cross-host execution contract.

- `fixtureVersion: 1` versions the fixture envelope; `behaviorBaseline: "rust-csv-v1"` labels this observed
  implementation. Existing persisted keys and IPC payloads acquire no new version field.
- Each case contains a synthetic account context and existing CsvImportRequest; expected preview, dedup keys
  and normalized batch DTO come from Rust. Only generated batch/account IDs and wall-clock timestamps are
  replaced with fixed placeholders. Content SHA-256, raw cells, line numbers, warning/error text and nulls
  are real Rust outputs. Production instrument seeds and timezone data are dependencies of the baseline.
- Cases cover fees/micro rounding, equivalent UTC offsets, duplicate identity, paired short order, missing
  fill/tick warnings, DST gap/overlap, explicit DST offsets, P&L fallback/missing values, currency mismatch,
  mixed dates, source timezone changes, signed minimum money and invalid duration/submillisecond order. One case explicitly records the existing fill-ID delimiter collision as a known defect, not accepted correct behavior.
- `golden_tests.rs` re-executes the real preview/commit paths and compares structured JSON exactly. Update
  intentionally with `FUNDEDFLOW_UPDATE_CSV_FIXTURES=1 cargo test --locked --lib normalization_v1_golden_baseline_matches_rust`
  in `apps/desktop/src-tauri`, then review the output diff.
- `packages/domain/test/contracts/build17-csv.test.ts` accepts the same request/preview/batch through the
  existing schemas without dropping fields and checks canonical financial values with existing primitives.
  It does **not** compute a TypeScript CSV preview or keys. Passing it proves DTO/primitive compatibility,
  not Rust↔TypeScript normalization parity. Do not redirect V1 writes based on this test.

## Coordinated decisions and dependencies

These require review before changing shared contracts, stored identities or architectural ownership. This
branch keeps the current authority and records the dependencies; it does not assume approval to defer the
card's portable implementation goal or mark it Done.

| Decision / gap | Concrete dependency and safe next step |
| --- | --- |
| Portable parser/normalizer ownership | Coordinate with Build 8.5/16. Define a versioned pure input containing account currency/reset zone, selected source zone/date/mapping, instrument metadata and explicit timezone rules. Keep SQLite duplicate lookup, provenance/history and commit transactions in Rust. Reuse current money/domain policies; extract incrementally with the same golden corpus. |
| Versioning and deterministic findings | Today FieldIssue has field/message, not stable warning codes; source exporter/version is not a required DTO field; persisted dedup keys are unversioned. Approve serialization/version/error-code rules before a cross-host implementation. Version 1 above is only a fixture baseline. |
| Frontend byte-cap mismatch | The existing request schema uses JS string `.max(MAX_CSV_BYTES)`, measuring UTF-16 code units, while Rust caps UTF-8 bytes. Rust remains authoritative and the new native cap tests pass; a multibyte payload can pass TS early validation and be rejected natively. A portable UTF-8 byte-count validator in the shared contract needs coordinated domain/adapter tests. This branch does not edit those production files. |
| Very large duration wire values | SQLite can hold durations through signed i64, while TypeScript JSON number/int validation cannot represent all of that range exactly. Approve either a safe-integer cap or string serialization in the shared contract before claiming full range parity. The new native guard prevents signed storage wrap; it does not resolve this wire decision. |
| Precision and identity corrections | Existing UTC persistence is milliseconds. Equivalent textual precision does not change identity; an actual changed millisecond can. Fees/notes are excluded from fallback identity. Cross-format identities differ. Do not change keys or overwrite original rows as an incidental normalization migration; require versioned compatibility/migration and explicit correction/replace policy. |
| Fill-ID delimiter collision | IDs currently permit colons, but `fills:<buy>:<sell>` does not escape them: pairs `(a:b,c)` and `(a,b:c)` collide. The known-limitation fixture records the current duplicate result. Fixing saved identities requires an approved versioned encoding, compatibility lookup/migration and shared parity tests; do not silently change existing keys or edit shipped migrations. |
| Supported source cohort | Build 3 must approve real provider/export versions and de-identified expected fixtures. These synthetic cases and the existing Performance example cannot certify all exporter versions or reconstruct arbitrary partial-fill executions. |
| Raw encoding | Rust receives a UTF-8 String, not original file bytes. Original-byte decoding/unsupported-encoding detection and file-picker cancellation belong to the host/wizard contract; no React/file-picker change is included. |
| UI integration | Build 18 owns mapping correction, review, accessible confirmation/cancel and result/recovery UX. Reuse the existing port and Build 13/14 presentation/data work. No frontend file changed here. |

## Recovery claims and limits

The real file-backed tests close and reopen SQLite, preserve failed-attempt history independently of rolled
back row/trade bundles, retry after failure, and repeat dedup-only commits. A child process previews then
exits abruptly without running destructors before confirmation; reopening shows no import writes. A
ROLLBACK trigger interrupts a late transactional write after a restore and insertion, proving those changes
roll back together. The original ABORT failure test is retained.

These do not establish a mid-write OS kill/power-loss guarantee, disk-controller durability or packaged
Windows behavior. The database still uses its existing WAL / synchronous NORMAL policy. No schema/migration,
backup, runtime recovery or transaction authority was changed. Run a controlled disposable-journal process
kill during commit, reopen/integrity checks, and real Windows Tauri preview/commit/cancel before full native
acceptance. Never infer user-facing cancellation after commit has been sent, or replay an uncertain write
without checking persisted history/results.

## Verification evidence

Executed in the isolated Linux worktree using Rust 1.99.1 and the workspace-provided native GTK/WebKit
sysroot/runner (`source /workspace/.tools/fundedflow-env.sh`). Native execution required the configured
runner outside the shell's ptrace sandbox; it ran real Rust code and bundled SQLite, not mocked repository
calls. The initial default-sandbox runner denial is an execution restriction, not a test result.

| Check | Result |
| --- | --- |
| Baseline `cargo test --locked --lib csv_import` before edits | 26 passed |
| Final `cargo test --locked --lib csv_import -- --test-threads=4` | **41 passed**, 1 ignored worker; parent invokes that worker explicitly and verifies exit code 37 |
| Rust golden baseline (normal update flag absent) | Passed during final CSV suite; 15 synthetic cases |
| `cargo clippy --locked --all-targets -- -D warnings` | Passed |
| Full `cargo test --locked` | **164 passed, 4 failed, 2 ignored**; the same four pre-existing legacy-rulebook failures also reproduce with 4 workers |
| Untouched main `cargo test --locked --lib db::legacy_rulebook_tests -- --test-threads=1` | **3 passed, the same 4 failed** at main `475807d`, from disposable `/tmp/fundedflow-build17-main-check` |
| `npm run typecheck` | Passed domain and desktop |
| `npm test` | **338 domain + 161 desktop = 499 passed**; 31 new CSV contract/primitive checks |
| `npm run build` | Passed domain and desktop production build |
| `npm run check` | Passed domain boundary and dist checks (143 exports) |
| `git diff --check` | Passed |
| Packaged Windows/Tauri smoke and real mid-commit OS kill | Not run; acceptance remains pending |

The four full-suite failures are `db::legacy_rulebook_tests::{assignment_intervals_follow_effective_from_and_contain_their_snapshots,
legacy_parameters_use_only_the_keys_the_matrix_maps, rule_keys_are_unique_per_version,
the_legacy_rules_fixture_covers_every_matrix_case}` with SQLite SystemIoFailure / extended code 1802.
The source opens a read-only connection from a temporary Journal owner whose Drop removes the fixture's
copy before later queries; those unrelated files were not changed. Full Rust validation is therefore
**not green**, even though every CSV test and Clippy passed. Windows CI must still run; no result is assumed.

Tracked dependencies (created in the existing roadmap's Triage lane, without assigning dates or owners):

- [Version fill-pair identity to prevent delimiter collisions](https://app.notion.com/p/3ff1bd4b6bde81488c3de52e7eb6d7e2).
- [Align UTF-8 byte and duration wire limits](https://app.notion.com/p/3ff1bd4b6bde81c7b748de494ff1e090).
- [Keep legacy fixture journals alive for Linux SQLite tests](https://app.notion.com/p/3ff1bd4b6bde819499abc89a9f2f9795).

The branch contains only the Rust importer fixes/tests, a new domain **test** (no domain production contract
edits), a separate synthetic test fixture and this new architecture document. No React component, hook,
provider, routing, design file, command/adapter contract, migration, manifest or lockfile was changed.
Build 17 stays **In development** pending portable-boundary decisions/parity, the identity/wire dependencies,
representative-source approval and native Windows/recovery evidence. Build 18 UI is not claimed complete.
