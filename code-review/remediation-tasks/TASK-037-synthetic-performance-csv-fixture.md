# TASK-037 — Fix: replace the real `Performance.csv` export with a synthetic fixture and re-derive its tests

| Field | Value |
|---|---|
| Status | Proposed (r1; awaiting independent review) |
| Type | Fix |
| Audit priority | P1 (TASK-002 follow-up; release-blocking) |
| Roadmap lane | Unassigned (owner) |
| Mandatory gate | Yes — TASK-029 stays Blocked until this task is Verified and merged into the candidate SHA (TASK-002 = B) |
| Severity | Medium (real trading data in a publicly viewable repository) |
| Confidence | High (owner confirmed the files are real exports) |
| Canonical issue | ISSUE-036 (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | TR-020 |
| Source card / date | Notion draft TASK-037 r1 (https://app.notion.com/p/4011bd4b6bde815d8816fd1f5eb50263), created 2026-10-22 under TASK-002 r2 Option B ("Yes APprove"; Kyle: "They are all real exports that I was using for testing") |
| Wave | W1 (TASK-002 follow-up; must merge before W4 / TASK-029) |
| Effort / risk | M / Medium (fixture change can silently weaken coverage) |
| Verification platform | Any OS (Rust CSV-import and store tests); Windows CI on the PR |
| Path convention | Paths starting `src-tauri/` are under `apps/desktop/`; `features/`, `lib/`, `journeys/`, `design-system/` are under `apps/desktop/src/` unless written in full |
| Inspected source revision | 1012d63 (application source identical to 92e7980) |
| Specification revision | r1 (2026-10-22; from the Notion draft, Block 3 format) |
| Execution log | `code-review/11-remediation-execution-log.md` — created by the first task executed after approval (template in 08 index §I); every task appends its evidence there |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / 1012d63 (HEAD). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | — (none; TASK-002 approval authorized creating this card only. Requires Kyle's explicit approval of this task ID and specification revision) |

## Purpose / risk
`test_csvimport/Performance.csv` (8,007 bytes; header + 67 data rows) is a real broker Performance export in a repository whose source is publicly viewable (`README.md:155`). Rust tests embed it with `include_str!` and several tests hard-code identifiers copied from it. Replacing it with synthetic data removes the real rows from the tracked tree while keeping the only real-exporter-format coverage (TASK-007 waived the P0-05 exporter cohort for owner-only V1, so this fixture's shape is the sole real-format evidence).

**Standing-rule exception.** `README.md:118`, `docs/architecture/build-17-csv-backend.md:14` and every remediation card's safety section say `test_csvimport/Performance.csv` must stay unedited. This card is the explicit, owner-authorized exception (TASK-002 Option B) and applies only once this card itself is approved: the file may be replaced in one commit by a synthetic file, nothing else may edit it, and the standing rule then applies to the synthetic file.

## Trigger / reproduction
Repository is public; the file and its copies are readable on GitHub at HEAD.

## Root cause / evidence
Real exports committed as test fixtures (owner confirmation 2026-10-22). Read-only facts at 1012d63 (counts only; no rows were printed):
- Format shape: 13 columns `symbol,_priceFormat,_priceFormatType,_tickSize,buyFillId,sellFillId,qty,buyPrice,sellPrice,pnl,boughtTimestamp,soldTimestamp,duration`; CRLF line endings, trailing newline, no BOM, no quoted fields (`.gitattributes:2` keeps `test_csvimport/*.csv -text`); one symbol; 12-digit fill IDs, 16 IDs shared between rows; `pnl` in `$n.nn` and parenthesised-negative `$(n.nn)` styles; timestamps `MM/DD/YYYY HH:MM:SS`; durations in seconds-only, minutes-and-seconds and single-unit styles.
- Consumers via `include_str!` / `PERFORMANCE`: `src-tauri/src/csv_import/tests.rs:13` (17 uses, 14 tests), `csv_import/regression_tests.rs:27,235` and `csv_import/wire_limit_tests.rs:102-103` (via `use super::*`), `store/attempt_tests.rs:13,305`, `store/insights_tests.rs:24,32,121`, `store/risk_promotion_tests.rs:390-394` (header and first data row).
- Identifiers equal to `Performance.csv` fill IDs hard-coded elsewhere (line numbers only): `csv_import/tests.rs:93,141,173,174,237,238`; `csv_import/regression_tests.rs:245`; `csv_import/identity_tests.rs:73` (its header claims all values are synthetic); `csv_import/wire_limit_tests.rs:108-109`; `test_csvimport/identity/fill-pair-v2.json:7-10` (consumed by `identity_tests.rs:283`); `docs/architecture/p0-01-p0-03.md:42`; `docs/design/mockups/TradeDetail.dc.html:109,111`.
- Checked and **not** copies of any of the three exports (no matching data line and no matching fill ID): `store/attempt_tests.rs`, `store/journal_review_tests.rs` (own inline `CSV`, line 200), `store/risk_promotion_tests.rs` constants, `wire_contract.rs:38` (and so `apps/desktop/src/test/fixtures/command-wire.json`), `db/upgrade_tests.rs:19`, `db/fixtures/generate.rs.txt:18`, `db/fixtures/*.db`, `test_csvimport/build17/normalization-v1.json` (18 inline synthetic cases; no `synthetic-*.csv` files exist), `test_csvimport/limits/byte-limit-v1.json`. The long numerals in the three store test files are timestamps/sizes and UUID constants, not fill IDs.

## Expected change scope
- `test_csvimport/Performance.csv`: replaced (same path, same file name) by a synthetic file with the same header, column order, line endings, value styles and edge cases (rows sharing a fill ID, sell-before-buy rows, negative and positive P&L styles, each duration style, the timestamp format), generated from documented rules, not by editing real rows.
- Assertions that depend on the fixture's values, re-derived from the synthetic file: `src-tauri/src/csv_import/tests.rs`, `csv_import/regression_tests.rs`, `csv_import/wire_limit_tests.rs`, `csv_import/identity_tests.rs:73`, `store/attempt_tests.rs`, `store/insights_tests.rs`, `store/risk_promotion_tests.rs` (only where values change).
- `test_csvimport/identity/fill-pair-v2.json`: replace the copied fill IDs with synthetic IDs and their contract keys, written by hand from the documented P0-01 contract (as `docs/architecture/p0-01-p0-03.md:112` requires), not by running the code under test.
- Fixture guidance and copied identifiers in docs: `README.md:118,149`, `docs/architecture/build-17-csv-backend.md:14,23`, `docs/architecture/p0-01-p0-03.md:42`, `docs/design/mockups/TradeDetail.dc.html:109,111` (identifier text only).

## Out of scope
- `test_csvimport/Performance Oct 20.csv`, `Performance Oct 20(1).csv` and the real pair copied into `csv_import/direction_pnl_tests.rs` (TASK-038).
- Git history, forks, PR pages, repository visibility (TASK-039).
- Regenerating `normalization-v1.json`, `command-wire.json`, `byte-limit-v1.json` or `db/fixtures/*.db` (verified not derived from the export).
- Importer behaviour changes; new formats; mockup layout changes.

## Implementation approach
1. Before branching: create or link the Notion roadmap Triage card for this task (CLAUDE.md plan of record); branch `feat/build-<n>-<slug>` and link the card in the PR. (Notion writes need their own approval; Block 4A.)
2. Before changing anything, record in the execution log (no raw rows): the inventory of every test that consumes the fixture, what each asserts (counts, IDs, duplicate keys, warnings, totals), and the edge cases the fixture must contain. Re-run the identifier scan (fill IDs of all three exports against all tracked files, printing only file:line) and confirm the list above.
3. Write the synthetic file from a short written specification (row count, which rows share fills, which are sell-before-buy, P&L and duration styles), with obviously synthetic fill IDs and plausible, non-real prices and dates on Monday–Friday. Keep the 13-column header byte-identical, CRLF line endings and trailing newline.
4. Re-derive every changed expectation by hand from the synthetic specification (comment the arithmetic beside it, as `direction_pnl_tests.rs` does); never derive expectations by running the code under test and pasting its output.
5. Update `fill-pair-v2.json` and `identity_tests.rs:73` with synthetic IDs and hand-computed keys; correct the "all values synthetic" header only if it still would be untrue.
6. Update the README and doc wording: the fixture is synthetic, mirrors the real Performance export format, and must stay unedited except through an approved card. Replace copied identifiers in the two docs files.
7. Keep a mapping in the PR description of old test name → what it covers → new expected value source, so the reviewer can confirm no coverage was dropped.

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-002 approved (done, Option B). This card's own approval.
- Recommended ordering: record TASK-039's owner disposition before opening this PR on GitHub; a public PR diff re-displays the deleted rows, and a later history rewrite also has to deal with PR refs.
- Independent of TASK-038 (no shared files); either may merge first.
- Likely shared-file conflicts: TASK-040 (formatting touches every Rust test file; see TASK-040 merge order); `README.md` (TASK-026 docs).
- Dependants: TASK-029 (Blocked until this is Verified and merged).

## Acceptance criteria (pass/fail)
- [ ] `test_csvimport/Performance.csv` at the tested SHA is synthetic: a scan for every fill ID and full data line of the original three exports over all tracked files returns no match outside history (record command and count, not values).
- [ ] Header line byte-identical to the original; CRLF endings, trailing newline, no BOM; each listed edge case is present (record row numbers, not values).
- [ ] Every test that consumed the old fixture still exists and still covers its scenario; each changed expectation has a hand-derivation comment; the PR mapping table is reviewed.
- [ ] Affected Rust tests pass (`csv_import::`, `store::attempt_tests`, `store::insights_tests`, `store::risk_promotion_tests`, `identity_tests`) and the full standard checks exit 0.
- [ ] README and doc text no longer describe the fixture as a real export; copied identifiers removed from `p0-01-p0-03.md` and `TradeDetail.dc.html`.
- [ ] Keep `FUNDEDFLOW_UPDATE_FIXTURES` and `FUNDEDFLOW_UPDATE_CSV_FIXTURES` **unset (not `0`)** for every check; never regenerate fixtures unless this card explicitly names the fixture and its diff is reviewed (this card names only `Performance.csv` and `fill-pair-v2.json`, both edited by hand).
- [ ] Evidence (commands, exit codes, tested SHA, gaps) recorded in the execution log without raw CSV rows.

## Verification plan
Targeted: `cargo test --offline --locked csv_import`, `... store::attempt_tests`, `... store::insights_tests`, `... store::risk_promotion_tests`. Identifier scan as in criterion 1. Reviewer reads the derivation comments.

Standard checks (run serially, frontend build before Rust):
- Repository root: `npm run check:boundaries -w @fundedflow/domain` → exit 0
- Repository root: `npm run typecheck` → exit 0
- Repository root: `npm test` → exit 0 (domain + desktop Vitest incl. journeys/axe, test:notices, test:ci-scripts)
- Repository root: `npm run build` → exit 0 (includes the dev-tools dist check)
- Repository root: `npm run check:dist -w @fundedflow/domain` → exit 0
- `apps/desktop/src-tauri`: `cargo test --offline --locked` → exit 0 (after `npm run build`, run serially)
- `apps/desktop/src-tauri`: `cargo clippy --offline --locked --all-targets -- -D warnings` → exit 0

## Safety, rollback and side effects
Never print, paste or log rows or identifiers from the real exports (Notion, chat, PR text, logs, test output). Replace the real file by writing the synthetic file in place; do not open or edit real rows. Use only disposable test journals and temporary directories created by tests. Never open, migrate, copy, seed or reset the real `%APPDATA%\com.fundedflow.desktop` journal. Do not edit shipped migrations or `src-tauri/src/db/fixtures/*.db`. Rollback: revert the PR (this restores the real file at HEAD; the owner must be told). History is unchanged by this task.

## Definition of done
Code merged through an approved PR on a `feat/build-<n>-<slug>` branch per CLAUDE.md; diff reviewed; every acceptance criterion has recorded evidence (command, directory, exit code); the reviewer confirms coverage is preserved. Compiling or passing unrelated tests is not completion.

## Independent review notes
Not yet reviewed. r1 written from the Notion draft; draft scope carried over and made concrete from source at 1012d63. Reviewer to confirm: (a) including the copied identifiers in `fill-pair-v2.json`, `p0-01-p0-03.md` and `TradeDetail.dc.html` is within the draft's "no copied real … identifiers" intent (else split to a Triage card); (b) the coordinator's note that store tests contain copied IDs was not confirmed by the fill-ID scan — those files only consume the fixture.
