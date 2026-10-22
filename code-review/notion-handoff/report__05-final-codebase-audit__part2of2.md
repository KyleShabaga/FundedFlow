## G. Tauri 2 and Rust assessment

- **Configuration and permissions** are minimal and correct. `core:default` could be narrowed (F-27). There is no remote IPC.
- **Command registration** is correct, and the debug/release boundary is sound. The release binary itself is not checked for debug commands (F-27).
- **Reliability.** Lock order is consistent and poisoned locks are recovered. Remaining issues:
  - reachable panic paths (F-08, F-28) and no `catch_unwind` (F-15);
  - blocking work on async workers under one mutex (F-10, F-13).
- **IPC contracts.** Consistent. Minor issues in error classification (F-18) and fixture coverage (F-24).
- **Security.** Small attack surface. TR-001 is the one integrity-relevant gap; path trust is defence in depth (F-16). No secrets, no logging of user data, and no command execution in shipping code.
- **Lifecycle.**
  - Startup is non-blocking with categorized failures.
  - There is no shutdown hook. That is safe for committed data, but there is no native close veto (F-09).
  - A second instance is safely refused (single-instance UX: F-30).

## H. React and TypeScript assessment

- Architecture and state ownership are clean: one runtime state machine, one key factory, one write lifecycle. Unknown values are never shown as zero, and every response is Zod-validated.
- Correctness issues cluster around trading-day re-derivation in TS (F-07) and inconsistent uncertain-outcome presentation (F-11).
- State-loss edges: F-09, F-10.
- Performance: the per-account fan-out (F-14) and screenshot loading (F-13).
- Type safety is good: no `any`, and the casts touching external data are low risk.
- Test fidelity is the largest frontend testing gap (F-24).
- Spec drift is a documentation issue: per the card-wins rule, fix the export-button and import-history specs.

## I. Windows and packaging assessment

- **Packaging.** Per-user NSIS, no elevation, stable identifier, notices bundled, no updater, unsigned (an owner decision). After install the app needs no network.
- **Code risks:**
  - F-06: startup blocked by any reparse point in the data path;
  - F-16: export and restore to OneDrive or junctioned folders;
  - F-23: weaker Windows filesystem checks;
  - F-30: no antivirus retry, DPI fit, roaming profiles.
- **Installer and documentation risks:** F-21 (uninstall scope, fixed version, WebView2 needs network); F-22 (release pipeline).
- **Nothing was validated on Windows.**

## J. Testing assessment

| Aspect | Assessment |
|---|---|
| Strengths | 393 Rust tests (persistence, migrations, failure injection, hostile archives, runtime). About 950 desktop Vitest cases including 98 journey cases and axe on 11 routes. About 190 domain cases with Rust-generated parity. 38 script tests (executed and passing here). |
| Executed in this audit | 4 script checks only (§C) |
| Unverified CI claim | `92e7980` green (handoff) |
| Missing regression tests | One test per finding, listed in 01 §9, 02 §9, 03 §9 and 04 §8. The Stage 1-critical ones: live-journal size caps; stray or missing attachment recovery; malformed cleanup marker; sqlite-named archive objects; overflow prices; junctioned data root; native close veto; delete/undo/restore journey; trading-day boundary; packaged smoke. |
| Validation gaps | No packaged run on any SHA. No Windows path tests. No manual accessibility or recovery run. No real-journal-copy upgrade. |

## K. Architecture and technical debt

These are high-value and pragmatic; no rewrites are recommended.

1. **Trading day only from Rust.** Remove the TS calendar-day logic (F-07).
2. **One `data_controls` hardening module.** Atomic markers, quarantine, stray/missing-file tolerance, streamed live hashing, exact-name schema allow-list, and checks scoped to app-owned paths. This resolves F-01 to F-06, F-16 and F-28 together.
3. **`Runtime::with` wrapper.** `catch_unwind` plus `spawn_blocking`, and hash files outside the lock (F-13, F-15, F-10).
4. **One uncertain-outcome presentation helper and one invalidation set** (F-11, F-26).
5. **Decide and document engine authority, then pin verdict parity** (F-12). Reconsider freezing every trade per calculation (F-02).
6. **Test fakes kept honest by schemas and wire fixtures** (F-24).
7. **Release pipeline gated on CI, with a unique version per candidate** (F-21, F-22).

## L. Stage 1 release readiness

**Verdict: NOT READY.** Mandatory acceptance criteria are demonstrably unmet:

- P0-13/NA-3 is not integrated;
- no release candidate has been built;
- the clean smoke has not been run.

Packaged and Windows behaviour also has **insufficient evidence**.

**No confirmed P0 code defect exists.** The code-level P1 items are strongly recommended before relying on the journal day to day, but none is proven to destroy committed data.

**Audit completeness is separate:** the source audit is complete, and executed validation is partial. This verdict **does not represent the owner's P0-18 go/no-go**.

**Mandatory gate register** (consolidated from 04 §10):

| Gate | Card | Status | Source SHA | EXE SHA-256 | Environment | Evidence | Remaining action |
|---|---|---|---|---|---|---|---|
| Owner-only v1.1 notices | P0-13 / NA-3 | **Not Run** (open) | HEAD ships `0.1.0-draft` | — | — | `legal/privacy-notice.ts:9`, `user-agreement.ts:8`, `legal.test.ts:11-21` | Integrate texts, versions, digests, tests, spec and summary wording (TEST-003, TR-014) |
| Release candidate | NA-2 / P0-06 | **Not Run** | None valid. `7679edc` lacks LegalGate and notices; `b94fb1b` is 14 behind `92e7980`. | `7679edc`: `041983f5…787f` (historical only) | GH windows-latest | `release-installer.yml`; `build-26.75-evidence.md:104-111` | Dispatch on the final SHA after a green CI run. Record run ID, unique version, toolchain, and the EXE hash from `SHA256SUMS.txt` (not the ZIP digest). |
| Clean Windows smoke | NA-2 / NA-5 | **Not Run** | — | — | Clean Win11 VM (not Sandbox until F-06 is resolved), plus Win10 22H2 | Checklist blank; step 4 stale (TEST-002) | Fix the checklist. Add: junction path, OneDrive export, title-bar close with unsaved text, ticked uninstall after an export, second instance, DPI. |
| Upgrade, reinstall, downgrade | NA-5 | **Not Run** | — | — | VM | — | Owner |
| Offline acceptance | NA-2 steps 3–10 | **Not Run** | — | — | VM | — | Owner (installer network caveat, F-21) |
| Manual recovery | Build 26.5–26.7 / 10.5 | **Not Run** | — | — | — | `build-26.5-26.7-recovery-reliability.md:187-194` | Owner. Include F-01 to F-04 scenarios. |
| Manual accessibility (NVDA, contrast, scaling, zoom, reduced motion) | Build 26 §9 / P0-08 | **Not Run** | — | — | — | `build-26-accessibility-journeys.md:227-238` | Owner |
| Window/DPI matrix | P0-08 / NA-5 | **Not Run** | — | — | — | `window-support-matrix.md` | Owner |
| Cohort | P0-05 | **Blocked** (owner disposition) | — | — | — | `p0-04-csv-contracts.md:170` | Owner |
| P0-09 evidence | P0-09 | **Blocked** (unidentified) | — | — | — | 0 repo hits | Owner |
| Studies / walkthroughs | P0-10 | **Blocked** (disposition) | — | — | — | — | Owner |
| D5 wrappers | D5 | **Blocked** (ambiguous reference) | — | — | — | — | Owner to clarify |
| 0BSD | — | **Blocked** (disposition). In use by tslib. | HEAD | — | — | `third-party-notices.mjs:38`; `about.toml:27` | Owner |
| NA-7 release notes | NA-7 | **Failed** (stale draft) | — | — | — | `build-26.75-evidence.md:145-166`; `README.md:68-81` | Update (F-21, TEST-002) |
| Advisory audit | — | **Not Run** locally. CI green per the handoff, but NOT RUN can pass. | `92e7980` | — | GH | `audit-guard.mjs:111-115` | Read the candidate's summary or dispatch with `--fail-on-outage` |
| CI suite (typecheck, Vitest, build, cargo test, clippy, notices) | — | **Passed per the handoff**, unverified. **Blocked** locally. | `92e7980` | — | GH windows-latest | CI 39735646149 (not read) | Read logs for the candidate SHA |
| Script tests and domain boundaries | — | **Passed** | `aad865f` = source `92e7980` | — | Linux container | 04 §5 | — |
| Real-journal-copy upgrade | 10.5 gate | **Not Run** (owner approval) | — | — | — | `db/upgrade_tests.rs:427-457` | Copy first and redact output (TEST-006), or the owner waives |
| `cargo fmt` | 10.5 gate 7 | **Failed** historically (`cf3f614`); not in CI | — | — | — | `build-10-5-closeout.md:61` | Owner: drop or schedule |
| Human go/no-go | P0-18 | **Not Run** | — | — | — | — | **Owner only** |

**What would move the verdict:**

- **To Conditionally Ready:** P0-13/NA-3 integrated; a candidate built and its clean smoke passed with recorded SHA, EXE hash and environment; each manual gate either Passed or explicitly waived by the owner with conditions recorded; owner dispositions recorded; and the owner accepts the open P1 code items as bounded.
- **To Ready:** the above, plus no unresolved P1 items the owner considers mandatory.

## M. Prioritized recommendations

| Priority | Recommendation | Related IDs | Components | Benefit | Effort | Regression risk | Dependencies |
|---|---|---|---|---|---|---|---|
| **P0 (gates)** | Integrate owner-only v1.1 notices and tests | TEST-003, TR-014 | `apps/desktop/src/legal`, `features/legal`, first-run journey, spec | Unblocks first run and NA-3 | S | Low (tests pin digests) | Owner text v1.1 |
| P0 (gates) | Produce a candidate and run the clean smoke plus manual gates | WIN-007, TEST-001, TEST-002, TEST-007 | Release workflow, evidence doc | Evidence-based readiness | M (mostly manual) | None | P0-13 done; ideally the P1 fixes first |
| P0 (gates) | Record owner dispositions | TEST-008, O-01, TEST-006, F-12 | Docs and cards | Removes Blocked gates | S | None | Owner |
| P1 | `data_controls` recovery hardening | F-01 to F-05, F-16, F-28 | `src-tauri/src/data_controls/*`, `store/attachments.rs` | No lock-out from journal, export, restore or erase; archive integrity | M | Medium (restore and erase paths). Mitigated by the strong existing tests. | — |
| P1 | Windows path-check scope fix | F-06, F-16, F-23 | `data_controls/filesystem.rs`, `runtime.rs` messages | Startup works on junctioned profiles | S–M | Medium (security check semantics) | Windows test environment |
| P1 | Trading day from Rust in the UI; Mon–Fri enforced natively | F-07 | `features/accounts/setup.ts`, rulebook components, lifecycle dialog; `store/rulebooks.rs` | Correct "in use" label and fewer Unknown verdicts | S–M | Low–Medium | — |
| P1 | Checked decimal arithmetic and price bounds | F-08 | `domain.rs`, `store/reviews.rs`, `store/trades.rs` | Removes persistent panics | S | Low | — |
| P1 | Native close veto, history guard, durable drafts | F-09 | `use-leave-guard.ts`, Tauri window API, capabilities | No lost text | S–M | Low | Windows check |
| P1 | Create idempotency; writes disabled during long operations; commit deadline ≥ preview | F-10 | `store/*` create paths, `submissions.ts`, migration for request ids | No duplicates | M | Medium (schema change) | — |
| P1 | Uninstall/version/WebView2 documentation; unique version per candidate; release gated on CI | F-21, F-22 | Docs, `tauri.conf.json` version, workflow | Safe install and uninstall; traceable artifacts | S | Low | Owner (signing, offline installer choices) |
| P1 (owner) | Decide engine authority; document it; add verdict parity | F-12 | CLAUDE.md, `packages.md`, Rust fixtures | Governance clarity | S (docs) / L (parity) | Low | Owner |
| P2 | Uncertain-outcome UX consistency; panic guard; runtime `created`; IPC error classes | F-11, F-15, F-17, F-18 | Shared hooks, runtime | Clearer recovery | S–M | Low | — |
| P2 | Screenshot IPC and Today fan-out performance | F-13, F-14 | attachments, Screenshots, Today hooks | Responsiveness | M | Low–Medium | — |
| P2 | Test fidelity: fakes, wire fixtures, delete journey, axe gaps, Windows `cfg` tests | F-23, F-24 | `test/`, `wire_contract.rs`, `src-tauri` tests | Regression protection | M | None | — |
| P2 | Recovery hygiene and import history labelling | F-19, F-20 | runtime, db, restore, csv_import | Clarity, disk use | S | Low | — |
| P3 | Minor correctness, state and hardening; collector render path | F-25 to F-31 | Various | Polish | S each | Low | — |

## N. Top five most important actions

1. **Integrate the owner-only v1.1 legal package (P0-13/NA-3) and update its tests.**
   - Why: it is a confirmed open mandatory item, and every candidate built before it is invalid for the first-run gate.
   - Effort: small. It also corrects TR-014's "no internet connection" summary.
2. **Fix the recovery-availability cluster in `data_controls` before relying on the journal: F-01, F-02, F-03, F-04, F-05.**
   - Why: these are the realistic ways the owner gets locked out of the journal or its only backup path. F-02 grows naturally with every risk calculation, and F-05 is the one integrity gap reachable from a tampered backup.
   - They share one module and one test suite, so they can be fixed as a single change set.
3. **Then build one traceable candidate and run the real Windows gates on it.**
   - Needed: a green CI run on the same SHA, a unique version, and the EXE SHA-256 from `SHA256SUMS.txt`.
   - Run, on a clean Win11 VM plus Win10: the corrected smoke, offline use, manual recovery, accessibility and DPI, ticked and unticked uninstall, upgrade and downgrade, a junctioned data path (F-06), and title-bar close with unsaved text (F-09).
   - Why: this is the evidence the Not Ready / Insufficient Evidence verdict is missing. No amount of further code review substitutes for it.
4. **Correct the small high-value code defects: F-06, F-07, F-08, F-09.**
   - F-06: scope the reparse check to app-owned paths.
   - F-07: take the trading day from Rust.
   - F-08: checked decimal subtraction.
   - F-09: native close and history guard.
   - Why: each is small, directly affects daily use or startup, and is confirmed in code.
5. **Record the owner decisions the audit cannot make:**
   - F-12: engine authority, documented and parity-pinned;
   - P0-09, P0-10, D5, 0BSD and P0-05 dispositions;
   - TEST-006: whether a real-journal-copy upgrade is required, and how to run it safely;
   - DATA-020 and TSD-008: duplicate-collapse and blank-fees policies;
   - TR-020: whether the test CSVs are real exports;
   - UI-020: ledger UI scope;
   - WIN-005: offline installer choice.

   Why: several gates are **Blocked** only on these decisions.

## O. Remaining uncertainties

- **Windows runtime behaviour, none of it observed:**
  - WebView2 `beforeunload` on native close;
  - NSIS uninstall and upgrade checkbox behaviour;
  - WebView2 bootstrapper failure when offline;
  - OneDrive reparse reporting;
  - antivirus sharing violations;
  - DPI clamping;
  - Sandbox (WCI) reparse tags;
  - the drive-relative `C:` quirk in F-06.
- **Not executed:** results of the TS and Rust suites at HEAD; the actual content of CI run 39735646149, including whether the advisory audits were NOT RUN; notices currency against the lockfiles.
- **Not measured:** journal growth rates (F-02); 50k-row import commit duration (F-10); screenshot IPC cost (F-13).
- **Card text unavailable:** Notion card text for the D5, P0-09, P0-10 and ledger-UI scope questions, and the Build 16 decision text beyond the repository handoff.
- **Unverified mechanisms:** Tauri's behaviour when an async command panics (F-15); whether `reqwest` is compiled into the Windows build; the `core:default` permission expansion.
- **Not read line by line:** the engine's rule algorithms beyond their boundaries and parity fixtures.

## P. Stage 2 handoff

Stage 2 (remediation planning) must:

1. **Carry forward** the owner-only scope snapshot and reconciliation register (00 §12) and the gate register (§L). Apply the 2026-10-22 owner decision over any older first-user or legal-gate wording, and record any conflict without expanding the work.
2. **Plan gates before code where they block:**
   - P0-13/NA-3 integration;
   - candidate production and recording rules;
   - the corrected smoke checklist;
   - owner dispositions (O-01, F-12, TEST-006).
3. **Sequence the P1 code work** into card-sized units within the repository conventions: one card per unit, `feat/build-<n>-<slug>` branches, no scope widening.
   - (a) `data_controls` recovery and archive hardening: F-01 to F-05, F-16, F-28.
   - (b) Windows path-check scope: F-06, F-23.
   - (c) Trading-day authority in the UI and Mon–Fri enforcement: F-07.
   - (d) Checked arithmetic: F-08.
   - (e) Input-loss guards: F-09.
   - (f) Create idempotency and write scheduling: F-10, which needs a migration.
   - (g) Packaging documentation, versioning and release gating: F-21, F-22.
4. **Define regression tests per unit** from the missing-test lists (§J), including Windows `cfg` tests and the packaged smoke steps.
5. **Decide whether P2 items enter V1.1** (Final Push V1 places triage follow-ups in "P1 - V1.1"). Audit priorities are not roadmap lanes.
6. **Keep** the collector (F-31) and Web V2 out of desktop V1 scope.
