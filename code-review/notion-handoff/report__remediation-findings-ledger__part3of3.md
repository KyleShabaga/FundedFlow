## B. Mandatory acceptance gates and evidence items

These are not new software defects. Gate state is one of Passed / Failed / Not Run / Blocked. Linked findings are cross-referenced, not duplicated.

| Canonical issue ID/title | Original finding IDs or N/A | Source card/ID and date | Roadmap lane | Category/work type | Severity | Gate state | Source requirement | Evidence still needed | Linked issues |
|---|---|---|---|---|---|---|---|---|---|
| ISSUE-039 Owner-only v1.1 notice integration | TEST-003 (C) | P0-13 / NA-3 (Final Push V1, 2026-10-22) | V1 (open) | Mandatory gate: implementation + tests + docs | N/A | **Not Run** | Statement `1.0.1-owner-only`; privacy `1.0.0-owner-only` | Texts, versions, digests; `legal.test.ts:11-20`, `first-run.journey.test.tsx:45, 61-62, 148`; `docs/design/screens/16-first-run.md:7-8`; summary wording | ISSUE-023 (TR-014) |
| ISSUE-040 Release candidate built from the final SHA | WIN-007 (C); TEST-001 (C, dup→WIN-007) | NA-2 / P0-06 (Final Push V1) | V1 | Mandatory gate: evidence | N/A | **Not Run** | Candidate with source SHA, EXE SHA-256 and environment. `7679edc` lacks LegalGate and notices; `b94fb1b` is 14 commits behind `92e7980`. | Dispatch after a green CI run on the same SHA; unique version; `SHA256SUMS.txt` EXE hash (not the ZIP digest) | ISSUE-022 |
| ISSUE-041 Clean Windows smoke (with corrected checklist) | TEST-002 (C) | NA-2 / NA-5 | V1 | Mandatory gate + documentation | N/A | **Not Run** | Checklist in `docs/build-26.75-evidence.md:111-143` | Fix step 4 (first-run screen); add junction path, OneDrive export, title-bar close, ticked uninstall, second instance, DPI | ISSUE-006, ISSUE-009, ISSUE-023, ISSUE-031 |
| ISSUE-042 Upgrade, reinstall, downgrade and uninstall | N/A (existing gate/decision) | NA-5 | V1 | Mandatory gate | N/A | **Not Run** | `docs/build-26.75-evidence.md:17` | VM results | ISSUE-022 (WIN-004), ISSUE-023 (WIN-003) |
| ISSUE-043 Offline acceptance | N/A (existing gate/decision) | NA-2 steps 3–10 | V1 | Mandatory gate | N/A | **Not Run** | Smoke checklist | VM results; installer network caveat | ISSUE-023 |
| ISSUE-044 Manual recovery acceptance | TEST-007 (C, part) | Build 26.5–26.7 / Build 10.5 gate 6 | V1 | Mandatory gate | N/A | **Not Run** | `docs/architecture/build-26.5-26.7-recovery-reliability.md:187-194` | Disposable-profile results, including ISSUE-001 to ISSUE-004 scenarios | ISSUE-001–004 |
| ISSUE-045 Manual accessibility | TEST-007 (C, part) | Build 26 §9 / P0-08 | V1 | Mandatory gate | N/A | **Not Run** | `docs/architecture/build-26-accessibility-journeys.md:227-238` | NVDA with WebView2, contrast, scaling, zoom, reduced motion | ISSUE-025 (axe) |
| ISSUE-046 Window and DPI matrix | TEST-007 (C, part) | P0-08 / NA-5 | V1 | Mandatory gate | N/A | **Not Run** | `docs/design/window-support-matrix.md` | Matrix results | ISSUE-031 (WIN-009) |
| ISSUE-047 Cohort (real exporter versions) | N/A (existing gate/decision) | P0-05 | V1 | Gate / owner disposition | N/A | **Blocked** (decision) | `docs/architecture/p0-04-csv-contracts.md:170` | Owner accept or waive | — |
| ISSUE-048 P0-09 evidence | N/A (existing gate/decision) | P0-09 | V1 | Gate | N/A | **Blocked** (evidence unidentified; 0 repo hits) | Final Push open baseline | Owner identifies the evidence | — |
| ISSUE-049 NA-7 release notes | N/A (existing gate/decision) | NA-7 | V1 | Gate + documentation | N/A | **Failed** (stale draft) | `docs/build-26.75-evidence.md:145-166`; `README.md:68-81` | Reconcile triggers, retention, first run, uninstall scope, WebView2 network | ISSUE-023 |
| ISSUE-050 Advisory dependency audit result | TEST-004 (C, linked) | CI dependency-audit (`ci.yml`) | V1 | Gate (evidence) | N/A | **Not Run** (local); CI green per handoff, but NOT RUN can pass | `scripts/audit-guard.mjs:112-120` | Read the candidate's job summary, or dispatch with `--fail-on-outage` | ISSUE-032 |
| ISSUE-051 CI suite on the candidate SHA | N/A (existing gate/decision) | `ci.yml` | V1 | Gate (evidence) | N/A | **Not Run** for the candidate. Passed per handoff at `92e7980` (unverified). Local script checks Passed at `aad865f`. | — | Candidate CI log | — |
| ISSUE-052 Real-journal-copy upgrade | TEST-006 (PC, linked) | Build 10.5 gate | V1 | Gate (owner approval) | N/A | **Not Run** | `docs/build-10-5-closeout.md:66` | Owner approval or waiver; a safe procedure (ISSUE-038) | ISSUE-038 |
| ISSUE-053 `cargo fmt` gate | N/A (existing gate/decision) | Build 10.5 gate 7 | V1 (historical) | Gate / owner decision | N/A | **Failed** (historical, `cf3f614`; not in CI) | `docs/build-10-5-closeout.md:61` | Owner: drop or schedule | ISSUE-022 |
| ISSUE-054 Human go/no-go | N/A (existing gate/decision) | P0-18 | V1 | Gate (owner only) | N/A | **Not Run** | Final Push V1 | Kyle's decision. Never inferred from the audit. | All |

## C. Owner decisions

| Canonical issue ID/title | Original finding IDs or N/A | Source card/ID and date | Decision state | Decision source | Options / consequence | Linked |
|---|---|---|---|---|---|---|
| ISSUE-055 P0-10 studies / walkthroughs | N/A (existing gate/decision) | P0-10 (Final Push V1) | **Pending** | — | Run, defer or waive | — |
| ISSUE-056 D5 wrappers | N/A (existing gate/decision) | D5 (Final Push V1; ambiguous in repo: `window-support-matrix.md:26`, `prop-firm-collector.md:470`) | **Pending** (clarify which D5) | — | Clarify, then dispose | — |
| ISSUE-057 0BSD allow-list | N/A (existing gate/decision); TEST-008 (C) | Final Push V1; `scripts/third-party-notices.mjs:38`; `about.toml:27`; in use by tslib | **Pending** | — | Accept (status quo) or reject (replace the dependency) | ISSUE-030 |
| ISSUE-058 Unsigned NSIS, manual updates, currentUser, downloadBootstrapper | N/A (existing gate/decision) | Owner decision 2026-10-21 recorded in `docs/build-26.75-evidence.md:97-100` | **Decided** (unsigned, no updater, currentUser, bootstrapper). The offline-installer choice is still open under ISSUE-023. | `docs/build-26.75-evidence.md:97-100` | Keep unless the owner changes it | ISSUE-023 |
| ISSUE-012 (decision part) Engine authority | UI-002 | Build 16 | **Pending** | — | TS authoritative (amend the rule) vs add Rust verdict parity | ISSUE-002 |
| ISSUE-034 (decision part) Fees policy | TSD-008 | CLAUDE.md rule | **Pending** | — | Keep 0 with a coverage statement vs nullable unknown fees | — |
| ISSUE-035 (decision part) Duplicate-collapse policy | DATA-020 | `dedup.rs:11-13` | **Pending** (confirmation) | — | Keep or add a user override | — |
| ISSUE-036 (decision part) CSV provenance | TR-020 | R-19 | **Pending** | — | Synthetic (no action) or real (anonymize or remove) | — |
| ISSUE-037 (decision part) Ledger UI in V1 | UI-020 | — | **Pending** | — | In V1 / V1.1 / remove the settings question | — |
| ISSUE-018 (decision part) Recovery copies keep deleted-account data | DATA-012 | 01 §10 | **Pending** | — | Accept (disclosed) or add pruning | — |
| ISSUE-052 / ISSUE-053 | TEST-006 / N/A | Build 10.5 | **Pending** | — | Keep or waive each gate | — |

## D. Non-finding dispositions (Phase 1 hypotheses)

| Phase 1 risk | Disposition |
|---|---|
| R-04 (restore WAL removal) | **Not an issue** (not a finding); covered by the `installing` rollback |
| R-13 (render-time spec) | **Not a bug** (not a finding) |
| R-15 (legal fail-open on save) | By design and tested |
| Pre-`ee52ec9` `legacy_rulebook_tests` failures | Superseded by the fix; no recorded re-run; CI reported green at `92e7980` |
