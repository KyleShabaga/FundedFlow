# FundedFlow: Stage 2 Block 4, approval and execution runbook

| Field | Value |
|---|---|
| Date | 2026-10-22 |
| Repository root and branch | `/home/user/FundedFlow`, branch `claude/practical-turing-wmii06` |
| HEAD | `295c89f`. The application source is identical to `92e7980` (see 09 header). |
| Task spec revision | r2, as listed in the 08 index |
| Status | **Complete** (planning). Nothing is Approved, and no implementation has started. |
| Readiness | Owner-only V1 is **Not Ready** (09 §7). |

This document plans future, separately approved sessions. It authorizes none of the following:
- an install or download;
- a build, a test run beyond the ones recorded in 09 §1.2, or an app launch;
- a write to Notion, a branch or a PR;
- any operation on the real journal.

## 1. Approval protocol

1. Kyle approves named task IDs at a named spec revision, for example "Approve TASK-012 r2". The approval quote and date go in the card's "Approval evidence" row and in `11-remediation-execution-log.md`.
2. Approval of one task does not extend to another task, to a later revision, or to a scope correction listed in §8. A corrected card needs a new approval.
3. Kyle approves each enabling action separately: dependency installation (`npm ci`, `cargo fetch --locked`), Notion Triage card creation, and branch or PR creation.
4. Each approved Fix or Test task becomes one PR on `feat/build-<n>-<slug>` (from CLAUDE.md). Kyle assigns `<n>`. If the session harness designates a different branch, ask Kyle which one wins before pushing.
5. Claude never marks a gate Passed without the evidence fields, and never records an owner decision or P0-18 on Kyle's behalf.

## 2. Working directories and environment prerequisites

| Area | Working directory | Prerequisites (never assumed; record each one in the log) |
|---|---|---|
| npm workspaces | repository root | `node_modules` from `npm ci`, which needs the network. This host has none. Node 22 and npm 10. |
| Rust crate | `apps/desktop/src-tauri` | Cargo registry cache (`cargo fetch --locked`, needs the network; this host has none). `apps/desktop/dist` from `npm run build`, because `tauri::generate_context!()` (`lib.rs:207`) reads `frontendDist: "../dist"` (`tauri.conf.json:10`). |
| Notices | repository root | cargo-about 0.9.2 (not installed here). `check:notices` runs `cargo fetch --locked` (`scripts/third-party-notices.mjs:307`). `npm run notices` overwrites the tracked notices files (`:441-443`), so run it only where a card authorizes it (TASK-027). |
| Collector | `tools/prop-firm-collector` | `uv sync --all-extras` and Playwright Chromium. **No V1 task needs these.** Do not install them. |
| Packaged app / gates | Windows 11 and 10 22H2 disposable VMs; GitHub Actions | A candidate EXE and its SHA-256, the Windows build number and the WebView2 version |

**Fixture rule.**
- `FUNDEDFLOW_UPDATE_FIXTURES` must be **unset, not `0`**. Six Rust test files rewrite tracked fixtures when the variable exists at all (`is_some()`): `wire_tests.rs:90`, `engine_snapshot_tests.rs:219`, `evidence_tests.rs:454/790`, `risk_promotion_tests.rs:1103`, `rulebook_editor_tests.rs:549`, `wire_limit_tests.rs:216`.
- Before each test process, run `env | grep -E 'FUNDEDFLOW_|FFC_UPDATE'` and remove anything inherited (`env -u`). `FUNDEDFLOW_UPGRADE_DB` is allowed only for the TASK-034 owner run.
- Never edit `test_csvimport/Performance.csv` or `apps/desktop/src-tauri/src/db/fixtures/*.db`.
- A fixture change needs the card to name it explicitly, plus an independent review of the expected result.

## 3. Validation matrix (standard checks, run serially in this order)

| # | Check | Directory | Serial group | Notes |
|---|---|---|---|---|
| 1 | `npm run check:boundaries -w @fundedflow/domain` | root | A | Node only. Passed here, exit 0. |
| 2 | `npm run typecheck` | root | B | Builds the domain first. `clean.mjs` deletes `packages/domain/dist`. |
| 3 | `npm test` | root | B | Covers domain Vitest, desktop (`build:domain && vitest run`, including journeys and axe), `test:notices` and `test:ci-scripts` |
| 4 | `npm run build` | root | B | Builds `packages/domain/dist` and `apps/desktop/dist`, including the dev-tools dist check |
| 5 | `npm run check:dist -w @fundedflow/domain` | root | B | After step 4 |
| 6 | `npm run test:dev-scripts` | root | A | Node only. Passed here: 20 tests. |
| 7 | `cargo test --offline --locked` | `apps/desktop/src-tauri` | C | After step 4. Uses `target/`. |
| 8 | `cargo clippy --offline --locked --all-targets -- -D warnings` | `apps/desktop/src-tauri` | C | After step 7 |
| 9 | `npm run check:notices` | root | C | Only when versions or dependencies change. Needs cargo-about and the network, otherwise record "not run: tool unavailable". |

**Rules:**
- There is no root lint script; don't invent one.
- Never run groups B and C concurrently with each other or with another session using the same checkout.
- **CI:** CI runs on `windows-latest` only, using plain `cargo test` (`ci.yml:69`) and `cargo clippy --all-targets -- -D warnings` (`ci.yml:73`). A local Linux run does not substitute for Windows-only criteria.
- **Advisory checks:** don't run `npm audit` or `cargo audit` locally. A push or PR run can show "NOT RUN" while still passing (`audit-guard.mjs:109-115`). Gate evidence must be a log or summary line reading "no blocking advisories." (`audit-guard.mjs:99`) from a push-to-main or `workflow_dispatch` run on the exact candidate SHA.

## 4. Preflight for every session and wave

| Step | Check | Fail → |
|---|---|---|
| P1 | Record the root, branch, HEAD and `git status`. Keep pre-existing changes and do not reset or clean. | Unexplained changes in a file the task touches → stop (§6). |
| P2 | `git diff 92e7980 HEAD -- <the card's files>`. Compare the cited `file:line` evidence, not just the hashes. | Drift that changes the root cause or scope → stop and return the card to Block 3. Drift elsewhere is recorded and not treated as a conflict. |
| P3 | The card status is Approved at the stated revision, every prerequisite task is Verified, and every prerequisite decision is Decided. | Not met → do not start that task. Other approved tasks continue. |
| P4 | Tools: node, npm, cargo, clippy. `node_modules` and the cargo cache are present, or their installation is explicitly approved. | Unavailable and not approved → **mandatory validation unavailable** → stop that task. |
| P5 | Clear `FUNDEDFLOW_UPDATE_FIXTURES`, `FFC_UPDATE_FIXTURES` and `FUNDEDFLOW_UPGRADE_DB` (§2). | — |
| P6 | **Baseline.** Run §3 steps 1–8 on the unmodified HEAD and record exit codes. This is the first baseline in this audit; it has never been run. | A baseline failure in an area the task touches → stop and report. An unrelated failure → record it, and continue only if Kyle agrees. |
| P7 | Disposable data only: tests' temp dirs, the seeder with `--data-dir <tempdir>/com.fundedflow.desktop`. Never `%APPDATA%\com.fundedflow.desktop`, `FUNDEDFLOW_DEV_DATA_DIR` release substitutes, or `dev:test-journal` for Windows startup evidence. | — |
| P8 | **W1 only (backup and restore readiness).** Confirm that the existing restore, rollback and erase tests pass at baseline (`cargo test --offline --locked data_controls`). | Fail → stop W1. |
| P9 | **Windows-dependent tasks (011, 018, 023, W5).** Have a disposable VM or profile ready, plus the candidate or build SHA and its EXE SHA-256. | Unavailable → that task waits. Unrelated approved tasks continue. |
| P10 | Create or link the Notion Triage card and branch per CLAUDE.md, only if approved (§1.3). | Not approved → work only on a local branch; do not push or open a PR. |

## 5. Exit gates (must hold before a dependent wave starts)

1. **Every Fix/Test PR:**
   - Standard checks 1–8 exit 0 after the change, run serially, with the commands and directories recorded.
   - The new regression tests were shown failing on the pre-fix code and passing after.
   - The diff contains only the files named in the card. Any fixture diff is limited to the named fields and was reviewed by someone independent.
   - Each acceptance criterion has evidence in `code-review/11-remediation-execution-log.md`, which the first executed task creates.
   - Kyle reviewed and merged the PR.
2. **Before W1b (013):** 012 is merged, and the existing-archive round trip passes.
3. **Before W1c (015):** 013 and 014 are merged; `replacedEntities` and the wire fixture are byte-identical except for 013's `detail` field and 014's one `requiredFreeBytes` value in the `inspect_journal_archive` entry (TASK-014 r5; board review re-check 2026-10-22).
4. **Before W1d (018):** 015–017 are merged, and persistence compatibility is shown:
   - markers from the previous version are recovered;
   - a restore that was in flight under the previous version recovers;
   - downgrade with a pending marker is either tested or declared unsupported in the docs (G8).
5. **W2c (024):** no functional prerequisite; merge order only — rebase onto whichever of 021/022 has merged (different regions of LifecycleDialogs.tsx / AccountSwitcher.tsx); no wait-for-both gate (board review re-check 2026-10-22).
6. **Windows-only criteria (018, 023, 011):** each needs a record of the SHA, the build EXE SHA-256 (if packaged), the Windows build, the WebView2 version, the tester and the date. jsdom or mocked Tauri results never count.
6a. **Before W3d (042):** 043 Verified, TASK-009 r4 decision 1 confirmed (board review re-check 2026-10-22).
7. **Before W4 (029):**
   - every W1–W3 task is Verified, including 044, and 042 and 043 when TASK-009 r4 decision 1 is confirmed (without that confirmation they are not started) (board review re-check 2026-10-22);
   - decisions 001, 002, 005 and 006 are recorded;
   - TASK-008 is decided (fmt task Verified if the gate is kept);
   - 027 and the 034 code change are merged;
   - CI passes on the exact candidate SHA.
8. **Before W5:** 029's evidence row is complete:
   - the SHA, CI run, release run and version;
   - the advisory line (not "NOT RUN");
   - the EXE SHA-256 matching `SHA256SUMS.txt` (not the artifact ZIP digest);
   - an artifact expiry of 30 days or more.
9. **Before W6:** each W5 gate state is recorded by its card's pass rule.
10. **Before TASK-036:** the evidence register is complete. Kyle decides P0-18.

## 6. Stop and escalation conditions (they apply to the affected task only)

Stop the affected task, record the condition in the log, and ask Kyle when any of these occurs:
- **Source or spec drift:** drift in the card's files or evidence that cannot be reconciled. A different HEAD alone is not a conflict.
- **Data-loss risk:** any path that could delete, overwrite or fail to preserve user bytes beyond what the card specifies, or any test touching non-temporary paths.
- **Unapproved dependency, schema or format change:**
  - a new crate or npm dependency (including declaring `windows-sys` in TASK-018 without approval);
  - any migration, except migration `0022` (`src-tauri/migrations/0022_trade_fees_recorded.sql`) named by TASK-042, once TASK-042 is approved and only within that task (Board review sync 2026-10-22);
  - an archive v1, `data.json`, marker or `legal-acceptance.json` format change the card does not name;
  - a shipped migration edit.
- **Scope growth:** more than the card's file list, or a contract or fixture change the card doesn't name, for example a router migration in TASK-022.
- **Baseline failure** in the area the task touches, or mandatory validation that is unavailable (tools, Windows VM, CI access).
- **Persistence incompatibility** found during testing (old markers, archives or restores fail).
- **A fixture regenerates unexpectedly**, or the fixture-update variable is found set.
- **A TASK-010 result** showing 64 MiB reachable within 12 months: escalate ISSUE-002 to P0 and create the D-ARCH task.

**Continue regardless:** do not halt unrelated approved tasks because another task is waiting on Windows evidence or an owner decision.

## 7. First batch recommendation and approval request

**Eligibility rule.** A task qualifies only if all four hold:
- the card is Ready for Approval at r2, with no Should-fix correction in §8;
- every prerequisite task and decision is complete;
- Claude can carry it out without Windows or owner input;
- it has no shared-file or contract coupling with another batch item.

**Batch 1 (proposed, not approved):**

| Task | Change | Components | Why first | Risk | Tests | Dependency |
|---|---|---|---|---|---|---|
| TASK-012 r2 | An exact `(type, name)` allow-list for `sqlite*` objects in archive `schema()`/`dump()`, plus a restore-only open variant with `trusted_schema=OFF` before `migrate` | `src-tauri/src/data_controls/archive.rs`, `restore.rs`, `db/mod.rs` (new variant only), `data_controls/security_tests.rs` | Start of W1. Closes the hidden-trigger restore path; code-only and small. | Medium (every restore path) | Four crafted archives → `Integrity`; `sqlite_sequence`/`sqlite_stat1` round-trip; existing `data_controls` and `current_schema_tests` | None |
| TASK-019 r2 | `checked_sub` in `risk_from_plan` and `realized_pnl` | `src-tauri/src/store/reviews.rs`, `src-tauri/src/domain.rs` | Removes a persistent read panic; S-sized, isolated | Low | 29-digit entry with stop `-1` → `risk: None`; trade create → validation error | None |
| TASK-020 r2 | Rust validates trading-day `effective_from` (reset and assignment) | `src-tauri/src/store/rulebooks.rs`, `store/attempts.rs`, deliberate edits to `db/rulebook_tests.rs:266-270, 296` and `seed.rs:531` | Persistence-side correctness that 021 builds on; no wire change | Low–Medium | Saturday reset is rejected; Monday is accepted; existing rulebook and attempt tests pass | None |
| TASK-022 r2 | Leave guard covers history and programmatic `navigate()`. **The `unstable_HistoryRouter` fallback is excluded** and needs separate approval. | `features/shared/hooks/use-leave-guard.ts`, `AccountSwitcher.tsx`, `app/AppShell.tsx`, tests | Data loss of typed text; independent of W1; unblocks 023 and 024 | Medium | Real-HashRouter tests: back and "Manage accounts" prompt; editor never unmounts | None |

Not in batch 1, for the reason given:

| Task | Why not |
|---|---|
| 014 | Blocked by 013, which needs correction |
| 024 | No functional prerequisite; merge order only — rebase onto whichever of 021/022 has merged (different regions of LifecycleDialogs.tsx / AccountSwitcher.tsx) (board review re-check 2026-10-22) |
| 025 | Needs the 001 and 006 decisions and Kyle's v1.1 texts. Superseded 2026-10-22: V1 legal text is PR #107's documents; 025 r6 needs #107 merged |
| 026 | Needs the 006 decision; PR #107 and TASK-027 merged |
| 004 | Needs the 003 decision |
| 010 | Doable now, but it is a measurement that needs dependency installation and a scratch harness. Proposed as batch 1b if Kyle approves the install. |
| Owner decisions 001, 002, 003, 005, 006, 009 | Not Claude-executable. Kyle can decide them now, which unblocks 004, 025, 026, 027 and 029. |

**APPROVAL REQUEST (proposal; requires Kyle's explicit reply):**
- **Tasks:** TASK-012 r2, TASK-019 r2, TASK-020 r2, TASK-022 r2. Each is a separate PR, scoped exactly to its card. TASK-022 excludes the router-migration fallback.
- **Enabling actions** (each needs a separate yes):
  - (a) `npm ci` at the root and `cargo fetch --locked` in `apps/desktop/src-tauri` in the execution environment;
  - (b) creating or linking Notion Triage cards and `feat/build-<n>-<slug>` branches, with `<n>` assigned by Kyle;
  - (c) pushing and opening PRs.
- **Prerequisites:** none outstanding for these four. Preflight P1–P8 runs first, including the first full baseline.
- **Validation:** standard checks 1–8 (§3), run serially; each card's new tests fail before the change and pass after; exit gate §5.1. No Windows evidence is required for these four, because CI covers the Windows build on push.

## 8. Corrections required before the remaining cards can be approved (return to Block 3)

Block 4 may not edit 08 or the cards. These corrections must be applied in a Block 3 rerun (spec r3), followed by independent review. Until then the listed cards are **not Ready for Approval**.

### 8.1 Index-level (08)
- **§C.1 ISSUE-005:** add "Live-connection `trusted_schema=OFF`: **Deferred to V1.1** (needs `db/upgrade_tests.rs` on v3/v4/v8 fixtures)", or create a task for it (G1).
- **§D V-023:** remove the claim that TASK-030, 031 and 033 cover it; it moves to TASK-028 (G2).
- **§E:** change "independent" to "small and reversible"; 024 depends on 021 and 022.
- **§G and §H:** change "22 call sites" to "21 of 24 (user paths `archive.rs:223, 331, 552`)".
- **§B:** W2 and the independent units (019, 020, 022, 026, the 034 code change) may run alongside W1 (09 §4).

### 8.2 Card-level Should-fix

| Card | Precise correction |
|---|---|
| TASK-007, 008 | Add the criterion: "Any run/keep/adopt choice creates a follow-up task. TASK-029 (fmt) or TASK-035 (cohort, studies) is marked Blocked until it is Verified." (G5, G10) |
| TASK-011 | Step (b) must use the release EXE and must not use `FUNDEDFLOW_DEV_DATA_DIR` or `dev:test-journal`; that variable bypasses `app_data_dir` (`lib.rs:185`). (G14) |
| TASK-013 | VACUUM of the temporary snapshot (never the live journal) becomes mandatory; remove the "narrowed acceptance" option. Add the criterion "export of a journal with >64 MiB free pages succeeds". Add the criterion "`npm run test -w @fundedflow/desktop -- src/features/data-controls` asserts the detail text; the wire fixture diff is limited to `detail`". Specify `skip_serializing_if`/`.optional()`. `DataControlProblem` (`api/data-controls.ts:56-73`) must carry `detail`. (G3, G10) |
| TASK-015 | Option B (`retry_data_cleanup`) changes its `null` output and its fixture entry, and the erase preview `warnings` come from Rust (`deletion.rs:234-236`) and are fixture-pinned. Either make the copy TS-only, or authorize and name the fixture edit. Name the runtime contract consumers: `runtime.ts:61` (stage map), `test/runtime-fixtures.ts:14-17`, `lib/diagnostics.ts:65`, `RuntimeGate.tsx`, `GallerySections.tsx`, journeys. Add `runtime.ts` and `AppShell.tsx` to conflicts. Downgrade: a marker that lists `data-controls-quarantine` breaks older builds (`deletion.rs:361-364`). State "downgrade with pending cleanup unsupported" or keep the old marker schema. (G8, G11) |
| TASK-016 | `Cleanup` has `deny_unknown_fields` (`deletion.rs:50`), so new fields break older builds. Declare downgrade unsupported (and record it in TASK-031) or keep extras out of the marker. Rollback only restores inventory files (`restore.rs:262-270`); state that extras survive in the operation folder after rollback, and test it. (G8, G12) |
| TASK-017 | Carry missing ids in the existing `DeletionPreview.warnings` and restore preview warning field, with no new field (or extend TASK-016's field in the same fixture update). A missing `safety-missing.json` means an empty list; test rollback of a restore prepared by the previous version. Export step: "export behaviour unchanged except `detail` names the ids". (G12) |
| TASK-018 | Replace "Linux CI still runs Unix tests" with "CI is Windows-only (`ci.yml:25`); Unix tests run locally". Name the runtime-contract consumers as in TASK-015. Include `data-controls-quarantine/` among the app-owned paths. List the manual record fields. (G11, G14) |
| TASK-021 | Add tests for the reset-dialog default at the boundary, the "unknown" state when freshness is unavailable, and no weekend dates in AssignDialog. (G10) |
| TASK-023 | Add: "If TASK-011(a) shows a native prompt, close as Not Needed with the recorded evidence". List the manual record fields. (G10, G14) |
| TASK-027 | Add `apps/desktop/src/journeys/recovery.journey.test.tsx:66`. Add "if TASK-006 = B or C, set `webviewInstallMode` (`tauri.conf.json:49-52`)" and TASK-006 as a prerequisite. Consider adding `producerVersion` to `normalize()` (`wire_tests.rs:9-17`) so the fixture doesn't change on every bump. Merge after 017 and before 029. (G4, G13) |
| TASK-028 | Name the target file. For each added step (junction, OneDrive, title-bar close, ticked uninstall, second instance, DPI, **install without WebView2 online and offline**), give the expected result, the evidence fields and whether it is mandatory. Add a criterion for the NA-7 draft. Add TASK-011 as a prerequisite. Leave the NA-7 lines 145-166 to this card, not TASK-026. (G2, G10) |
| TASK-029 | Prerequisites: add "TASK-008 decided; the fmt task Verified if the gate is kept". CI evidence: a push-to-main or `workflow_dispatch` run on the exact SHA (not a PR merge commit). `--fail-on-outage` is applied automatically on dispatch (`ci.yml:109, 124`) and cannot be passed in. Drop the WebView2 field from its Definition of Done. (G5, G14) |
| TASK-030, 032, 033 | Each gets an explicit pass rule that lists the mandatory steps and scenarios. TASK-032 cites `docs/architecture/build-26.5-26.7-recovery-reliability.md:187-194` and gives the expected result for a large-journal export. Expect a legal re-prompt after upgrade. (G9) |
| TASK-031 | Pass iff data is intact after upgrade and reinstall, an unticked uninstall keeps `%APPDATA%`, and a ticked uninstall removes exactly the TASK-026 list. Name the older EXE used (e.g. the recorded 0.1.0 artifact) with its SHA and SHA-256. Downgrade with a pending cleanup follows the 015/016 declaration. (G6, G8, G9) |
| TASK-034 | Move the code change before TASK-029 (W3c); only the owner run stays in W5. Set `FUNDEDFLOW_UPGRADE_DB` to the copy. Fix the doc comment at `upgrade_tests.rs:428`, which points at the live path. (G7) |

### 8.3 Nits (apply in r3; they do not block the cards marked Ready)
- **TASK-009:** relabel "P2/P3 decisions".
- **TASK-010:** record the usage model (trades per day, calculations per day).
- **TASK-012:** add a test that a previous-version safety copy (installing phase) still rolls back (`restore.rs:318, 346`).
- **TASK-015:** the temp marker goes in the data root, like `write_pending` (`restore.rs:170`), not in the queue directory.
- **TASK-022:** the fallback router migration needs separate approval. Batch 1 already excludes it.
- **TASK-024:** drop "with a link to the affected record", or name it in scope. Batch 2 approval should state which.
- **TASK-026:** limit it to `build-26.75-evidence.md:51-70`; replace "reviewer verifies" with a per-statement source-line checklist.
- **TASK-033, 035:** add the SHA and EXE hash to acceptance.
- **Fixture rule on all cards:** "unset (not 0)".
- **TASK-030 and 031:** expect the legal re-prompt after upgrade.

## 9. Decisions Kyle must make before the dependent implementation

| Decision | Task | Unblocks |
|---|---|---|
| 0BSD allow-list | 001 | 025, 029 |
| Test CSV provenance | 002 | 029 |
| Engine authority (TS vs Rust) | 003 | 004; ISSUE-002c design |
| Version scheme A/B/C | 005 | 027, 031 |
| WebView2 install mode | 006 | 025, 026, 027, 028 |
| P0-05, P0-09, P0-10, D5 | 007 (after correction) | 035 |
| Real-journal-copy gate; `cargo fmt` gate | 008 (after correction) | 034, 029 |
| Fees, duplicate collapse, ledger UI, retention, archive format, network paths | 009 | V1.1 scope |
| Keep the `user-agreement` id; supply the exact v1.1 texts (superseded 2026-10-22: Kyle chose PR #107's documents; id kept) | 025 | 025 |
| Pull TASK-019 into W1 | 019 | (batch 1 assumes yes) |
| Downgrade with a pending cleanup: support it or declare it unsupported | 015/016 r3 | W1c |
| Approve enabling actions (§1.3) | — | Any execution |
| P0-18 go/no-go | 036 | Release (last) |

## 10. Next Claude Code session (PROPOSAL; do not run without Kyle's explicit approval)

```text
PROPOSAL — requires Kyle's explicit approval of the task IDs and enabling actions below before use.

FundedFlow remediation execution, batch 1. Repository: KyleShabaga/FundedFlow at the current checkout.
Approved tasks (spec r2 only): TASK-012, TASK-019, TASK-020, TASK-022 (TASK-022 excludes the unstable_HistoryRouter fallback).
Approved enabling actions: [Kyle fills in: npm ci / cargo fetch --locked / Notion Triage cards / branches feat/build-<n>-<slug> with n=… / push + PR].

Read first: CLAUDE.md; code-review/10-stage2-approval-and-execution-runbook.md (§2–§6); code-review/09-stage2-implementation-waves.md (§4–§6);
code-review/remediation-tasks/TASK-012-archive-schema-exact-allowlist.md, TASK-019-checked-decimal-subtraction.md,
TASK-020-rust-reset-effective-from-trading-day.md, TASK-022-leave-guard-history-navigation.md.

Do:
1. Run preflight P1–P8 and record the results in code-review/11-remediation-execution-log.md (create it; this is the first executed task).
2. Implement one task at a time, in the order 012, 019, 020, 022: one branch/PR each, the card's scope only, new tests shown failing before the change and passing after.
3. Run standard checks 1–8 serially after each task, with FUNDEDFLOW_UPDATE_FIXTURES unset (not 0). Record commands, directories and exit codes.
4. Stop a task on any §6 condition and report it. Do not start any other task ID, edit fixtures, add dependencies or migrations, or touch the real journal.

Deliverables to inspect: each PR diff; code-review/11-remediation-execution-log.md (baseline, per-task evidence, before/after test results);
the card "Approval evidence" rows; git status.
```

## 11. Deferred work and why

- **V1.1:**
  - ISSUE-008 (if TASK-019 is not pulled in), 010, 011 (rest), 013, 014, 015, 016, 017, 018, 019, 020, 021, 024, 025, 026–032, the 037 implementation, and 038 if gate 052 is waived. ISSUE-018 is V1.1 except B2-1, handled by TASK-043, and the retention disclosure, handled by TASK-044, both in V1; for ISSUE-034 only nullable fee amounts are V1.1, and the fees-recorded migration is V1 via TASK-042 (as 08 §D; board review re-check 2026-10-22).
  - Partial items: 002c redesign; 004 export side; the 006 user-path part; 012 Rust verdict fixtures; TEST-010; and the live `trusted_schema` change (pending the §8.1 decision).
  - Reasons are given per item in 08 §C.1: P2 or P3, no current trigger, an unmeasured frequency, or a migration that needs B2-1 first.
- **V1.5:** ISSUE-033 (collector), which is a separate tool.
- **V2:** external-user agreements, counsel sign-off, MPL/NSIS legal reviews, Web V2.
- **Excluded:** signing and auto-update (ISSUE-058 decided), router or package rewrites, new test infrastructure, edits to shipped migrations or historical fixtures.

## 12. Git state at the end of Block 4

Block 4 created only `code-review/09-stage2-implementation-waves.md` and this file. No source, configuration, test, fixture, dependency or prior report was modified. Build caches were not created, because no build ran.
