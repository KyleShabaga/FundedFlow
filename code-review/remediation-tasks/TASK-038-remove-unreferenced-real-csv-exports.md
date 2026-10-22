# TASK-038 — Fix: remove the two unreferenced real CSV exports and the pair copied from one of them

| Field | Value |
|---|---|
| Status | Proposed (r1; awaiting independent review) |
| Type | Fix |
| Audit priority | P1 (TASK-002 follow-up; release-blocking) |
| Roadmap lane | Unassigned (owner) |
| Mandatory gate | Yes — TASK-029 stays Blocked until this task is Verified and merged into the candidate SHA (TASK-002 = B) |
| Severity | Medium (real trading data in a publicly viewable repository) |
| Confidence | High (owner confirmed the files are real exports; references checked) |
| Canonical issue | ISSUE-036 (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | TR-020 |
| Source card / date | Notion draft TASK-038 r1 (https://app.notion.com/p/4011bd4b6bde81d295e4d49bdcd0ab98), created 2026-10-22 under TASK-002 r2 Option B |
| Wave | W1 (TASK-002 follow-up; must merge before W4 / TASK-029) |
| Effort / risk | S / Low |
| Verification platform | Any OS (reference checks, `direction_pnl_tests`); Windows CI on the PR |
| Path convention | Paths starting `src-tauri/` are under `apps/desktop/`; `features/`, `lib/`, `journeys/`, `design-system/` are under `apps/desktop/src/` unless written in full |
| Inspected source revision | 1012d63 (application source identical to 92e7980) |
| Specification revision | r1 (2026-10-22; from the Notion draft, Block 3 format) |
| Execution log | `code-review/11-remediation-execution-log.md` — created by the first task executed after approval (template in 08 index §I); every task appends its evidence there |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / 1012d63 (HEAD). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | — (none; TASK-002 approval authorized creating this card only. Requires Kyle's explicit approval of this task ID and specification revision) |

## Purpose / risk
`test_csvimport/Performance Oct 20.csv` (4,798 bytes; header + 40 rows) and `test_csvimport/Performance Oct 20(1).csv` (4,984 bytes; header + 41 rows) are real exports in a publicly viewable repository and serve no test.

## Trigger / reproduction
Repository is public; both files are readable on GitHub at HEAD.

## Root cause / evidence
Added in commit `31f1447` ("Add test csv files.", 2026-10-20, merged by PR #25 / `0828db4`); unchanged since. Read-only facts at 1012d63:
- No reference by path: a search for `test_csvimport`, `Performance Oct 20` and both file names over all tracked files (excluding `code-review/`) finds no code, test, script, workflow or doc that reads either file. `.gitattributes:2` (`test_csvimport/*.csv -text`) is a glob and stays for `Performance.csv`.
- One **copy** (not a reader): `src-tauri/src/csv_import/direction_pnl_tests.rs` embeds one fill pair and its row values copied from `Performance Oct 20(1).csv` (doc comment line 3 says so; data line 26; assertions at lines 100, 188, 193; worked-total comment at 221). Removing the file does not break this test, but the real values would remain in the tracked tree.
- No fill ID or data line of `Performance Oct 20.csv` appears in any other tracked file. No fill IDs are shared between the three exports.

## Expected change scope
- Delete `test_csvimport/Performance Oct 20.csv` and `test_csvimport/Performance Oct 20(1).csv`.
- `src-tauri/src/csv_import/direction_pnl_tests.rs`: replace the copied pair with a synthetic pair that keeps the scenario (a real-format Performance row whose sell timestamp precedes its buy timestamp, classified short, with the same kind of hand-worked P&L), update the hand-derived expected values, the worked totals in the line-221 comment and the module doc comment ("All CSV values are synthetic").

## Out of scope
- `test_csvimport/Performance.csv` and identifiers copied from it (TASK-037).
- Git history, forks, PR pages, repository visibility (TASK-039).
- Any other test or importer change.

## Implementation approach
1. Before branching: create or link the Notion roadmap Triage card for this task (CLAUDE.md plan of record); branch `feat/build-<n>-<slug>` and link the card in the PR. (Notion writes need their own approval; Block 4A.)
2. Re-run the reference check at the implementation revision: path/name search, plus a scan of both files' fill IDs and full data lines over all tracked files, printing only file:line. If a new reader or copy appears, handle it the same way (synthetic replacement preserving coverage) and record it.
3. `git rm` the two files.
4. Rewrite the copied pair in `direction_pnl_tests.rs` with synthetic values; re-derive each expected value by hand in the comment beside it (the file's existing rule: no expected value from the code under test).
5. Re-run the scan: zero matches.

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-002 approved (done, Option B). This card's own approval.
- Recommended ordering: record TASK-039's owner disposition before opening this PR on GitHub (a public deletion diff re-displays the rows).
- Independent of TASK-037 (no shared files).
- Likely shared-file conflicts: TASK-040 (formatting touches `direction_pnl_tests.rs`).
- Dependants: TASK-029 (Blocked until this is Verified and merged).

## Acceptance criteria (pass/fail)
- [ ] `git ls-files test_csvimport` at the tested SHA lists neither file.
- [ ] Scan of both exports' fill IDs and data lines over all tracked files at the tested SHA → 0 matches (record command and count, not values).
- [ ] `direction_pnl_tests` still covers the short/sell-before-buy real-format row; every changed expected value has a hand-derivation comment; `cargo test --offline --locked direction_pnl` → pass.
- [ ] Full standard checks → exit 0.
- [ ] Keep `FUNDEDFLOW_UPDATE_FIXTURES` **unset (not `0`)** for every check; never regenerate fixtures unless this card explicitly names the fixture and its diff is reviewed (this card names none).
- [ ] Removal evidence, commands/results and commit SHA recorded in the execution log without raw CSV rows.

## Verification plan
Reference scan before and after; `cargo test --offline --locked direction_pnl`; then the standard checks.

Standard checks (run serially, frontend build before Rust):
- Repository root: `npm run check:boundaries -w @fundedflow/domain` → exit 0
- Repository root: `npm run typecheck` → exit 0
- Repository root: `npm test` → exit 0 (domain + desktop Vitest incl. journeys/axe, test:notices, test:ci-scripts)
- Repository root: `npm run build` → exit 0 (includes the dev-tools dist check)
- Repository root: `npm run check:dist -w @fundedflow/domain` → exit 0
- `apps/desktop/src-tauri`: `cargo test --offline --locked` → exit 0 (after `npm run build`, run serially)
- `apps/desktop/src-tauri`: `cargo clippy --offline --locked --all-targets -- -D warnings` → exit 0

## Safety, rollback and side effects
Never print, paste or log rows or identifiers from the exports (Notion, chat, PR text, logs); describe the deletion by file name and size only. Use only disposable test journals and temporary directories created by tests. Never open, migrate, copy, seed or reset the real `%APPDATA%\com.fundedflow.desktop` journal. Do not edit shipped migrations, `test_csvimport/Performance.csv` or `src-tauri/src/db/fixtures/*.db`. Rollback: revert the PR (restores the files at HEAD). History is unchanged by this task.

## Definition of done
Code merged through an approved PR on a `feat/build-<n>-<slug>` branch per CLAUDE.md; diff reviewed; every acceptance criterion has recorded evidence (command, directory, exit code). Compiling or passing unrelated tests is not completion.

## Independent review notes
Not yet reviewed. r1 written from the Notion draft. Reviewer to confirm that rewriting the pair copied into `direction_pnl_tests.rs` falls under the draft's "resolve any discovered consumer while preserving its intended coverage" (else split to a Triage card and keep this card to the two deletions).
