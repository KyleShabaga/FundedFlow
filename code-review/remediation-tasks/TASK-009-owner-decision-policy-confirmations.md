# TASK-009 — Owner decisions: fees, duplicate collapse, ledger UI, recovery-copy retention, archive format

| Field | Value |
|---|---|
| Status | Ready for Approval (r4) |
| Type | Owner Decision |
| Audit priority | P2/P3 (decisions; V1.1 inputs). Decisions (1) and (4) now create V1 P1 work, owned by TASK-042, TASK-043 and TASK-044 |
| Roadmap lane | Unassigned (owner) |
| Mandatory gate | No |
| Severity | N/A |
| Confidence | High |
| Canonical issue | ISSUE-034, ISSUE-035, ISSUE-037, ISSUE-018 (D-RET), ISSUE-004/002 (D-ARCH), ISSUE-021 (optional input) (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | TSD-008, DATA-020, UI-020, DATA-012 (linked) |
| Source card / date | Stage 1 audit 2026-10-22; CLAUDE.md money rules |
| Wave | W0 |
| Effort / risk | S / Low |
| Verification platform | N/A |
| Path convention | Paths starting `src-tauri/` are under `apps/desktop/`; `features/`, `lib/`, `journeys/`, `design-system/` are under `apps/desktop/src/` unless written in full |
| Inspected source revision | 9430f2a (application source identical to 92e7980) |
| Specification revision | r4 (2026-10-22; r3 + board review fixes) |
| Execution log | `code-review/11-remediation-execution-log.md` — created by the first task executed after approval (template in 08 index §I); every task appends its evidence there |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / 9430f2a (HEAD). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | r2: approved by Kyle on the Notion approval board, 2026-10-22, with the fee amendment. r3/r4: none yet; requires Kyle's explicit re-approval of TASK-009 r4, including explicit confirmation of decision 1 (see "Owner confirmation required") |

## Purpose / risk
Policies that determine V1 and V1.1 work: blank manual fees stored as 0 (`src-tauri/src/domain.rs:330-331`); identical ID-less CSV rows collapse (`src-tauri/src/csv_import/dedup.rs:11-13`); no ledger-entry UI while `features/rulebooks/components/CalculationSettings.tsx:14-15` asks whether fees and the ledger are complete; recovery copies keep deleted-account data; whether the archive format may change to export without missing attachments or with larger caps.

## Trigger / reproduction
N/A.

## Root cause / evidence
N/A.

## Options and consequences (owner decides)
Fees: keep 0 + coverage statement / nullable 'fees unknown' (migration, V1.1) / persisted "fees recorded" flag (V1 migration; chosen 2026-10-22, see decision 1). Dedup: keep / add override. Ledger UI: V1 / V1.1 / remove the settings question. Retention: accept disclosed retention / add pruning (V1.1). Archive format: keep v1 strict / v1.1 with missing-attachment manifest. Optional: export/restore to UNC/network paths (ISSUE-021, V1.1 path validator) — allow / reject network paths.

## Recorded decisions
1. **Fees (ISSUE-034).** r2 approval: "blank manual fees stay zero for owner-only V1 with explicit disclosure; unknown fees V1.1", amended on Notion to require a per-trade "fees not recorded" marker kept distinct from an explicit zero. **Superseded by Kyle's decision, 2026-10-22 (this session):** "a V1 migration plus a new task. Add a persisted 'fees recorded' flag so that missing fees are distinguishable from an explicitly entered zero." This replaces the earlier "storage redesign deferred to V1.1" wording. **Owner confirmation required:** this decision supersedes the owner's earlier approved amendment (keep storing zero, mark trades "fees not recorded" in the UI; nullable-fee redesign V1.1), and it moves the work from UI-only into a V1 schema migration (TASK-042) with a release-path rollback prerequisite (TASK-043). Because the earlier amendment is the one Kyle approved on the board, decision 1 holds only when Kyle explicitly confirms it at approval of TASK-009 r4; without that confirmation the r2 amendment stands and TASK-042/043 are not started. In both versions a blank fee is still stored as zero (the flag records whether fees were entered; it does not make the amount nullable), and nullable "fees unknown" storage remains V1.1. Owner: **TASK-042** (migration, storage, UI marker), with **TASK-043** (B2-1 rollback fix) as its prerequisite. Points TASK-042 still puts to Kyle: the legacy-row rule, the CSV-import rule, the net P&L display rule and the "Fees are complete" coverage-note rule.
2. **Duplicate collapse (ISSUE-035).** An explicit import override for identical ID-less rows is V1.1. "Document current collapse": the developer documentation already states it (`docs/data-model.md:856-858`, first "Limitations" bullet), and the import preview flags the second row as a duplicate. No V1 task owns user-facing documentation; propose a Triage card (see the SHOULD item in Changes in r3).
3. **Ledger-entry UI (ISSUE-037).** V1.1. Note: roadmap card "P1 Ledger entry UI" sits in lane P1 — V1.5 (audit N10); reconcile on the board.
4. **Recovery-copy retention (ISSUE-018, D-RET).** Accept disclosed V1 retention, including deleted-account data; pruning V1.1. The disclosure does not exist yet: the account-deletion section says "Failing or archiving an account keeps its history. Deleting removes it for good." (`features/data-controls/components/DataControlsPage.tsx:201`); the deletion dialog mentions recovery copies only for whole-journal erasure (`features/data-controls/components/DeletionDialog.tsx:165`, `!isAccount && preview.localRecoveryCopies > 0`); the privacy notice mentions only the pre-upgrade copy (`apps/desktop/src/legal/privacy-notice.ts:36-46`); the copies are enumerated in `src-tauri/src/data_controls/deletion.rs:93-131`. Owner of the V1 wording: **TASK-044**. This decision holds only once TASK-044 is Verified.
5. **Archive format (D-ARCH).** Strict archive v1; missing-attachment support only as a separate versioned change.
6. **Network paths (ISSUE-021, optional).** No direct network-path support; use local paths. Policy only: nothing enforces it until the V1.1 path validator; propose a Triage card (see Changes in r3).

## Expected change scope
Decisions only. The V1 work they create is specified in TASK-042, TASK-043 and TASK-044.

## Out of scope
Any implementation. V1 implementation is owned by TASK-042/043/044; everything else is V1.1.

## Implementation approach
1. Present each option set.
2. Record each decision (or explicit deferral).

## Prerequisites, dependencies and conflicts
- Prerequisites: None.
- Blocks: TASK-042 and TASK-043 (decision 1; TASK-043 exists only as TASK-042's B2-1 prerequisite), TASK-044 (decision 4).
- Likely shared-file conflicts: None.

## Acceptance criteria (pass/fail)
- [ ] Five decisions (plus the optional ISSUE-021 network-path question) recorded or explicitly deferred with source.
- [ ] Decision (1) records Kyle's 2026-10-22 choice verbatim and names TASK-042 (and its prerequisite TASK-043) as owner.
- [ ] Kyle's approval of TASK-009 r4 explicitly confirms that decision (1) supersedes the earlier amendment ("keep storing zero, mark trades 'fees not recorded' in UI; nullable redesign V1.1"); the confirmation is recorded verbatim in the approval evidence.
- [ ] Decision (4) names TASK-044 as owner of the V1 disclosure.

## Verification plan
Owner confirmation.

## Safety, rollback and side effects
None.

## Definition of done
Kyle's explicit choice recorded verbatim with date and source (trusted conversation or attributable Notion decision). Claude may prepare options but cannot decide, waive a gate, or infer approval.

## Changes in r3
- Decision (1) now records Kyle's 2026-10-22 choice ("a V1 migration plus a new task", persisted "fees recorded" flag), superseding the "storage redesign deferred to V1.1" wording and the Notion-only fee amendment; owner TASK-042, prerequisite TASK-043 (owner decision; audit MUST: the amendment could not be stored — `migrations/0001_core_schema.sql:368, 398` — and no task owned it).
- Decision (4): the "disclosed" retention it accepts has no disclosure today (`DataControlsPage.tsx:201`, `DeletionDialog.tsx:165`, `legal/privacy-notice.ts:36-46`; locations from `deletion.rs:93-131`). New V1 wording task TASK-044 owns it (audit MUST).
- Added a "Recorded decisions" section so all six decisions are in the file rather than only on Notion (audit process item: amendments existed only on Notion).
- Decision (2): records that the collapse is already documented for developers (`docs/data-model.md:856-858`); user-facing documentation has no owning task (audit SHOULD).
- Decision (6): records that network-path rejection is policy only until the V1.1 validator (audit SHOULD).
- Proposed Triage cards (not created here; Notion writes need their own approval): "Document identical ID-less row collapse for users" and "Enforce local-path-only export/restore (reject UNC/network paths)" (audit SHOULD: the remaining choices need homes).
- Audit priority relabelled "P2/P3", noting that decisions (1) and (4) now create P1 V1 work (Block 4 nit; audit N6).
- Scope, out-of-scope, Blocks and acceptance updated to name TASK-042/043/044.
- Inspected source revision and baseline updated to 9430f2a (application source identical to 92e7980).
- Decision 1 lists all four rules TASK-042 puts to Kyle, adding the coverage-note rule; Blocks also names TASK-043 (independent review (review4), reviewer C nits).

## Changes in r4
- Decision (1): states explicitly that it supersedes the owner's earlier approved amendment (keep storing zero, UI "fees not recorded" marker, nullable redesign V1.1), that zero is still stored and nullable fees remain V1.1, and that it requires Kyle's explicit confirmation at approval; new acceptance criterion and approval-evidence wording to match (board review 2026-10-22).
- Review notes: replaced the stale "r3: not yet reviewed" line (board review 2026-10-22).

## Independent review notes
Independent review (Block 3, 2026-10-22): READY as drafted. r2 adds only global items (execution-log pointer; Triage-card step on Fix/Test cards).
r3: reviewed in the approved-task audit pass (next line).
Independent review (approved-task audit fixes, 2026-10-22): three reviewers plus a re-check of the blocking fixes; READY at r3.
Board review (2026-10-22, against main 92e7980): APPROVE WITH NOTE (Kyle must explicitly confirm decision 1 at approval); fixes folded in at r4. Independent re-check of r4: pending.
