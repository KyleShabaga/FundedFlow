# TASK-040 — Fix: adopt `cargo fmt` in a dedicated formatting-only change and enforce it in CI

| Field | Value |
|---|---|
| Status | Ready for Approval (r2) |
| Type | Fix |
| Audit priority | Gate |
| Roadmap lane | Build 10.5 gates (historical, V1) |
| Mandatory gate | Yes — TASK-029 stays Blocked until this task is Verified (TASK-008 = A, cargo fmt adopted) |
| Severity | N/A |
| Confidence | High |
| Canonical issue | ISSUE-053 (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | TEST-006 (linked by TASK-008) |
| Source card / date | Notion draft TASK-040 r1 (https://app.notion.com/p/4011bd4b6bde81e9852df4e2e2831d21), created 2026-10-22 under TASK-008 r3 ("Approve with option a for both") |
| Wave | W1 start (merged before any W1 Rust branch is opened; see Prerequisites) |
| Effort / risk | S / Low (mechanical, but a wide diff that conflicts with any open Rust branch) |
| Verification platform | Any OS locally; Windows CI (`ci.yml`, windows-latest) |
| Path convention | Paths starting `src-tauri/` are under `apps/desktop/`; `features/`, `lib/`, `journeys/`, `design-system/` are under `apps/desktop/src/` unless written in full |
| Inspected source revision | 1012d63 (application source identical to 92e7980) |
| Specification revision | r2 (2026-10-22; r1 + alignment with TASK-027 r5 reusable check workflow) |
| Execution log | `code-review/11-remediation-execution-log.md` — created by the first task executed after approval (template in 08 index §I); every task appends its evidence there |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / 1012d63 (HEAD). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | — (none; TASK-008 approval authorized creating this card only. Requires Kyle's explicit approval of this task ID and specification revision) |

## Purpose / risk
Build 10.5 left `cargo fmt` as a failed gate (`docs/build-10-5-closeout.md:61,99`: baseline-wide differences, first at `src/catalogue.rs:39`); it is not run in CI, so formatting drifts and later diffs mix style with behaviour. TASK-008 Option A adopts it through one formatting-only change plus a CI check.

## Trigger / reproduction
`cargo fmt --check` in `apps/desktop/src-tauri` (historically failing; not re-run for this spec — the number of files that would change is unknown until the executor runs it).

## Root cause / evidence
Read-only facts at 1012d63:
- No `rustfmt.toml` / `.rustfmt.toml` anywhere and no `rust-toolchain(.toml)`; the crate is `edition = "2024"` (`src-tauri/Cargo.toml:9`), so rustfmt's default 2024 style edition applies. No `#[rustfmt::skip]` and no `include!` of generated Rust.
- Single crate, no workspace. 83 tracked `.rs` files, all under `apps/desktop/src-tauri` (`build.rs`, `examples/seed-demo-journal.rs`, 81 under `src/`). `src/db/fixtures/generate*.rs.txt` are not Rust sources and are not touched by `cargo fmt`.
- `.github/workflows/ci.yml:57-60` installs `dtolnay/rust-toolchain@stable` with `components: clippy` only (no `rustfmt`); `ci.yml:67-73` run `cargo test` and `cargo clippy --all-targets -- -D warnings` in `apps/desktop/src-tauri`. No fmt step exists. CI is Windows-only (`ci.yml:25`).
- CI uses an unpinned `stable` toolchain; local rustfmt in this environment reports `1.9.0-stable` (version to be re-recorded at execution).

## Expected change scope
- Commit 1 (formatting only): output of `cargo fmt` in `apps/desktop/src-tauri` over the crate's Rust files. Nothing else.
- Commit 2 (CI): `.github/workflows/ci.yml` (or `.github/workflows/checks.yml` if TASK-027 r5 has merged) — add `rustfmt` to the toolchain step's `components` (`clippy, rustfmt`) and a step `cargo fmt --check` with `working-directory: apps/desktop/src-tauri`, placed after `Swatinem/rust-cache` and before `cargo test` so it fails fast.

## Out of scope
`rustfmt.toml` or any style option; pinning the toolchain; `.git-blame-ignore-revs`; adding fmt to `CLAUDE.md`/`README.md` check lists (record as Triage cards if wanted); editing `release-installer.yml` (TASK-027 owns it; through TASK-027 r5 the installer runs the same `checks.yml`, so the fmt check reaches packaging without a separate edit); behaviour, schema, dependency, fixture or refactoring changes; formatting `.rs.txt` generators.

## Implementation approach
1. Before branching: create or link the Notion roadmap Triage card for this task (CLAUDE.md plan of record); branch `feat/build-<n>-<slug>` and link the card in the PR. (Notion writes need their own approval; Block 4A.)
2. Confirm no other open branch touches Rust (see merge order). Record `rustc --version` and `rustfmt --version`; use the current `stable` that CI will install.
3. In `apps/desktop/src-tauri`: `cargo fmt`, then `cargo fmt --check` → exit 0. Commit only the formatter output; record the file count (`git diff --stat`).
4. Edit `ci.yml` (or `checks.yml` if TASK-027 r5 has merged) as above in a second commit.
5. Run the standard checks on the final commit; push; confirm the PR's CI run shows the new step green.
6. Reviewer determinism check: in a disposable worktree at the base SHA, run `cargo fmt` with the same rustfmt and `git diff --exit-code` against the PR's Rust files → identical, proving the Rust diff is formatter output only.

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-008 approved (done, Option A); this card's own approval; Rust toolchain with the `rustfmt` component available locally.
- **Merge order (recommended: first).** Merge this PR before any W1–W3 Rust branch is opened (TASK-012…020, TASK-025 (`src-tauri/src/legal.rs`), TASK-027 (`data_controls/wire_tests.rs`, optional part), TASK-034 code, TASK-037, TASK-038, TASK-041, all Not Started at spec time). Reason: a formatting-only PR touches nearly every Rust file and conflicts with every concurrent Rust branch; at the start nothing is open, so it merges conflict-free, and from then on the CI check keeps each later functional diff free of formatting noise. Doing it last would also be conflict-free but leaves every W1–W3 review mixed with incidental formatting and still requires a full re-check of the crate just before TASK-029. Fallback: if any Rust branch is already open when this card is approved, merge this immediately after the last W1–W3 Rust PR and before TASK-029, and do not open new Rust branches meanwhile. If TASK-039 option C (history rewrite) is scheduled before W1, run that first; if it is scheduled after TASK-037/038/041 merge (TASK-039's recommendation), this commit is simply rewritten with the rest.
- Likely shared-file conflicts: every Rust file (all W1–W3 Rust tasks incl. TASK-025 and TASK-027, TASK-037, TASK-038, TASK-041); `ci.yml` with TASK-027 r5, which moves the CI check steps into a reusable `.github/workflows/checks.yml`: if this card merges first (recommended), TASK-027 moves its fmt step into `checks.yml`; if this card merges after TASK-027, add the `rustfmt` component and the `cargo fmt --check` step to `checks.yml` instead of `ci.yml`.
- Dependants: TASK-029 (Blocked until this is Verified; verification resolves only this blocker).

## Acceptance criteria (pass/fail)
- [ ] The Rust diff is formatter output only (reviewer determinism check in step 6 passes); the only other change is the reviewed `ci.yml` edit (or `checks.yml` edit, per merge order).
- [ ] `apps/desktop/src-tauri`: `cargo fmt --check` → exit 0 on the final commit (record rustfmt version).
- [ ] Standard checks → exit 0 on the same commit.
- [ ] CI on the PR (and on the merge commit on `main`) includes the `cargo fmt --check` step → green.
- [ ] Keep `FUNDEDFLOW_UPDATE_FIXTURES` **unset (not `0`)** for every check; never regenerate fixtures unless this card explicitly names the fixture and its diff is reviewed (this card names none).
- [ ] Task ID, final commit SHA, commands/results and CI run URL recorded in the execution log; TASK-029's fmt blocker marked resolved only after Verified.

## Verification plan
`cargo fmt --check`; reviewer determinism check; CI run.

Standard checks (run serially, frontend build before Rust):
- Repository root: `npm run check:boundaries -w @fundedflow/domain` → exit 0
- Repository root: `npm run typecheck` → exit 0
- Repository root: `npm test` → exit 0 (domain + desktop Vitest incl. journeys/axe, test:notices, test:ci-scripts)
- Repository root: `npm run build` → exit 0 (includes the dev-tools dist check)
- Repository root: `npm run check:dist -w @fundedflow/domain` → exit 0
- `apps/desktop/src-tauri`: `cargo fmt --check` → exit 0
- `apps/desktop/src-tauri`: `cargo test --offline --locked` → exit 0 (after `npm run build`, run serially)
- `apps/desktop/src-tauri`: `cargo clippy --offline --locked --all-targets -- -D warnings` → exit 0

## Safety, rollback and side effects
Use only disposable test journals and temporary directories created by tests. Never open, migrate, copy, seed or reset the real `%APPDATA%\com.fundedflow.desktop` journal. Do not edit shipped migrations, `test_csvimport/Performance.csv` or `src-tauri/src/db/fixtures/*.db` (formatting cannot touch them). Rollback: revert the PR. Side effect: an unpinned `stable` rustfmt could change output in a future release and turn CI red; record the version and treat such a failure as a new formatting-only change.

## Definition of done
Code merged through an approved PR on a `feat/build-<n>-<slug>` branch per CLAUDE.md; diff reviewed and confirmed formatting-only apart from the CI step; every acceptance criterion has recorded evidence (command, directory, exit code) including the green CI run. Compiling or passing unrelated tests is not completion.

## Changes in r1 (after independent review)
- Independent review (review3_B), nit: Rust-touching card list now includes TASK-025 (`src-tauri/src/legal.rs`) and TASK-027 (`data_controls/wire_tests.rs`, optional), plus the new TASK-041; conflicts line updated to match.
- TASK-039 option C ordering wording aligned with TASK-039 r1 (one rewrite after TASK-037/038/041 is now its recommendation).

## Changes in r2
- Aligned with TASK-027 r5 (owner-directed reusable check workflow): the `ci.yml` conflict line now covers both merge orders, and the out-of-scope line records that the fmt check reaches the installer through `checks.yml` (independent review of TASK-027 r5).

## Independent review notes
Not yet reviewed. r1 written from the Notion draft; command scope made concrete from source (single crate, `cargo fmt --check` in `apps/desktop/src-tauri`, add `rustfmt` component). Reviewer to confirm the "merge first" order against the actual state of W1 branches at approval time.
Independent review r1 (review3_B, 2026-10-22): READY; merge-first order sound. Nits applied (see "Changes in r1 (after independent review)"). Status stays Proposed until approval. Open index nit: `08-…index.md:35` and the 09 waves table do not yet show TASK-040 merging first (not edited here).
Independent review (currency pass, 2026-10-22): two reviewers plus a re-check of the blocking fixes; READY at r1.
Independent review r2 (2026-10-22, owner-directed CI gate): CHANGES applied, re-check READY.
