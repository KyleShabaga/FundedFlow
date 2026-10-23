# FundedFlow: Stage 2 Block 3 remediation task index

| Field | Value |
|---|---|
| Date | 2026-10-22 |
| Repository HEAD at spec time | `63e0e27` (r2 cards, before the re-check fixes). Application source is identical to `92e7980`, and `a7310fd` is the Block 2 plan. |
| Inputs | `remediation-findings-ledger.md`, `06-stage2-evidence-reconciliation.md`, `07-stage2-priorities-and-dependencies.md`, Stage 1 reports `00`–`05`, and source read at the revision above |
| Specification revision | r2 (2026-10-22), which is r1 plus the independent-review corrections. **r3** (2026-10-22) for TASK-007, 008, 011, 013, 015–018, 021, 023, 027–034 (Block 4 corrections) and TASK-012, 022, 024, 026, 035 (§8.3 nits only): r2 plus the Block 4 corrections (10 §8), independently reviewed; see §H "r3". The other 18 cards stay at r2. |
| Review | Two independent read-only reviewers. The first reviewed r1 (16 READY, 20 CHANGES); every correction was applied. The second re-checked the 20 corrected cards (11 READY, 9 CHANGES); every correction was applied in the final r2. See §H. |
| Status | 44 tasks. Approvals are recorded on the Notion approval board (the approval record; card files are frozen by hash, so their "Approval evidence" rows stay blank by design). As of 2026-10-22 after the approved-task audit: 12 Approved (001, 002, 003, 005, 006, 008, 010, 011, 012, 013, 019, 020), 13 moved back to Pending Review for re-approval at a new revision, 023 Deferred, the rest Pending Review. |
| Scope of Block 3 | Task and index Markdown only. No source, configuration, migration, fixture, test or dependency was changed, no fix was implemented, and Block 4 was not started. |

**Status vocabulary.**
- **Proposed:** drafted, not yet reviewed.
- **Ready for Approval:** passed independent review, or its required corrections were applied and re-checked.
- **Not Needed:** closed with recorded evidence that the change is unnecessary (used by TASK-023 if TASK-011(a) shows a native prompt; r3).
- **Approved:** Kyle approved this task ID and spec revision. No task is Approved.
- **Blocked**, **In Progress**, **Verified**: execution states.

## A. Full task index

| Task ID | Title | Source card / linked finding IDs or N/A | Audit priority / roadmap lane | Type / mandatory gate | Dependencies | Effort | Risk | Verification platform | Specification revision | Approval/status |
|---|---|---|---|---|---|---|---|---|---|---|
| [TASK-001](remediation-tasks/TASK-001-owner-decision-0bsd.md) | Owner decision: 0BSD licence allow-list | ISSUE-057; N/A (existing gate/decision); TEST-008 (linked) | P1 (decision) / Final Push V1 (open disposition) | Owner Decision / Yes — blocks candidate notices | None. | S | Low | N/A | r2 (2026-10-22; r1 + independent-review corrections) | **Approved at r2** by Kyle (recorded on the Notion board, 2026-10-22) |
| [TASK-002](remediation-tasks/TASK-002-owner-decision-test-csv-provenance.md) | Owner decision: provenance of test_csvimport CSV files | ISSUE-036; TR-020 | P1 (decision) / Unassigned (owner) | Owner Decision / Yes — before any tag/candidate | None. | S | Low | N/A | r2 (2026-10-22; r1 + independent-review corrections) | **Approved at r2** by Kyle (recorded on the Notion board, 2026-10-22) |
| [TASK-003](remediation-tasks/TASK-003-owner-decision-engine-authority.md) | Owner decision: authority for stored risk verdicts (TS engine vs Rust) | ISSUE-012; UI-002 | P1 (decision) / P0-02 / Build 16 (merged) — governance | Owner Decision / No | None. | S | Low | N/A | r2 (2026-10-22; r1 + independent-review corrections) | **Approved at r2** by Kyle (recorded on the Notion board, 2026-10-22) |
| [TASK-004](remediation-tasks/TASK-004-doc-engine-authority-rule.md) | Document the engine-authority decision in CLAUDE.md, packages.md, data-model.md and the design README | ISSUE-012; UI-002 | P1 / P0-02 / Build 16 (governance) | Documentation / No | TASK-003. | S | Low | Any OS | r4 (2026-10-22; r3 + board review fixes; independent re-check pending) | **Pending re-approval at r4** (was Approved at r2; moved back to Pending Review at Kyle's direction) |
| [TASK-005](remediation-tasks/TASK-005-owner-decision-version-scheme.md) | Owner decision: candidate version scheme | ISSUE-022; WIN-004 (linked) | P1 (decision) / NA-2 / P0-06 (release) | Owner Decision / Yes — before candidate | None. | S | Low | N/A | r2 (2026-10-22; r1 + independent-review corrections) | **Approved at r2** by Kyle (recorded on the Notion board, 2026-10-22) |
| [TASK-006](remediation-tasks/TASK-006-owner-decision-offline-installer.md) | Owner decision: WebView2 install mode (bootstrapper vs offline installer) | ISSUE-023 (D-OFF); ISSUE-058 (decided parts); WIN-005 (linked) | P1 (decision) / NA-7 / NA-2 | Owner Decision / Yes — affects offline gate and NA-7 text | None. | S | Low | N/A | r2 (2026-10-22; r1 + independent-review corrections) | **Approved at r2** by Kyle (recorded on the Notion board, 2026-10-22) |
| [TASK-007](remediation-tasks/TASK-007-owner-decision-final-push-dispositions.md) | Owner decisions: P0-05 cohort, P0-09 evidence, P0-10 studies, D5 wrappers | ISSUE-047, ISSUE-048, ISSUE-055, ISSUE-056; N/A (existing gate/decision); TEST-008 (linked) | Gate / decision / Final Push V1 | Owner Decision / Yes — go/no-go inputs | None. | S | Low | N/A | r4 (2026-10-22; approved-task audit fixes; independently reviewed) | **Pending re-approval at r4** (was Approved at r3; moved back to Pending Review at Kyle's direction) |
| [TASK-008](remediation-tasks/TASK-008-owner-decision-build-10-5-gates.md) | Owner decisions: real-journal-copy upgrade gate and cargo fmt gate | ISSUE-052, ISSUE-053 (+ ISSUE-038); TEST-006 (linked) | Gate / decision / Build 10.5 gates (historical, V1) | Owner Decision / Yes | None. | S | Low | N/A | r3 (2026-10-22; r2 + Block 4 corrections, 10 §8.2/§8.3; independently reviewed) | **Approved at r3** by Kyle (recorded on the Notion board, 2026-10-22) |
| [TASK-009](remediation-tasks/TASK-009-owner-decision-policy-confirmations.md) | Owner decisions: fees, duplicate collapse, ledger UI, recovery-copy retention, archive format | ISSUE-034, ISSUE-035, ISSUE-037, ISSUE-018 (D-RET), ISSUE-004/002 (D-ARCH), ISSUE-021 (optional input); TSD-008, DATA-020, UI-020, DATA-012 (linked) | P2 (decisions; V1.1 inputs) / Unassigned (owner) | Owner Decision / No | None. | S | Low | N/A | r4 (2026-10-22; r3 + board review fixes; independent re-check pending) | **Pending re-approval at r4** (was Approved at r2; moved back to Pending Review at Kyle's direction) |
| [TASK-010](remediation-tasks/TASK-010-verify-journal-growth.md) | Verification: measure journal growth per risk calculation (ISSUE-002 escalation check) | ISSUE-002; DATA-004 | P1 / Unassigned (owner) | Verification / No | Approval of this task (it runs cargo with disposable data). | M | Low | Any OS | r2 (2026-10-22; r1 + independent-review corrections) | **Approved at r2** by Kyle (recorded on the Notion board, 2026-10-22) |
| [TASK-011](remediation-tasks/TASK-011-verify-windows-baseline.md) | Verification: Windows baseline measurements on a throwaway build (close, junction, write timing) | ISSUE-009, ISSUE-006, ISSUE-010; DATA-008, UI-005, WIN-001, WIN-002, DATA-006, DATA-007 | P1 / Unassigned (owner) | Verification / No (results do not count toward gates) | Approval; a Windows VM. Synthetic CSV must not contain real trades. | M | Low | Windows only | r3 (2026-10-22; r2 + Block 4 corrections, 10 §8.2/§8.3; independently reviewed) | **Approved at r3** by Kyle (recorded on the Notion board, 2026-10-22) |
| [TASK-012](remediation-tasks/TASK-012-archive-schema-exact-allowlist.md) | Fix: archive schema validation uses an exact allow-list for sqlite internal objects | ISSUE-005; TR-001 | P1 / Unassigned (owner) | Fix / No | None (first in W1). | S–M | Medium (all restore paths) | Any OS | r3 (2026-10-22; r2 + Block 4 nits, 10 §8.3; independently reviewed) | No approval; Ready for Approval (r3) |
| [TASK-013](remediation-tasks/TASK-013-live-cap-used-pages.md) | Fix: live-journal size checks count used pages and name the component over the limit | ISSUE-002 (part a); DATA-004 | P1 (P0 if TASK-010 escalates) / Unassigned (owner) | Fix / No | TASK-012 (same file, merge order); TASK-010 result (priority). | M | High (export/restore/erase) | Any OS | r4 (2026-10-22; currency update for approved decisions; independently reviewed) | No approval; Ready for Approval (r4) |
| [TASK-014](remediation-tasks/TASK-014-stream-hash-preview-tokens.md) | Fix: restore/deletion preview tokens hash the live journal without a capped full dump | ISSUE-002 (part b); DATA-004 | P1 / Unassigned (owner) | Fix / No | TASK-013. | M | High (destructive flows' safety token) | Any OS | r5 (2026-10-22; r4 + board review fixes; independent re-check pending) | **Pending re-approval at r5** (was Approved at r3; moved back to Pending Review at Kyle's direction) |
| [TASK-015](remediation-tasks/TASK-015-cleanup-marker-atomic-nonfatal.md) | Fix: deletion cleanup markers are atomic and cannot block journal startup | ISSUE-001; DATA-001 | P1 / Unassigned (owner) | Fix / No | TASK-014 (shared deletion.rs merge order). | M | High (startup, erase) | Any OS (+ Windows in TASK-032) | r5 (2026-10-22; r4 + board review fixes; independent re-check pending) | **Pending re-approval at r5** (was Approved at r3; moved back to Pending Review at Kyle's direction) |
| [TASK-016](remediation-tasks/TASK-016-stray-attachments-preserved.md) | Fix: stray files under attachments/ no longer block restore and erase | ISSUE-003; DATA-002 | P1 / Unassigned (owner) | Fix / No | TASK-015. | M | High | Any OS | r5 (2026-10-22; r4 + board review fixes; independent re-check pending) | **Pending re-approval at r5** (was Approved at r3; moved back to Pending Review at Kyle's direction) |
| [TASK-017](remediation-tasks/TASK-017-missing-attachments-erase-restore.md) | Fix: missing/changed attachment files no longer block erase and restore | ISSUE-004 (erase/restore part); DATA-003 | P1 / Unassigned (owner) | Fix / No | TASK-016. | M | High | Any OS | r6 (2026-10-22; r5 + board review fixes; independent re-check pending) | **Pending re-approval at r6** (was Approved at r4; moved back to Pending Review at Kyle's direction) |
| [TASK-018](remediation-tasks/TASK-018-startup-reparse-scope.md) | Fix: startup tolerates reparse points above the app data folder (Windows) | ISSUE-006 (startup part); WIN-001 (WIN-002 user-path part deferred to V1.1 with TR-007) | P1 / Unassigned (owner) | Fix / No | TASK-017 (merge order on data_controls); TASK-011 (b) results to confirm cases. No new dependency is approved (owner); if std is insufficient, stop and report (board review re-check 2026-10-22). | M–L | High (startup) | Windows only (+ Any OS for regression) | r5 (2026-10-22; r4 + board review fixes; independent re-check pending) | **Pending re-approval at r5** (was Approved at r3; moved back to Pending Review at Kyle's direction) |
| [TASK-019](remediation-tasks/TASK-019-checked-decimal-subtraction.md) | Fix (optional pull-in): checked Decimal subtraction in P&L and planned risk | ISSUE-008; TR-002, TR-003 | P2 (recommended pull-in to W1) / Unassigned (owner) | Fix / No | None (independent; recommended alongside W1). | S | Low | Any OS | r2 (2026-10-22; r1 + independent-review corrections) | No approval; Ready for Approval |
| [TASK-020](remediation-tasks/TASK-020-rust-reset-effective-from-trading-day.md) | Fix: Rust enforces trading-day effective_from for resets and assignments | ISSUE-007 (persistence part); UI-010 | P1 / Unassigned (owner) | Fix / No | None. | S | Low–Medium | Any OS | r2 (2026-10-22; r1 + independent-review corrections) | No approval; Ready for Approval |
| [TASK-021](remediation-tasks/TASK-021-ui-trading-day-from-rust.md) | Fix: UI uses the Rust trading day for 'in use' rulebook, badges and reset default | ISSUE-007; UI-001, UI-009, UI-010 (UI part) | P1 / Unassigned (owner) | Fix / No | TASK-020. | M | Medium | Any OS | r5 (2026-10-22; r4 + board review fixes; independent re-check pending) | **Pending re-approval at r5** (was Approved at r3; moved back to Pending Review at Kyle's direction) |
| [TASK-022](remediation-tasks/TASK-022-leave-guard-history-navigation.md) | Fix: unsaved-changes guard covers history navigation and programmatic navigate() | ISSUE-009 (history part); UI-005, DATA-008 (navigation part) | P1 / Unassigned (owner) | Fix / No | None. | M | Medium | Any OS | r5 (2026-10-22; r4 + board review fixes; independent re-check pending) | **Pending re-approval at r5** (was Approved at r3; moved back to Pending Review at Kyle's direction) |
| [TASK-023](remediation-tasks/TASK-023-native-close-veto.md) | Fix: native window close asks before discarding unsaved edits | ISSUE-009 (close part); DATA-008 | P1 / Unassigned (owner) | Fix / No | TASK-011 (a); TASK-022. | M | Medium–High (window lifecycle) | Windows only (+ Any OS for component tests) | r3 (2026-10-22; r2 + Block 4 corrections, 10 §8.2/§8.3; independently reviewed) | **Deferred** by Kyle (2026-10-22) until TASK-011(a) results; then Not Needed with evidence, or a native guard after TASK-022 |
| [TASK-024](remediation-tasks/TASK-024-uncertain-outcome-wording.md) | Fix: uncertain write outcomes are not reported as definite failures | ISSUE-011 (wording part); UI-004, UI-003 (toast wording only) | P1 (wording only) / Unassigned (owner); P0-03 rule (merged) | Fix / No | No functional prerequisite; merge order only — rebase onto whichever of 021/022 has merged (different regions of LifecycleDialogs.tsx / AccountSwitcher.tsx) (board review re-check 2026-10-22). | S | Low | Any OS | r5 (2026-10-22; r4 + board review fixes; independent re-check pending) | **Pending re-approval at r5** (was Approved at r3; moved back to Pending Review at Kyle's direction) |
| [TASK-025](remediation-tasks/TASK-025-owner-only-legal-notices.md) | Gate work: integrate owner-only v1.1 legal notices (statement 1.0.1-owner-only; privacy 1.0.0-owner-only) | ISSUE-039; TEST-003; TR-014 (linked; canonical ISSUE-023) | Gate work (mandatory) / P0-13 / NA-3 (V1, open) | Fix / Yes — ISSUE-039 | TASK-001 (0BSD), TASK-006 (wording basis); v1.1 text and the `user-agreement` id already decided (package page and approval card). Not TASK-026: the summaries come from the package (r4/r5; Board review sync 2026-10-22). | S–M | Low | Any OS (+ packaged check in TASK-030) | r5 (2026-10-22; r4 + board review fixes; independent re-check pending) | **Pending re-approval at r5** (was Approved at r3; moved back to Pending Review at Kyle's direction) |
| [TASK-026](remediation-tasks/TASK-026-install-uninstall-webview2-docs.md) | Documentation: uninstall scope, WebView2/offline wording and workflow facts | ISSUE-023; WIN-003, WIN-005, TR-014 | P1 / NA-7 / P0-13 (V1) | Documentation / Supports ISSUE-049 | TASK-006; TASK-027 merged (Board review sync 2026-10-22). | S | Low | Any OS | r4 (2026-10-22; approved-task audit fixes; independently reviewed) | **Pending re-approval at r4** (was Approved at r3; moved back to Pending Review at Kyle's direction) |
| [TASK-027](remediation-tasks/TASK-027-release-workflow-gating-version.md) | Fix (process): installer packaging gated on in-job checks of the exact source SHA; unique version per candidate | ISSUE-022; WIN-006, WIN-004, WIN-008, TEST-010; TEST-001 (dup → ISSUE-040) | P1 / NA-2 / P0-06 (release) | Fix / Supports ISSUE-040/042 | TASK-005; TASK-006 (r3). Merges after TASK-017 and before TASK-029. | S–M | Low | Any OS (CI) | r6 (2026-10-22; r5 + board review fixes; independent re-check pending) | No approval; Ready for Approval (r6) |
| [TASK-028](remediation-tasks/TASK-028-smoke-checklist-na7-draft.md) | Documentation: correct the smoke checklist (first-run gate etc.) and refresh NA-7 draft notes | ISSUE-041, ISSUE-049; TEST-002 | Gate work / NA-2 / NA-5 / NA-7 | Documentation / Yes — instrument for ISSUE-041/043; ISSUE-049 draft | TASK-025, TASK-026, TASK-011 (r3). | S | Low | Any OS | r6 (2026-10-22; r5 + board review fixes; independent re-check pending) | No approval; Ready for Approval (r6) |
| [TASK-029](remediation-tasks/TASK-029-build-and-record-candidate.md) | Gate: build and record the release candidate (CI green, advisory result, EXE SHA-256) | ISSUE-040, ISSUE-050, ISSUE-051; WIN-007, TEST-001, TEST-004 (linked); TR-012/TR-013 observation | Gate / NA-2 / P0-06 | Verification / Yes — ISSUE-040, ISSUE-050, ISSUE-051 (+ ISSUE-030 checks) | All W1–W3 tasks Verified; decisions 001, 002, 005, 006, 008 approved; TASK-037 and 038 Verified, TASK-039 disposition recorded (and its B/C execution task Verified if chosen), TASK-040 Verified, TASK-041 Verified if removal is ruled, TASK-034 code change merged (r4); TASK-042, TASK-043 and TASK-044 Verified; TASK-023 Verified, Not Needed with TASK-011(a) evidence, or still Deferred with the window-close gap accepted by Kyle in TASK-036 (r6; owner acknowledgement required at r7) (Board review sync 2026-10-22). | S | Low | GitHub Actions + Windows (hash check) | r7 (2026-10-22; r6 + board review fixes; independent re-check pending) | No approval; Ready for Approval (r7) |
| [TASK-030](remediation-tasks/TASK-030-gate-clean-smoke-offline.md) | Gate: clean Windows smoke and offline acceptance on the candidate | ISSUE-041, ISSUE-043; TEST-002 (instrument) | Gate / NA-2 / NA-5 | Verification / Yes — ISSUE-041, ISSUE-043 | TASK-029, TASK-028. | M | Low | Windows only | r4 (2026-10-22; approved-task audit fixes; independently reviewed) | No approval; Ready for Approval (r4) |
| [TASK-031](remediation-tasks/TASK-031-gate-upgrade-reinstall-uninstall.md) | Gate: upgrade, reinstall, downgrade and uninstall (ticked and unticked) on the candidate | ISSUE-042; N/A (existing gate/decision); WIN-003, WIN-004 (linked) | Gate / NA-5 | Verification / Yes — ISSUE-042 | TASK-029; TASK-027 unique versions. | M | Low | Windows only | r6 (2026-10-22; r5 + board review fixes; independent re-check pending) | No approval; Ready for Approval (r6) |
| [TASK-032](remediation-tasks/TASK-032-gate-manual-recovery.md) | Gate: manual recovery acceptance on the candidate (incl. ISSUE-001–004 scenarios) | ISSUE-044; TEST-007 (canonical here) | Gate / Build 26.5–26.7 / Build 10.5 gate 6 | Verification / Yes — ISSUE-044 | TASK-029. | M | Low | Windows only | r3 (2026-10-22; r2 + Block 4 corrections, 10 §8.2/§8.3; independently reviewed) | No approval; Ready for Approval (r3) |
| [TASK-033](remediation-tasks/TASK-033-gate-accessibility-dpi.md) | Gate: manual accessibility and window/DPI matrix on the candidate | ISSUE-045, ISSUE-046; TEST-007 (cross-ref); WIN-009 (linked) | Gate / Build 26 §9 / P0-08 / NA-5 | Verification / Yes — ISSUE-045, ISSUE-046 | TASK-029. | M | Low | Windows only | r3 (2026-10-22; r2 + Block 4 corrections, 10 §8.2/§8.3; independently reviewed) | No approval; Ready for Approval (r3) |
| [TASK-034](remediation-tasks/TASK-034-gate-real-journal-copy-upgrade.md) | Gate: real-journal-copy upgrade with a safe procedure (kept by TASK-008 Option A) | ISSUE-052, ISSUE-038; TEST-006 | Gate (kept, TASK-008 A) / P2 test safety / Build 10.5 gate | Test / Yes if TASK-008 keeps it — ISSUE-052 | TASK-008 (keep). Code change (W3c) before TASK-029; owner run (W5) after TASK-029 (r3). | S | Low | Any OS (test) + Windows (owner run) | r5 (2026-10-22; r4 + board review fixes; independent re-check pending) | No approval; Ready for Approval (r5) |
| [TASK-035](remediation-tasks/TASK-035-evidence-register-na7-final.md) | Documentation/gate: final evidence register and NA-7 release notes | ISSUE-049; N/A (existing gate/decision) | Gate / NA-7 | Documentation / Yes — ISSUE-049 | TASK-029..TASK-034 (TASK-034 unconditional, TASK-008 A) (Board review sync 2026-10-22). | S | Low | Any OS | r4 (2026-10-22; r3 + board review fixes; independent re-check pending) | No approval; Ready for Approval (r4) |
| [TASK-036](remediation-tasks/TASK-036-owner-go-no-go.md) | Owner decision: P0-18 human go/no-go | ISSUE-054; N/A (existing gate/decision) | Gate / P0-18 (V1) | Owner Decision / Yes — ISSUE-054 | TASK-035. | S | Low | N/A | r4 (2026-10-22; approved-task audit fixes; independently reviewed) | No approval; Ready for Approval (r4) |
| [TASK-037](remediation-tasks/TASK-037-synthetic-performance-csv-fixture.md) | Replace the real Performance.csv export with a synthetic fixture and rewrite dependent expectations | ISSUE-036; TR-020 (TASK-002 Option B) | P1 / privacy follow-up | Fix / Yes — TASK-029 prerequisite | TASK-002 (approved); TASK-040 first (recommended); TASK-039 decision before the PR opens (recommended). | M | Medium (many test expectations) | Any OS | r2 (2026-10-22; r1 + board review fixes; independent re-check pending) | No approval; Ready for Approval (r2) |
| [TASK-038](remediation-tasks/TASK-038-remove-unreferenced-real-csv-exports.md) | Remove the two unreferenced real CSV exports and the copied pair in direction_pnl_tests.rs | ISSUE-036; TR-020 (TASK-002 Option B) | P1 / privacy follow-up | Fix / Yes — TASK-029 prerequisite | TASK-002 (approved). | S | Low | Any OS | r1 (2026-10-22; repository spec from the Notion draft; independently reviewed) | No approval; Ready for Approval (r1) |
| [TASK-039](remediation-tasks/TASK-039-assess-real-csv-git-history.md) | Owner decision: real CSV exports in public Git history (A accept / B make private / C rewrite history) | ISSUE-036; TR-020 (TASK-002 Option B) | P1 (decision; urgent) / privacy | Owner Decision / Yes — TASK-029 prerequisite | TASK-002 (approved). Any B/C execution needs its own approved task. | S | High if C (history rewrite) | N/A | r2 (2026-10-22; r1 + board review fixes; independent re-check pending) | No approval; Ready for Approval (r2) |
| [TASK-040](remediation-tasks/TASK-040-adopt-cargo-fmt.md) | Adopt cargo fmt: one formatting-only commit, then a CI `cargo fmt --check` step | ISSUE-053 (TASK-008 Option A) | Gate work / Build 10.5 | Fix / Yes — TASK-029 prerequisite | TASK-008 (approved). Recommended to merge before any W1–W3 Rust branch opens. | S | Low (formatting only) | Any OS (CI) | r3 (2026-10-22; r2 + board review fixes; independent re-check pending) | No approval; Ready for Approval (r3) |
| [TASK-041](remediation-tasks/TASK-041-remove-real-value-copies-from-fixtures.md) | Remove value-only copies of real export rows from tests, fixtures and mockups (owner ruling first) | ISSUE-036; TR-020 (split from TASK-037) | P2 (owner ruling) / privacy | Fix / Conditional — TASK-029 prerequisite only if removal is ruled | TASK-002 (approved); TASK-037; TASK-040; TASK-034 code first; owner ruling A/B; explicit approval to regenerate db/fixtures v3/v4 and command-wire.json. | M | Medium (fixture regeneration) | Any OS | r2 (2026-10-22; r1 + board review fixes; independent re-check pending) | No approval; Ready for Approval (r2) |
| [TASK-042](remediation-tasks/TASK-042-fees-recorded-flag-migration.md) | Fix: persisted fees-recorded flag (migration 0022) so missing fees differ from an entered zero | ISSUE-034; TSD-008 (TASK-009 r3 decision 1) | P1 / V1 (Kyle, 2026-10-22) | Fix / Yes — TASK-029 prerequisite | TASK-043 Verified; TASK-009 r4 approved, including Kyle's explicit confirmation of decision 1; owner rules for legacy rows, imports, net P&L display and 'Fees are complete'. | M–L | High (migration; archive/wire knock-on) | Any OS | r2 (2026-10-22; r1 + board review fixes; independent re-check pending) | No approval; Ready for Approval (r2) |
| [TASK-043](remediation-tasks/TASK-043-rollback-accepts-older-safety-copy.md) | Fix: restore rollback accepts a safety copy at an older schema version (B2-1) | ISSUE-018 (B2-1) | P1 / V1 (prerequisite for TASK-042) | Fix / Yes — TASK-029 prerequisite | After TASK-017 and TASK-018 (W1 tail, serial on `restore.rs`); must be Verified before TASK-042 opens (Board review sync 2026-10-22). | S–M | Medium (rollback path) | Any OS | r1 (2026-10-22; created from the approved-task audit; independently reviewed) | No approval; Ready for Approval (r1) |
| [TASK-044](remediation-tasks/TASK-044-recovery-copy-retention-disclosure.md) | Fix: disclose that recovery copies keep deleted-account data (deletion copy, dialog, privacy notice) | ISSUE-018 (D-RET); TASK-009 r3 decision 4 | P1 / V1 | Fix / Yes — TASK-029 prerequisite | After TASK-025 (privacy-notice version bump and re-prompt); owner wording. | S | Low | Any OS | r2 (2026-10-22; r1 + board review fixes; independent re-check pending) | No approval; Ready for Approval (r2) |

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
| W1 | Data safety (native), merged in this order because they share `data_controls` files | 012 → 013 → 014 → 015 → 016 → 017 → 018 → 043 (W1 tail; Board review sync 2026-10-22); 019 is an optional pull-in that can run in parallel |
| W2 | Correctness (Rust, then UI). W2 and the independent units (019, 020, 022, 026, and the TASK-034 code change in W3c) may run alongside W1 (09 §4; r3). | 020 → 021; 022 → 023 (023 needs the result of 011(a)); 024: no functional prerequisite; merge order only — rebase onto whichever of 021/022 has merged (board review re-check 2026-10-22) |
| W3 | Legal, release and docs | 025 → 044 (044 also after 015–017); 027 (after 005 and 006; merges after 017, before 029) → 026; 028 (after 025, 026 and 011); W3c: the TASK-034 code change, before 029 (gate kept by TASK-008 A); 042 after 043 Verified and 019, the 034 code change, 041 (if ruled), 022 and 024 merged, before 029 (Board review sync 2026-10-22) |
| W4 | Candidate | 029 |
| W5 | Manual Windows gates | 030, 031, 032, 033; the TASK-034 owner run (gate kept by TASK-008 A) |
| W6 | Release notes and go/no-go | 035 → 036 |

**Critical path:**
1. Decisions 001, 002, 005 and 006, together with W1–W3.
2. TASK-029.
3. W5 gates.
4. TASK-035.
5. TASK-036.

**Block 2 constraints carried into the cards:**
- **B2-1:** the rollback validates the safety DB at `latest_version` (`restore.rs:345-349`). This is ISSUE-018, ~~deferred to V1.1~~. **Superseded 2026-10-22:** TASK-042 (Kyle's fee decision) adds a V1 migration, so B2-1 is fixed in V1 by TASK-043, which TASK-042 requires. **Any future migration task must list B2-1 as its prerequisite.**
- **B2-2:** the risk fingerprint is sensitive to DTO shape. TASK-014 and TASK-019 do not change trade or ledger DTOs. Any future fees or request-ID migration must re-check it. **Board review sync 2026-10-22:** TASK-042 adds `feesRecorded` to the Trade DTO, so it is affected; TASK-042 strips the key from `risk_inputs_in` and tests that existing fingerprints are unchanged.
- **B2-3 and B2-4:** rebuild cascades and the `import_batches.status` CHECK. No V1 task rebuilds a table or adds a status.
- **B2-5:** a `windows-sys` helper. TASK-018 uses std `is_symlink`/`symlink_metadata`. No new dependency is approved (owner); if std is insufficient, stop and report (board review re-check 2026-10-22).

## C. Mapping of every canonical issue, gate and decision

### C.1 Defects and hardening (ISSUE-001 to ISSUE-038)

| Canonical issue | Original IDs | Task(s) | Disposition / reason |
|---|---|---|---|
| ISSUE-001 Cleanup marker blocks open | DATA-001 | TASK-015, TASK-032 | V1 fix |
| ISSUE-002 Live size caps | DATA-004 | TASK-010, TASK-013, TASK-014, TASK-032 | V1 fix. **Deferred to V1.1:** 002c frozen-input redesign, needs TASK-003; a new task if TASK-010 escalates. |
| ISSUE-003 Stray attachment blocks | DATA-002 | TASK-016, TASK-032 | V1 fix |
| ISSUE-004 Missing attachment blocks | DATA-003 | TASK-017, TASK-009 (D-ARCH), TASK-032 | V1 fix for erase and restore. **Deferred to V1.1:** export side, pending the archive-format decision. |
| ISSUE-005 Archive schema bypass | TR-001 | TASK-012 | V1 fix (restore path). Live-connection `trusted_schema=OFF`: **Deferred to V1.1** (needs `db/upgrade_tests.rs` on the v3/v4/v8 fixtures). (r3, G1) |
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
| ISSUE-018 Recovery hygiene (+B2-1) | DATA-010, -011, -012, -014 | TASK-009 (D-RET), TASK-043 (B2-1), TASK-044 (retention disclosure) | B2-1 fixed in V1 by TASK-043 (before TASK-042's migration); retention disclosure in V1 by TASK-044; pruning and the rest **deferred to V1.1** (Board review sync 2026-10-22). |
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
| ISSUE-034 Fees stored as zero | TSD-008 | TASK-009 (D-FEES), TASK-042, TASK-043 | V1: persisted fees-recorded flag, migration 0022 (TASK-042, after TASK-043), subject to Kyle's confirmation of TASK-009 r4 decision 1. **Deferred to V1.1:** nullable fee amounts (Board review sync 2026-10-22). |
| ISSUE-035 Duplicate collapse | DATA-020 | TASK-009 | Decision only (by design) |
| ISSUE-036 Test CSV provenance | TR-020 | TASK-002 | Decision. TR-020 is Unverified, pending the owner's answer. |
| ISSUE-037 No ledger-entry UI | UI-020 | TASK-009 (D-LEDGER) | Decision. **Deferred to V1.1:** implementation. |
| ISSUE-038 Real-journal upgrade test safety | TEST-006 | TASK-008, TASK-034 | V1: gate ISSUE-052 kept (TASK-008 Option A, approved 2026-10-22) |

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
- **Issues:** ISSUE-008 (unless TASK-019 is pulled in), 010, 011 (rest), 013, 014, 015, 016, 017, 018 (except B2-1, TASK-043, and the retention disclosure, TASK-044), 019, 020, 021, 024, 025, 026–032, nullable fee amounts for 034 (the fees-recorded migration is V1, TASK-042), 037 implementation, and 038 if gate 052 is waived (Board review sync 2026-10-22).
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
- V-031 is covered by TASK-030, TASK-031 and TASK-033.
- V-023 (install without WebView2, online and offline) moves to TASK-028, which adds it as a mandatory smoke-checklist step with its expected result and evidence fields. TASK-030, 031 and 033 no longer claim it. (r3, G2)

## E. Up to five tasks safe to execute after approval

All five are small and reversible. TASK-024 has no functional prerequisite; it only merges in order with TASK-021 and TASK-022 (board review re-check 2026-10-22). None touches the real journal, a migration, a fixture or a dependency.

1. **TASK-001 to TASK-009 (owner decisions).** No code. They unblock W3 and W4 and cost only Kyle's time.
2. **TASK-012: archive schema allow-list.** Restore-path hardening that is code-only and covered by security tests. The live-connection `trusted_schema` change is excluded and deferred to V1.1 (§C.1 ISSUE-005, r3).
3. **TASK-019: checked Decimal subtraction.** Size S, Low risk, independent of the W1 merge order.
4. **TASK-020: Rust trading-day validation.** Size S. It validates new writes only. Its edits to existing tests are named in the card.
5. **TASK-024: uncertain-outcome wording.** Size S and UI-only. No functional prerequisite; merge order only — rebase onto whichever of 021/022 has merged (different regions of LifecycleDialogs.tsx / AccountSwitcher.tsx).

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
11. TASK-018 dependencies: No new dependency is approved (owner); if std is insufficient, stop and report (board review re-check 2026-10-22).
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
| 018 | All app-owned call sites root-anchored (corrected in r3: 21 of 24 non-test call sites; the user paths are `archive.rs:223, 331, 552`). Contract change named (`runtime.ts` categories and stage map). std `is_symlink` tried first. `check:notices` and `Cargo.lock` diff check. ISSUE-024 reference fixed. CI uses plain `cargo test`. |
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

All 36 cards were **Ready for Approval** at r2 (Block 4 later returned 18 of them for r3; see the r3 record below). The 9 cards changed after the re-check had corrections at the level of wording and line references, with no open blocker. An approving reviewer may spot-check them against this table.

**r3 record (Block 3 rerun, 2026-10-22).** Block 4 (runbook 10 §8) returned 18 cards for correction: 007, 008, 011, 013, 015, 016, 017, 018, 021, 023, 027, 028, 029, 030, 031, 032, 033 and 034. Three drafting agents applied every §8.2 Should-fix item and the §8.3 nits that name these cards, checking each citation against the source (application source unchanged since `92e7980`). Each card lists its corrections under "Changes in r3".

- Index corrections (10 §8.1) were applied in §B, §C.1 (ISSUE-005, G1), §D (V-023, G2), §E and §H. §G had no "22 call sites" text.
- **Reviewer 3** (r3; 007, 008, 028–034, plus the index) returned READY for 7 cards and CHANGES for 2:
  - 029: the prerequisites deadlocked with TASK-034. Now only the TASK-034 code change has to be in the candidate.
  - 031: the pending-cleanup downgrade needed a method, an expected result and a pass-rule effect. Step 4a was added.
  - Its nits were also applied: the 007 citation, the 028 B7(b) pass condition, 032 R0 and R10, the 033 coverage reference and the 034 `docs/data-model.md:572`.
- **Reviewer 4** (r3; 011, 013, 015–018, 021, 023, 027) returned READY for 6 cards and CHANGES for 3:
  - 015: option B's TS contract consumers.
  - 018: `RuntimeProvider.tsx:60` was missing from the consumer list.
  - 021: the AssignDialog test was untestable with a native date input.
  - Its nits were also applied: the 011, 016 and 013 citations, the 017 dialog criterion and the 027 knock-on and conflicts.
- **Re-check** of the blocking fixes: everything was READY except two items, and both were corrected:
  - 031 step 4a: a recovery copy is now created by a restore first, and the lock is released before the downgrade launch, because a cleanup the older build cannot finish stops it with OpenFailed (`runtime.rs:352-356`).
  - 015: the option B criterion was moved into acceptance.
  - The 015/016 declaration now notes that "startup not blocked" holds only once the cleanup can finish.
- **Notable r3 choices for Kyle to confirm:**
  - The 015/016 declaration makes downgrade with a pending cleanup **supported** by keeping the old marker schema (runbook 10 §9).
  - TASK-013 makes VACUUM of the temporary snapshot mandatory.
  - TASK-031 step 4a being Not Run does not block the gate unless Kyle makes it mandatory.
  - TASK-033 requires a written waiver for hardware the tester lacks.
- **Known runbook citation errors** that the cards correct:
  - §8.2 TASK-016 `restore.rs:262-270` is in `replace_database`; the rollback path is `:345-349` → `:273-281` → `:178-202`.
  - §8.2 TASK-015 `deletion.rs:361-364` is actually `:361-365`.

- **Follow-up (r3 nits on Pending Review cards).** At Kyle's request, the §8.3 nits were applied to TASK-012, 022, 024, 026 and 035, which moved them to r3. An independent review returned CHANGES on 012, 024 and 026, and those were applied:
  - 012: the rollback test's construction and citations;
  - 024: the `LibraryView.tsx:287-293` citation;
  - 026: evidence lines 51-71, README lines 68-81, and where the TASK-006 approval is recorded.
  TASK-009 and 010 keep r2, because Kyle approved them at r2.

Cards are Ready for Approval at r2 (13) or r3 (23). Approvals are recorded on the Notion board, not in this index.

**Currency pass (2026-10-22, after Kyle's approvals of TASK-001 to 011).** Pending cards were checked against the approved decisions:
- Updated: 013 (r4), 014 (r3), 017 (r4), 025 (r3), 027 (r4), 028 (r4), 029 (r4), 031 (r4), 034 (r4), 036 (r3).
- Already current: 015, 016, 018, 019, 020, 021, 023, 030, 032, 033.
- New repository specs: TASK-037 to 040 (from the Notion drafts) and TASK-041 (split from TASK-037 after a review found value-only copies of real export rows in tests, fixtures and mockups).
- Two independent reviewers plus a re-check: all READY. A privacy scan of `code-review/` found no real export values.
- Approved cards (001–011) were reviewed read-only; their file hashes match the approved revisions.

## I. Process notes

- **Approved-task audit (2026-10-22).** A separate audit of the 25 approved cards (`code-review/stage2-approved-task-audit-2026-10-22.md` on branch `claude/zen-albattani-bg7wk3`) found must-fix items. At Kyle's direction:
  - The affected approved cards were revised and moved back to Pending Review: 004, 007, 009, 014, 015, 016, 017, 018, 021, 022, 024, 025, 026. Notion-only owner amendments (016, 017, 021) and decisions (007 D5, 009 fees, 024 scope) are folded into the files.
  - The pending cards 028, 029, 030, 031 and 036 were aligned.
  - TASK-042, 043 and 044 were created.
  - Three reviewers and a re-check returned READY.
  - TASK-023 is Deferred; the ISSUE-009 window-close part is covered by deferred TASK-023, and TASK-029 r6 and TASK-036 r4 handle that gap.

- **`cargo fmt --check` (from TASK-040).** Once TASK-040 merges, every card that changes Rust code adds `apps/desktop/src-tauri`: `cargo fmt --check` → exit 0 to its standard checks. TASK-040 is recommended to merge before any W1–W3 Rust branch opens. Report 09's wave tables predate TASK-037 to 041 and are not updated; this index and the cards are current.

- **Notion Triage cards.** CLAUDE.md requires one roadmap card per branch. Each Fix/Test card's first step is to create or link a Triage card, then branch `feat/build-<n>-<slug>`. Notion writes need their own approval in Block 4A; Block 3 made none.
- **Execution log.** The first task executed after approval creates `code-review/11-remediation-execution-log.md`, whatever its number. It contains:
  - a header (date, source SHA);
  - a decisions section: Kyle's words, date, source;
  - a per-task section: commands, directory, exit code, tester, environment, installer EXE SHA-256 where applicable;
  - a gate register.

  Every later task appends to it.
- **Approval.** Kyle approves a task by its ID and spec revision (r2). That approval is recorded in the card's "Approval evidence" row, and the status changes to Approved. Claude may not infer approval.
- **Workflow note.** The repository's stop hook required commits of the report outputs during Stages 1 and 2. Block 3 outputs were committed for that reason only, as documentation.
