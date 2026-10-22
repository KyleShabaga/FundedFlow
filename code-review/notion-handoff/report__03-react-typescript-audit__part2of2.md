## 10. Remaining uncertainties and verification limits

- **Nothing was executed.** `npm test`, `npm run typecheck` and `npm run build` were skipped: there is no `node_modules`, and installing would need the network. Test-count and coverage statements are from reading the test files.
- **jsdom only.** All UI evidence is from jsdom with a mocked repository and invoke. Native WebView2 behaviour is unverified, including window close (DATA-008), focus behaviour, scaling and contrast.
- **Cards not checked.** Notion card text was not available. For ledger entry UI scope (UI-020) and the TS-engine authority decision (UI-002), the cards win and must be checked.
- **UI-016** depends on whether the review-summary DTOs carry trade-derived fields (not traced).
- **Commands executed** (read-only, repo root or `apps/desktop/src`):

  | Command | Result |
  |---|---|
  | `git status --porcelain` | Exit 0; report files only |
  | `sed -n`/`grep -n` on `features/accounts/setup.ts`, `AccountSwitcher.tsx`, `use-leave-guard.ts`, `LifecycleDialogs.tsx`, `CalculationExplanation.tsx`, `lib/data/runtime.ts` | Exit 0 |

## 11. Reconciliation register (Phase 4 delta) and agent coverage

| Prior item | Phase 4 result |
|---|---|
| R-11, R-12 | DATA-006, DATA-007 (unchanged) |
| R-13 | Not a bug (Informational) |
| R-14 | TR-010; legal raw mutation: by design; data-controls lock: DATA-007 |
| R-15 legal fail-open | By design and tested (`first-run.journey`: "record can't be saved"). The new related issue is UI-012 (fails *closed* on a read failure). |
| R-16 TS risk engine | UI-002 (owner decision) |
| R-17 Number checks / zone default | UI-015; `AccountsPage.tsx:126` is labelled and intended; `RulebookPage.tsx:108` is UI-018 |
| R-18 drafts | DATA-008 / DATA-009; stale-draft overwrite is warned (not an issue) |
| R-29 tsconfig / casts | §5 (P3) |
| P0-D UI cards (31 merged, Final Push V1) | Spot-checked five screens: Today, Import, Trade review, Daily review, Data controls. These match the specs, apart from the spec drift in UI-020. P0-D24 review controls is HEAD's merge. Partially Confirmed (sampled). |
| P0-03 uncertain-outcome rule | Generally followed; gaps UI-003, UI-004, UI-011 |
| P0-02 risk promotion | Sound atomicity; governance UI-002 |
| Accessibility / manual gates | Automated axe coverage confirmed; manual checklist **unrun** (gate) |
| P0-13/NA-3 legal | First-run flow tested extensively in jsdom. Draft text unchanged (open). |

**Separation by category:**

| Category | Findings |
|---|---|
| Confirmed defects | UI-001, -003, -004, -005, -009, -010, -011, -012, -013, -014, -015, -018 |
| Test gaps | UI-006, -007, -019 |
| Performance | UI-008 |
| Governance / owner | UI-002, UI-020, TSD-008 (fees) |
| Hypotheses | UI-016; parts of UI-017 |
| Escalation | None (no data-loss or security issue beyond Phases 2 and 3) |

**Lead verification:**

- UI-001: `setup.ts:28-38`
- UI-003: `AccountSwitcher.tsx:36-50`
- UI-004: `LifecycleDialogs.tsx:160-170`
- UI-005: `use-leave-guard.ts:15-50`
- UI-009: `CalculationExplanation.tsx:54`, via grep

UI-002 was checked against the `build-16` statement and the Phase 3 reading of `snapshots.rs`.

**Lane mapping:**

| Lane | Candidates | Became |
|---|---|---|
| L1 | TSD-001 to TSD-011 | UI-001, -002, -009, -010, -013, -014, -015, -018 and §5 |
| L2 | Items 1–12 | UI-003, -004, -005, -008, -011, -012, -016, -017; R-13 dismissed |
| L3 | F1 to F11 | UI-006, -007, -019, -020; F2 merged into UI-004, F3 into DATA-008, F9 into UI-018 |
