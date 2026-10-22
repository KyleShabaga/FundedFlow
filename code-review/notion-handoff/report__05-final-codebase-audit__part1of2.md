| Field | Value |
|---|---|
| Review date | 2026-10-22 |
| Audit completeness | **Complete for source review. Partial for executed validation.** Every relevant area was reviewed statically. Only the dependency-free script checks were executed (§C). |
| Release-readiness verdict | **Not Ready** for Kyle's owner-only V1. Mandatory acceptance criteria are demonstrably unmet, and packaged behaviour has **Insufficient Evidence** (§L). **No confirmed P0 code defect.** |
| Repository root | `/home/user/FundedFlow` |
| Branch / HEAD | `claude/practical-turing-wmii06` at `7ca8c7fc4f8f97d97a76f84e827a43c8829d1948` |
| Source drift | None. `git diff 92e7980..HEAD` touches only `code-review/`. The application source equals the handoff snapshot `92e7980`. `8c3dd34` is 116 commits older (00 §0). |
| Report commits | Each phase's reports were committed and pushed at the session stop hook's request, contrary to the prompt's no-commit rule: `24e5c9e`, `4fee79e` (P1), `feb00e2` (P2), `aad865f` (P3/P4), `7ca8c7f` (P5). Only Markdown in `code-review/` was committed. |
| Input reports | `00` (4fee79e), `01` (feb00e2), `02` and `03` (aad865f), `04` and `coverage-matrix` (7ca8c7f). All current. |
| Host | Linux x86_64 container, bash. **Not Windows and not WSL.** Node 22.22.0, npm 10.9.4, cargo/rustc 1.97.0, uv 0.11.32. No `node_modules`, Cargo registry or collector venv. |
| Instruction files | `CLAUDE.md` only. No conflicts. |
| Phase 6 agents | Lead plus one adversarial verifier. The verifier read source only, did not read prior reports, and was asked to refute 13 high-impact claims. It returned, and its corrections are adopted below (§E). The lead re-checked its new claims: `store/evidence.rs:314` stores the trades list in the calculation inputs, the only `VACUUM` in non-test code is `VACUUM INTO`, and `rederive_account` reaches the overflow path. |

---

## A. Executive summary

**Health.** FundedFlow is a carefully engineered local-first desktop app. **Committed journal data is well protected:**

- every write path commits in one SQLite transaction or not at all;
- each migration commits together with its version bump, and a backup is taken before any upgrade;
- a journal from a newer schema is refused untouched;
- a second app instance cannot open the journal;
- restore stages a safety copy and rolls back idempotently;
- CSV import is atomic, bound to the reviewed preview, and safe against duplicates;
- a failed save never appears successful.

The Tauri surface is minimal:

- one window, dialog plugin only;
- strict CSP;
- no network code, no shell, no HTML sinks;
- debug commands excluded from release builds.

The TS↔Rust contract is consistent: all 108 commands have matching argument keys, money is exact decimal text, and unknown values are never coerced to zero.

**No Critical or High finding survived verification, and there is no confirmed P0 code defect.**

**Major risks.** In order of real-world weight for one owner on their own PC:

1. **Recovery availability (fail-closed with no repair path).** These checks protect data but can lock the owner out of the journal, export, restore or erase:
   - a malformed deletion-cleanup marker blocks every start (DATA-001);
   - a stray or missing screenshot file blocks restore, erase or export (DATA-002, DATA-003);
   - **size caps on the live journal** block export, restore-over, erase and account deletion (DATA-004). This is more reachable than first rated: each saved risk calculation stores a full copy of the account's trades, and nothing ever vacuums the database;
   - any reparse point in the data-folder path blocks startup on Windows (WIN-001).
2. **Archive trust.** A tampered backup can plant hidden triggers by naming them `sqlite`+any character (TR-001).
3. **Trading-day correctness in the UI.** Several screens use the calendar date instead of the Rust trading day, so they show the wrong rulebook "in use" after the reset or at weekends. Risk then falls back to Unknown; no wrong verdict was found (UI-001, UI-009, UI-010).
4. **Edges where user input is lost or duplicated:**
   - unsaved text on window close or back navigation (DATA-008, UI-005);
   - duplicate creates after an uncertain save followed by a restart (DATA-006, DATA-007);
   - uncertain outcomes shown as definite failures or with no review path (UI-003, UI-004).

**Readiness.** **Not Ready.**

- The owner-only legal notices (P0-13/NA-3) are not integrated: the source still ships `0.1.0-draft`.
- No installer has been built from current source.
- No clean Windows smoke test, manual recovery, accessibility, offline or window-matrix gate has been run.
- Several owner dispositions are unrecorded (P0-09, P0-10, D5, 0BSD, P0-05).

These are evidence and decision gaps more than code defects. The audit verdict **does not stand in for the owner's P0-18 go/no-go**.

## B. Architecture summary

- **Workspaces:**
  - `apps/desktop`: React 19 + TanStack Query UI, plus the Rust Tauri host in `src-tauri`.
  - `packages/domain`: Zod contracts, bigint money, the `JournalRepository` port, the TS risk engine and Insights.
  - `tools/prop-firm-collector`: a separate Python tool; the desktop does not consume it.
- **Frontend.** `main.tsx` mounts the error boundary, `HashRouter`, React Query, `RuntimeProvider` (the single runtime state machine) and the toast provider. `LegalGate` wraps everything, and `RuntimeGate` wraps each data route. Reads use `useFeatureQuery` (10 s). Writes use `useFeatureMutation`/`Submissions`: a per-scope lock, a 30 s deadline, and uncertain-outcome review.
- **IPC.** `lib/data/tauri-repository.ts` validates with Zod in both directions over 108 release commands. Runtime, legal, freshness and data-controls have small dedicated gateways.
- **Rust.**
  - `lib.rs` starts the runtime on a background thread.
  - `runtime.rs` owns one `Mutex<Option<Connection>>` and an `fs2` exclusive lock.
  - `commands.rs` are thin async wrappers.
  - `store/*` holds the repositories, `csv_import/*` the import pipeline and `data_controls/*` export, restore and deletion.
  - `db/` holds 21 migrations (SQL plus Rust steps 5, 7, 10, 16) with pre-upgrade `VACUUM INTO` backups.
- **Local data footprint** (all under `%APPDATA%\com.fundedflow.desktop`):

  | File or folder | Contents |
  |---|---|
  | `fundedflow.db` (+WAL/SHM) | The journal |
  | `attachments/screenshots/` | Screenshot files |
  | `fundedflow.db.before-vN[.previous-<uuid>].bak` | Pre-upgrade backups |
  | `data-controls/<uuid>/`, `data-controls-pending.json`, `data-controls-work/`, `data-controls-cleanup/` | Restore and deletion staging and queues |
  | `fundedflow.lock` | Single-instance lock |
  | `legal-acceptance.json` | Install/config acceptance record, separate from journal data |

  Two other stores sit outside this folder:
  - WebView storage: a sidebar flag in `localStorage`, and draft text in `sessionStorage`.
  - Exports go to wherever the owner chooses.

## C. Audit coverage

**Reviewed areas** (final statuses in `coverage-matrix.md`):

- **Inspected:** all Rust modules (runtime, db/migrations, store write paths, csv_import, data_controls, legal, commands, lib, dev_tools); configuration and capabilities; the IPC adapters; the frontend shell, shared hooks and every feature folder; the design-system formatters; domain contracts, money and Insights; CI and release workflows; repository scripts; evidence docs.
- **Partially inspected:** the TS engine's full rule algorithms (`packages/domain/src/engine/evaluate.ts`; boundaries and provenance only); store modules for catalogue, authoring, offers and evidence internals (write pattern sampled); design-system component internals; screen specs beyond the seven read; collector tests and GUI.
- **Excluded:** generated and dependency output (`node_modules`, `dist`, `target`, `gen/schemas`); the real user journal; binary fixtures; CSV fixture rows.

**End-to-end workflow tracing:**

| Workflow | Traced through |
|---|---|
| Startup and recovery (W1) | Source |
| First run (W2) | Source |
| Journal features (W3–W11) | UI → IPC → store |
| Export, restore, delete (W12–W14) | Native level, plus UI |
| Uncertain writes (W15) | Source |
| Install, upgrade, uninstall (W16) | Configuration and docs only; **no packaged run** |

**Checks executed** (repo root, `FUNDEDFLOW_UPDATE_FIXTURES` unset, Phase 5 at `aad865f` = source `92e7980`):

| Command | Result |
|---|---|
| `npm run check:boundaries -w @fundedflow/domain` | OK, exit 0 |
| `npm run test:dev-scripts` | 20/20 pass |
| `npm run test:ci-scripts` | 8/8 pass |
| `npm run test:notices` | 10/10 pass |

npm's update notifier may have contacted the registry once; the repository scripts made no network requests.

**Blocked (dependencies would need installing, which is not authorized):**
- `npm run typecheck`, `npm test` (including journeys and axe), `npm run build`, `npm run check:dist`
- `cargo test --offline --locked`, `cargo clippy`
- `npm run check:engine-runtimes`, `npm run check:notices`
- npm audit, cargo audit
- collector ruff, mypy, pytest

**Not authorized:** building, installing or launching an installer; upgrading a copy of the real journal.

**Test claims backed by execution:**
- Only the four script checks above.
- The handoff states that CI run 39735646149 at `92e7980` is green. That is **not verified** here (logs not read), and its advisory audit may have been NOT RUN.
- Every historical evidence doc is 4–338 commits stale (04 §6).

**Limitations:**
- Linux only.
- Notion not refreshed.
- No CI logs or artifacts read.
- WebView2, NSIS, NTFS, OneDrive, DPI and Defender behaviour unverified.

## D. Consolidated findings table

Canonical entries list their source IDs. Verification reflects Phase 6's lead and independent checks.

| ID | Severity | Priority | Category | Location | Finding | Verification |
|---|---|---|---|---|---|---|
| F-01 (DATA-001) | Medium | P1 | Recovery / startup | `src-tauri/src/runtime.rs:336-356`; `data_controls/deletion.rs:287-291, 321-386`; `filesystem.rs:116-130` | Non-atomic deletion-cleanup marker; any `recover_cleanup` error, including truncated JSON, blocks every journal open. No quarantine, and the message doesn't name the file. | Confirmed (lead + verifier) |
| F-02 (DATA-004) | Medium | **P1** | Recovery / capacity | `data_controls/archive.rs:72-91, 239, 271`; `deletion.rs:133`; `restore.rs:57-78`; `store/evidence.rs:314`; `db/mod.rs:152-157` | Caps on the **live** journal (≥64 MiB of pages including free pages, >500k rows) block export, restore-over, erase **and account deletion**. Growth is realistic: each calculation stores the account's full trade list; there is no auto-vacuum or VACUUM. | Confirmed; likelihood raised in Phase 6 |
| F-03 (DATA-002) | Medium | P1 | Recovery | `store/attachments.rs:199-291`; `restore.rs:127-132, 242-255`; `deletion.rs:211-213` | A stray file under `attachments/` (crash between rename and commit, or a leftover `.part`) blocks restore prepare and erase, with a misleading message and no sweep | Confirmed |
| F-04 (DATA-003) | Medium | P1 | Recovery | `archive.rs:141-173` | Any attachment row, including soft-deleted ones, whose file is missing or changed blocks export, restore prepare and erase. No repair path. | Confirmed |
| F-05 (TR-001) | Medium | P1 | Security / integrity | `archive.rs:77, 466`; `restore.rs:74-75, 114-119` | Archive validation ignores objects named `sqlite`+any character (LIKE `_` wildcard). A tampered archive can install hidden triggers that alter or drop journal data. | Confirmed. Fix must use an exact allow-list; escaping alone is insufficient (`writable_schema`). |
| F-06 (WIN-001) | Medium | P1 | Windows / startup | `data_controls/filesystem.rs:89-109`; `data_controls/mod.rs:155-168`; `runtime.rs:330-335, 130` | Any reparse point in any ancestor of the data root (junctioned profile or `C:\Users`, redirected Roaming, mount point, possibly Sandbox; also the drive-relative `C:` quirk) permanently blocks the journal, with a misleading "retryable" message | Confirmed in code; how common the trigger is on Windows is Unverified |
| F-07 (UI-001; with UI-009, UI-010) | Medium | P1 | Correctness | `apps/desktop/src/features/accounts/setup.ts:32-35`; `rulebooks/components/CalculationExplanation.tsx:54-55`; `accounts/components/LifecycleDialogs.tsx:282-293`; `src-tauri/src/store/rulebooks.rs:785-835` | TS uses the calendar day instead of the Rust trading day (reset and weekend roll). Effects: wrong "in use" rulebook; risk claims from the wrong version, so Unknown (fails closed); a false "not today" badge; a weekend `effectiveFrom` can be stored, because Rust doesn't enforce Mon–Fri. | Confirmed (impact: Unknown, not a wrong verdict) |
| F-08 (TR-002; with TR-003) | Medium | P1 | Reliability | `store/reviews.rs:527-532, 505-507, 633`; `store/insights.rs:220`; `domain.rs:410`; `store/trades.rs:625-670` | Unchecked `Decimal` subtraction. Review planned prices (about 29 digits) are committed, then every read of that review and of Insights panics. Trade P&L panics on create, on CSV import, **and in `rederive_account`**, which can block an account currency change. Realistic mainly through a crafted archive. | Confirmed |
| F-09 (DATA-008; with UI-005) | Medium | P1 | State / input loss | `features/shared/hooks/use-leave-guard.ts:20-48`; no `onCloseRequested` | The leave guard covers only anchor clicks and `beforeunload`. Native close, back/forward and `navigate()` calls discard unsaved review, daily-review and rulebook text. Drafts don't survive a restart. | Confirmed in code; WebView2 close behaviour Unverified |
| F-10 (DATA-006; with DATA-007, TR-005) | Medium | P1 | State / duplication | `store/trades.rs:261`; `store/ledger.rs:185`; `features/shared/submissions.ts:4, 47-52`; `runtime.rs:242-250, 389-400` | Creates have no idempotency key, and the uncertain lock lives only in memory. A single mutex held through long operations, plus a fixed 30 s deadline, turns unrelated writes uncertain. After a restart, re-entering an item duplicates a trade or ledger entry. | Partially Confirmed (timing not measured) |
| F-11 (UI-003; with UI-004, UI-011) | Medium | P2 | State / UX | `features/accounts/components/AccountSwitcher.tsx:42-45`; `LifecycleDialogs.tsx:160-192`; `TradeLogView.tsx:146`; `DailyReviewPage.tsx:353-360` | An uncertain setting write locks the key for the session with no review path (active-account switch blocked, false "wasn't changed"). Archive, restore and trade-restore report uncertain as failed. The daily review acknowledges before re-reading. | Confirmed |
| F-12 (UI-002) | Medium | P1 (owner decision) | Governance | `lib/data/calculate-risk.ts:66-77`; `store/risk_promotion.rs:1-15`; `store/snapshots.rs:407-458`; `docs/handoffs/build-16.md:11, 83` | Stored risk verdicts and figures come from the TS engine. Rust checks freshness and consistency, not correctness. This is documented in code and the handoff, but CLAUDE.md and `packages.md` still say Rust is authoritative. Only arithmetic has Rust parity, not verdict logic. | Partially Confirmed (deliberate design; documentation and parity gap) |
| F-13 (TR-006) | Medium | P2 | Performance | `store/attachments.rs:70-77, 338-369`; `features/journal/components/Screenshots.tsx:126-133` | Each screenshot card fetches the full image as base64 JSON while the DB mutex is held (up to about 280 MB per trade) | Confirmed mechanism; impact Unverified |
| F-14 (UI-008) | Medium | P2 | Performance | `features/today/hooks/today.ts:49-76`; `accounts/components/presentation.tsx:71-90` | About 10 IPC reads per account on Today and Accounts, re-keyed every minute | Confirmed |
| F-15 (DATA-005; with TR-004) | Medium | P2 | Reliability | `runtime.rs:260-324`; `commands.rs:500-513`; all async commands | A panic during init leaves `running` set, so Retry never re-runs init until restart. Panicking commands probably never answer the call, so the UI waits 30 s and shows "uncertain". There is no `catch_unwind`. | Confirmed mechanism; Low likelihood |
| F-16 (TR-007; with WIN-002) | Low | P2 | Security / Windows | `data_controls/mod.rs:107-153`; `archive.rs:223, 330-331, 552`; `restore.rs:13-34` | Export and restore paths are free strings, not bound to the dialog. UNC paths are allowed and the data dir is not excluded (strays trigger F-03). The same ancestor reparse check may refuse OneDrive or junctioned Documents folders. | Confirmed (OneDrive case Unverified) |
| F-17 (TR-009) | Low | P2 | IPC | `runtime.rs:225-239`; `apps/desktop/src/lib/data/runtime.ts:62` | `prepare_restore` keeps `created=true`. A restore on a new PC briefly yields an invalid runtime status. Self-heals on retry. | Confirmed (transient) |
| F-18 (TR-008; with TR-010, TR-018) | Low | P2 | IPC errors | `lib/data/tauri-repository.ts:113-114`; `lib/data/freshness.ts:20`; `features/data-controls/api/data-controls.ts:67-73` | String (contract) errors become uncertain writes. Freshness bypasses the error mapping. A Zod failure after an irreversible data control is reported as plain failure. | Confirmed |
| F-19 (DATA-010, DATA-011, DATA-012, DATA-014) | Low | P2 | Recovery hygiene | `runtime.rs:145-164`; `db/mod.rs:271-284`; `restore.rs:83, 108-150, 314-343`; `deletion.rs:93-131` | Retry message names the wrong backup. Partial backups left behind. Recovery copies never pruned (they keep deleted-account data; non-UUID entries block deletion previews). Silent rollback of an interrupted restore. | Confirmed |
| F-20 (DATA-013) | Low | P2 | Import history | `csv_import/mod.rs:608-623` | A refused or retried commit records a misleading "failed" batch | Confirmed |
| F-21 (WIN-003; with WIN-004, WIN-005) | Medium | P1 (documentation before use) | Packaging | `docs/build-26.75-evidence.md:51-54`; `tauri.conf.json:4, 54-57`; `README.md:7-11, 79` | The uninstall "Delete application data" option removes screenshots and every backup, which the docs don't say. The fixed 0.1.0 version can't distinguish candidates (a downgrade gives NewerSchema). The installer needs the network when WebView2 is missing. | Confirmed (config/docs); NSIS behaviour Unverified |
| F-22 (WIN-006; with TEST-001, WIN-008) | Medium | P1 (process) | Release | `.github/workflows/release-installer.yml:6-21, 41-85` | The release build runs no tests and isn't gated on CI. The PR filter omits the frontend, domain and notices. Toolchains are unpinned and unlogged. | Confirmed |
| F-23 (TEST-005) | Medium | P2 | Test / Windows | `filesystem.rs:80-86, 134-144`; `dev_tools/tests.rs:422, 433`; `data_controls/tests.rs:784` | Windows filesystem safety is weaker than on Unix (no hard-link refusal, no directory flush) and untested on Windows | Confirmed |
| F-24 (UI-006, UI-007, UI-019, TR-011) | Medium | P2 | Test fidelity | `test/app-store.ts`; `features/*/test-store.ts`; `test/boundaries.ts`; `journeys/accessibility.test.tsx:31-61`; `src-tauri/src/wire_contract.rs` | No production test for trade delete/undo/restore. Journey fakes are looser than Rust and bypass the adapter. Wire fixtures miss review, library, screenshot, CSV-preview and more. Axe misses several screens. | Confirmed |
| F-25 (UI-013, UI-014, UI-015, UI-018) | Low | P3 | Correctness (minor) | `design-system/format.ts:227-241`; `journal-model.ts:137-152`; `packages/domain/src/contracts/fields.ts:10-11`; `journal/components/presentation.tsx:76-82` | Ambiguous DST time resolved silently. Journal and Insights profit factors round differently. `Number()` sign refines disagree with micro-unit validation. Time-zone abbreviation taken from "now". | Confirmed |
| F-26 (UI-016, UI-017, UI-012) | Low | P3 | State (minor) | see 03 §2 | Inconsistent invalidation; stale-token UX; import button not disabled during recheck; locks survive restore; legal-gate hang or re-show on read failure | Confirmed / Unverified (UI-016) |
| F-27 (TR-012, TR-013, TR-014, TR-017) | Low/Info | P2–P3 | Hardening | `release-installer.yml`; `capabilities/default.json`; `apps/desktop/src/legal/index.ts:12-14` | No release-binary dev-name check. `core:default` broader than needed. First-run summary says "no internet" while the installer may download. Uncapped draft sizes; legal fsync on the main thread. | Confirmed (TR-013 unverified against schema) |
| F-28 (TR-015, TR-016) | Low | P3 | Archive hardening | `csv_import/dedup.rs:156`; `archive.rs:346-347` | Byte-slice panic on a non-ASCII stored timestamp; zip central directory parsed before the entry cap | Confirmed / Unverified |
| F-29 (DATA-015, DATA-016, DATA-017, DATA-018, DATA-019) | Low/Info | P3 | Hardening | see 01 §4.1 | Last-writer-wins updates. Latent cascade for future `account_snapshots` rebuilds. WAL `NORMAL` / unasserted mode / no Windows directory flush. Erase leaves the WAL un-checkpointed and temp copies behind. Newer WAL sidecars. | Confirmed / Unverified as marked |
| F-30 (WIN-009 to WIN-012, TEST-004, TEST-009, TEST-010, TEST-011) | Low/Info | P2–P3 | Windows / CI | see 04 §7 | DPI fit; antivirus rename retries; roaming/network profiles; second-instance window; advisory NOT RUN passes; inconsistent fixture flag; CI gaps (fmt, engine-runtimes, `--locked`); stale historical counts | Confirmed / Unverified as marked |
| F-31 (TR-019) | Low | P3 (secondary) | Collector | `tools/prop-firm-collector/src/fundedflow_collector/render/browser.py:66-79, 113-128` | Playwright render path may allow WebSockets or non-standard ports to the LAN. The httpx path is guarded. Not a desktop issue. | Unverified |
| O-01 | — | Owner decision | Scope | DATA-020; TSD-008 (03 §5); TR-020; UI-020; TEST-008 | (a) Identical rows without IDs collapse into one trade. (b) Blank manual fees are stored as 0. (c) The test CSVs may be real exports. (d) There is no ledger-entry UI, though calculation settings ask about ledger completeness. (e) P0-09, P0-10, D5, 0BSD (in use by tslib) and P0-05 have no recorded disposition. | — |

**Gate items (not code defects):** WIN-007, TEST-002, TEST-003, TEST-006 and TEST-007 are in §L.

**Dismissed or already resolved:**

| Item | Outcome |
|---|---|
| R-04 (restore removes the WAL before the rename) | Not an issue: the `installing` rollback covers it |
| R-13 (acknowledge uses the render-time spec) | Not a bug |
| R-15 (legal fail-open on save) | By design and tested |
| Phase 1 R-28 (cascade into risk promotions) | Latent only (F-29) |
| Pre-#75 `legacy_rulebook_tests` failures | Superseded by `ee52ec9`. No re-run is recorded, but CI at `92e7980` is reported green. |

**Contradictions resolved:**

- **UI-002 vs CLAUDE.md:** the code and handoff document a deliberate design. The documentation conflict is the defect.
- **UI-001 impact:** fails closed to Unknown. It does not produce a wrong verdict.
- **TR-001 fix:** escaping the `_` alone is insufficient; an exact allow-list is required.
- **TEST-001 commit count:** Phase 5's lead correction applies: `b94fb1b` is 14 commits behind `92e7980`, not 18.

## E. Detailed verified findings

Full detail is in the phase reports: 01 §4.2, 02 §3.2, 03 §3 and 04 §7. Phase 6 changes and confirmations:

- **F-02 / DATA-004: likelihood raised.**
  - `store/evidence.rs:314` assembles risk inputs with `"trades": trades::list(tx, account_id)`. The engine payload, including `input`, is stored in `account_snapshots.explanation` and re-hashed by `validate_engine_payload`, so every calculation keeps a full copy of the account's trades.
  - The only `VACUUM` in non-test code is `VACUUM INTO` for the backup (`db/mod.rs:283`). There is no auto-vacuum, so `page_count` (which counts free pages) never shrinks.
  - The 64 MiB live cap is therefore reachable in ordinary use, and once reached, **export (the only backup), restore-over, erase and account deletion all fail** with a generic `LimitExceeded`.
  - Correction:
    1. Stream-hash the live side instead of calling `dump` for preview tokens.
    2. Measure used pages.
    3. Name the component that is over the limit.
    4. Consider not freezing the whole trade list per calculation, which needs a design decision tied to F-12.
  - Tests: a journal with more than 64 MiB of free pages; a journal with many calculations.
- **F-05 / TR-001: fix strengthened.** The verifier confirmed that SQLite only reserves the exact `sqlite_` prefix, that no other check catches a hidden trigger, and that the trigger can fire during the candidate migration. Correction:
  1. Allow only known internal objects by exact name (`sqlite_sequence`, `sqlite_stat1/4`, `sqlite_autoindex_*` with NULL sql); reject every other `sqlite%` name.
  2. Apply the same rule in `dump`.
  3. Set `trusted_schema=OFF` on the live connection.

  Test: archives containing `sqlitex_evil`, `SQLITE1`, `sqliteA`, and a `writable_schema`-planted `sqlite_x` trigger, all rejected.
- **F-08 / TR-002 and TR-003: scope widened.** `rederive_account` (`store/trades.rs:625-670`, called from `accounts.rs:322`) recomputes P&L for trades stored as `reported` or `currency_mismatch`. Changing an account's currency so it matches the instrument can therefore hit the overflow, and that settings change can never be saved. Correction: `checked_sub` at `domain.rs:410` and `reviews.rs:530`, plus range validation for prices at write time.
- **F-06 / WIN-001: confirmed with a quirk.** The first component checked is the bare `C:`, which is drive-relative, so the process's current directory on C: is what gets inspected. Correction:
  1. Trust the OS-resolved app data prefix.
  2. Check only the app-owned subtree.
  3. Reject only symlink, junction and mount-point reparse tags.
  4. Give "unsafe directory" its own wording, separate from "already owned".
- **F-01, F-03, F-04, F-09, F-15 and F-17** were re-confirmed by the verifier, with the triggers and impacts as stated.
- **F-07 / UI-001:** severity kept at Medium P1. It shows wrong information on Today and the rulebook screens during every evening and weekend session, and leaves risk stuck at Unknown. It fails safe.
- **F-12 / UI-002:** reclassified as a governance and documentation gap with missing verdict-logic parity. It is not a policy violation hidden in the code.

## F. Data integrity assessment

| Area | Assessment |
|---|---|
| Committed data | **Strongly protected.** Single-transaction commit bundles, verified by failure-injection tests (`store/tests.rs`, `csv_import/tests.rs`, `db/upgrade_tests.rs`). No silent success. |
| Crash and power loss | WAL with `synchronous=NORMAL`: the last commits may be lost, but there is no corruption. Restore and deletion are crash-safe by design. |
| Recovery availability | The main weakness: F-01 to F-04, F-06, F-19 |
| Migrations | Sound: per-step transactions, original backup retained across retries, newer schema refused. Real v3/v4/v8 journals are tested. Latent cascade hazard for future rebuilds (F-29). |
| Backup and restore | Pre-upgrade backup appropriate. Restore well engineered (token, re-inspection, safety copy, idempotent rollback). Gaps: TR-001, size caps, strays. No extra backup infrastructure is warranted; make export robust (F-02, F-04). |
| Legal record | Atomic, and correctly outside export, restore and erase |
| User input at the edges | F-09, F-10 |

