## 8. Recommended corrections, in order

These are a basis for Stage 2 planning only; nothing was implemented.

1. **Recovery availability (DATA-001, DATA-002, DATA-003):**
   - make the cleanup marker atomic and non-blocking;
   - quarantine bad markers;
   - preserve stray attachment files instead of rejecting them;
   - tolerate and report missing screenshots in restore and export;
   - give each case a distinct message.

   This is one small, cohesive change set in `data_controls`.
2. **Size caps (DATA-004):** stream-hash the live tokens, measure used pages, and make the limit error name the component.
3. **Input loss and duplication (DATA-008, DATA-006, DATA-007):**
   - a native close-requested veto;
   - request IDs for creates;
   - disable writes during long operations;
   - align the commit deadline with the preview's.
4. **P2 polish:**
   - DATA-005: a panic guard;
   - DATA-009, DATA-010, DATA-011, DATA-012 (prune and ignore non-UUID entries), DATA-013.
5. **P3 / informational:** DATA-014 to DATA-019; record the owner's decision on DATA-020.

## 9. Missing regression tests

Tests that do exist are listed in the §7 evidence and in the lane notes; for example `runtime/tests.rs` has 14 and `data_controls/tests.rs` has 21. Tests that do not exist:

| Missing test | For |
|---|---|
| A malformed, empty, oversized or non-regular cleanup marker at startup | DATA-001 |
| A locked file in the cleanup list | DATA-001 |
| A pending marker with an unknown phase, or a missing op dir | DATA-001 |
| A stray `screenshots/<uuid>.png` or `.part` file blocking restore and erase | DATA-002 |
| A crash between rename and commit; a failed `remove_file` after a failed commit | DATA-002 |
| A missing or changed live screenshot during export, restore and erase | DATA-003 |
| A live journal over 64 MiB of pages (incl. free pages), and the `data.json` and total caps | DATA-004 |
| A panic on the init path → Retry still works | DATA-005 |
| A create retried with the same request ID | DATA-006 |
| The commit deadline is at least the preview deadline; writes are disabled during data-control operations | DATA-007 |
| A dirty form vetoes native close (component); a manual title-bar close on Windows | DATA-008 |
| Editing a daily review during a pending save | DATA-009 |
| A second failure after a retry, with message accuracy | DATA-010 |
| Partial-backup cleanup on disk full | DATA-011 |
| A failed prepare leaves no op dir; a non-UUID entry under `data-controls/` | DATA-012 |
| A stale-token retry records no misleading `failed` batch | DATA-013 |
| A crash after install and before `committed` | DATA-014 |
| A rollback failure | DATA-014 |
| A row-count preservation check for every table across all migrations, `risk_promotions` included | DATA-016 |
| A newer journal in WAL mode | DATA-019 |

## 10. Reconciliation register (carried forward from Phase 1 §12; Phase 2 delta)

The scope snapshot in `00-repository-discovery.md` §12.1 still applies. Notion was not refreshed.

| Prior ID / source | Claimed state | Phase 2 evidence (HEAD 4fee79e = source 92e7980) | Verification | Remaining |
|---|---|---|---|---|
| P0-01 to P0-04 (Final Push V1, 2026-10-22) | Merged | P0-02 risk promotion is in an IMMEDIATE transaction (`store/risk_promotion.rs:341`), append-only (migration 21). P0-04 CSV limits and identity are enforced in `csv_import` (`parse.rs:8-9`, `dedup.rs:40-61`). Commit atomicity and preview binding are verified (§3). | Partially Confirmed (source; tests not run) | Phase 5 runs the tests. P0-01 and P0-03 are not examined in this phase. |
| Build 26.5–26.7 recovery reliability (`docs/architecture/build-26.5-26.7-recovery-reliability.md`) | Implemented; packaged acceptance pending | The runtime state machine, failure categories and retry behaviour match the docs. New gaps: DATA-001 and DATA-005. | Partially Confirmed | Manual recovery acceptance on Windows (open gate) |
| Builds 24–25 data controls (`docs/handoffs/build-24-*.md`) | Implemented | Export, restore and deletion are implemented and well guarded. Availability gaps: DATA-001 to DATA-004 and DATA-012. `docs/data-model.md:362` still says permanent delete is "Not implemented" (R-26; stale doc). | Partially Confirmed | Stage 2 to fix; Phase 6 to record the doc drift |
| P0-13 / NA-3 owner-only notice v1.1 | Open | Unchanged. The legal record's persistence is sound and correctly outside journal export, restore and erase. | Confirmed open | Integrate the v1.1 text (not authorized here) |
| Manual recovery / offline acceptance | Open (unrun gate) | Source supports recovery. DATA-001 and DATA-008 must be part of the manual checklist: a bad marker, and title-bar close with unsaved text. | Unrun gate | Phase 5 gate register |
| Other open baseline items (candidate installer, accessibility, cohort, P0-09, NA-7, P0-18, P0-10, D5, 0BSD, P0-05) | Open or owner disposition | Not in Phase 2 scope; unchanged | — | As in Phase 1 §12.2 |

**Separation of categories:**

| Category | Items |
|---|---|
| Confirmed defects | DATA-001, -002, -003, -004, -005 (latent), -010, -011, -012, -013, -014 |
| Partially confirmed or hypotheses | DATA-006, -007, -008 (WebView2 close behaviour), -009, -015, -017, -018, -019 |
| Latent or design | DATA-016 |
| Owner decision | DATA-020; whether disclosed retention of deleted-account data in recovery copies (DATA-012) is acceptable |
| Unrun gates | Windows manual recovery; title-bar close check; uninstall data-retention check |
| Deferred | None added |
| Escalation | **None required.** No evidence was found of a serious loss of committed data or a security issue. |

**Preliminary risk mapping** (from Phase 1):

| Phase 1 risk | Outcome in Phase 2 |
|---|---|
| R-02 | DATA-002 |
| R-03 | DATA-017 (Low, Unverified as a loss path) |
| R-04 | Not an issue |
| R-05 | DATA-001 |
| R-06 | DATA-011, DATA-012 |
| R-07 | DATA-004 |
| R-09 | DATA-018; shutdown itself is safe |
| R-10 | DATA-005 |
| R-11 | DATA-006 |
| R-12 | DATA-007 |
| R-13 | Code confirmed but fails safe (lane 3 C3); left to Phase 4 |
| R-14 | Partly DATA-007 |
| R-18 | DATA-008 / DATA-009 (stale-draft overwrite is warned and consented: not an issue) |
| R-28 | DATA-016 |
| R-01 | Phase 3 (data view: DATA-007) |
| R-08 | Phase 3 |

## 11. Checks, verification limits and remaining uncertainties

### Commands executed

All commands are read-only and offline, run from the repository root unless stated.

| Command | Result |
|---|---|
| `git branch --show-current`; `git rev-parse HEAD`; `git status --porcelain -uall`; `git diff --stat 92e7980 HEAD -- . ':!code-review'` | Exit 0. Branch `claude/practical-turing-wmii06`, HEAD `4fee79e`, clean tree, no source diff. |
| `echo ${FUNDEDFLOW_UPDATE_FIXTURES-unset}` | `unset` |
| `ls ~/.cargo/registry`, `apps/desktop/src-tauri/target`, `node_modules` | All absent |
| `sed -n`, `grep -rn` over `apps/desktop/src-tauri/src` and `apps/desktop/src` (run from `apps/desktop/src-tauri` and the root) | Exit 0 |

### Skipped checks

- `cargo test --offline --locked` (in `apps/desktop/src-tauri`): **skipped**. There is no Cargo registry cache or vendored dependencies; fetching crates would need the network, which is not authorized.
- `npm test`: **skipped**. There is no `node_modules`; `npm ci` would download.
- No isolated disposable-data experiments were possible without the toolchain dependencies.

All findings are therefore **source-traced, not executed**. Confirmed means the execution path was read in code.

### Platform

Linux. No NTFS, WebView2 or `%APPDATA%` behaviour was observed. The following stay **Unverified** until Windows evidence exists (Phase 5):

- Windows rename, persist and replace semantics;
- the effect of antivirus and indexer locks;
- `beforeunload` on a title-bar close (DATA-008).

### Remaining uncertainties

- Whether real journals reach the caps in DATA-004, and how fast.
- Whether a 50k-row import commit exceeds 30 s on typical hardware (DATA-007).
- Whether the bundled SQLite fsyncs `VACUUM INTO` output before migration commits (L1, Low confidence).
- What the NSIS uninstall "Delete the application data" option removes.
- Store modules not individually traced: `catalogue`, `authoring`, `offers` and `evidence` internals beyond their transaction pattern, `snapshots` / `freshness` / `insights` (read-only paths). Lane 3 covered their write pattern by sampling.

## 12. Agent assignments and lead verification

| Lane | Scope | Returned | Lead re-verification |
|---|---|---|---|
| L1 SQLite lifecycle | db, steps, migrations, runtime, store transaction sampling, settings | Yes | `db/mod.rs:145-286`, `runtime.rs:138-175, 255-362`, `commands.rs:500-515` read in full. DATA-005 and DATA-010 confirmed; DATA-001 (L1 F2) confirmed. |
| L2 Files, archive, restore | attachments, data_controls/*, legal | Yes | `attachments.rs:190-300`, `restore.rs:115-140, 160-349`, `archive.rs:66-95, 138-173`, `deletion.rs:128-136, 200-220, 284-295, 318-345`, `filesystem.rs:116-150` read. DATA-001 to DATA-004 confirmed; R-04 confirmed not an issue. |
| L3 Import, store, frontend | csv_import, store write paths, frontend submissions and drafts, settings | Yes | `csv_import/mod.rs:608-624` read (DATA-013). Grep confirmed no `onCloseRequested`/`CloseRequested` and no request-ID fields (DATA-006, DATA-008). |

There were no conflicts between lanes. L1 F2 and L2 F3 were merged into DATA-001, and L1 F8 and L2 F7 into DATA-014.
