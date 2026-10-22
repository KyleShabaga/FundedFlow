| Field | Value |
|---|---|
| Date | 2026-10-22 |
| Repository HEAD at spec time | `63e0e27` (r2 cards, before the re-check fixes). Application source is identical to `92e7980`, and `a7310fd` is the Block 2 plan. |
| Inputs | `remediation-findings-ledger.md`, `06-stage2-evidence-reconciliation.md`, `07-stage2-priorities-and-dependencies.md`, Stage 1 reports `00`–`05`, and source read at the revision above |
| Specification revision | r2 (2026-10-22), which is r1 plus the independent-review corrections |
| Review | Two independent read-only reviewers. The first reviewed r1 (16 READY, 20 CHANGES); every correction was applied. The second re-checked the 20 corrected cards (11 READY, 9 CHANGES); every correction was applied in the final r2. See §H. |
| Status | 36 tasks. **None is Approved.** Approval needs Kyle's explicit approval of a task ID at this spec revision. |
| Scope of Block 3 | Task and index Markdown only. No source, configuration, migration, fixture, test or dependency was changed, no fix was implemented, and Block 4 was not started. |

**Status vocabulary.**
- **Proposed:** drafted, not yet reviewed.
- **Ready for Approval:** passed independent review, or its required corrections were applied and re-checked.
- **Approved:** Kyle approved this task ID and spec revision. No task is Approved.
- **Blocked**, **In Progress**, **Verified**: execution states.

## A. Full task index

| Task ID | Title | Source card / linked finding IDs or N/A | Audit priority / roadmap lane | Type / mandatory gate | Dependencies | Effort | Risk | Verification platform | Specification revision | Approval/status |
|---|---|---|---|---|---|---|---|---|---|---|
| TASK-001 (remediation-tasks/TASK-001-owner-decision-0bsd.md) | Owner decision: 0BSD licence allow-list | ISSUE-057; N/A (existing gate/decision); TEST-008 (linked) | P1 (decision) / Final Push V1 (open disposition) | Owner Decision / Yes — blocks candidate notices | None. | S | Low | N/A | r2 (2026-10-22; r1 + independent-review corrections) | No approval; Ready for Approval |
| TASK-002 (remediation-tasks/TASK-002-owner-decision-test-csv-provenance.md) | Owner decision: provenance of test_csvimport CSV files | ISSUE-036; TR-020 | P1 (decision) / Unassigned (owner) | Owner Decision / Yes — before any tag/candidate | None. | S | Low | N/A | r2 (2026-10-22; r1 + independent-review corrections) | No approval; Ready for Approval |
| TASK-003 (remediation-tasks/TASK-003-owner-decision-engine-authority.md) | Owner decision: authority for stored risk verdicts (TS engine vs Rust) | ISSUE-012; UI-002 | P1 (decision) / P0-02 / Build 16 (merged) — governance | Owner Decision / No | None. | S | Low | N/A | r2 (2026-10-22; r1 + independent-review corrections) | No approval; Ready for Approval |
| TASK-004 (remediation-tasks/TASK-004-doc-engine-authority-rule.md) | Document the engine-authority decision in CLAUDE.md and packages.md | ISSUE-012; UI-002 | P1 / P0-02 / Build 16 (governance) | Documentation / No | TASK-003. | S | Low | Any OS | r2 (2026-10-22; r1 + independent-review corrections) | No approval; Ready for Approval |
| TASK-005 (remediation-tasks/TASK-005-owner-decision-version-scheme.md) | Owner decision: candidate version scheme | ISSUE-022; WIN-004 (linked) | P1 (decision) / NA-2 / P0-06 (release) | Owner Decision / Yes — before candidate | None. | S | Low | N/A | r2 (2026-10-22; r1 + independent-review corrections) | No approval; Ready for Approval |
| TASK-006 (remediation-tasks/TASK-006-owner-decision-offline-installer.md) | Owner decision: WebView2 install mode (bootstrapper vs offline installer) | ISSUE-023 (D-OFF); ISSUE-058 (decided parts); WIN-005 (linked) | P1 (decision) / NA-7 / NA-2 | Owner Decision / Yes — affects offline gate and NA-7 text | None. | S | Low | N/A | r2 (2026-10-22; r1 + independent-review corrections) | No approval; Ready for Approval |
| TASK-007 (remediation-tasks/TASK-007-owner-decision-final-push-dispositions.md) | Owner decisions: P0-05 cohort, P0-09 evidence, P0-10 studies, D5 wrappers | ISSUE-047, ISSUE-048, ISSUE-055, ISSUE-056; N/A (existing gate/decision); TEST-008 (linked) | Gate / decision / Final Push V1 | Owner Decision / Yes — go/no-go inputs | None. | S | Low | N/A | r2 (2026-10-22; r1 + independent-review corrections) | No approval; Ready for Approval |
| TASK-008 (remediation-tasks/TASK-008-owner-decision-build-10-5-gates.md) | Owner decisions: real-journal-copy upgrade gate and cargo fmt gate | ISSUE-052, ISSUE-053 (+ ISSUE-038); TEST-006 (linked) | Gate / decision / Build 10.5 gates (historical, V1) | Owner Decision / Yes | None. | S | Low | N/A | r2 (2026-10-22; r1 + independent-review corrections) | No approval; Ready for Approval |
| TASK-009 (remediation-tasks/TASK-009-owner-decision-policy-confirmations.md) | Owner decisions: fees, duplicate collapse, ledger UI, recovery-copy retention, archive format | ISSUE-034, ISSUE-035, ISSUE-037, ISSUE-018 (D-RET), ISSUE-004/002 (D-ARCH), ISSUE-021 (optional input); TSD-008, DATA-020, UI-020, DATA-012 (linked) | P2 (decisions; V1.1 inputs) / Unassigned (owner) | Owner Decision / No | None. | S | Low | N/A | r2 (2026-10-22; r1 + independent-review corrections) | No approval; Ready for Approval |
| TASK-010 (remediation-tasks/TASK-010-verify-journal-growth.md) | Verification: measure journal growth per risk calculation (ISSUE-002 escalation check) | ISSUE-002; DATA-004 | P1 / Unassigned (owner) | Verification / No | Approval of this task (it runs cargo with disposable data). | M | Low | Any OS | r2 (2026-10-22; r1 + independent-review corrections) | No approval; Ready for Approval |
| TASK-011 (remediation-tasks/TASK-011-verify-windows-baseline.md) | Verification: Windows baseline measurements on a throwaway build (close, junction, write timing) | ISSUE-009, ISSUE-006, ISSUE-010; DATA-008, UI-005, WIN-001, WIN-002, DATA-006, DATA-007 | P1 / Unassigned (owner) | Verification / No (results do not count toward gates) | Approval; a Windows VM. Synthetic CSV must not contain real trades. | M | Low | Windows only | r2 (2026-10-22; r1 + independent-review corrections) | No approval; Ready for Approval |
| TASK-012 (remediation-tasks/TASK-012-archive-schema-exact-allowlist.md) | Fix: archive schema validation uses an exact allow-list for sqlite internal objects | ISSUE-005; TR-001 | P1 / Unassigned (owner) | Fix / No | None (first in W1). | S–M | Medium (all restore paths) | Any OS | r2 (2026-10-22; r1 + independent-review corrections) | No approval; Ready for Approval |
| TASK-013 (remediation-tasks/TASK-013-live-cap-used-pages.md) | Fix: live-journal size checks count used pages and name the component over the limit | ISSUE-002 (part a); DATA-004 | P1 (P0 if TASK-010 escalates) / Unassigned (owner) | Fix / No | TASK-012 (same file, merge order); TASK-010 result (priority). | M | High (export/restore/erase) | Any OS | r2 (2026-10-22; r1 + independent-review corrections) | No approval; Ready for Approval |
| TASK-014 (remediation-tasks/TASK-014-stream-hash-preview-tokens.md) | Fix: restore/deletion preview tokens hash the live journal without a capped full dump | ISSUE-002 (part b); DATA-004 | P1 / Unassigned (owner) | Fix / No | TASK-013. | M | High (destructive flows' safety token) | Any OS | r2 (2026-10-22; r1 + independent-review corrections) | No approval; Ready for Approval |
| TASK-015 (remediation-tasks/TASK-015-cleanup-marker-atomic-nonfatal.md) | Fix: deletion cleanup markers are atomic and cannot block journal startup | ISSUE-001; DATA-001 | P1 / Unassigned (owner) | Fix / No | TASK-014 (shared deletion.rs merge order). | M | High (startup, erase) | Any OS (+ Windows in TASK-032) | r2 (2026-10-22; r1 + independent-review corrections) | No approval; Ready for Approval |
| TASK-016 (remediation-tasks/TASK-016-stray-attachments-preserved.md) | Fix: stray files under attachments/ no longer block restore and erase | ISSUE-003; DATA-002 | P1 / Unassigned (owner) | Fix / No | TASK-015. | M | High | Any OS | r2 (2026-10-22; r1 + independent-review corrections) | No approval; Ready for Approval |
| TASK-017 (remediation-tasks/TASK-017-missing-attachments-erase-restore.md) | Fix: missing/changed attachment files no longer block erase and restore | ISSUE-004 (erase/restore part); DATA-003 | P1 / Unassigned (owner) | Fix / No | TASK-016. | M | High | Any OS | r2 (2026-10-22; r1 + independent-review corrections) | No approval; Ready for Approval |
| TASK-018 (remediation-tasks/TASK-018-startup-reparse-scope.md) | Fix: startup tolerates reparse points above the app data folder (Windows) | ISSUE-006 (startup part); WIN-001 (WIN-002 user-path part deferred to V1.1 with TR-007) | P1 / Unassigned (owner) | Fix / No | TASK-017 (merge order on data_controls); TASK-011 (b) results to confirm cases; approval of the `windows-sys` declaration only if std `is_symlink` proves insufficient. | M–L | High (startup) | Windows only (+ Any OS for regression) | r2 (2026-10-22; r1 + independent-review corrections) | No approval; Ready for Approval |
| TASK-019 (remediation-tasks/TASK-019-checked-decimal-subtraction.md) | Fix (optional pull-in): checked Decimal subtraction in P&L and planned risk | ISSUE-008; TR-002, TR-003 | P2 (recommended pull-in to W1) / Unassigned (owner) | Fix / No | None (independent; recommended alongside W1). | S | Low | Any OS | r2 (2026-10-22; r1 + independent-review corrections) | No approval; Ready for Approval |
| TASK-020 (remediation-tasks/TASK-020-rust-reset-effective-from-trading-day.md) | Fix: Rust enforces trading-day effective_from for resets and assignments | ISSUE-007 (persistence part); UI-010 | P1 / Unassigned (owner) | Fix / No | None. | S | Low–Medium | Any OS | r2 (2026-10-22; r1 + independent-review corrections) | No approval; Ready for Approval |
| TASK-021 (remediation-tasks/TASK-021-ui-trading-day-from-rust.md) | Fix: UI uses the Rust trading day for 'in use' rulebook, badges and reset default | ISSUE-007; UI-001, UI-009, UI-010 (UI part) | P1 / Unassigned (owner) | Fix / No | TASK-020. | M | Medium | Any OS | r2 (2026-10-22; r1 + independent-review corrections) | No approval; Ready for Approval |
| TASK-022 (remediation-tasks/TASK-022-leave-guard-history-navigation.md) | Fix: unsaved-changes guard covers history navigation and programmatic navigate() | ISSUE-009 (history part); UI-005, DATA-008 (navigation part) | P1 / Unassigned (owner) | Fix / No | None. | M | Medium | Any OS | r2 (2026-10-22; r1 + independent-review corrections) | No approval; Ready for Approval |
| TASK-023 (remediation-tasks/TASK-023-native-close-veto.md) | Fix: native window close asks before discarding unsaved edits | ISSUE-009 (close part); DATA-008 | P1 / Unassigned (owner) | Fix / No | TASK-011 (a); TASK-022. | M | Medium–High (window lifecycle) | Windows only (+ Any OS for component tests) | r2 (2026-10-22; r1 + independent-review corrections) | No approval; Ready for Approval |
| TASK-024 (remediation-tasks/TASK-024-uncertain-outcome-wording.md) | Fix: uncertain write outcomes are not reported as definite failures | ISSUE-011 (wording part); UI-004, UI-003 (toast wording only) | P1 (wording only) / Unassigned (owner); P0-03 rule (merged) | Fix / No | TASK-021, TASK-022 (shared files merge order). | S | Low | Any OS | r2 (2026-10-22; r1 + independent-review corrections) | No approval; Ready for Approval |
| TASK-025 (remediation-tasks/TASK-025-owner-only-legal-notices.md) | Gate work: integrate owner-only v1.1 legal notices (statement 1.0.1-owner-only; privacy 1.0.0-owner-only) | ISSUE-039; TEST-003; TR-014 (linked; canonical ISSUE-023) | Gate work (mandatory) / P0-13 / NA-3 (V1, open) | Fix / Yes — ISSUE-039 | TASK-001 (0BSD), TASK-006 (wording basis), TASK-026 (wording), v1.1 text supplied by Kyle; owner decision whether the `user-agreement` id stays. | S–M | Low | Any OS (+ packaged check in TASK-030) | r2 (2026-10-22; r1 + independent-review corrections) | No approval; Ready for Approval |
| TASK-026 (remediation-tasks/TASK-026-install-uninstall-webview2-docs.md) | Documentation: uninstall scope, WebView2/offline wording and workflow facts | ISSUE-023; WIN-003, WIN-005, TR-014 | P1 / NA-7 / P0-13 (V1) | Documentation / Supports ISSUE-049 | TASK-006. | S | Low | Any OS | r2 (2026-10-22; r1 + independent-review corrections) | No approval; Ready for Approval |
| TASK-027 (remediation-tasks/TASK-027-release-workflow-gating-version.md) | Fix (process): release build gated on CI for the same SHA; unique version per candidate | ISSUE-022; WIN-006, WIN-004, WIN-008, TEST-010; TEST-001 (dup → ISSUE-040) | P1 / NA-2 / P0-06 (release) | Fix / Supports ISSUE-040/042 | TASK-005. | S–M | Low | Any OS (CI) | r2 (2026-10-22; r1 + independent-review corrections) | No approval; Ready for Approval |
| TASK-028 (remediation-tasks/TASK-028-smoke-checklist-na7-draft.md) | Documentation: correct the smoke checklist (first-run gate etc.) and refresh NA-7 draft notes | ISSUE-041, ISSUE-049; TEST-002 | Gate work / NA-2 / NA-5 / NA-7 | Documentation / Yes — instrument for ISSUE-041/043; ISSUE-049 draft | TASK-025, TASK-026. | S | Low | Any OS | r2 (2026-10-22; r1 + independent-review corrections) | No approval; Ready for Approval |
| TASK-029 (remediation-tasks/TASK-029-build-and-record-candidate.md) | Gate: build and record the release candidate (CI green, advisory result, EXE SHA-256) | ISSUE-040, ISSUE-050, ISSUE-051; WIN-007, TEST-001, TEST-004 (linked); TR-012/TR-013 observation | Gate / NA-2 / P0-06 | Verification / Yes — ISSUE-040, ISSUE-050, ISSUE-051 (+ ISSUE-030 checks) | All W1–W3 tasks Verified (incl. TASK-025, TASK-026, TASK-027); TASK-001, TASK-002, TASK-005, TASK-006 decided. | S | Low | GitHub Actions + Windows (hash check) | r2 (2026-10-22; r1 + independent-review corrections) | No approval; Ready for Approval |
| TASK-030 (remediation-tasks/TASK-030-gate-clean-smoke-offline.md) | Gate: clean Windows smoke and offline acceptance on the candidate | ISSUE-041, ISSUE-043; TEST-002 (instrument) | Gate / NA-2 / NA-5 | Verification / Yes — ISSUE-041, ISSUE-043 | TASK-029, TASK-028. | M | Low | Windows only | r2 (2026-10-22; r1 + independent-review corrections) | No approval; Ready for Approval |
| TASK-031 (remediation-tasks/TASK-031-gate-upgrade-reinstall-uninstall.md) | Gate: upgrade, reinstall, downgrade and uninstall (ticked and unticked) on the candidate | ISSUE-042; N/A (existing gate/decision); WIN-003, WIN-004 (linked) | Gate / NA-5 | Verification / Yes — ISSUE-042 | TASK-029; TASK-027 unique versions. | M | Low | Windows only | r2 (2026-10-22; r1 + independent-review corrections) | No approval; Ready for Approval |
| TASK-032 (remediation-tasks/TASK-032-gate-manual-recovery.md) | Gate: manual recovery acceptance on the candidate (incl. ISSUE-001–004 scenarios) | ISSUE-044; TEST-007 (canonical here) | Gate / Build 26.5–26.7 / Build 10.5 gate 6 | Verification / Yes — ISSUE-044 | TASK-029. | M | Low | Windows only | r2 (2026-10-22; r1 + independent-review corrections) | No approval; Ready for Approval |
| TASK-033 (remediation-tasks/TASK-033-gate-accessibility-dpi.md) | Gate: manual accessibility and window/DPI matrix on the candidate | ISSUE-045, ISSUE-046; TEST-007 (cross-ref); WIN-009 (linked) | Gate / Build 26 §9 / P0-08 / NA-5 | Verification / Yes — ISSUE-045, ISSUE-046 | TASK-029. | M | Low | Windows only | r2 (2026-10-22; r1 + independent-review corrections) | No approval; Ready for Approval |
| TASK-034 (remediation-tasks/TASK-034-gate-real-journal-copy-upgrade.md) | Gate (conditional): real-journal-copy upgrade with a safe procedure | ISSUE-052, ISSUE-038; TEST-006 | Gate (if kept) / P2 test safety / Build 10.5 gate | Test / Yes if TASK-008 keeps it — ISSUE-052 | TASK-008 (keep), TASK-029. | S | Low | Any OS (test) + Windows (owner run) | r2 (2026-10-22; r1 + independent-review corrections) | No approval; Ready for Approval |
| TASK-035 (remediation-tasks/TASK-035-evidence-register-na7-final.md) | Documentation/gate: final evidence register and NA-7 release notes | ISSUE-049; N/A (existing gate/decision) | Gate / NA-7 | Documentation / Yes — ISSUE-049 | TASK-029..TASK-033 (and TASK-034 if kept). | S | Low | Any OS | r2 (2026-10-22; r1 + independent-review corrections) | No approval; Ready for Approval |
| TASK-036 (remediation-tasks/TASK-036-owner-go-no-go.md) | Owner decision: P0-18 human go/no-go | ISSUE-054; N/A (existing gate/decision) | Gate / P0-18 (V1) | Owner Decision / Yes — ISSUE-054 | TASK-035. | S | Low | N/A | r2 (2026-10-22; r1 + independent-review corrections) | No approval; Ready for Approval |

Card paths are relative to `code-review/`. Every card carries the full field set:
- status, priority, lane, gate flag, severity, confidence and type;
- source card, finding IDs, purpose, trigger, root cause, scope and out of scope;
- steps, prerequisites and conflicts;
- acceptance criteria, verification plan, safety, effort and risk;
- approval evidence and definition of done.

## B. Work grouped by wave

| Wave | Purpose | Tasks |
|---|---|---|
| W0 | Owner decisions and measurements. No code. | 001, 002, 003, 004 (docs after 003), 005, 006, 007, 008, 009, 010, 011 |
| W1 | Data safety (native), merged in this order because they share `data_controls` files | 012 → 013 → 014 → 015 → 016 → 017 → 018; 019 is an optional pull-in that can run in parallel |
| W2 | Correctness (Rust, then UI) | 020 → 021; 022 → 023 (023 needs the result of 011(a)); 024 goes after 021 and 022 |
| W3 | Legal, release and docs | 026 → 025; 027 (after 005); 028 (after 025 and 026) |
| W4 | Candidate | 029 |
| W5 | Manual Windows gates | 030, 031, 032, 033; 034 is conditional on 008 |
| W6 | Release notes and go/no-go | 035 → 036 |

**Critical path:**
1. Decisions 001, 002, 005 and 006, together with W1–W3.
2. TASK-029.
3. W5 gates.
4. TASK-035.
5. TASK-036.

**Block 2 constraints carried into the cards:**
- **B2-1:** the rollback validates the safety DB at `latest_version` (`restore.rs:345-349`). This is ISSUE-018, deferred to V1.1. No V1 task adds a migration, so B2-1 does not block V1. **Any future migration task must list B2-1 as its prerequisite.**
- **B2-2:** the risk fingerprint is sensitive to DTO shape. TASK-014 and TASK-019 do not change trade or ledger DTOs. Any future fees or request-ID migration must re-check it.
- **B2-3 and B2-4:** rebuild cascades and the `import_batches.status` CHECK. No V1 task rebuilds a table or adds a status.
- **B2-5:** a `windows-sys` helper. TASK-018 first tries std `is_symlink`; declaring a dependency needs explicit approval.

## C. Mapping of every canonical issue, gate and decision

### C.1 Defects and hardening (ISSUE-001 to ISSUE-038)

| Canonical issue | Original IDs | Task(s) | Disposition / reason |
|---|---|---|---|
| ISSUE-001 Cleanup marker blocks open | DATA-001 | TASK-015, TASK-032 | V1 fix |
| ISSUE-002 Live size caps | DATA-004 | TASK-010, TASK-013, TASK-014, TASK-032 | V1 fix. **Deferred to V1.1:** 002c frozen-input redesign, needs TASK-003; a new task if TASK-010 escalates. |
| ISSUE-003 Stray attachment blocks | DATA-002 | TASK-016, TASK-032 | V1 fix |
| ISSUE-004 Missing attachment blocks | DATA-003 | TASK-017, TASK-009 (D-ARCH), TASK-032 | V1 fix for erase and restore. **Deferred to V1.1:** export side, pending the archive-format decision. |
| ISSUE-005 Archive schema bypass | TR-001 | TASK-012 | V1 fix. The live `trusted_schema` change is a separate PR. |
| ISSUE-006 Reparse points | WIN-001; WIN-002 | TASK-011(b), TASK-018, TASK-028 | V1 fix for startup. **Deferred to V1.1:** WIN-002 user-path part (with TR-007). |
| ISSUE-007 Calendar vs trading day | UI-001, UI-009, UI-010 | TASK-020, TASK-021 | V1 fix |
| ISSUE-008 Decimal overflow panic | TR-002, TR-003 | TASK-019 (optional pull-in) | P2. If not pulled in, deferred to V1.1. **Deferred:** bounded price validation. |
| ISSUE-009 Unsaved text lost | DATA-008, UI-005 | TASK-011(a), TASK-022, TASK-023 | V1 fix. **Deferred to V1.1:** durable drafts. |
| ISSUE-010 Idempotency / deadline | DATA-006, DATA-007, TR-005 (dup) | TASK-011(c) measures it | **Deferred to V1.1:** request-ID migration needs B2-1. Escalates if 011(c) shows commits over 30 s. |
| ISSUE-011 Uncertain outcomes | UI-003, UI-004, UI-011 | TASK-024 (wording) | V1 wording fix. **Deferred to V1.1:** settings auto-ack and the daily-review acknowledge flow, after ISSUE-016. |
| ISSUE-012 TS engine authority | UI-002 | TASK-003, TASK-004 | Decision and docs. **Deferred to V1.1:** Rust verdict fixtures. |
| ISSUE-013 Screenshot IPC | TR-006 | none | **Deferred to V1.1:** stall not measured; contract and CSP change |
| ISSUE-014 Read fan-out | UI-008 | none | **Deferred to V1.1:** P3, churn is bounded |
| ISSUE-015 Panic handling | DATA-005, TR-004 | none | **Deferred to V1.1:** no current panic site. TR-004 is Unverified. |
| ISSUE-016 IPC error classification | TR-008, TR-010, TR-018 | none | **Deferred to V1.1:** low frequency; precedes 010 and 011 (rest) |
| ISSUE-017 `created` flag | TR-009 | none | **Deferred to V1.1:** P3, self-heals |
| ISSUE-018 Recovery hygiene (+B2-1) | DATA-010, -011, -012, -014 | TASK-009 (D-RET) | **Deferred to V1.1.** B2-1 must land before any migration. |
| ISSUE-019 Failed import batch | DATA-013 | none | **Deferred to V1.1:** P3, history label only |
| ISSUE-020 Daily-review edits during save | DATA-009 | none | **Deferred to V1.1:** Partially Confirmed; check V-020 first |
| ISSUE-021 Path validator | TR-007 | TASK-009 (optional network-path question) | **Deferred to V1.1:** defence in depth |
| ISSUE-022 Release pipeline / version | WIN-006, WIN-004, WIN-008, TEST-010; TEST-001 (dup) | TASK-005, TASK-027 | V1 process fix. TEST-010 `check:engine-runtimes` is **deferred to V1.1** (named in TASK-027). |
| ISSUE-023 Install docs / offline wording | WIN-003, WIN-005, TR-014 | TASK-006, TASK-026, TASK-025 (summary) | V1 docs |
| ISSUE-024 Windows FS hardening | TEST-005, DATA-017, WIN-010 | none | **Deferred to V1.1:** test gap; WIN-010 is Unverified |
| ISSUE-025 Test fidelity | UI-006, UI-007, UI-019, TR-011 | none | **Deferred to V1.1.** The delete-journey slice is the first candidate. |
| ISSUE-026 Minor frontend correctness | UI-013, UI-014, UI-015, UI-018 | none | **Deferred to V1.1:** P3 |
| ISSUE-027 Minor state/UX | UI-012, UI-016, UI-017 | none | **Deferred to V1.1:** P3 |
| ISSUE-028 Archive/parse hardening | TR-015, TR-016 | none | **Deferred to V1.1:** P3, needs crafted input |
| ISSUE-029 Data hardening | DATA-015, -016, -018, -019 | none | **Deferred to V1.1:** latent. DATA-019 is Unverified. |
| ISSUE-030 Tauri/release hardening | TR-012, TR-013, TR-017 | TASK-029 (observation only) | **Deferred to V1.1:** P3. TR-013 is Unverified and needs the capability schema. |
| ISSUE-031 Windows platform behaviour | WIN-009, WIN-011, WIN-012 | TASK-030, TASK-033 (observed through gates) | **Deferred to V1.1** for any fix. WIN-009 is Unverified. |
| ISSUE-032 CI/test hygiene | TEST-004, TEST-009, TEST-011 | TASK-029 (advisory result) | **Deferred to V1.1:** handled procedurally in the gate |
| ISSUE-033 Collector render path | TR-019 | none | **Deferred to V1.5:** separate tool; Unverified |
| ISSUE-034 Fees stored as zero | TSD-008 | TASK-009 (D-FEES) | Decision. **Deferred to V1.1:** any migration. |
| ISSUE-035 Duplicate collapse | DATA-020 | TASK-009 | Decision only (by design) |
| ISSUE-036 Test CSV provenance | TR-020 | TASK-002 | Decision. TR-020 is Unverified, pending the owner's answer. |
| ISSUE-037 No ledger-entry UI | UI-020 | TASK-009 (D-LEDGER) | Decision. **Deferred to V1.1:** implementation. |
| ISSUE-038 Real-journal upgrade test safety | TEST-006 | TASK-008, TASK-034 | Only if gate ISSUE-052 is kept; otherwise **deferred to V1.1** |

### C.2 Gates (ISSUE-039 to ISSUE-054)

| Gate | Task(s) |
|---|---|
| ISSUE-039 Owner-only v1.1 notices (TEST-003) | TASK-025; packaged check in TASK-030 |
| ISSUE-040 Candidate from final SHA (WIN-007, TEST-001) | TASK-029 |
| ISSUE-041 Clean smoke (TEST-002) | TASK-028 (instrument), TASK-030 |
| ISSUE-042 Upgrade / reinstall / downgrade / uninstall | TASK-031 |
| ISSUE-043 Offline acceptance | TASK-030 |
| ISSUE-044 Manual recovery (TEST-007 canonical) | TASK-032 |
| ISSUE-045 Manual accessibility | TASK-033 |
| ISSUE-046 Window and DPI matrix | TASK-033 |
| ISSUE-047 P0-05 cohort | TASK-007 |
| ISSUE-048 P0-09 evidence | TASK-007 |
| ISSUE-049 NA-7 notes | TASK-028 (draft), TASK-035 (final) |
| ISSUE-050 Advisory dependency audit (TEST-004) | TASK-029 |
| ISSUE-051 CI on candidate SHA | TASK-029 |
| ISSUE-052 Real-journal-copy upgrade (TEST-006) | TASK-008, TASK-034 |
| ISSUE-053 `cargo fmt` | TASK-008 (a fmt task is created only if the gate is kept) |
| ISSUE-054 Human go/no-go | TASK-036 |

### C.3 Decisions (ISSUE-055 to ISSUE-058 and the decision IDs)

| Decision | Task |
|---|---|
| ISSUE-055 P0-10 studies | TASK-007 |
| ISSUE-056 D5 wrappers | TASK-007 |
| ISSUE-057 0BSD (TEST-008) | TASK-001 |
| ISSUE-058 Unsigned / manual updates / currentUser / bootstrapper | **Decided 2026-10-21** for signing, updater and currentUser. The offline-installer part is TASK-006. |
| D-VER | TASK-005 |
| D-OFF | TASK-006 |
| D-ARCH, D-FEES, D-LEDGER, D-RET, ISSUE-035, ISSUE-021 network paths | TASK-009 |
| Engine authority (ISSUE-012) | TASK-003 |
| CSV provenance (ISSUE-036) | TASK-002 |
| ISSUE-052 / ISSUE-053 keep or waive | TASK-008 |

All 58 canonical issues and all 84 original IDs are mapped above. Every original ID appears under its canonical owner.

## D. Excluded, deferred, resolved and unverifiable findings

**Resolved / Not Applicable.** None. Of the 84 original IDs, 0 are Already Resolved and 0 are Not Applicable.

**Duplicates.** These are scheduled only through their canonical owner:
- TR-005 → DATA-007 (ISSUE-010)
- TEST-001 → WIN-007 (ISSUE-040)

**Unverified (7).** Each has the following handling:

| Finding | Issue | Handling |
|---|---|---|
| DATA-019 | ISSUE-029 | Deferred to V1.1. Verify V-029 (newer-WAL fixture) first. |
| TR-004 | ISSUE-015 | Deferred to V1.1. Verify V-015 (does the invoke hang on a panic?). |
| TR-013 | ISSUE-030 | Deferred to V1.1. Generate the capability schema (V-030); observe in TASK-029. |
| TR-019 | ISSUE-033 | V1.5 / collector. Needs the V-033 fixture. |
| TR-020 | ISSUE-036 | Owner answer in TASK-002 |
| WIN-009 | ISSUE-031 | Observed in TASK-030 and TASK-033 |
| WIN-010 | ISSUE-024 | Deferred to V1.1. Verify V-024 (AV sharing violations); optional check in TASK-032. |

**Deferred to V1.1.** The full list is in §C.1. In short:
- **Issues:** ISSUE-008 (unless TASK-019 is pulled in), 010, 011 (rest), 013, 014, 015, 016, 017, 018, 019, 020, 021, 024, 025, 026–032, the 034 migration, 037 implementation, and 038 if gate 052 is waived.
- **Parts:** 002c redesign, 004 export side, the 006 user-path part, 012 Rust verdict fixtures, and TEST-010.

**Deferred to V1.5:** ISSUE-033.

**Deferred to V2:** external-user agreements, counsel sign-off, and Web V2.

**Excluded (not proposed):**
- signing and auto-update changes (ISSUE-058 is decided);
- cosmetic redesigns and new features;
- data-router or whole-package rewrites;
- new test infrastructure;
- edits to shipped migrations, `test_csvimport/Performance.csv` or `db/fixtures`.

**Verification-only items not given their own card.** They are listed in 07 §G.1 and attached to the V1.1 issue they size:
- V-013, V-014, V-015, V-020, V-024, V-027, V-029, V-030, V-033, V-B2-2.
- V-023 and V-031 are covered by TASK-030, TASK-031 and TASK-033.

