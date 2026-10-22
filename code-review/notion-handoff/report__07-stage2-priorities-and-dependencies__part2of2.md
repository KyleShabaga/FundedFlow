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
