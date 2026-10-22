# FundedFlow Stage 2, Block 1 of 4: audit intake, finding verification and evidence reconciliation

| Field | Value |
|---|---|
| Review date | 2026-10-22 |
| Scope status | **Complete** |
| Repository root | `/home/user/FundedFlow` |
| Branch / HEAD | `claude/practical-turing-wmii06` at `bba845b`. The working tree was clean at intake. |
| Source drift | `git diff --stat 92e7980 HEAD -- . ':!code-review'` is empty. The application source is identical to the handoff snapshot `92e7980`. The tailoring snapshot `8c3dd34` is 116 commits older; the differences are in 00 §0. |
| Report commits | `24e5c9e`/`4fee79e` (P1), `feb00e2` (P2), `aad865f` (P3/P4), `7ca8c7f` (P5), `bba845b` (P6). Each was committed at the session stop hook's request. |
| Host / tools | Linux x86_64 container, bash. Not Windows and not WSL. Node 22.22.0, cargo 1.97.0. No `node_modules`, Cargo registry or collector venv. |
| Instruction files | `CLAUDE.md` only. There is no `.claude/` or `AGENTS.md`. No conflict. |
| Notion | The Stage 2 page (`3ff1bd4b…`) was read in full at the user's request (96,776 characters, fetched 2026-10-22T14:01Z). It matches the supplied Block 1 prompt. Its "Entry gate" requires the six local reports, and these are present. The Final Push V1 board was **not** refreshed (evidence limitation). No Notion writes. |
| Agents | Lead plus two read-only specialists, both of which returned:<br>**L1** rechecked 26 native, packaging and docs claims: 23 Confirmed, 3 Partially Confirmed, 0 refuted.<br>**L2** rechecked 18 frontend and domain claims: 12 Confirmed, 6 Partially Confirmed, 1 sub-claim refuted.<br>The lead ran the provenance lane and reconciled the results against Phase 6's independent verifier (13 claims). |
| Checks executed | None new. Read-only `git`, `grep` and `sed` only. Stage 1 executed checks: Phase 5 §5 (4 script checks, all passed). |
| Outputs | This file and `remediation-findings-ledger.md` |

## 1. Intake

| Report | Present | Scope status | Revision | Usable |
|---|---|---|---|---|
| `00-repository-discovery.md` | Yes | Complete | 4fee79e | Yes |
| `01-data-integrity-audit.md` | Yes | Complete (static); checks Blocked | feb00e2 | Yes |
| `02-tauri-rust-security-audit.md` | Yes | Complete (static); checks Blocked | aad865f | Yes |
| `03-react-typescript-audit.md` | Yes | Complete (static); checks Blocked | aad865f | Yes |
| `04-windows-testing-readiness.md` | Yes | Partial on execution; Complete static | 7ca8c7f | Yes |
| `05-final-codebase-audit.md` | Yes | Source review Complete; executed validation Partial. Verdict **Not Ready** / Insufficient Evidence | bba845b | Yes |
| `coverage-matrix.md` | Yes | Final (Phase 6) | bba845b | Yes |

**Decision: the intake passes.** The audit's required scope is finished. "Partial" refers only to executed validation, which was blocked by the environment (dependencies could not be installed). Per the Stage 2 entry gate, a Not Ready or Insufficient Evidence verdict is valid input.

The critical coverage gaps are carried forward rather than blocking. They are:

- no executed TypeScript or Rust suites at HEAD;
- no Windows runtime evidence;
- the engine's rule algorithms were not reviewed line by line.

## 2. Original finding inventory

Every original Stage 1 finding ID appears in the ledger with a status.

| Prefix | Range | Count | Source report |
|---|---|---|---|
| DATA | 001–020 | 20 | 01 |
| TR | 001–020 | 20 | 02 |
| UI | 001–020 | 20 | 03 |
| WIN | 001–012 | 12 | 04 |
| TEST | 001–011 | 11 | 04 |
| TSD-008 | Lane note, routed as an owner item in 03 §5 and 05 O-01(b); not a formal phase ID | 1 | 03, 05 |
| **Total** | | **84** | |

These sources are **not** treated as findings:

- Phase 1 risks `R-01`…`R-29` are hypotheses, mapped in each phase report.
- Phase 6 consolidation IDs `F-01`…`F-31` and `O-01` are aliases, listed next to each ledger row.
- Lane-internal IDs (`REL-`, `IPC-`, `SEC-`, `TSD-` other than 008) were merged into the phase IDs.

**Duplicate relationships.** These link IDs; they are not a status.

| Duplicate | Canonical |
|---|---|
| TR-005 | DATA-007 (ISSUE-010) |
| TEST-001 | WIN-007 (ISSUE-040), and also WIN-006 (ISSUE-022) |

**Shared root causes, grouped under one canonical issue:**

| Canonical issue | Original IDs |
|---|---|
| ISSUE-006 | WIN-001 and WIN-002 |
| ISSUE-007 | UI-001, UI-009 and UI-010 |
| ISSUE-008 | TR-002 and TR-003 |
| ISSUE-009 | DATA-008 and UI-005 |
| ISSUE-011 | UI-003, UI-004 and UI-011 |
| ISSUE-015 | DATA-005 and TR-004 |
| ISSUE-016 | TR-008, TR-010 and TR-018 |
| ISSUE-018 | DATA-010, DATA-011, DATA-012 and DATA-014 |
| ISSUE-022 | WIN-006, WIN-004, WIN-008 and TEST-010 |
| ISSUE-023 | WIN-003, WIN-005 and TR-014 |
| ISSUE-024 | TEST-005, DATA-017 and WIN-010 |
| ISSUE-025 | UI-006, UI-007, UI-019 and TR-011 |
| ISSUE-026 to ISSUE-032 | Minor groups; see the ledger |

## 3. Recheck method and depth

- **Critical / High:** none exist.
- **Alleged blockers:** all were rechecked. These are the gate and evidence items WIN-007, TEST-001, TEST-002, TEST-003, TEST-006, TEST-007 and TEST-008, plus every P1 code item.
- **Medium findings:** all were rechecked at `bba845b`. The coverage came from three sources:
  - the lead (Phase 6 and earlier lead reads);
  - the Phase 6 independent verifier (claims C1–C13: DATA-001 to DATA-005, TR-001, TR-002, TR-003, WIN-001, UI-001, UI-002, DATA-008/UI-005 and TR-009);
  - the Block 1 lanes L1 (N1–N26) and L2 (F1–F18).
- **Low and Informational:** rechecked proportionately by L1 and L2. These were **not fully re-reviewed in Block 1** and keep their Phase 2–5 status:

  | Finding | Reason / status |
  |---|---|
  | UI-017 | The quick-import effect part was not rechecked |
  | TR-013 | Requires the generated schema |
  | TR-019 | Collector; Unverified |
  | WIN-009, WIN-010 | Windows-only; Unverified |
  | DATA-019 | Unverified |

### Corrections from the Block 1 recheck (no source drift)

| Item | Correction |
|---|---|
| UI-016 / F8 | The "rulebook writes omit Insights invalidation" part is **refuted**: Insights reads no rulebook data. The import/account omissions are proven, but stale data is unproven, because review summaries list only reviewed trades (`src-tauri/src/store/reviews.rs:712`). Status Partially Confirmed. |
| UI-008 / F14 | 9 or more queries per account is proven. Minute-key churn is **bounded**: `checkedAt` changes only on an explicit recheck or when the window becomes visible again, never on a timer. Severity revised Medium → Low; status Partially Confirmed. |
| UI-003 / F18 | **Wider than reported.** `AccountActions.tsx:37` has the same "wasn't changed" toast, and display zone, Today view and session skips also lack an acknowledge path. |
| UI-002 | Documented in `src-tauri/src/store/risk_promotion.rs:1-15` and `docs/handoffs/build-16.md`. It is a governance and parity gap, not hidden. Partially Confirmed. |
| UI-001 | The impact is Unknown (fails closed), not a wrong verdict. Confirmed with corrected impact. |
| TR-001 | Escaping the `_` alone is insufficient (`writable_schema`); an exact allow-list is needed |
| TR-003 | Also reachable through `rederive_account` (`src-tauri/src/store/trades.rs:625-670`) |
| DATA-004 | More reachable: each calculation stores a full copy of the account's trades (`store/evidence.rs:314`), and nothing vacuums. Account deletion is also blocked. |
| DATA-009 / F2 | Whether text is lost depends on render timing; it may only appear as a "Restore them" notice. Partially Confirmed. |
| TR-014 / N26 | The draft versions live in `apps/desktop/src/legal/*.ts`, not `legal.rs` (only its test fixture at `:127`) |
| WIN-003 / N20 | The folder-level uninstall text is accurate (the config and data dirs are the same folder). The **omissions** are the legal record, the `data-controls/` safety copies and the cleanup queue. |
| TEST-006 / N24 | Confirmed: no lock check and the stdout leak. Unproven: the `-shm` side effect. |
| DATA-011 / N3 | The existing test `upgrade_tests.rs:~396` probably leaves the empty retained file, but does not assert it |
| Line drift | `RestoreArchiveDialog.tsx` "Check again" is at `:120` (not `:305`). `audit-guard.mjs` returns at `:120`. `ci.yml` outage flags are at `:108-109, 123-124`. |

## 4. Evidence provenance

Build, P0 and NA labels are not proof of audit severity.

| Evidence | Recorded SHA | Relation to HEAD source (`92e7980`) | What it proves now |
|---|---|---|---|
| `docs/build-26.75-evidence.md` | `7679edc` (installer EXE `041983f5…787f`) | 124 commits behind HEAD (128 counted from HEAD in Phase 5). Lacks LegalGate (`1a0d8af`) and notices (`c9feb38`). | Historical build only. Smoke **not run**. Checklist step 4 is stale; triggers and retention text have drifted. |
| PR installer run 39730672821 | `b94fb1b` | 14 commits and 28 files behind `92e7980` | Not the candidate. No EXE hash in the repo. |
| CI run 39735646149 (handoff) | `92e7980` | Same source | Green per the handoff. Logs not read. Advisory audits may be NOT RUN (`audit-guard.mjs:112-120`). |
| `docs/build-26.9-evidence.md` | none (doc commit `d3d1a1b`) | 170 behind | Linux dev-tools QA. Its legacy test failures predate fix `ee52ec9`. |
| `docs/build-10-5-closeout.md` | `cf3f614` | 240 behind | Historical CI. `cargo fmt` failed. Packaged run, real-journal upgrade and human acceptance were **not executed**. |
| `docs/architecture/build-26.5-26.7-recovery-reliability.md` | `21d2215`, `5255ca8`, `2a65c18`, `1629f2f` | 207–216 behind | Windows 11 local test runs. Packaged and controlled-failure smoke pending. |
| `docs/architecture/build-26-accessibility-journeys.md` | `7709d29` | 229 behind | jsdom and axe only. §9 manual checklist pending. |
| `docs/handoffs/build-16.md` | `9d49d71`, `615f0d7` | ~291–300 behind | Engine-runtime parity was run by hand then. Documents the TS-engine decision. |
| Stage 1 executed checks | `aad865f` (source = `92e7980`) | Same source | `check:boundaries`, `test:dev-scripts` 20/20, `test:ci-scripts` 8/8, `test:notices` 10/10 |
| Collector (`tools/prop-firm-collector`) | — | Separate tool | Static review only. No desktop consumer (deferred to V1.5). Its intended fetching is not a desktop regression. |

## 5. Changes since Stage 1, contradictions, unknowns

**Changes since Stage 1:**
- Application source: none.
- `code-review/`: only report commits.
- No finding is Already Resolved.

**Contradictions resolved:**

| Contradiction | Resolution |
|---|---|
| UI-002 vs CLAUDE.md | Documented design. The rule text is the defect. |
| UI-001 "wrong verdict" | Unknown, not a wrong verdict |
| UI-016 rulebooks→insights | Refuted |
| UI-008 churn | Bounded |
| Installer commit count | 14 commits from `b94fb1b` to `92e7980` (Phase 5 lane said 18) |
| Legal draft location | In the TypeScript legal files (TR-014 / N26) |

**Missing test coverage carried forward:** the per-finding lists in 01 §9, 02 §9, 03 §9 and 04 §8. The Block 1 additions are:
- no assertion of the import-batch count on a stale-token refusal (ISSUE-019);
- no assertion of leftover backup files (ISSUE-018);
- no daily-review "typing while saving" test (ISSUE-020);
- no hung or rejected legal-read journey (ISSUE-027);
- no import double-click-during-recheck test (ISSUE-027).

**Windows-only validation still needed:**
- title-bar close with unsaved text (ISSUE-009);
- a junctioned profile / Sandbox first launch, and an OneDrive export (ISSUE-006);
- ticked uninstall, and installing with no WebView2 offline and online (ISSUE-023);
- DPI matrix (ISSUE-031);
- antivirus sharing violations (ISSUE-024);
- write timing for long operations (ISSUE-010);
- every packaged gate (ISSUE-040 to ISSUE-046).

**Unknowns:**
- CI log content, including the advisory result;
- the TypeScript and Rust suite results at HEAD;
- Notion card text for P0-09, P0-10, D5 and ledger-UI scope;
- the `core:default` expansion;
- Tauri's behaviour when a command panics.

**Concern separation.**

| Concern | Canonical issues |
|---|---|
| Data safety | ISSUE-001–004, 009, 010, 018, 020, 029 |
| Functional correctness | ISSUE-007, 008, 026, 034 |
| Security | ISSUE-005, 021, 028, 030, 033 |
| UX | ISSUE-011, 016, 017, 019, 027 |
| Performance | ISSUE-013, 014 |
| Windows | ISSUE-006, 024, 031 |
| Process / tests | ISSUE-022, 025, 032, 038 |
| Documentation | ISSUE-023, 037 |
| Governance / decisions | ISSUE-012, 034–037 |
| Future features | None |

No new requirements were introduced.

**Final Push reconciliation.** P0-01 to P0-04 and the P0-D cards are **not reopened**: their code is present, and outstanding manual acceptance is tracked as gates (ISSUE-044 to ISSUE-046), not as defects. Triage follow-ups stay in P1 - V1.1, with no lane changed. Audit priority is assigned in Block 2 and is not a roadmap lane.

## 6. Count reconciliation

### 6.1 Finding verification status over original IDs

Each ID is counted once, at its canonical owner.

| Prefix | Confirmed | Partially Confirmed | Unverified | Already Resolved | Not Applicable | Total |
|---|---|---|---|---|---|---|
| DATA | 15 | 4 (006, 007, 008, 009) | 1 (019) | 0 | 0 | 20 |
| TR | 13 | 3 (006, 015, 016) | 4 (004, 013, 019, 020) | 0 | 0 | 20 |
| UI | 15 | 5 (002, 008, 015, 016, 017) | 0 | 0 | 0 | 20 |
| WIN | 6 | 4 (002, 003, 005, 011) | 2 (009, 010) | 0 | 0 | 12 |
| TEST | 10 | 1 (006) | 0 | 0 | 0 | 11 |
| TSD-008 | 1 | 0 | 0 | 0 | 0 | 1 |
| **Total** | **60** | **17** | **7** | **0** | **0** | **84** |

**Confirmed IDs that are not software defects.** Of the 60 Confirmed:

- 6 are **gate or evidence findings**, tracked in the gate register and not in the defect total: WIN-007, TEST-001 (duplicate), TEST-002, TEST-003, TEST-007 and TEST-008.
- 1 is a **by-design policy for an owner decision**: DATA-020.

That leaves **53 Confirmed defect, test-gap or hardening findings**. Of those, 9 are test or validation gaps rather than runtime defects: UI-006, UI-007, UI-019, TR-011, TEST-004, TEST-005, TEST-009, TEST-010 and TEST-011.

**Partially Confirmed (17): proven part and unsupported part.** Each ledger row records both. In summary:

| Finding | Proven | Not proven |
|---|---|---|
| DATA-006 | No idempotency key | Frequency of the trigger |
| DATA-007 | Mutex and deadlines | Write timing |
| DATA-008 | Guard scope | WebView2 close behaviour |
| DATA-009 | No carry-over of edits | Loss depends on render timing |
| TR-006 | Lock held during read | Size of the stall |
| TR-015 | The panic | A realistic input |
| TR-016 | Parse before cap | Memory impact |
| UI-002 | Engine runs in TS | That it is undocumented |
| UI-008 | Fan-out | Churn (bounded) |
| UI-015 | `Number()` refines | Impact (small) |
| UI-016 | Missing keys | Staleness; rulebooks part refuted |
| UI-017 | Most parts | Quick-import effect (not rechecked) |
| WIN-002 | Junction case | OneDrive case |
| WIN-003 | Documentation omissions | NSIS behaviour |
| WIN-005 | Configuration | Failure UI |
| WIN-011 | Data location | Network WAL impact |
| TEST-006 | Lock check and stdout leak | `-shm` creation |

**Other totals:**
- Duplicate mappings: 2 (TR-005 → DATA-007; TEST-001 → WIN-007/WIN-006).
- Canonical issues: ISSUE-001 to ISSUE-038 (defect, test, hardening and decision-linked), ISSUE-039 to ISSUE-054 (gates), ISSUE-055 to ISSUE-058 (standalone decisions).

### 6.2 Gates (reported separately, not in any defect total)

| Gate state | Count | Issues |
|---|---|---|
| Passed | 0 | — |
| Failed | 2 | ISSUE-049 (NA-7 stale), ISSUE-053 (`cargo fmt`, historical) |
| Not Run | 12 | ISSUE-039–046, 050, 051, 052, 054 |
| Blocked | 2 | ISSUE-047 (P0-05 decision), ISSUE-048 (P0-09 unidentified) |
| **Unresolved** | **16 of 16** | |

### 6.3 Owner decisions (separate)

| Decision state | Count | Items |
|---|---|---|
| Decided | 1 | ISSUE-058: unsigned NSIS, currentUser, bootstrapper, no updater (owner, 2026-10-21, `docs/build-26.75-evidence.md:97-100`) |
| Pending | 11 | P0-10, D5, 0BSD, engine authority, fees policy, duplicate-collapse policy, CSV provenance, ledger UI, recovery-copy retention, real-journal upgrade gate, `cargo fmt` gate |

## 7. Handback

**Block 1 is complete.** Block 2 should read the ledger and this report.

**No escalation.** No new serious data-loss or security evidence was found. TR-001 remains the one integrity-relevant security item, and it requires a tampered archive.

**Git state at write time:** these two new files are the only changes.
