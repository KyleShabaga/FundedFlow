# FundedFlow Stage 2, Block 2 of 4: priorities, root causes and dependencies

| Field | Value |
|---|---|
| Review date | 2026-10-22 |
| Scope status | **Complete** |
| Repository root / branch / HEAD | `/home/user/FundedFlow`, `claude/practical-turing-wmii06`, `45de2af` (clean at start) |
| Source drift | None. The application source is identical to `92e7980`. Changes since then are only `code-review/` commits: Stage 1 reports and Block 1 at `45de2af`. |
| Inputs | `06-stage2-evidence-reconciliation.md` and `remediation-findings-ledger.md` (45de2af); `05-final-codebase-audit.md` and `coverage-matrix.md` (bba845b); `01`–`04` as needed |
| Host | Linux container (not Windows or WSL). No dependencies installed, no checks run. |
| Instruction files | `CLAUDE.md`. No conflict. |
| Agents | Lead plus three read-only lanes, all returned: (1) data/native dependencies; (2) domain/frontend dependencies; (3) independent triage reviewer. The lead re-read `restore.rs:345-349` (B2-1 below) and relied on earlier lead reads for the freshness DTO's `currentTradingDay` (`apps/desktop/src/lib/data/freshness.ts`). |
| Output | This file only. Stage 1 reports and the Block 1 ledger are unchanged. Ledger corrections are recorded in §G.4 for the next Block 1 rerun or Block 3. |

**Abbreviations.** `rs/` = `apps/desktop/src-tauri/src/`; `desktop/` = `apps/desktop/src/`.

---

## A. Executive triage summary

- **No P0 code defect.** Nothing credibly loses existing committed data or forms an exploitable serious flaw for the owner-only V1.
  - The worst issues lock the owner out of the journal or its backup path (ISSUE-001 to ISSUE-004, ISSUE-006). The data stays intact on disk, and the owner, who is also the developer, can recover manually.
  - **ISSUE-002 has an explicit escalation trigger:** it becomes P0 if measurement shows a normal journal reaching the 64 MiB live cap within the V1 horizon (about 12 months). Every user calculation stores a full copy of the account's trades, and nothing vacuums the database.
- **A repair wave before the release candidate is justified.**
  - Building the candidate first would force a second full manual-gate pass, because the planned gates exercise exactly the defects being fixed:
    - recovery scenarios (ISSUE-001–004);
    - a junctioned data path (ISSUE-006);
    - title-bar close (ISSUE-009);
    - corrected first-run steps.
  - The candidate must also carry the owner-only notices (ISSUE-039) and a unique version (ISSUE-022).
  - An optional throwaway "baseline build" may be used only to rehearse the VM procedures and measure; its results don't count.
- **Proposed V1 work order:**

  | Wave | Content |
  |---|---|
  | W0 | Owner decisions and measurements |
  | W1 | Data-safety repair |
  | W2 | Correctness and UX |
  | W3 | Legal, release and documentation preparation |
  | W4 | Candidate build |
  | W5 | Manual Windows gates |
  | W6 | Evidence register, NA-7 and P0-18 go/no-go (Kyle) |

  All P2/P3 work goes to the V1.1 queue (roadmap lane "P1 - V1.1") unless the owner pulls it in.
- **V1 P1 set:**
  - code: ISSUE-001, 002, 003, 004, 005, 006, 007, 009, 011 (wording part);
  - process / documentation: 022, 023;
  - decisions: 012, 036;
  - mandatory gate work: ISSUE-039 to ISSUE-054.
- **New planning constraints found in Block 2:**
  - **B2-1:** restore rollback refuses an older-version safety copy. Must precede any new migration.
  - **B2-2:** changing trade or ledger JSON shapes makes every promoted calculation stale.
  - **B2-3:** a table-rebuild migration cascade-deletes child rows.
  - **B2-4:** the import batch `status` CHECK allows only two values.
  - **B2-5:** a Windows helper dependency is needed.

  Details in §F. None changes V1 priority, because no V1 item needs a migration.

## B. Prioritized canonical findings

Audit priority is **not** the roadmap lane. The roadmap lane comes from the Final Push snapshot; "Unassigned" means no card was found offline. For ledger items without a source card, the source card is "Stage 1 audit 2026-10-22".

Column abbreviations used in the tables below:

| Column | Values |
|---|---|
| Pri | Audit priority (P0–P3) |
| Effort | S / M / L |
| Plat | Verification platform: Any OS, Win (Windows only), Both |
| Regr | Regression risk |

### B.1 P1: V1 code and process work

| Canonical issue / source card | Original IDs | Pri / roadmap lane | Work type / gate | Why now | Dependencies | Affected areas | Effort | Plat / tests / evidence | Regr |
|---|---|---|---|---|---|---|---|---|---|
| ISSUE-002 Live-journal size caps / Stage 1 audit | DATA-004 | **P1 (escalate to P0 if V-002 shows ≤12-month reach)** / Unassigned | Fix (split) | Blocks export (the only backup), restore-over, erase and account deletion. Grows with every calculation. | V-002 → sizing; ISSUE-005 → 002a (shared `dump`/`schema`); ISSUE-012 → 002c (frozen-copy redesign) | `rs/data_controls/archive.rs:71-91, 231-273`; `restore.rs:56-67`; `deletion.rs:133`; `store/evidence.rs:314` | 002a/b M; 002c L | Any OS; tests `data_controls/tests.rs:30,147,198,450`, `security_tests.rs:117`; growth measured on Windows | High: keep the `data.json` byte format; `sqlite_sequence`/`sqlite_stat*` stay excluded |
| ISSUE-001 Cleanup marker blocks every open / Stage 1 audit; Builds 24–25 | DATA-001 | P1 / Unassigned | Fix | Total lock-out on every launch, no message naming the file; cheap fix | None (do before 018, 029c) | `rs/data_controls/deletion.rs:287-293, 321-386`; `runtime.rs:352-356`; `filesystem.rs` atomic helper | M | Any OS (Windows for AV locks); `data_controls/tests.rs:580, 427, 450, 611` | High (startup and erase): keep the owned-row check |
| ISSUE-003 Stray attachment blocks restore and erase / Stage 1 audit | DATA-002 | P1 / Unassigned | Fix | Plausible after a crash or power loss; misleading message; no repair | Before 004 (shared pattern and code); 021 (shared `inspect_to`) | `rs/data_controls/restore.rs:127-133, 212-255`; `deletion.rs:211-213`; `mod.rs` `Code`; TS data-controls contract and wire fixture | M | Any OS; `tests.rs:198, 450, 520, 748`; `store/journal_review_tests.rs:493` | High: strays must be preserved, never dropped |
| ISSUE-004 Missing attachment blocks export, restore and erase / Stage 1 audit | DATA-003 | P1 / Unassigned | Fix (erase and restore now; export after a format decision) | Permanent loss of backup ability after AV or tidying | 003 → 004; owner decision D-ARCH (archive v1.1/v2) for the export side | `rs/data_controls/archive.rs:154-173, 246, 430`; `restore.rs:127, 178-202, 345-349`; `deletion.rs:211` | M (erase/restore); L (export) | Any OS; `tests.rs:49` will change on purpose; `security_tests.rs:36` | High |
| ISSUE-005 Archive schema `sqlite_`-wildcard bypass / Stage 1 audit | TR-001 | P1 (bundled; the triage reviewer argued P2) / Unassigned | Fix (security integrity) | The only restore path's integrity control is defeated. It is a one-line, low-cost fix in the same function as 002a, so it is done first. | Before 002a, 028, 021 (`inspect_to`/`dump` merge order) | `rs/data_controls/archive.rs:77, 466`; `restore.rs:73, 116` (candidate opened with `trusted_schema` ON); `db/mod.rs::configure` | S–M | Any OS; `security_tests.rs:158` (add `sqlitex_`), `:200`; `current_schema_tests.rs:141` | Medium: `trusted_schema=OFF` live; run the full suite |
| ISSUE-006 Reparse-point ancestor check blocks startup / Stage 1 audit | WIN-001; WIN-002 (linked) | P1 / Unassigned | Fix + Windows verification | Fatal at startup on junctioned or mount-point profiles; frequency on Kyle's PC unknown | B2-5 helper → 006; 021 → 006 (user-path part only) | `rs/data_controls/filesystem.rs:68-109`; `mod.rs:155-168`; `runtime.rs:126-136, 330-335`; `archive.rs:223, 331, 552` | M–L | **Windows** (junction, mount point, Sandbox, OneDrive); no Windows tests today | High: must not allow junctions *inside* the data folder |
| ISSUE-007 Calendar day vs Rust trading day / Stage 1 audit; P0-D UI (merged) | UI-001; UI-009; UI-010 | P1 / Unassigned (do not reopen P0-D) | Fix | Wrong "in use" rulebook every evening after the reset and every weekend; risk shows Unknown; a weekend `effectiveFrom` can be stored | Read paths: use the existing `list_account_freshness.currentTradingDay` (no contract change); TR-010 freshness routing optional. Reset path: Rust option (b) rejects a mismatched `effective_from` (no wire change) before the `LifecycleDialogs` change | `desktop/features/accounts/setup.ts:32-35`; `rulebooks/components/context.ts:15`; `CalculationExplanation.tsx:54-55`; `LifecycleDialogs.tsx:282-293`; `AssignDialog.tsx:30`; `rs/store/rulebooks.rs:829`; `store/attempts.rs:262` | M | Any OS (fake clock) plus a Windows sanity check; `rulebooks.test.tsx:443`, `rs/domain.rs:463`, `rs/store/freshness.rs:207` | Medium: fails closed |
| ISSUE-009 Unsaved text lost on close or history navigation / Stage 1 audit; specs 13/14 | DATA-008; UI-005 | P1 / Unassigned | Fix (history part) + verification (close) → fix | Loss of user-written text on common actions | V-009 (Windows close behaviour) → close-veto part; capability check `core:window:allow-destroy` (coordinate with 030); merge order 009 → 020 → 011 on `DailyReviewPage.tsx` | `desktop/features/shared/hooks/use-leave-guard.ts`; `app/AppShell.tsx:231`; `AccountSwitcher.tsx:68`; `capabilities/default.json` | M | History part: any OS. Close part: **Windows**. Tests: `review-save-guard`, `trade-nav-guard` | Medium–High: a JS close listener can block closing; register it only while dirty |
| ISSUE-011 (wording part) Uncertain shown as failed / Stage 1 audit; P0-03 rule | UI-004 (+ UI-003 toast wording) | P1 (the wording); P2 (settings auto-acknowledge, daily-review acknowledge flow) / Unassigned | Fix | "Wasn't archived" or "wasn't restored" contradicts the merged P0-03 rule and invites repeating an irreversible action | Merge after 009 / 020 on shared files | `desktop/features/accounts/components/LifecycleDialogs.tsx:166, 191`; `TradeLogView.tsx:146`; `TradeDetailPage.tsx:270`; `AccountSwitcher.tsx:45`; `AccountActions.tsx:37` | S | Any OS; uncertain-writes journeys | Low |
| ISSUE-022 Release gating and versioning / NA-2/P0-06 workflow | WIN-006; WIN-004; WIN-008; TEST-010; TEST-001 (dup, canonical ISSUE-040) | P1 / Unassigned (process) | Process fix + owner choice (version scheme) | Candidate integrity: same-SHA CI and a unique version are needed for gates 040/042 | D-VER (version scheme) → 022 → ISSUE-040 | `.github/workflows/release-installer.yml`; `ci.yml`; `tauri.conf.json:4`; `Cargo.toml:3` | S–M | Any OS (CI) | Low |
| ISSUE-023 Install/uninstall documentation and the "no internet" wording / NA-7, P0-13 | WIN-003; WIN-005; TR-014 | P1 / NA-7 + P0-13 (V1 open) | Documentation + owner choice (offline installer) | User-facing claims must be accurate before the candidate. Feeds NA-7 and the legal summary. | D-OFF (offline installer) → 023; agree `PRIVACY_SUMMARY` text with 039 | `docs/build-26.75-evidence.md`; `README.md`; `desktop/legal/index.ts:12-14` | S | Any OS (docs); Windows verification V-023 | Low |

### B.2 Mandatory gate work and owner decisions in V1

These are not defects. Priority and gate flag are both shown.

| Canonical issue / source card | Original IDs | Pri / lane | Work type / gate | Why now | Dependencies | Effort | Platform / evidence |
|---|---|---|---|---|---|---|---|
| ISSUE-039 Owner-only v1.1 notices / P0-13, NA-3 | TEST-003 | Gate work / V1 | Implementation + tests + spec (mandatory) | A first-run requirement; no candidate is valid without it | D-0BSD (ISSUE-057); 023 wording agreed; owner supplies the v1.1 text | S–M | Any OS; packaged first run in W5 |
| ISSUE-012 Engine authority / Build 16, P0-02 | UI-002 | P1 (decision) | Owner decision → documentation (+ optional parity fixtures, P2) | Governs 002c and the CLAUDE.md rule | — | S (docs) / L (Rust verdict fixtures) | Any OS |
| ISSUE-036 Test CSV provenance | TR-020 | P1 (decision) | Owner decision | Possible disclosure in a source-available repository; must be resolved before any tag | — | S | — |
| ISSUE-040 to ISSUE-054 | WIN-007, TEST-002, TEST-004 (link), TEST-006 (link), TEST-007 | Gates | Mandatory gates (§E W3–W6) | Release-blocking flag | Per §D | — | Per gate |
| Decisions ISSUE-047, 048, 052, 053, 055, 056, 057 and the decision parts of 018 (DATA-012), 034, 035, 037; D-VER, D-OFF, D-ARCH | Various / N/A | Decisions | Owner | Some gate fixes (§D) | — | — | — |

### B.3 P2: worthwhile; V1.1 queue unless the owner pulls them in

| Canonical issue | Original IDs | Why P2 | Notes / dependencies | Effort / platform |
|---|---|---|---|---|
| ISSUE-008 Decimal overflow panics | TR-002, TR-003 | Persistent read panic, but needs ~29-digit input or a crafted archive | **Recommend pulling into W1:** `checked_sub` only is S; precedes 034 | S–M / Any |
| ISSUE-010 Idempotent creates; deadline | DATA-006, DATA-007, TR-005 (dup) | Unmeasured frequency; the request ID needs a migration | Commit deadline ≥ preview (TS-only, S) may be pulled in. Request IDs need B2-1 → 016 → 019 → migration. Escalate to P1 if V-010 shows commits over 30 s. | S / L; timing on Windows |
| ISSUE-011 (rest) Settings auto-ack; daily-review acknowledge | UI-003, UI-011 | UX lock until restart; no data loss | After 016 (categories) | M / Any |
| ISSUE-013 Screenshot IPC | TR-006 | Unmeasured stall | Contract change plus CSP `blob:` (coordinate with 023/030 on `tauri.conf.json`); after 025 wire extension | M–L / Both |
| ISSUE-015 Panic guard | DATA-005, TR-004 | No current panic site | 017 → 015 (`runtime.rs`); the drop guard is S | S–M / Any |
| ISSUE-016 IPC error classification | TR-008, TR-010, TR-018 | Low frequency | Predecessor of 010 and of 011 (rest) | S–M / Any |
| ISSUE-018 Recovery hygiene (+ B2-1) | DATA-010, -011, -012, -014 | Disk, privacy, message accuracy | **B2-1 must land before any migration.** After 001 and 004. Retention part is D-RET. | M (5 small parts) / Any |
| ISSUE-020 Daily-review edits during save | DATA-009 | Partially Confirmed | V-020 component test first | S / Any |
| ISSUE-021 Path validator | TR-007 | Defence in depth | After 005 and 028; before 006's user-path part | M / Both |
| ISSUE-024 Windows FS tests and hardening | TEST-005, DATA-017, WIN-010 | Test gap | B2-5 helper; `cfg(windows)` tests | M / **Win** |
| ISSUE-025 Test fidelity | UI-006, UI-007, UI-019, TR-011 | Regression protection. Highest-value part: the production trade delete/undo/restore journey. | Wire extension precedes 013/014/010 contract changes | L (splittable) / Any |
| ISSUE-034 Fees policy | TSD-008 | Breaks the "unknown is —" rule, mitigated by the coverage statement | D-FEES first. If nullable: B2-3/029b → `ADD COLUMN fees_known`. Watch B2-2. | L / Any |
| ISSUE-037 Ledger UI scope; spec drift | UI-020 | Scope question | D-LEDGER; spec fixes (card wins) | S / — |
| ISSUE-038 Real-journal upgrade test safety | TEST-006 | Low risk to source (read-only copy) | Only if gate 052 is kept | S / Any |

### B.4 P3: deferrable

| Canonical issue | Original IDs | Reason |
|---|---|---|
| ISSUE-014 Fan-out | UI-008 | Churn bounded after recheck |
| ISSUE-017 `created` flag | TR-009 | Self-heals |
| ISSUE-019 Failed import batch | DATA-013 | History label only. Skip refusals rather than add a status, because of the `status` CHECK (B2-4). |
| ISSUE-026 Minor frontend correctness | UI-013, UI-014, UI-015, UI-018 | Low impact. UI-014 (visible ratio mismatch) could be P2. |
| ISSUE-027 Minor state/UX | UI-012, UI-016, UI-017 | Edge cases |
| ISSUE-028 Archive/parse hardening | TR-015, TR-016 | Crafted input needed |
| ISSUE-029 Data hardening | DATA-015, -016, -018, -019 | Latent. 029b (migration rule plus row-count test) becomes a predecessor of any rebuild migration. 029c (erase checkpoint) could be P2 on privacy grounds. |
| ISSUE-030 Tauri/release hardening | TR-012, TR-013, TR-017 | Check `core:default` and the dev-name exclusion during the candidate build (W4) |
| ISSUE-031 Windows platform behaviour | WIN-009, WIN-011, WIN-012 | Covered by gates 041/046 |
| ISSUE-032 CI/test hygiene | TEST-004, TEST-009, TEST-011 | Handled procedurally in gate 050 |
| ISSUE-033 Collector render path | TR-019 | Separate tool, deferred to V1.5 |
| ISSUE-035 Duplicate-collapse policy | DATA-020 | By design; owner confirmation only |

**Already Resolved / Not Applicable / duplicates — not scheduled:**
- No Already Resolved or Not Applicable findings.
- Duplicates TR-005 (→ DATA-007) and TEST-001 (→ WIN-007) are scheduled only through their canonical issues.
- Phase 1 non-findings R-04, R-13 and R-15 are not scheduled.

## C. Decision rationale

- **P0: none.** The P0 test is credible loss of existing data, a fundamental broken workflow, or an exploitable serious flaw.
  - ISSUE-001–004 and 006 are lock-outs with intact data and manual recovery available.
  - ISSUE-005 needs a crafted third-party archive.
  - ISSUE-008 needs about 29-digit input.
  - Gates block release independently of P0.
- **ISSUE-002 is ranked highest.** It is reachable through normal use: every calculation adds a full trade copy and nothing vacuums. Its failure mode removes the owner's only backup path. It escalates to P0 on measurement.
- **ISSUE-005 is P1 despite low likelihood.** It defeats an explicit integrity control on the only restore path, costs S, and sits in the same function as ISSUE-002a. The triage reviewer's P2 view is recorded; the lead chose P1-bundled because doing it later would mean re-opening the same code.
- **ISSUE-007 is P1.** It triggers daily for evening/weekend futures users and persists bad `effectiveFrom` data. It is not P0 because the engine fails closed (Unknown).
- **ISSUE-009 is P1.** Loss of authored text on a common action. The close half is still unverified, hence V-009 first.
- **ISSUE-011 is P1 only for wording.** The wording violates the merged P0-03 rule and is S. The rest is P2.
- **ISSUE-022 and ISSUE-023 are P1** because the gates' validity depends on them: same-SHA CI, a unique version, accurate install text.
- **P2 items** are real but either unmeasured (010, 013), have no current trigger (015), are defence in depth (021), are tests (024, 025), or wait on decisions (034, 037).
- **ISSUE-008 is recommended for an optional pull-in to W1** at S effort because its persistent-panic mode is ugly and the fix is trivial.
- **P3 items** are cosmetic, latent or covered by gates.

**Trade-offs:**
- Doing 002c (removing frozen trade copies) would fix the growth at its source. However:
  - it changes risk-promotion fingerprints (B2-2);
  - it depends on the ISSUE-012 authority decision.

  002a/b (count used pages, stream-hash, name the component) restores availability without touching that design.
- 004's export side changes the archive contract (`ArchiveManifest` uses `deny_unknown_fields`, and `inspect_to` requires an exact inventory). Older apps could not read the result, so only the erase and restore sides go into V1.

## D. Dependencies (predecessor → successor)

### Decisions → work

| Decision | Successor |
|---|---|
| D-0BSD (ISSUE-057) | ISSUE-039 → W4 candidate (notices bundle) |
| ISSUE-036 CSV provenance | Any tag or candidate (W4) |
| ISSUE-012 engine authority | 002c; CLAUDE.md / `packages.md` edits; optional verdict fixtures |
| D-VER version scheme | ISSUE-022 → ISSUE-040 candidate → ISSUE-042 upgrade/downgrade gate |
| D-OFF offline installer | ISSUE-023 → ISSUE-049 NA-7 and ISSUE-043 offline gate |
| D-ARCH archive format | 004 export side; raising the 002 caps |
| D-FEES (034) | Any fees migration |
| D-LEDGER (037) | Spec and CalculationSettings change |
| D-RET (DATA-012) | Pruning in 018 |
| ISSUE-052 / ISSUE-053 keep or waive | 038 fix; CI `cargo fmt` |

### Code: native

- 005 → 002a (shared `dump`/`schema`; keep `sqlite_sequence`/`sqlite_stat*` excluded)
- 005 → 028 → 021 (`inspect_to` merge order)
- 003 → 004 (shared new code and the preserve/quarantine pattern)
- 021 → 006 (user-path part); B2-5 Windows helper → 006 and 024
- 001 → 018 (quarantine location must not be under `data-controls/`; `deletion.rs:104`); 001 → 029c (`execute_durable`)
- 017 → 015 (`runtime.rs`)
- B2-1 (in 018) → any migration (010, 034); 029b (rule plus row-count test, foreign-keys-off rebuild infrastructure) → 034 and any rebuild
- 010 ↔ 034: serialize migration numbers (0022, then 0023), one per pull request
- 008 → 034 (shared P&L derivation)
- 019 → 010; 016 → 010 (a request-ID contract mismatch would otherwise create false uncertain locks)

### Code: domain/frontend

- 007 Rust reset-path check (`store/rulebooks.rs:829`, `store/attempts.rs:262`) → `LifecycleDialogs.tsx` change
- 007 read paths via `list_account_freshness.currentTradingDay` (no contract change). 016's freshness routing is optional first. 014, if ever done, can absorb this.
- 009 → 020 → 011 (merge order on `DailyReviewPage.tsx`)
- 016 → 011 (rest)
- 025 wire and fake extension → 013, 014, 010 contract changes
- 039 → 027 legal hardening; 039 ↔ 023 agree on the `PRIVACY_SUMMARY` text
- 009 ↔ 030 capability set (keep `core:event` listen; add `core:window:allow-destroy` if the JS close veto is used); 013 ↔ 023/030 on `tauri.conf.json` (CSP `blob:`)

### Gates

- W1 + W2 + 039 + 022 + 023 → ISSUE-051 (CI on the candidate SHA) → ISSUE-050 (advisory result read) → ISSUE-040 (candidate plus EXE SHA-256)
- ISSUE-040 → ISSUE-041 (fixed checklist, TEST-002) → 042, 043, 044 (including the 001–004 scenarios), 045, 046 → 052 (if kept)
- All gates and decisions → ISSUE-049 NA-7 final → ISSUE-054 P0-18 (Kyle only)

## E. Suggested implementation waves

| Wave | Content | Entry criteria | Exit criteria |
|---|---|---|---|
| **W0: Decisions and measurement** | **Decisions:** D-0BSD (057), 036, 012, D-VER (022), D-OFF (023), D-ARCH, D-LEDGER (037), D-RET (018), D-FEES (034), 035, 047 (P0-05), 048 (identify P0-09), 052/053, 055 (P0-10), 056 (D5). Owner supplies the v1.1 legal text. **Measurements (verification only):** V-002 growth per calculation on a disposable journal (any OS); V-010 commit/export timing (Windows); V-009 title-bar close (Windows); V-006 junction/Sandbox layout on Kyle's profile (Windows). A throwaway baseline build is allowed; its results don't count toward gates. | Block 3 tasks approved by Kyle | Each decision recorded Decided with its source, or explicitly deferred. V-002 result recorded (decides whether 002 becomes P0). |
| **W1: Data-safety repair (Rust; serial within `data_controls`)** | 005 → 002a (used pages, name the component) → 002b (stream-hash tokens) → 001 (atomic marker, quarantine, non-fatal) → 003 (distinct code, preserve strays) → 004 (erase and restore tolerate/report missing) → 006 (app-owned components, reparse-tag check, distinct category). Optional pull-in: 008 (`checked_sub`). | W0 decisions affecting scope (D-ARCH for 004 export; 012 only for 002c, which is excluded from W1) | `npm run build` then `cargo test --offline --locked` and `cargo clippy --offline --locked --all-targets -- -D warnings` pass. New regression tests pass. 006 verified on Windows (junction plus standard). No migration. |
| **W2: Correctness and UX** | 007 (Rust reset check, then UI read paths from `currentTradingDay`); 009 history/`navigate()` guard, then close veto per V-009 (+ capability); 011 wording | W1 merged (no shared files except via the 009/020/011 order) | `npm run typecheck`, `npm test` (journeys and axe), `npm run build`, `cargo test` pass. Fake-clock boundary tests for 007. Windows close check for 009. |
| **W3: Legal, release and documentation preparation** | 039 owner-only notices and tests and spec; 023 docs and wording (+ `offlineInstaller` per D-OFF); 022 workflow gating and unique version; TEST-002 checklist correction (instrument for 041); NA-7 draft update | 057 decided; v1.1 text supplied; D-VER, D-OFF decided | `legal.test.ts` pins the new digests; first-run journey passes; docs cite the current workflow |
| **W4: Candidate** | 051 green CI on the exact SHA; 050 read the advisory summary (or dispatch with `--fail-on-outage`); 040 release run, recording run ID, version, toolchain, and EXE SHA-256 from `SHA256SUMS.txt`; 030 checks (`core:default` schema, dev-name binary scan) observed | W1–W3 merged; 036 decided | Candidate record complete |
| **W5: Manual Windows gates (owner or approved VM)** | 041 smoke (corrected step 4; junction path; OneDrive export; title-bar close; ticked uninstall after export; second instance; DPI); 042 upgrade/reinstall/downgrade; 043 offline; 044 recovery (including ISSUE-001–004 scenarios); 045 accessibility; 046 DPI matrix; 052 if kept | Candidate from W4 | Each gate Passed/Failed recorded with SHA, EXE hash, environment, tester and date |
| **W6: Close-out** | 049 NA-7 final against actual candidate behaviour; evidence register; 054 P0-18 go/no-go (**Kyle only**) | W5 complete or gates explicitly waived by the owner | Owner decision recorded |
| **V1.1 queue (outside V1)** | All P2/P3 not pulled in. Triage follow-ups stay in roadmap lane "P1 - V1.1" without widening any card. | — | — |

**Serial vs independent:**
- W1 is strictly serial: shared `archive.rs`, `restore.rs`, `deletion.rs`, `filesystem.rs` and `runtime.rs`.
- In W2, 007 and 011 are independent. 009 must merge before any later `DailyReviewPage` change.
- W3 items are independent, except 039 ↔ 023 wording.
- Decisions in W0 can run in parallel.

## F. Cross-cutting contract and migration risks

1. **B2-1: rollback version mismatch (new; confirmed by lead read).**
   - `rs/data_controls/restore.rs:345-349`: `rollback()` validates `safety.db` at `db::latest_version()`.
   - If a restore is interrupted in `installing` and the next app build adds a migration, rollback fails with `Integrity`, so every start is blocked.
   - Fix: validate at the copy's own `user_version`, then let `open_file` migrate. Belongs under ISSUE-018.
   - **Must precede any new migration.** No V1 item needs a migration, so it is P2 but a hard predecessor of 010/034.
   - To be added to the ledger on the next Block 1 rerun (§G.4).
2. **B2-2: risk fingerprint sensitivity (lane finding; Unverified by lead).**
   - `rs/store/risk_promotion.rs` re-fingerprints `risk_inputs_in` output, which includes `trades::list` and `ledger::list`.
   - Any serialized-shape change marks every promoted calculation stale. It fails closed (Unknown), but users would see that as a regression.
   - Applies to 010 (`requestId`), 034 (fees), 002c and possibly 008.
   - Mitigation: keep new columns out of these DTOs, or version the fingerprint.
3. **B2-3: rebuild migrations cascade.**
   - `migrate_with` runs each step in a transaction with `foreign_keys=ON` (`rs/db/mod.rs:214-241`). A `DROP TABLE`-style rebuild of `trades` or `account_snapshots` would cascade into child tables.
   - New migrations must be `ADD COLUMN` plus index only, until ISSUE-029b adds foreign-keys-off rebuild infrastructure and a row-count test. Extends DATA-016.
4. **B2-4: `import_batches.status` CHECK** (`rs/migrations/0001_core_schema.sql:305`) allows only `committed`/`failed`. ISSUE-019 must skip refusals; a new label would need a rebuild.
5. **B2-5: the Windows reparse-tag and hard-link checks** need a direct `windows-sys` dependency (already transitive in the lockfile; not declared in `Cargo.toml`). This is a dependency change, so it needs explicit approval in the task.
6. **Archive format v1 compatibility.**
   - Old archives validate at their own schema version.
   - A new migration must use deterministic SQL, because the restore candidate's upgraded schema is text-compared to a fresh build.
   - New-version archives are refused by older apps.
   - Every build is 0.1.0 (ISSUE-022), so downgrades are confusing. The only path back is `fundedflow.db.before-v<N>.bak`.
7. **TS↔Rust contract changes:**
   - 010: `requestId` in strict Zod inputs and `deny_unknown_fields` structs.
   - 013: binary screenshot response; port change.
   - 014: new command.
   - 007 option (a): changes the reset `RulebookDecision`. Option (b), recommended, has no wire change.
   - Each must land atomically on both sides, ideally after 016 classifies Tauri `invalid args` errors.
   - Fixture regeneration (`command-wire.json` etc. with `FUNDEDFLOW_UPDATE_FIXTURES=1`) must be named in task scope and diff-reviewed.
8. **Never edit shipped migrations** (`rs/db/mod.rs:37`). Versions stay contiguous (`MIGRATIONS[..version]`).

## G. Verification-only tasks, owner decisions and unresolved questions

### G.1 Verification-only tasks

| ID | Verifies | Decides | Platform |
|---|---|---|---|
| V-002 | DB growth per calculation × trades on a disposable journal | 002 P0/P1; need for 002c | Any OS |
| V-006 | Junctioned profile; Windows Sandbox first launch; OneDrive Documents export (WIN-002) | Frequency; 006 test cases | Windows |
| V-009 | Title-bar close with unsaved text under WebView2 | Close-veto scope | Windows |
| V-010 | 50k-row commit and export duration | 010 escalation; deadline values | Windows |
| V-013 | 20 × 10 MB screenshots stall | 013 escalation | Windows |
| V-014 | Invoke count with N accounts | 014 | Any OS |
| V-015 | Injected panic: does the invoke hang? (TR-004) | 015 scope | Windows / Tauri |
| V-020 | Typing during a pending daily-review save | 020 | Any OS |
| V-023 | Ticked NSIS uninstall; install with no WebView2, online and offline | 023 wording | Windows VM |
| V-024 | AV sharing violations (WIN-010) | 024 retry scope | Windows |
| V-027 | Quick-import effect (UI-017 remainder) | 027 | Any OS |
| V-029 | Newer-WAL fixture (DATA-019) | 029 | Any OS |
| V-030 | Generate the capability schema to expand `core:default` (TR-013) | 030 | Any OS |
| V-031 | DPI matrix; network profile (WIN-009/011) | 031 | Windows |
| V-033 | Collector WebSocket fixture (TR-019) | 033 (separate tool) | Collector env |
| V-B2-2 | Confirm fingerprint sensitivity before 010/034 | Migration design | Any OS |

### G.2 Owner decisions

| Item | Status |
|---|---|
| D-0BSD (ISSUE-057) | Pending |
| ISSUE-036 CSV provenance | Pending |
| ISSUE-012 engine authority | Pending |
| D-VER version scheme (ISSUE-022) | Pending |
| D-OFF offline installer (ISSUE-023) | Pending. The existing signing, updater and bootstrapper decisions (ISSUE-058) are **Decided**. |
| D-ARCH archive format for missing attachments / caps (ISSUE-004/002) | Pending |
| D-FEES (ISSUE-034) | Pending |
| ISSUE-035 duplicate-collapse policy | Pending |
| D-LEDGER (ISSUE-037) | Pending |
| D-RET (DATA-012 / ISSUE-018) | Pending |
| ISSUE-052 / 053 keep or waive | Pending |
| ISSUE-047 P0-05 cohort | Pending |
| ISSUE-048 P0-09 evidence | Pending (identify) |
| ISSUE-055 P0-10 | Pending |
| ISSUE-056 D5 | Pending (clarify) |
| ISSUE-021 | Pending. Whether mapped network drives are acceptable export targets. |
| ISSUE-054 P0-18 | Kyle only, at the end |

### G.3 Unresolved questions

- Notion card text for P0-09, P0-10, D5 and ledger UI scope (not refreshed).
- CI log content and the advisory result at `92e7980`.
- TS and Rust suite results at HEAD (never executed in this audit).
- Tauri panic-to-invoke behaviour.
- `core:default` expansion.

### G.4 Ledger corrections to apply on the next Block 1 rerun or in Block 3

Block 2 may not edit the ledger.

1. **TEST-001:** canonical owner is ISSUE-040. ISSUE-022 is a cross-reference only.
2. **TEST-007:** canonical owner is ISSUE-044. ISSUE-045 and ISSUE-046 cross-reference it.
3. **TEST-008:** is decision-linked (ISSUE-057, plus 048, 055, 056). 06 §6.1's "6 gate/evidence" count should read 5 gate/evidence + 2 decision-linked (TEST-008, DATA-020). The total of 53 is unchanged.
4. **06 §5 concern table:** add ISSUE-015 under Reliability / data safety.
5. **Pending-decision count:** the 11 in 06 §6.3 omits D-VER, D-OFF, D-ARCH, ISSUE-047 (P0-05) and ISSUE-048 (P0-09). The corrected pending count is **16**; Decided is still 1. This file's §G.2 is the working list.
6. **ISSUE-039:** label it "gate with implementation work" (scheduled in W3), not "Not Run" only.
7. **New items:** add B2-1 (under ISSUE-018), and B2-2 to B2-5 as planning constraints (§F).
8. **Header:** the ledger says HEAD `bba845b`. That was the input revision; the ledger itself was committed in `45de2af`. No source drift.
9. **Double-listing rule:** issues listed in both sections A/B and section C of the ledger count as defects only in A, and as decisions only in C.

## H. Deferred and excluded work

**Deferred to V1.1** (roadmap lane "P1 - V1.1"; no card scope widened):
- all P2 and P3 items not pulled in by the owner (§B.3, §B.4);
- 002c frozen-copy redesign;
- 004 export-side format change;
- 010 request-ID migration;
- 012 Rust verdict fixtures;
- 013 binary IPC;
- 014 overview command;
- 034 fees migration;
- 025 beyond the delete-journey slice.

**Deferred to V1.5 / separate:** ISSUE-033 (collector), and the desktop collector consumer.

**Deferred to V2:** external-user agreements, counsel sign-off, MPL/NSIS legal reviews, Web V2.

**Excluded (not proposed):**
- cosmetic redesigns;
- new features unrelated to findings;
- cloud or networking;
- signing or auto-update changes (owner decision ISSUE-058 stands);
- collector architecture changes;
- whole-package rewrites (e.g. a data-router migration for 009 — use guard routing instead);
- new test infrastructure (all test work uses existing Vitest/jsdom/cargo);
- unrelated refactors;
- editing shipped migrations or historical fixtures.

## I. Up to five supported high-value fixes

| # | Fix | Issue(s) | Why | Effort / platform |
|---|---|---|---|---|
| 1 | Restore archive integrity and live-journal availability: exact-name schema allow-list, count used pages, name the component over the cap, stream-hash preview tokens | ISSUE-005 → ISSUE-002a/b | Protects the only backup/restore path against normal growth and tampered archives. One serial change set in `archive.rs`. | M / Any OS |
| 2 | Cleanup marker cannot lock the journal: atomic write, quarantine, non-fatal startup, named file | ISSUE-001 | Removes a total startup lock-out. Cheap. | M / Any OS (+ Windows AV) |
| 3 | Stray or missing screenshots no longer block restore and erase: preserve strays in the safety copy, tolerate and report missing files, distinct error code | ISSUE-003 → ISSUE-004 (erase/restore part) | Recovery tools work when they're needed most | M / Any OS |
| 4 | Startup tolerates junctioned or mount-point profiles: check only app-owned components, reject only symlink/junction/mount tags, distinct "unsafe directory" category | ISSUE-006 | Removes a Windows-only fatal startup path | M–L / **Windows** |
| 5 | Trading day from Rust in the UI, plus a Mon–Fri `effective_from` check in Rust | ISSUE-007 | Fixes a daily, user-visible correctness issue and stops new weekend `effectiveFrom` rows. No contract change (uses `currentTradingDay`; reset option b). | M / Any OS |

The next candidates were **ISSUE-009** (history guard now, close veto after V-009) and **ISSUE-011** (wording). Both are in W2.

---

**Handback:**
- Block 2 is complete. Only this file was written. The Git status at write time shows only `code-review/07-stage2-priorities-and-dependencies.md` as new.
- No escalation: B2-1 is serious only if a migration ships, and no V1 item requires one.
- Block 3 should create task cards from §B/§E, apply the §G.4 ledger corrections, and keep gates, decisions and V1.1 deferrals separate.
