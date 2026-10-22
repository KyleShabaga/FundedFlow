# TASK-032 — Gate: manual recovery acceptance on the candidate (incl. ISSUE-001–004 scenarios)

| Field | Value |
|---|---|
| Status | Ready for Approval (r3) |
| Type | Verification |
| Audit priority | Gate |
| Roadmap lane | Build 26.5–26.7 / Build 10.5 gate 6 |
| Mandatory gate | Yes — ISSUE-044 |
| Severity | N/A |
| Confidence | High |
| Canonical issue | ISSUE-044 (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | TEST-007 (canonical here) |
| Source card / date | docs/architecture/build-26.5-26.7-recovery-reliability.md:187-194 |
| Wave | W5 |
| Effort / risk | M / Low |
| Verification platform | Windows only |
| Path convention | Paths starting `src-tauri/` are under `apps/desktop/`; `features/`, `lib/`, `journeys/`, `design-system/` are under `apps/desktop/src/` unless written in full |
| Inspected source revision | b01e2b9 (application source identical to 92e7980) |
| Specification revision | r3 (2026-10-22; r2 + Block 4 corrections from 10 §8.2/§8.3) |
| Execution log | `code-review/11-remediation-execution-log.md` — created by the first task executed after approval (template in 08 index §I); every task appends its evidence there |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / a7310fd (HEAD). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | — (none; requires Kyle's explicit approval of this task ID and specification revision) |

## Purpose / risk
Manual recovery checks have never run on a packaged build.

## Trigger / reproduction
N/A.

## Root cause / evidence
N/A.

## Expected change scope
VM procedure: locked/corrupt journal, failed migration simulation (disposable), interrupted restore, malformed cleanup marker (TASK-015), stray/missing screenshot (TASK-016/017), large journal export (TASK-013/014), AV lock if feasible.

Source of the pending manual checks: `docs/architecture/build-26.5-26.7-recovery-reliability.md:187-194` (§5 "Pending and owners": native/packaged smoke and controlled-failure runs from §1 Block D; NVDA/contrast/scaling go to TASK-033); Block D's controlled-failure cases are at lines 110-112 of the same file.

## Out of scope
Real journal.

## Implementation approach
1. Run each scenario on a disposable profile; record outcome and message.

**Pass rule (r3, G9).** The gate is **Passed** only if every mandatory scenario below is run on the installed candidate and its observed result matches the expected result, with no data loss. Any mandatory scenario that fails gives **Failed**; any not run gives **Blocked** or **Not Run**, never Passed.

| # | Scenario | Expected result | Mandatory |
|---|---|---|---|
| R0 | Destructive round trip (`docs/architecture/build-26-accessibility-journeys.md:220-222`, the §8 destructive case): export a full backup through the real save dialog, erase the journal with its phrase, restore the backup | "Journal restored" appears only after the runtime is Ready; the synthetic account, trades and screenshots match the pre-export state; the export file name, size and SHA-256 are recorded | Yes |
| R1 | Locked journal (file held open by another process), then unlock and press Retry | Open failure explained with Retry and an allowlisted summary; after unlocking, Retry reaches Ready; data intact (lines 110-112) | Yes |
| R2 | Corrupt journal (disposable copy) | Failure explained; no empty-journal claim; the file is not reset or overwritten | Yes |
| R3 | Failed migration simulation (disposable) | Rolled back; the message names the pre-upgrade backup file; the journal opens at its previous state after the cause is fixed | Yes |
| R4 | Synthetic journal with a newer schema than the candidate | Refused with code and versions; no Retry/reset/downgrade; file untouched (lines 110-112) | Yes |
| R5 | Interrupted restore (process killed during restore) | Next start ends in either the pre-restore journal or the fully restored one, never a mix; record which | Yes |
| R6 | Malformed cleanup marker (TASK-015) | A zero-byte marker or non-regular entry still reaches Ready at startup and at restore prepare | Yes |
| R7 | Stray and missing screenshot (TASK-016/017) | A stray file is preserved in the safety folder; a missing screenshot does not block restore or erase | Yes |
| R8 | Large-journal export (TASK-013/014): synthetic journal with more than 64 MiB of free pages and small live data | Export succeeds (the temporary snapshot is vacuumed, never the live journal) and shows name, size and SHA-256; erase preview and restore inspect succeed. A synthetic journal whose live data exceeds a real cap is refused with a detail naming the component; the journal is unchanged | Yes |
| R9 | Antivirus lock | Record behaviour if feasible | No |
| R10 | Uncertain-write acknowledgement on the packaged build for the rulebook, Today checkpoint, calculation and screenshot surfaces (`docs/architecture/build-26.5-26.7-recovery-reliability.md:192-193`, still pending) | Record the behaviour if a reliable way to produce an uncertain outcome exists on the VM; otherwise record Not Run. This item has no other owner: if it is Not Run, the tester adds a Notion Triage card for it | No |

Legal prompt: if the disposable profile already holds an acceptance from an earlier build, the candidate shows the first-run agreement again after the upgrade (`apps/desktop/src/legal/index.ts:40-43`); expect this legal re-prompt and accept it; it is not a failure.

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-029.
- Likely shared-file conflicts: None.

## Acceptance criteria (pass/fail)
- [ ] Each scenario recorded with expected vs actual; gate state set by the pass rule above (Passed only if R0–R8 all match their expected results without data loss).
- [ ] R8 records the synthetic journal's size and free-page count, the export result (name, size, SHA-256) and that the live journal was not vacuumed.
- [ ] Keep `FUNDEDFLOW_UPDATE_FIXTURES` **unset (not `0`)** for every check; never regenerate fixtures unless this card explicitly names the fixture and its diff is reviewed.

## Verification plan
—

## Safety, rollback and side effects
Disposable profile/VM; synthetic data.

## Definition of done
Gate state recorded Passed/Failed/Not Run/Blocked with source SHA, installer EXE SHA-256, environment (Windows build, WebView2 version), tester, date and evidence. A planning document or inferred result is not a pass.

## Changes in r3
- Added an explicit pass rule with mandatory scenarios R1–R8 and optional R9 (10 §8.2 TASK-032; G9).
- r3 review fix: added mandatory R0 (the build-26 §8 export → erase → restore round trip, which TASK-033 relies on) and record-only R10 (the pending uncertain-write acknowledgement from the cited §5 list, with a Triage card if Not Run) (independent r3 review).
- Cited `docs/architecture/build-26.5-26.7-recovery-reliability.md:187-194` (verified at b01e2b9: §5 "Pending and owners") and the Block D cases at lines 110-112 (10 §8.2 TASK-032; G9).
- Gave the expected result for the large-journal export (R8), consistent with TASK-013 r3 (VACUUM of the temporary snapshot mandatory) and TASK-014 (10 §8.2 TASK-032; G9).
- Expect the legal re-prompt after an upgrade (10 §8.2 TASK-030/032/033; G9).
- Fixture rule: `FUNDEDFLOW_UPDATE_FIXTURES` unset (not `0`) (10 §8.3 fixture nit).

## Independent review notes
Independent review (Block 3, 2026-10-22): READY as drafted. r2 adds only global items (execution-log pointer; Triage-card step on Fix/Test cards).
Block 4 review (10 §8.2/§8.3): CHANGES — applied in r3: explicit pass rule (R1–R8 mandatory); recovery doc 187-194 cited; large-journal export expected result; legal re-prompt expected; fixture rule unset (not 0).
Independent review r3 (two reviewers, then a re-check of the blocking fixes, 2026-10-22): READY after the corrections listed in "Changes in r3" were applied.
