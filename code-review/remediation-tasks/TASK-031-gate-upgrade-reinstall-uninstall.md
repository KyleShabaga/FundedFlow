# TASK-031 — Gate: upgrade, reinstall, downgrade and uninstall (ticked and unticked) on the candidate

| Field | Value |
|---|---|
| Status | Proposed (r3; awaiting independent review) |
| Type | Verification |
| Audit priority | Gate |
| Roadmap lane | NA-5 |
| Mandatory gate | Yes — ISSUE-042 |
| Severity | N/A |
| Confidence | High |
| Canonical issue | ISSUE-042 (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | N/A (existing gate/decision); WIN-003, WIN-004 (linked) |
| Source card / date | Final Push V1 — https://app.notion.com/p/4001bd4b6bde8044ab04f75d167950cd; docs/build-26.75-evidence.md:17 |
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
Confirm data survives upgrade/reinstall, record what a downgrade does (no migration exists between candidates, so the older build is expected to open normally; NewerSchema appears only across a schema change), record NSIS's own downgrade prompt behaviour, and confirm the uninstall checkbox removes exactly what TASK-026 documents.

## Trigger / reproduction
N/A.

## Root cause / evidence
N/A.

## Expected change scope
VM procedure with a synthetic journal; results only.

## Out of scope
Real journal.

**Older EXE (r3, G6).** The previous build is the recorded 0.1.0 artifact: `fundedflow-0.1.0-7679edc-windows-nsis`, installer `FundedFlow_0.1.0_x64-setup.exe`, source SHA `7679edc1ac117944ae31d81b6c6a29142b61a0fe`, SHA-256 `041983f565c7f6b41dba2388c2f21bc8c4c7402c94e442ed0f75d00938e0787f`, release run 39691474111 — recorded in `docs/build-26.75-evidence.md:105-111`. The artifact expires 2026-11-20 (line 109): download it before then, check `Get-FileHash` against the recorded SHA-256, and keep the copy for this gate. If it has expired with no kept copy, the older build must be rebuilt from a named older SHA (approval required) and its source SHA and EXE SHA-256 recorded in the execution log before use; the gate is Blocked until then. The candidate must carry a higher version than 0.1.0 (TASK-005/TASK-027) so NSIS treats step 2 as an upgrade. No migration was added between `7679edc` and `92e7980` (no change under `src-tauri/migrations` or the schema), so the downgrade in step 4 is expected to open normally unless a remediation task adds one. `src-tauri/src/data_controls/` is also identical between `7679edc` and `92e7980`, so the cleanup-marker schema this EXE reads is the one the TASK-015/016 declaration is tested against.

## Implementation approach
1. Install the older EXE named above (verify its SHA-256 first), create synthetic data and screenshots, export an archive outside %APPDATA%.
2. Upgrade to the candidate; verify data. Expect the first-run agreement after the upgrade: `7679edc` has no legal gate (TASK-029), and any build whose accepted legal versions differ from the candidate's re-prompts (`apps/desktop/src/legal/index.ts:40-43`). Accept and continue; the re-prompt is expected, not a failure.
3. Reinstall same version; verify.
4. Install an older build over newer; record the NSIS prompt (if any) and whether the app opens normally. Downgrade with a pending cleanup follows the TASK-015/016 declaration (see those cards): run that case only as those cards declare it, and record the result against that declaration.
5. Uninstall unticked → data remains; uninstall ticked → list remaining folders.

**Pass rule (r3, G9).** The gate is **Passed** if and only if: (a) the synthetic data (account, trades, screenshots) is intact after the upgrade (step 2) and after the same-version reinstall (step 3); (b) an unticked uninstall keeps `%APPDATA%\com.fundedflow.desktop`; and (c) a ticked uninstall removes exactly the list documented by TASK-026 (no listed folder left, nothing unlisted removed; the exported archive outside `%APPDATA%` remains). Any of (a)–(c) false gives **Failed**; any not run gives **Not Run** or **Blocked**. The downgrade (step 4) is recorded, not part of the pass rule, except that its pending-cleanup case must match the TASK-015/016 declaration.

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-029; TASK-027 unique versions; the older EXE above available with its recorded SHA and SHA-256; TASK-015/016 downgrade declaration recorded (Kyle confirms it, runbook 10 §9 row "Downgrade with a pending cleanup").
- Likely shared-file conflicts: None.

## Acceptance criteria (pass/fail)
- [ ] Each step recorded with SHA/EXE hash/environment; uninstall result compared to TASK-026 text.
- [ ] The older EXE is recorded by name, source SHA and SHA-256, and its `Get-FileHash` matches the recorded value.
- [ ] Gate state set by the pass rule above.
- [ ] Keep `FUNDEDFLOW_UPDATE_FIXTURES` **unset (not `0`)** for every check; never regenerate fixtures unless this card explicitly names the fixture and its diff is reviewed.

## Verification plan
—

## Safety, rollback and side effects
Synthetic data on disposable VMs.

## Definition of done
Gate state recorded Passed/Failed/Not Run/Blocked with source SHA, installer EXE SHA-256, environment (Windows build, WebView2 version), tester, date and evidence. A planning document or inferred result is not a pass.

## Changes in r3
- Pass rule: Passed iff data intact after upgrade and reinstall, unticked uninstall keeps `%APPDATA%`, ticked uninstall removes exactly the TASK-026 list (10 §8.2 TASK-031; G9).
- Named the older EXE (0.1.0 artifact from `7679edc`) with its source SHA and SHA-256 and where they are recorded (`docs/build-26.75-evidence.md:105-111`), plus the expiry fallback (10 §8.2 TASK-031; G6).
- Downgrade with a pending cleanup follows the TASK-015/016 declaration (see those cards); added as a prerequisite (10 §8.2 TASK-031; G8).
- Expect the legal re-prompt after the upgrade (10 §8.3 TASK-030/031 nit; G9).
- No V-023 claim on this card; V-023 is owned by TASK-028 (10 §8.1 §D; G2).
- Fixture rule: `FUNDEDFLOW_UPDATE_FIXTURES` unset (not `0`) (10 §8.3 fixture nit).

## Independent review notes
Independent review r1: CHANGES (applied, 08 §H). Independent re-check r2: READY.
Block 4 review (10 §8.2/§8.3): CHANGES — applied in r3: pass rule; older EXE named with SHA and SHA-256; downgrade with pending cleanup follows TASK-015/016 declaration; legal re-prompt after upgrade expected; fixture rule unset (not 0).
