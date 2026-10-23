# TASK-030 — Gate: clean Windows smoke and offline acceptance on the candidate

| Field | Value |
|---|---|
| Status | Ready for Approval (r5) |
| Type | Verification |
| Audit priority | Gate |
| Roadmap lane | NA-2 / NA-5 |
| Mandatory gate | Yes — ISSUE-041, ISSUE-043 |
| Severity | N/A |
| Confidence | High |
| Canonical issue | ISSUE-041, ISSUE-043 (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | TEST-002 (instrument) |
| Source card / date | Final Push V1 — https://app.notion.com/p/4001bd4b6bde8044ab04f75d167950cd; legal track: PR #107 documents (Kyle, 2026-10-22; `10a-stage2-notion-publication-and-approval-manifest.md` §12) |
| Wave | W5 |
| Effort / risk | M / Low |
| Verification platform | Windows only |
| Path convention | Paths starting `src-tauri/` are under `apps/desktop/`; `features/`, `lib/`, `journeys/`, `design-system/` are under `apps/desktop/src/` unless written in full |
| Inspected source revision | 9430f2a (application source identical to 92e7980); PR #107 head `c0a076e` (branch `feat/mit-license-transition`, base 92e7980, draft, open). Citations written `#107 <path>:<line>` are to `c0a076e`. |
| Specification revision | r5 (2026-10-22; r4 + PR #107 legal-track alignment) |
| Execution log | `code-review/11-remediation-execution-log.md` — created by the first task executed after approval (template in 08 index §I); every task appends its evidence there |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / a7310fd (HEAD). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | — (none; requires Kyle's explicit approval of this task ID and specification revision) |

## Purpose / risk
Run the corrected checklist (TASK-028) on clean Windows 11 and Windows 10 22H2 VMs (full VM preferred over Sandbox).

## Trigger / reproduction
N/A.

## Root cause / evidence
N/A.

## Expected change scope
Owner/approved VM procedure; results only.

## Out of scope
Fixing failures (new tasks).

## Implementation approach
1. Verify EXE SHA-256.
2. Run every checklist step including offline steps 3–10 and the TASK-028 added steps B1–B7 (junction, OneDrive, close, ticked uninstall, second instance, DPI, install without WebView2 online and offline). This card executes B4 and B7 but does not own V-023; TASK-028 owns it (08 §D, G2).
3. Record Pass/Fail per step with screenshots.
**R1. Real-format import check** (TASK-007 r4 P0-05 waiver condition, accepted by Kyle on 2026-10-22, `10a-stage2-notion-publication-and-approval-manifest.md` §12; mandatory, owner-run, counts only): run once, on either VM, after checklist step 10. Kyle imports one current real export from his broker into the installed candidate. Record only: exporter name, file row count, imported trade count, duplicate and skipped counts, warning and error counts by kind (field or category), and pass/fail. Never record warning or error message text: CSV messages embed cell values such as trade and fill IDs (`csv_import/dedup.rs:67-68`), symbols (`csv_import/normalize.rs:144`) and header names (`csv_import/detect.rs:293-378`). Never commit, attach or upload the file or its values; remove it and the VM journal from the VM afterwards. Mandatory: Yes (a failed import is Failed; not run is Blocked).

**Pass rule (r3).** The gate is **Passed** only if every mandatory step below is run on the candidate and its observed result matches the expected result written in the TASK-028 checklist, on both a clean Windows 11 VM and a clean Windows 10 22H2 VM (B7 needs an image without WebView2; one such image is enough), except R1, which runs once, on either VM, after step 10. A "known limitation (V1.1)" result counts as a pass only where the checklist says that is the expected result. Any mandatory step that fails gives **Failed**; any mandatory step not run (for example, no image without WebView2 available) gives **Blocked** or **Not Run**, never Passed.
- Mandatory: 1 (hash matches `SHA256SUMS.txt`), 2 (install, no UAC), 3 (offline from here to step 10), 4 (first-run acknowledgment screen with the documents below → **Acknowledge and continue** → Today, offline), 4a (installed legal files and in-app notices), 5 (journal path), 6 (data survives reopen), 7 (no developer tools), 8 (unticked uninstall keeps the journal), 9 (reinstall opens the data), 10 (over-install keeps the journal), B1–B7, R1 (real-format import, one VM; owner-run by Kyle, counts only).
- Optional: 11 (network observation); record it if run.
- Legal documents (r5; the packaged check TASK-025 delegates here): under Kyle's TASK-025 draft-status choice (A), step 4 shows the privacy notice and License and product information at `0.2.1-draft` (`#107 apps/desktop/src/legal/privacy-notice.ts:5-6`, `#107 apps/desktop/src/legal/user-agreement.ts:5-6`) with the "Draft documents" banner on the first-run screen (`#107 apps/desktop/src/features/legal/components/LegalGate.tsx:63-67`), and Settings → Privacy & legal lists both documents at those versions with its "Draft documents" banner (`#107 features/legal/components/PrivacyLegalSection.tsx:23-31`); under (B), the finalized versions named in TASK-025's later revision and no draft banners. Any other version, a missing document or a missing (A) banner is a Fail of step 4.
- Legal prompt: the first launch of a fresh install shows the first-run acknowledgment screen, titled "Before you start" (step 4; `#107 LegalGate.tsx:55`). If the VM profile already holds an acceptance or acknowledgment record for an earlier document version or digest (for example, after installing over an older build), the candidate shows the screen again, titled "The privacy or product notice has changed" and naming the changed documents (`#107 LegalGate.tsx:55, 60-62`) — expect this re-prompt and acknowledge it again; it is not a failure (`#107 apps/desktop/src/legal/index.ts:44-47` requires every current document's version and digest). A same-version reinstall after an unticked uninstall (steps 9–10) keeps `legal-acceptance.json` in `%APPDATA%\com.fundedflow.desktop` and does not re-prompt (`#107 docs/design/screens/16-first-run.md:42`).

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-029, TASK-028; PR #107 merged and TASK-025 (Kyle's draft-status choice sets the expected documents and banners) (legal-track decision 2026-10-22).
- Likely shared-file conflicts: None.

## Acceptance criteria (pass/fail)
- [ ] Every step recorded Pass/Fail with SHA, EXE hash, Windows build, WebView2 version, tester, date; gate state set by the pass rule above (Passed only if every listed mandatory step, including B1–B7 and R1, passes on both VMs, R1 on one VM).
- [ ] Steps 4 and 4a record the document titles and versions shown on the first-run screen and in Settings, whether the "Draft documents" banners appear (expected under TASK-025 (A)), and that **Acknowledge and continue** led to Today; this result is recorded against TASK-025's packaged-check criterion.
- [ ] R1 real-format import (mandatory; owner-run by Kyle) recorded with counts by kind only (no file, no values, no message text) and pass/fail.
- [ ] Keep `FUNDEDFLOW_UPDATE_FIXTURES` **unset (not `0`)** for every check; never regenerate fixtures unless this card explicitly names the fixture and its diff is reviewed.

## Verification plan
—

## Safety, rollback and side effects
Disposable VMs only; never the real journal.

## Definition of done
Gate state recorded Passed/Failed/Not Run/Blocked with source SHA, installer EXE SHA-256, environment (Windows build, WebView2 version), tester, date and evidence. A planning document or inferred result is not a pass.

## Changes in r3
- Added an explicit pass rule listing the mandatory steps (1–10, 4a, B1–B7), the optional step (11) and how Failed/Blocked/Not Run are decided (10 §8.2 TASK-030; G9).
- Expect the legal re-prompt after an upgrade; a same-version reinstall does not re-prompt (10 §8.2 TASK-030 and §8.3 TASK-030/031 nit; G9).
- V-023: this card runs B4 and B7 but no longer claims V-023; TASK-028 owns it (10 §8.1 §D; G2).
- Fixture rule: `FUNDEDFLOW_UPDATE_FIXTURES` unset (not `0`) (10 §8.3 fixture nit).

## Changes in r4
- Added the owner-run real-export import check (step 4, mandatory, counts only, nothing committed), required by TASK-007 r4 because TASK-037 removes the last real-format fixture and P0-05 is waived (approved-task audit SHOULD).
- The import step is renamed R1 (it clashed with checklist step 4, the first-run agreement), added to the pass rule's mandatory list and AC1, and runs once on either VM after step 10 (independent review (review4), reviewer C blocking 1).
- R1 records warning and error counts by kind, never message text, because CSV messages embed values (`csv_import/dedup.rs:67-68`, `normalize.rs:144`, `detect.rs:293-378`); file handling reworded to "never commit, attach or upload; remove it and the VM journal afterwards" (independent review (review4), reviewer C blocking 2 and nit).
- `Inspected source revision` bumped to 9430f2a and the revision label put in the brief's format (independent review (review4), reviewer C nits).

## Changes in r5
- Pass rule, step 4: "first-run agreement → Accept → Today" becomes the first-run acknowledgment screen → **Acknowledge and continue** → Today (`#107 LegalGate.tsx:58`) (legal-track decision 2026-10-22).
- New "Legal documents" item and criterion: the packaged first-run screen and Settings must show the `0.2.1-draft` privacy notice and License and product information with the "Draft documents" banners under TASK-025 (A) (`#107 LegalGate.tsx:63-67`; `#107 PrivacyLegalSection.tsx:23-31`), or the finalized versions under (B); this is the packaged check TASK-025 r6 delegates to this card (legal-track decision 2026-10-22).
- Legal prompt: worded as acknowledgment of the documents; the re-prompt after an upgrade is still expected (title "The privacy or product notice has changed", `#107 LegalGate.tsx:55, 60-62`); citation moved from `legal/index.ts:40-43` at 92e7980 to `#107 legal/index.ts:44-47`; same-version reinstall cites `#107 16-first-run.md:42` (legal-track decision 2026-10-22).
- Prerequisites: PR #107 merged and TASK-025's draft-status choice (legal-track decision 2026-10-22).
- R1 is no longer conditional: Kyle accepted the TASK-007 r4 real-export import condition on 2026-10-22 (`10a-stage2-notion-publication-and-approval-manifest.md` §12), so R1 is a mandatory step, run by Kyle, counts only, in the pass rule, mandatory list and criteria (board re-check 2026-10-22).

## Independent review notes
Independent review (Block 3, 2026-10-22): READY as drafted. r2 adds only global items (execution-log pointer; Triage-card step on Fix/Test cards).
Block 4 review (10 §8.2/§8.3): CHANGES — applied in r3: explicit pass rule with mandatory steps; legal re-prompt after upgrade expected; V-023 not claimed (owned by TASK-028); fixture rule unset (not 0).
Independent review r3 (two reviewers, then a re-check of the blocking fixes, 2026-10-22): READY after the corrections listed in "Changes in r3" were applied.
Independent review (approved-task audit fixes, 2026-10-22): three reviewers plus a re-check of the blocking fixes; READY at r4.
Revised for Kyle's legal-track decision (PR #107 documents), 2026-10-22. Independent re-check of r5 (2026-10-22): READY; nits applied.


## Owner scope changes (Kyle, 2026-10-23, after approval)
- The OneDrive export case (TASK-028 B2, OneDrive part) is removed from V1 scope. It is listed as an untested known gap for TASK-035 and TASK-036.
- Windows Sandbox counts as the clean Windows 11 leg. The Windows 10 22H2 leg is skipped and is a TASK-036 known gap.
- These are recorded owner decisions. The approved revision's text above is unchanged. See `code-review/11-remediation-execution-log.md`.
