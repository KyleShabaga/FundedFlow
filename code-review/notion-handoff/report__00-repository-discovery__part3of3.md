## 12. Owner-only scope, prior-audit snapshot and reconciliation register

### 12.1 Copied scope snapshot (2026-10-22; preserve in later phases)

- **Target:** Kyle's personal-use Windows desktop V1. External-user agreements, counsel sign-off and the identified MPL/NSIS legal reviews are **V2**. Technical privacy and security, the existing third-party notices, data safety and packaged validation remain **V1**. This audit infers no distribution approval.
- **Source of the snapshot:** "Final Push V1" (Notion `4001bd4b6bde8044ab04f75d167950cd`), as copied in the Phase 1 prompt. The owner-only decision in it supersedes older external-user and legal-gate wording. The older "P0 Audit — completed docs and Notion comparison — 2026-10-21" is history: keep its original revision and results, and apply the later owner decisions to it.
- **Claimed state:** P0-01 to P0-04 merged; all 31 P0-D UI cards merged; triage follow-ups moved to "P1 - V1.1". Audit severity and priority do **not** change a roadmap lane.
- **Open baseline from the snapshot:**
  - P0-13/NA-3 integration of the owner-only v1.1 notice package: owner-use statement `1.0.1-owner-only`, privacy notice `1.0.0-owner-only`;
  - a fresh candidate installer with a clean Windows smoke test;
  - manual recovery, accessibility, cohort and offline acceptance;
  - P0-09 evidence;
  - NA-7 notes;
  - the P0-18 human go/no-go.
- **Needs explicit owner disposition if unresolved:** P0-10 studies and walkthroughs, D5 wrappers, 0BSD allow-list acceptance, and the P0-05 cohort. Do not silently waive or implement them.
- **CI and installer provenance (from the snapshot; not re-fetched):**
  - Main `92e7980` Windows CI run `39735646149` succeeded. A green job is not packaged acceptance, and the audit guard can report NOT RUN and still pass.
  - PR installer run `39730672821` at `b94fb1b8f945c0cbfb2fdee07d3cc6a00834a504` produced artifact `fundedflow-0.1.0-b94fb1b-windows-nsis`, which expires 2026-10-25. It predates main.
  - The `7679edc` artifact in `docs/build-26.75-evidence.md` is historical.
  - A ZIP digest is not the EXE SHA-256.
  - A final candidate needs: source SHA, EXE SHA-256, environment, and actual acceptance results.

### 12.2 Reconciliation register

Verification status uses: Confirmed / Partially Confirmed / Unverified / Already Resolved / Not Applicable. "Repo evidence" means what this checkout shows at `92e7980`.

| Prior ID (source, date) | Claimed state | Current repo evidence (HEAD 92e7980) | Verification | Remaining acceptance / decision |
|---|---|---|---|---|
| P0-01 to P0-04 (Final Push V1, 2026-10-22) | Merged | Design docs present: `docs/architecture/p0-01-p0-03.md`, `p0-02-risk-promotion.md`, `p0-04-csv-contracts.md`. P0-02 code: `promote_account_risk`, migration 21, `store/risk_promotion_tests.rs` (1,457 lines). P0-04: `test_csvimport/limits/byte-limit-v1.json`, `csv_import/wire_limit_tests.rs`. | Partially Confirmed (present in source; tests not run in Phase 1) | Phases 2–4 verify behaviour; Phase 5 runs the tests |
| P0-D01 to D31 UI cards (Final Push V1) | All 31 merged | Many cards are referenced in source and specs (e.g. P0-D06 freshness `lib/data/freshness.ts:1`, P0-D24 review controls in HEAD's merge `f7bcf29`, `docs/design/screens/p0-d17/`). A per-card source mapping was not done. | Unverified per card | Phase 4 samples the key workflows; Phase 6 reconciles |
| Triage follow-ups (Final Push V1) | Moved to P1 - V1.1 | Not visible in the repo | Unverified (Notion) | Owner. No new V1 work is inferred. |
| P0-13 / NA-3 owner-only notice v1.1 (statement `1.0.1-owner-only`, privacy `1.0.0-owner-only`) | Open | Source still ships `0.1.0-draft` documents (`apps/desktop/src/legal/privacy-notice.ts:8-11`, `user-agreement.ts:7-10`). `legal.test.ts:11-20` asserts draft state. Repo-wide grep finds **no** `owner-only` text. The first-run gate and the acceptance record (id + version + digest, `legal/index.ts:40-43`; `legal.rs`) exist. | Confirmed open | Integrate the v1.1 text, digests, versions, summary and tests under P0-13/NA-3 (implementation is not authorized by this audit) |
| Fresh candidate installer + clean Windows smoke | Open | `docs/build-26.75-evidence.md:8` "Not Done"; checklist `:121-143` blank; recorded artifact at `7679edc` (124 commits behind HEAD). The release workflow computes EXE SHA-256 (`release-installer.yml`). | Confirmed open (unrun gate) | Build the candidate from the chosen SHA; record the EXE SHA-256, environment and results |
| Manual recovery / accessibility / cohort / offline acceptance | Open | Automated jsdom journeys exist (`src/journeys/{recovery,accessibility,…}.test.tsx`). Docs mark packaged/manual runs pending (`docs/build-10-5-closeout.md:65,67`; `docs/architecture/build-26-accessibility-journeys.md:17`; `build-26.5-26.7-recovery-reliability.md:11,187-194`). | Confirmed open (unrun gates) | Manual Windows runs on the candidate |
| P0-09 evidence | Open | No P0-09-specific evidence document found by filename | Unverified | Owner and Phase 5 to identify the evidence |
| NA-7 release notes | Open | Install, verify and uninstall wording is in `docs/build-26.75-evidence.md` ("Install and verify for the NA-7 release notes") and `README.md` §Windows installer; the doc has drifted from the workflow (R-26) | Partially Confirmed (draft exists) | Reconcile the notes with the current workflow and candidate |
| P0-18 human go/no-go | Open | Not represented in the repo | Not Applicable to source; owner decision | The owner decides; no audit verdict implies it |
| P0-10 studies / walkthroughs | Needs disposition | Not represented in the repo | Unverified | Owner disposition |
| D5 wrappers | Needs disposition | Not identified in the repo by name | Unverified | Owner disposition |
| 0BSD allow-list acceptance | Needs disposition | The notices allow-list is in `scripts/third-party-notices.mjs:27-40` and `src-tauri/about.toml`. Whether 0BSD is accepted was not checked in Phase 1. | Unverified | Owner disposition; Phase 5 inspects the allow-list |
| P0-05 cohort | Needs disposition | Not represented in the repo | Unverified | Owner disposition |
| MPL/NSIS legal reviews | Deferred to V2 | `docs/build-26.75-evidence.md:97-100` notes the open NSIS licence question | Not Applicable for V1 (deferred) | V2 |
| Prior "P0 Audit 2026-10-21" findings | Historical | Not available offline | Unverified | Reconcile per finding in Phases 2–6 when relevant; preserve the original IDs |
| Collector (Build 29 / 29.25; P0-14 consumer deferred to V1.5, owner decision 2026-10-21) | Standalone; consumer deferred | No desktop consumer (grep). Separate CI. DB guard refuses the desktop journal. | Confirmed | Secondary coverage only; its intended network fetching is not a desktop privacy regression |

### 12.3 Separation of categories (as of Phase 1)

| Category | Items |
|---|---|
| Already resolved in code | Cross-process lock; refusal of newer schema; per-migration transactions with backup; preview-token-bound import commit; debug command exclusion from release registration |
| Confirmed defects | **None yet.** Phase 1 does not confirm defects. |
| Unrun gates | Candidate installer and clean Windows smoke; manual recovery, accessibility, cohort and offline acceptance; P0-09 evidence |
| Open implementation work (existing cards) | P0-13/NA-3 v1.1 notice integration and the matching legal test update; NA-7 notes reconciliation |
| Owner decisions | P0-18 go/no-go; P0-10, D5, 0BSD and P0-05 dispositions; signing and auto-update stay owner choices; provenance of R-19 CSVs |
| Deferred | External-user agreements, counsel sign-off, MPL/NSIS reviews (V2); collector desktop consumer (V1.5); Web V2 |

---

*Finding conventions for Phases 2–6:* `DATA-`, `TR-`, `UI-`, `WIN-`, `TEST-` with stable numeric suffixes (e.g. `DATA-001`). Verification: Confirmed / Partially Confirmed / Unverified / Already Resolved / Not Applicable; "Duplicate of X" is a relationship, not a status. Severity: Critical / High / Medium / Low / Informational. Priority: P0 blocker, P1 important Stage 1 correction, P2 justified maintainability/performance, P3 deferred.
