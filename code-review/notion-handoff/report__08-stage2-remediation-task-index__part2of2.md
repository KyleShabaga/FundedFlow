## E. Up to five tasks safe to execute after approval

All five are small, independent and reversible. None touches the real journal, a migration, a fixture or a dependency.

1. **TASK-001 to TASK-009 (owner decisions).** No code. They unblock W3 and W4 and cost only Kyle's time.
2. **TASK-012: archive schema allow-list.** Restore-path hardening that is code-only and covered by security tests. The live `trusted_schema` change is excluded and goes in a separate PR.
3. **TASK-019: checked Decimal subtraction.** Size S, Low risk, independent of the W1 merge order.
4. **TASK-020: Rust trading-day validation.** Size S. It validates new writes only. Its edits to existing tests are named in the card.
5. **TASK-024: uncertain-outcome wording.** Size S and UI-only. It merges after 021 and 022 when those are approved; on its own it is safe and needs a rebase.

TASK-015 is high value but High risk (startup) and comes fourth in the W1 merge order, so it is not listed here.

## F. Open decisions for Kyle

1. 0BSD allow-list (TASK-001).
2. Whether the CSVs in `test_csvimport` are real exports (TASK-002).
3. Engine authority: TS or Rust (TASK-003).
4. Version scheme A, B or C (TASK-005).
5. WebView2 install mode: bootstrapper, offline installer or fixed version (TASK-006).
6. Final Push dispositions (TASK-007): P0-05 cohort, P0-09 evidence location, P0-10 studies, and which D5.
7. Build 10.5 gates: whether to keep the real-journal-copy upgrade gate and the `cargo fmt` gate (TASK-008).
8. Policies (TASK-009): fees, duplicate collapse, ledger UI, recovery-copy retention, archive format, and optionally network-path export.
9. Whether the first-run document id `user-agreement` stays (TASK-025), and supply the exact v1.1 texts.
10. Whether to pull TASK-019 into W1.
11. Approval of a `windows-sys` declaration, only if std `is_symlink` proves insufficient (TASK-018).
12. P0-18 go/no-go, at the very end (TASK-036). It is never inferred.

That is 16 pending decisions, per 07 §G.4 item 5. Items 9 to 11 above arise from the task cards.

## G. Ledger corrections recorded here

Block 3 may not edit the ledger. These are the 07 §G.4 corrections; apply them on the next ledger revision.
1. TEST-001's canonical owner is ISSUE-040. ISSUE-022 is a cross-reference only.
2. TEST-007's canonical owner is ISSUE-044. ISSUE-045 and ISSUE-046 cross-reference it.
3. TEST-008 is decision-linked (ISSUE-057, plus 048, 055 and 056). The count becomes 5 gate/evidence + 2 decision-linked (TEST-008, DATA-020); the total of 53 is unchanged.
4. In the 06 §5 concern table, add ISSUE-015 under Reliability / data safety.
5. The pending-decision count is 16; Decided is 1 (ISSUE-058).
6. Label ISSUE-039 "gate with implementation work" (W3, TASK-025).
7. Add B2-1 under ISSUE-018, and B2-2 to B2-5 as planning constraints.
8. The ledger header's HEAD `bba845b` is the input revision; the ledger was committed in `45de2af`.
9. Double-listing rule: count an issue as a defect only in sections A/B, and as a decision only in section C.

Also found in Block 3: TR-014 is linked under ISSUE-025 (summary wording) but its canonical owner is ISSUE-023. The card states this.

## H. Independent review record

**Reviewer 1 (r1).** It returned READY for 16 cards: 001, 002, 003, 004, 007, 008, 009, 011, 019, 023, 024, 030, 032, 033, 035 and 036. It returned CHANGES for 20 cards: 005, 006, 010, 012–018, 020–022, 025–029, 031 and 034.

All required corrections were applied in r2:

| Card | Correction applied in r2 |
|---|---|
| 005 | Version knock-on listed (wire fixture `producerVersion`, notices `appVersion`, lockfiles). Example tied to options A–C. |
| 006 | `webviewInstallMode` line set to `tauri.conf.json:49-52` |
| 010 | Explicit seeder command. A scratch harness is required for calculations and is never committed. A P0 escalation creates a new task. |
| 012 | `trusted_schema=OFF` set inside `open_file`/`configure`, or via an open variant. Allow-list by `(type, name)`. writable_schema, `sqlite_sequence` and ANALYZE tests added. The live change goes in a separate PR with upgrade tests. |
| 013 | Snapshot free pages handled with VACUUM on the snapshot. `ControlError.detail` contract named across Rust, Zod, TS and the wire fixture. "Uncertain path" note removed. |
| 014 | `deletion.rs:175` simulation and the `:190-205` counts are covered. Hash includes rowids. `replacedEntities` and the wire fixture stay byte-identical. |
| 015 | Quarantine key added to the `recover_cleanup` allow-list. Observable defined without breaking `failure:null` on Ready. Stray consequence noted. `prepare_restore` path tested. |
| 016 | `.<uuid>.part` temp name. Mandatory wire fixture regeneration and TS schema named. `#[serde(default)]` for marker extras. Safety-copy acceptance added. |
| 017 | Separate `safety-missing.json`. `copy_managed` relaxed. `tests.rs:49` stays unchanged. Detail contract named. |
| 018 | All 22 app-owned call sites root-anchored. Contract change named (`runtime.ts` categories and stage map). std `is_symlink` tried first. `check:notices` and `Cargo.lock` diff check. ISSUE-024 reference fixed. CI uses plain `cargo test`. |
| 020 | Successor account's tz and reset. Breaking tests and the seed listed as deliberate edits. Severity Medium. |
| 021 | Command runs from the root and includes `src/features/accounts`. Fails closed when the trading day is unavailable. No weekend dates in AssignDialog. |
| 022 | HashRouter and popstate constraints stated. Real-router tests assert the editor never unmounts. `unstable_HistoryRouter` named as fallback. DailyReviewPage→024 conflict dropped. |
| 025 | Version regex fix (`legal.test.ts:15`). Digests taken from the expected first failure. Id decision goes to the owner. TASK-026 is a prerequisite. TR-014 linked. |
| 026 | `%LOCALAPPDATA%` removal added. Uninstall contents marked "expected" until TASK-031. |
| 027 | Full knock-on listed. TEST-010 explicitly deferred. |
| 028 | Junction and OneDrive export expected as "known limitation (V1.1)" |
| 029 | Prerequisites 006, 025, 026 and 027 added |
| 031 | Downgrade expectation corrected (no migration between candidates). NSIS prompt recorded. |
| 034 | Folder copy taken with the app closed. Exact `cargo test … upgrade_copy -- --ignored` command. Both SHAs recorded. |
| Global | Every Fix/Test card has a Triage-card step. Execution-log pointer on every card (§I). Contract and fixture changes named. |

**Reviewer 2 (r2 re-check of the 20 corrected cards).** This reviewer returned READY for 11 cards: 005, 006, 014, 016, 020, 021, 025, 026, 028, 029 and 031. It returned CHANGES for 9 cards, and each change was applied:

| Card | Correction applied |
|---|---|
| 010 | The seeder has only `--data-dir` and `--preset stress`. The scratch harness adds trades to reach N. |
| 012 | Restore uses its own open variant that sets `trusted_schema=OFF` before `migrate`. The shared `configure`/`open_file` stay unchanged in this PR, which removes the conflict with the separate live-connection PR. The verification plan names the four crafted archives plus the positive cases. |
| 013 | Steps 2 and 5 follow the option chosen in the PR: either VACUUM the snapshot, or report the database pages in the error detail. |
| 015 | The erase preview mention is copy text only. No DeletionPreview or wire change. |
| 017 | Reuses the `detail` field added by TASK-013, which comes earlier in the merge order. No second contract change. |
| 018 | 21 of the 24 non-test call sites are app-owned; the user paths are `archive.rs:223, 331, 552`. The Windows CI criterion is the `ci.yml:69` `cargo test` step. ISSUE-024 is marked unassigned and needs a Triage card. Approving `windows-sys` is needed only if std `is_symlink` is insufficient. |
| 020 (nit) | The seed reference is corrected to `seed.rs:531`. |
| 022 | The test command adds `src/features/shared`, `src/features/accounts` and `src/app`. |
| 027 | Removed the stale `appVersion` sentence that contradicted the knock-on list. |
| 034 | Sets `FUNDEDFLOW_UPGRADE_DB` (`upgrade_tests.rs:432`). The copy includes `-wal` and `-shm`. The run record includes both SHA values. |
| Global | The reviewer flagged that this 08 file was missing; it was written after the review. TASK-015 has its Triage step, which was confirmed after regeneration. |

All 36 cards are **Ready for Approval**. The 9 cards changed after the re-check had corrections at the level of wording and line references, with no open blocker. An approving reviewer may spot-check them against this table.

## I. Process notes

- **Notion Triage cards.** CLAUDE.md requires one roadmap card per branch. Each Fix/Test card's first step is to create or link a Triage card, then branch `feat/build-<n>-<slug>`. Notion writes need their own approval in Block 4A; Block 3 made none.
- **Execution log.** The first task executed after approval creates `code-review/11-remediation-execution-log.md`, whatever its number. It contains:
  - a header (date, source SHA);
  - a decisions section: Kyle's words, date, source;
  - a per-task section: commands, directory, exit code, tester, environment, installer EXE SHA-256 where applicable;
  - a gate register.

  Every later task appends to it.
- **Approval.** Kyle approves a task by its ID and spec revision (r2). That approval is recorded in the card's "Approval evidence" row, and the status changes to Approved. Claude may not infer approval.
- **Workflow note.** The repository's stop hook required commits of the report outputs during Stages 1 and 2. Block 3 outputs were committed for that reason only, as documentation.
