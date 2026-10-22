# FundedFlow: Stage 2 Block 4, implementation waves

| Field | Value |
|---|---|
| Review date | 2026-10-22 |
| Repository root | `/home/user/FundedFlow` |
| Branch / HEAD | `claude/practical-turing-wmii06` / `295c89f`. The working tree was clean at the start. |
| Source comparison | `git diff 92e7980 HEAD -- . ':!code-review'` is empty, so the application source is identical to inspected main `92e79802593f…`. The earlier snapshot `8c3dd34` was not re-diffed; all Stage 2 inputs were built at `92e7980`. No checkout, reset or fetch was done. |
| Host | Linux x86_64 cloud container. This is not Windows and not WSL, so no Windows runtime validation is possible here. |
| Tools present | node v22.22.0, npm 10.9.4, cargo, rustc and clippy 1.97.0, uv 0.11.32, Python 3.13.16 |
| Tools absent | `node_modules`, the cargo registry cache and `target/` are absent, and cargo-about is not installed. |
| Agent instructions | `CLAUDE.md` was read. There is no `.claude/` folder and no `AGENTS.md`. No instruction conflicts with Block 4 scope. |
| Inputs | `05-final-codebase-audit.md`; `06-stage2-evidence-reconciliation.md` and `remediation-findings-ledger.md` (`45de2af`); `07-stage2-priorities-and-dependencies.md` (`a7310fd`); `08-stage2-remediation-task-index.md` and 36 cards at spec r2 (`295c89f`) |
| Scope status | **Complete** for planning. No fix was implemented. |
| Companion | `10-stage2-approval-and-execution-runbook.md`. It covers approval, preflight, exit gates, stop rules, the corrections needed from Block 3, and the proposed next session. |

## 1. Agents and coverage

The lead dispatched three read-only reviewers. None of them edited files, ran npm or cargo, or used the network. The lead re-checked the high-impact claims (§1.1).

| Lane | Coverage | Result |
|---|---|---|
| Backlog reviewer | Mapping of ISSUE-001 to 058 and all 84 original IDs; duplicates; scope; priorities; acceptance quality; counts | No blocking defects. 16 Should-fix, 11 Nit. |
| Dependency reviewer | Shared files and functions in TASK-012 to 027 and TASK-034; persistence formats; wire contract; commands and query invalidation; migrations; version bump | Order confirmed. No migration needed. 8 Should-fix, 6 Nit. |
| Validation reviewer | Exact check commands, directories and prerequisites; CI; audit-guard; collector; gate evidence fields; existing evidence classes | No blocking defects. 6 Should-fix, 5 Nit. Produced the validation matrix (runbook §3). |

### 1.1 Lead re-checks (source at `295c89f` = `92e7980`)

- **Downgrade risk confirmed.** `Cleanup` uses `deny_unknown_fields` (`apps/desktop/src-tauri/src/data_controls/deletion.rs:50`). New marker fields from TASK-016 would make an older build fail to start (`runtime.rs:352`).
- **Hard-coded version confirmed.** `apps/desktop/src/journeys/recovery.journey.test.tsx:66` expects `FundedFlow version: 0.1.0`. The TASK-027 version bump would break it, and the card doesn't name it.
- **Export path confirmed.** Export snapshots through the SQLite backup API (`archive.rs:174-183`), which copies free pages. TASK-013's "narrowed acceptance" option could therefore leave export, the only backup path, blocked.
- **Rollback behaviour confirmed.** Rollback restores only the files listed in the inventory (`restore.rs:262-270`). Under TASK-016, extras that were copied to the safety folder would be absent from the live tree after a rollback.

### 1.2 Checks run by the lead

All were run serially from the repository root, with `FUNDEDFLOW_UPDATE_FIXTURES` explicitly unset. Each uses only Node built-ins and temporary directories; scripts were inspected first.

| Command | Exit | Result |
|---|---|---|
| `npm run test:dev-scripts` | 0 | 20 pass |
| `npm run test:notices` | 0 | 10 pass |
| `npm run test:ci-scripts` | 0 | 8 pass |
| `npm run check:boundaries -w @fundedflow/domain` | 0 | "Domain boundaries OK" |

`git status` was clean after these runs.

**Not run** (each would need an install or download first):
- `npm run typecheck`
- `npm test` (the domain and desktop Vitest parts)
- `npm run build`
- `npm run check:dist -w @fundedflow/domain`
- `cargo test` and `cargo clippy`
- `npm run check:notices`

**Baseline status.** The TypeScript and Rust suites have **never been executed in this audit**. A green baseline at `92e7980` is not established and must be the first preflight step of any implementation session (runbook §4).

## 2. Backlog audit summary

**Coverage.** All 58 canonical issues and all 84 original IDs are mapped in 08 §C. The 7 Unverified IDs match the ledger. No task duplicates another, and there are no invented finding IDs.

**Gaps that must be fixed in Block 3.** Full correction text is in runbook §8.

| # | Gap | Type | Affects |
|---|---|---|---|
| G1 | The live-connection `trusted_schema=OFF` change (the rest of ISSUE-005) has no owner, neither a task nor a deferral | Missing coverage | 08 §C.1, TASK-012 |
| G2 | V-023 (installing without WebView2) is claimed as covered, but no gate step does it | Missing coverage | 08 §D, TASK-028 |
| G3 | TASK-013 allows an outcome where export stays blocked | Unresolved risk (P1 impact) | TASK-013 |
| G4 | The TASK-006 config outcome is not in TASK-027's scope | Missing ownership | TASK-027 |
| G5 | If the `cargo fmt` gate is kept, no task formats the crate and TASK-029 does not wait for it | Missing ownership | TASK-008, TASK-029 |
| G6 | No task produces the older build that the downgrade test needs | Missing prerequisite | TASK-031 |
| G7 | TASK-034 changes code after the candidate SHA is frozen | Sequencing | TASK-034, TASK-029 |
| G8 | Downgrade with a pending cleanup marker breaks startup (`deny_unknown_fields`, old key allow-list) | Persistence compatibility | TASK-015, 016, 031 |
| G9 | Gate pass rules are undefined | Acceptance quality | TASK-030, 031, 032, 033 |
| G10 | Steps without matching acceptance criteria | Acceptance quality | TASK-013, 021, 023, 028, 007, 008 |
| G11 | Contract consumers are unnamed, and the "no wire change" claim is wrong | Contract | TASK-015, 018 |
| G12 | Overlapping preview fields; the missing-list fallback; rollback behaviour of extras | Contract and persistence | TASK-016, 017 |
| G13 | The version knock-on misses `recovery.journey.test.tsx:66`; the fixture changes on every bump | Scope | TASK-027 |
| G14 | False or imprecise validation statements | Validation | TASK-018 (says "Linux CI"; CI is Windows-only), TASK-029 (`--fail-on-outage` and PR merge-commit SHA), TASK-011 (must forbid `FUNDEDFLOW_DEV_DATA_DIR` and prefer the release EXE), TASK-018 and 023 (manual record fields) |

**Nits.** These are recorded in runbook §8.3. They narrow or clarify scope and do not block approval.
- TASK-022: the `unstable_HistoryRouter` fallback needs separate approval.
- TASK-024: drop "link to the record".
- TASK-009: relabel as P2/P3.
- TASK-012: add a test that a safety copy from the previous version still rolls back.
- Fixture rule: "unset, not 0", because six Rust test files accept any value.
- 08 §E: replace "independent" with "small and reversible".
- 08 §G: change "22 call sites" to "21 of 24".
- TASK-015: write the temp marker in the data root.
- TASK-026 and 028: split the NA-7 lines between them.
- TASK-010: record a usage model.
- TASK-033 and 035: add the SHA fields.

**Consequence.** Cards with a Should-fix correction (G1 to G14) **return to Block 3** and are not Ready for Approval in this block:
- 007, 008, 011, 013, 015, 016, 017, 018, 021, 023, 027, 028, 029, 030, 031, 032, 033, 034.
- Through G1, the index entry for ISSUE-005 (TASK-012's card text itself is unaffected).

**Cards with no Should-fix correction.** These remain Ready for Approval at r2:
- 001, 002, 003, 004, 005, 006, 009, 010, 012, 014, 019, 020, 022, 024, 025, 026, 035, 036.
- Some of these have recorded Nits (§8.3). Some have prerequisites that are not complete (§5).

## 3. Counts (computed from the 08 §A index)

| By type | Count | Task IDs |
|---|---|---|
| Fix | 15 | 012 to 025, 027 |
| Owner Decision | 9 | 001, 002, 003, 005, 006, 007, 008, 009, 036 |
| Verification | 7 | 010, 011, 029, 030, 031, 032, 033 |
| Documentation | 4 | 004, 026, 028, 035 |
| Test | 1 | 034 |
| **Total** | **36** | |

| By audit priority | Count | Task IDs |
|---|---|---|
| P0 | 0 | none. TASK-013 becomes P0 only if TASK-010 escalates. |
| P1 (code, docs, process, verification) | 17 | 004, 010, 011, 012, 013, 014, 015, 016, 017, 018, 020, 021, 022, 023, 024, 026, 027 |
| P1 (decision) | 5 | 001, 002, 003, 005, 006 |
| P2 | 2 | 009 (decisions), 019 (optional pull-in) |
| Gate or gate work | 12 | 007, 008, 025, 028, 029, 030, 031, 032, 033, 034 (conditional), 035, 036 |

## 4. Dependency verdict

Source: the dependency reviewer, re-checked by the lead.

**True couplings in W1** (contract or behaviour, not just merge order):
- 012 → 014: the streaming hash must cover the same tables as 012's `dump()` rule.
- 013 → 017: both use the `detail` field.
- 015 → 016: quarantined markers leave strays, which 016 classifies.
- 016 → 017: both change `validate_managed`/`copy_managed` (`restore.rs:240-255`) and the `Code` enum.
- 015 → 018: both change the runtime status contract and `runtime.rs`.
- 018 goes last: it touches every app-owned `no_symlink_components` call site (21 of 24).

**Shared files that force serial merges:**
- `data_controls/mod.rs`: 013, 016, 017, 018
- `deletion.rs`: 014, 015, 016, 017
- `restore.rs`: 012, 014, 016, 017
- `archive.rs`: 012, 013, 014, 017
- `runtime.rs`: 015, 018
- `packages/domain/src/contracts/data-controls.ts` and `packages/domain/test/fixtures/data-controls-wire.json`: 013, 016, 017 (optional), 027 (`producerVersion`, line 89)
- `apps/desktop/src/lib/data/runtime.ts`: 015, 018
- `LifecycleDialogs.tsx`: 021, 024
- `AccountSwitcher.tsx`: 022, 024
- `use-leave-guard.ts`: 022, 023
- `AppShell.tsx`: 022, and 015 if it adds a banner
- `README.md` and `docs/build-26.75-evidence.md`: 026, 027, 028

**Truly independent of W1** (no shared files, no contract coupling):
- 019 (`store/reviews.rs`, `domain.rs`)
- 020 (`store/rulebooks.rs`, `store/attempts.rs`, `db/rulebook_tests.rs`, `seed.rs`)
- 022 (`use-leave-guard.ts`, `AccountSwitcher.tsx`, `AppShell.tsx`)
- 026 (docs)
- the TASK-034 code change (`db/upgrade_tests.rs`)

This corrects 07 §E: W2 does not need W1 merged first.

**Persistence:**
- No V1 task needs a migration, so B2-1 (the rollback validating at `latest_version`) does not block V1.
- Archive v1, the `data.json` format and the `legal-acceptance.json` format are unchanged.
- `legal.rs:54-57` accepts `1.0.1-owner-only`, and acceptance re-prompts by design.
- Downgrade compatibility of cleanup markers is the one open persistence issue (G8).

**Wire contract:**
- Each contract change lands once per task, in serial order: 013 (`detail`) → 016 (`Code` and the preview field) → 017 (reuses both) → 027 (`producerVersion`).
- B2-2 (risk fingerprint) is not affected: no task changes the `trades::list` or `ledger::list` shapes.
- No Rust command request signature changes.
- 021 reuses `accountFreshnessKey`, which is already invalidated after mutations (`features/accounts/hooks/freshness.ts:43-46`).
- 024's `uncertain-outcome` category is separate from the runtime-status categories in 015 and 018.

## 5. Implementation waves (smallest useful units)

Each line is one PR-sized change and one approval unit.

- **→** a serial merge.
- **∥** may proceed in parallel *as separate sessions or branches*. Planning launches no agents or concurrent edits.
- "Ready" means the card is Ready for Approval at r2, with no Block 3 correction.

| Wave | Units (in order) | Card state | Prerequisites | Can run alongside |
|---|---|---|---|---|
| **W0-D** owner decisions | 001, 002, 003, 005, 006, 009 (each its own decision); 007 and 008 after correction G10/G5 | 001–006, 009 Ready; 007 and 008 need correction | None | Everything |
| **W0-Doc** | 004 | Ready | 003 decided | W1, W2 |
| **W0-M** measurements | 010 (any OS, disposable); 011 (Windows VM) | 010 Ready; 011 needs correction G14 | 010: approval to fetch dependencies (runbook §4). 011: a Windows VM. | W1, W2 |
| **W1a** archive integrity | 012 | **Ready** | None | 019, 020, 022 |
| **W1b** size caps | 013 → 014 | 013 needs G3/G10; 014 Ready but blocked by 013 | 012 merged; 010 result informs priority | W2 |
| **W1c** cleanup and attachments | 015 → 016 → 017 | All need correction (G8, G11, G12) | 014 merged | W2 |
| **W1d** startup reparse | 018 | Needs correction (G11, G14) | 017 merged; 011(b) result | W2 |
| **W1-opt** | 019 | **Ready** | None | All |
| **W2a** trading day | 020 → 021 | 020 **Ready**; 021 needs G10 | 021 needs 020 merged | W1 |
| **W2b** navigation | 022 → 023 | 022 **Ready**; 023 needs G10/G14 | 023 needs 022 merged and 011(a) | W1 |
| **W2c** wording | 024 | Ready | 021 and 022 merged (merge hygiene in `LifecycleDialogs.tsx` and `AccountSwitcher.tsx`) | W1 |
| **W3a** docs | 026 → 025 → 028 | 026 and 025 Ready; 028 needs G2/G10 | 025: TASK-001 and 006 decided, plus Kyle's v1.1 texts and the id decision. 026: TASK-006 decided. | W1, W2 |
| **W3b** release process | 027 | Needs correction (G4, G13) | 005 and 006 decided; merge after W1's fixture edits (017) | — |
| **W3c** test safety | 034 code part (moved before the candidate, per G7) | Needs correction | 008 keeps the gate | Any |
| **W4** candidate | 029 | Needs correction (G5, G14) | All of W1 to W3 Verified; 001, 002, 005, 006 decided | — |
| **W5** Windows gates | 030, 031, 032, 033; owner run of 034 | All need correction (G6, G8, G9) | 029 recorded | Each other (separate VMs) |
| **W6** | 035 → 036 | Ready | W5 complete or each gate state recorded | — |

**Safety-critical before polish.** W1 (data safety) and W2a/W2b (correctness, data loss on navigation) come before W2c (wording) and before W3 docs. W3a can run alongside because it has no code coupling.

**Regression tests the implementation sessions must add.** These are specified in the cards and summarised here.

| Task | Test |
|---|---|
| 012 | Four crafted archives are rejected, including a planted `writable_schema` object. Archives with `sqlite_sequence` or `sqlite_stat1` still round-trip. A previous-version safety copy still rolls back (Nit). |
| 013 | A journal with more than 64 MiB of free pages exports and previews (after G3). The over-cap detail names the component. |
| 014 | Over-cap previews work. Changing only a rowid changes the token. The wire fixture stays byte-identical. |
| 015 | A zero-byte marker or a non-regular entry still reaches Ready, at both startup and `prepare_restore`. An older build ignores the quarantine folder, or downgrade is declared unsupported (G8). |
| 016 | A stray file and a `.part` file are preserved in the safety folder. Rollback semantics are stated (G12). |
| 017 | A missing screenshot does not block restore or erase. Rollback works with a missing list from the old format (G12). |
| 018 | `cfg(windows)` junction tests in the `ci.yml` `cargo test` step. |
| 019 | A 29-digit price returns `risk: None` or a validation error, with no panic. |
| 020 | A Saturday reset is rejected. The existing tests and the seed are edited deliberately. |
| 021 | Fake-clock checks at the reset boundary and at weekends. Fails closed when freshness is unavailable. |
| 022 | With the real HashRouter, the editor never unmounts. |
| 023 | The close veto registers only while dirty. |
| 024 | Uncertain and definite failures get different wording. |

## 6. Exit gates between waves (summary)

The full detail is in runbook §5.

| After | Must hold before dependants start |
|---|---|
| Every Fix/Test PR | Every standard check is green and run serially (runbook §3); new tests fail before the fix and pass after; any fixture diff is limited to the fields the card names and was reviewed; every acceptance criterion has evidence in `11-remediation-execution-log.md`; the PR was reviewed and merged by Kyle |
| W1b, W1c | Persistence compatibility: old-version markers, archives and in-flight restore recover. Downgrade behaviour is either tested or declared unsupported. |
| W1d, W2b (023) | Windows evidence recorded: SHA, EXE SHA-256 when packaged, Windows build, WebView2 version, tester, date. jsdom or mock results do not count. |
| W3 | Notices check (`check:notices`) and `Cargo.lock` diff check if versions or dependencies changed; TASK-027 observed in Actions |
| W4 | Candidate recorded: a `ci.yml` push or dispatch run on the exact SHA (not a PR merge commit) whose advisory log says "no blocking advisories." with no "NOT RUN"; EXE SHA-256 from `SHA256SUMS.txt` (not the ZIP digest) |
| W5 | Each gate state is Passed, Failed, Not Run or Blocked, decided by its card's pass rule (after G9) |
| W6 | Evidence register complete. Then Kyle's P0-18 decision. |

## 7. Readiness reassessment (Stage 1 definitions)

**Owner-only V1 readiness: Not Ready.** This is unchanged from 05, and planning completion does not alter it.

| Gate | State |
|---|---|
| ISSUE-039 owner-only v1.1 notices | Not Run (implementation work pending, TASK-025) |
| ISSUE-040 candidate from the final SHA | Not Run (no valid candidate: `7679edc` lacks LegalGate; PR run `39730672821` at `b94fb1b` predates `92e7980`; neither is acceptance) |
| ISSUE-041 clean smoke, ISSUE-043 offline | Not Run (checklist stale, TASK-028) |
| ISSUE-042 upgrade/reinstall/downgrade/uninstall | Not Run |
| ISSUE-044 recovery, ISSUE-045 accessibility, ISSUE-046 window/DPI | Not Run |
| ISSUE-047 cohort, ISSUE-048 P0-09, ISSUE-055 P0-10, ISSUE-056 D5, ISSUE-057 0BSD | Owner decision pending |
| ISSUE-049 NA-7 | Not Run (draft stale) |
| ISSUE-050 advisory result, ISSUE-051 CI on the candidate | Not Run for a candidate. The 05 CI run `39735646149` was not read. |
| ISSUE-052 real-journal-copy upgrade, ISSUE-053 `cargo fmt` | Owner decision pending (keep or waive) |
| ISSUE-054 P0-18 | Not Run. Kyle only. |
| ISSUE-058 | Decided 2026-10-21 (unsigned, manual updates, currentUser, bootstrapper) |

**Evidence classes:**
- **Dated docs evidence:** `docs/build-26.75-evidence.md:103-111`, artifact `7679edc`, historical. **Mock/jsdom:** the Vitest journeys and axe suites, which `ci.yml:45-46` labels "not packaged-app runs". **Current Windows artifact evidence for `92e7980`:** none.
- **No P0 code defect is confirmed.** Readiness is blocked by unrun mandatory gates and pending owner decisions, plus the open P1 defects.
