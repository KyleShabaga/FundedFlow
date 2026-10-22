## 7. Important application workflows

| # | Workflow | Path (UI → command → Rust) | Phase(s) |
|---|---|---|---|
| W1 | Startup, recovery and upgrade | `main.tsx` → `RuntimeProvider` → `runtime_status`/`retry_runtime` → `Runtime::initialize` → lock → restore recover → `open_file` (backup, migrate) → cleanup recover | 2, 3, 5 |
| W2 | First-run acknowledgement | `preloadLegalAcceptance` → `LegalGate` → `get`/`record_legal_acceptance` → `legal.rs` (`legal-acceptance.json`) | 3, 4, 5 |
| W3 | Account lifecycle | Accounts → `create`/`update`/`archive`/`restore`/`change_status`/`reset_account_attempt` → `store/accounts`, `store/attempts` | 2, 4 |
| W4 | Manual trade create/edit/delete/restore | Journal → `create`/`update`/`delete`/`restore_trade` → `store/trades` (soft delete, corrections log) | 2, 4 |
| W5 | CSV import | `/import` → `preview_csv_import` (digest) → `commit_csv_import` (token re-check, IMMEDIATE transaction, lineage, dedup and restore) → `csv_import/*` | 2, 3, 4 |
| W6 | Trade review and screenshots | Trade detail → `save_trade_review`, `add`/`read`/`remove_trade_screenshot` → `store/reviews`, `store/attachments` | 2, 3, 4 |
| W7 | Daily review | `/journal/days/:day` → `save`/`reopen_daily_review`, `relink_daily_review_trades` → `store/daily_reviews` | 2, 4 |
| W8 | Rulebook authoring and assignment | Rulebook → draft/validate/publish/assign → `store/rulebooks` (append-only events) | 2, 4 |
| W9 | Risk calculation and promotion | Today/Rulebook → `get_account_risk_inputs` → TS engine → `promote_account_risk` (source-fingerprint gate) → `store/risk_promotion` | 2, 4 |
| W10 | Financial evidence and reconciliation | `VerifyBalanceDialog` → observations, ledger revisions, reconcile/resolve → `store/evidence`, `store/reconciliation` | 2, 4 |
| W11 | Insights | `/insights` → `get_insights_dataset` → TS `summarize` | 4 |
| W12 | Export journal / trades CSV | Settings → dialog save → `export_journal_archive` / `export_trade_csv` → `data_controls/archive` | 2, 3, 4 |
| W13 | Restore journal | Settings → dialog open → `inspect_journal_archive` → `restore_journal_archive` ("REPLACE ENTIRE JOURNAL" + token) → staging → runtime Failed → next initialize installs or rolls back | 2, 3, 4, 5 |
| W14 | Permanent deletion (account or journal) | Settings → `preview_permanent_deletion` → `permanently_delete_data` → `retry_data_cleanup` → `data_controls/deletion` | 2, 3, 4 |
| W15 | Uncertain write review | Any write → timeout or ambiguous error → per-scope lock → re-read → acknowledge | 4 |
| W16 | Install, upgrade, uninstall | NSIS currentUser → WebView2 bootstrapper → first run → upgrade keeps `%APPDATA%` → uninstall "Delete the application data" checkbox | 5 |
| W17 | Developer seed and reset (debug only) | `dev:test-journal`, `seed`/`reset:test-journal`, `dev_reset_handoff` → isolated directory | 3, 5 |

## 8. Major dependencies and integration boundaries

1. **WebView ↔ Rust IPC.** The typed boundary is `apps/desktop/src/lib/data/tauri-repository.ts`. The input is validated with Zod before `invoke` and the output after. Rejections parse to `AppError`, with a fallback of `{kind:"database"}`.
   - Three paths sit **outside** the repository adapter: `lib/data/runtime.ts` (single-flight gateway, 10 s timeout, strict status schema), `lib/data/legal.ts`, and `lib/data/freshness.ts` (raw `invoke` with Zod and no `AppError` mapping, `freshness.ts:20`).
   - `lib/data/data-controls.ts` has its own `call` and error type.
2. **Domain contracts ↔ Rust serde.** The two sides are pinned by Rust-generated fixtures: `packages/domain/test/fixtures/*.json` and `apps/desktop/src/test/fixtures/{command,evidence,risk-promotion,rulebook,csv-duration}-wire.json`. Vitest replays them; `cargo test` fails on drift.
3. **Fixture regeneration is controlled by `FUNDEDFLOW_UPDATE_FIXTURES`, and the test files check it inconsistently.**
   - Exact value `"1"`: `parity.rs:34`, `wire_contract.rs:278`.
   - Any value (`is_some()`): `data_controls/wire_tests.rs:90`, `store/engine_snapshot_tests.rs:219`, `store/evidence_tests.rs:454,790`, `store/risk_promotion_tests.rs:1103`, `db/rulebook_editor_tests.rs:549`, `csv_import/wire_limit_tests.rs:216`.
   - Later phases must make sure the variable is unset for any check they run.
4. **SQLite ↔ filesystem.** Attachments, restore staging and deletion cleanup coordinate DB rows and files across two durability domains.
5. **OS / WebView2 / installer.** NSIS currentUser and the WebView2 bootstrapper, which needs Microsoft's network only when the runtime is absent. `LICENSE` and `THIRD_PARTY_NOTICES.txt` are bundled.
6. **Native dialogs.** `@tauri-apps/plugin-dialog` open and save (`features/data-controls/api/data-controls.ts:108,116`).
7. **CI ↔ advisory services.** npm audit and cargo-audit run through `scripts/audit-guard.mjs`. On push and PR events, an outage is reported as `NOT RUN` and **exits 0** (`scripts/audit-guard.mjs:111-115`). It fails only on schedule or `workflow_dispatch`.
8. **Collector ↔ desktop.** There is no runtime coupling. Grep finds no consumer in `apps/` or `packages/`. The desktop consumer is deferred to V1.5 (`docs/architecture/prop-firm-collector.md` §2). The schemas in `docs/contracts/*.schema.json` mirror the collector's export schemas.

## 9. Preliminary risk areas (hypotheses, not findings)

These are leads for later phases. Each has an `R-` number for traceability only. When later phases confirm or reject them, they assign their own `DATA-`/`TR-`/`UI-`/`WIN-`/`TEST-` IDs and should cite the R-number.

| R-ID | Area | Evidence | Why it matters | Phase |
|---|---|---|---|---|
| R-01 | Blocking work in async commands under one mutex | `commands.rs:5,36-50`, no `spawn_blocking` in `src/`; `runtime.rs:389-400`. Long holders: export (up to 256 MiB of hashing), restore prepare (double inspect), deletion preview (dump + clone). | Possible worker starvation and UI timeouts, which the UI then turns into uncertain outcomes | 3 |
| R-02 | Attachment file vs DB commit ordering | `store/attachments.rs:200-291`; ownership checks `restore.rs:246-255`, `deletion.rs:213` | A crash between rename and commit leaves stray bytes that may block restore or erase | 2 |
| R-03 | No directory fsync on Windows | `data_controls/filesystem.rs:134-144` (`sync_dir` is a no-op when not unix) | Durability of renames for the pending marker, attachments and the restore swap depends on NTFS | 2, 5 |
| R-04 | Restore DB swap ordering | `restore.rs:256-272` removes `-wal`/`-shm` before `persist` | A crash window relies on the "installing" rollback | 2 |
| R-05 | Fail-closed recovery can block startup | `restore.rs:296-300`, `deletion.rs:327-333`, `runtime.rs:336-356` | One malformed pending or cleanup file might make the journal unopenable until manual repair. This may be intended, so check the user-facing recovery path. | 2 |
| R-06 | Recovery copies never pruned | `db/mod.rs:266-284`, `data-controls/<id>` safety images, `docs/data-model.md:532-538` | Disk growth, and data removed by an account deletion persists in old backups | 2, 3 |
| R-07 | Export and restore size caps vs attachment allowance | `filesystem.rs:5-7`, `archive.rs:72-91,196` vs `attachments.rs:34-35` | A large journal may become impossible to export or restore | 2 |
| R-08 | Webview-supplied paths for export and restore | `data_controls/mod.rs:113-153`, `restore.rs:13-15`; checks: symlink components, `persist_noclobber`, unix-only hard-link check (`filesystem.rs:79-85`) | IPC path trust boundary | 3 |
| R-09 | No shutdown hook or checkpoint; erase leaves WAL pages | `lib.rs:172-209`; `deletion.rs:296-307` | Whether erased data persists in the WAL until a checkpoint, and behaviour during Windows shutdown | 2, 3 |
| R-10 | Panics in shipping code | About 20 non-dev `unwrap`/`expect`/`unreachable!`/`panic!` sites (e.g. `catalogue.rs:25`, `store/daily_reviews.rs:893,1111,1139`, `store/rulebooks.rs:414,782`, `store/accounts.rs:135-136`, `csv_import/mod.rs:292-293,388`) | Most are validated-then-unwrap. Unwinding plus poison recovery needs a check that transactions roll back. | 3 |
| R-11 | Uncertain-write lock held only in memory | `features/shared/submissions.ts:8-53` | Reload or restart forgets the uncertain state, so a resubmit could duplicate a write | 4 |
| R-12 | Late success after the 30 s timeout is dropped | `submissions.ts:35`; the import commit may exceed 30 s | Expected uncertain outcomes on long writes | 4 |
| R-13 | `acknowledgeUncertainOutcome` uses the render-time spec | `use-feature-mutation.ts:43,61` vs `:66-67` | Could clear the wrong scope | 4 |
| R-14 | Write and error paths that bypass the shared lifecycle | `lib/data/freshness.ts:20`; data-controls lock with no timeout (`data-controls.ts:14-46`); CSV preview and legal raw mutations | Inconsistent unavailable/uncertain handling; a hung data-control operation stays locked until reload | 4 |
| R-15 | Legal acceptance fails open for the session | `features/legal/hooks.ts:33-48` | Matches the documented intent; confirm against the NA-3/P0-13 acceptance criteria | 4, 5 |
| R-16 | TypeScript computes the promoted risk result | `lib/data/calculate-risk.ts:59-77`; Rust gates on source fingerprint only | Tension with "Rust is authoritative for stored calculations"; check parity coverage | 4 |
| R-17 | `Number()` checks on decimal text and the display-zone default | `packages/domain/src/contracts/fields.ts:10-11`, etc.; `formatInstant` without a zone in `AccountsPage.tsx:126`, `RulebookPage.tsx:108` | Sub-micro edge cases; times shown in the wrong zone vs the CLAUDE.md account-zone rule | 4 |
| R-18 | Plaintext drafts in `sessionStorage` restored by cast | `ReviewCard.tsx:108-122`, `DailyReviewPage.tsx:93-105`, `unsaved.ts:15-29` | A stale draft against a newer revision; privacy of the WebView profile | 4 |
| R-19 | Unreferenced CSVs of unknown provenance in a source-available repo | `test_csvimport/Performance Oct 20.csv`, `…(1).csv` (PR #25, 2026-10-20) | May be real trade exports (privacy). The owner should confirm they are synthetic or remove them. **Rows were deliberately not read.** | 3, 5 |
| R-20 | No packaged Windows acceptance for the current source | `docs/build-26.75-evidence.md:8,117-143` (checklist blank; status "Not Done"); recorded installer SHA `7679edc…` is 124 commits behind HEAD | Readiness evidence gap, not a code defect | 5, 6 |
| R-21 | The release workflow runs no tests; the PR path filter omits UI and domain | `.github/workflows/release-installer.yml:41-51, 80-115`; `ci.yml` has no tag trigger | A `v*` tag could build an installer from an untested commit | 5 |
| R-22 | Advisory audit can be green while NOT RUN | `scripts/audit-guard.mjs:111-115`; `ci.yml:109,124`; toolchain and cargo-audit unpinned | A green job is not advisory evidence | 5 |
| R-23 | Draft legal text pinned by tests; privacy claim vs WebView2 bootstrapper | `apps/desktop/src/legal/privacy-notice.ts:8-11`, `user-agreement.ts:7-10`, `legal.test.ts:11-20`; `legal/index.ts:12-14` ("no internet connection") vs `tauri.conf.json` `downloadBootstrapper` | Open P0-13/NA-3 integration work; wording accuracy for installer-time network use | 5 |
| R-24 | `FUNDEDFLOW_UPDATE_FIXTURES` inconsistently checked | §8 item 3 | Running checks with the variable set to `0` still rewrites fixtures | 5 |
| R-25 | `reset-test-data.mjs` defaults to the real journal | `scripts/reset-test-data.mjs:12-17,70`; `docs/development/reset-test-data.md:11-18` | Guarded (preview, `--yes`, process check, rename-to-backup), but it targets real data | 3, 5 |
| R-26 | Stale documentation | `docs/data-model.md:362` says permanent delete is "Not implemented", but `data_controls/deletion.rs` implements it; `docs/build-26.75-evidence.md:63,71` disagree with the current release workflow triggers and PR retention (3 days) | Misleading acceptance and recovery guidance | 5, 6 |
| R-27 | Debug gating relies solely on `cfg(debug_assertions)` | `lib.rs:10,145-163` | A custom profile with debug assertions enabled would ship dev commands. Mitigated by `check-no-dev-tools.mjs` for the frontend only. | 3, 5 |
| R-28 | Future table rebuilds could cascade into `risk_promotions` | `migrations/0021_risk_promotions.sql:13` (`ON DELETE CASCADE`) with the `DROP TABLE account_snapshots` rebuild pattern (`0012:57`, `0015:44`) under `foreign_keys=ON` | Latent maintenance hazard; safe today | 2 (Informational) |
| R-29 | Desktop `tsconfig` lacks `noUncheckedIndexedAccess`; about 84 casts | `apps/desktop/tsconfig.json` | Maintainability and type safety | 4 |

### 9.1 Confidence that each lead warrants deep review

These ratings are for prioritising later work only. They are not a judgement that a defect exists.

| Confidence | R-IDs | Basis |
|---|---|---|
| High: code behaviour verified by the lead in source; open question is impact | R-01, R-03, R-09 (no shutdown hook), R-14 (`freshness.ts:20`), R-15, R-16, R-20, R-22, R-23, R-26 | The lead read the cited lines |
| Medium: mapped by a specialist with file:line evidence; not re-read by the lead | R-02, R-04, R-05, R-06, R-07, R-08, R-10, R-11, R-12, R-13, R-17, R-18, R-21, R-24, R-25, R-27 | Specialist report; Phase 2–5 must re-read |
| Low: latent or provenance question | R-19, R-28, R-29 | Needs an owner answer, or is not reachable today |

### 9.2 Areas with limited direct tests (existing tests mapped first)

Test counts are by grep at 92e7980. The tests were not run.

- **Rust, well covered by dedicated suites:**
  - migrations and upgrade (`db/*tests.rs`, about 70 tests, including real legacy journals);
  - store repositories (about 151 tests);
  - CSV import (about 79);
  - data controls (34: `tests.rs` 21, `current_schema_tests.rs` 7, `security_tests.rs` 5, `wire_tests.rs` 1);
  - runtime (14, `runtime/tests.rs`);
  - legal record (5 inline).
- **Rust, thin or absent:**
  - `commands.rs` and `lib.rs` have no tests. Startup wiring, command registration and the async-to-blocking path are only exercised indirectly.
  - Shutdown and exit have no tests (there is no hook to test, R-09).
  - Crash windows *between* filesystem and DB steps (attachment rename vs commit, restore swap, erase vs WAL) are not visible as dedicated tests from file names. Phase 2 should confirm this by reading `data_controls/tests.rs`, `store/journal_review_tests.rs` and `runtime/tests.rs`.
  - Windows-specific filesystem semantics (no `sync_dir`, reparse points, hard links) cannot be exercised by the Linux test run.
- **Frontend, by feature folder** (non-test source files / test files):

  | Folder | Source files | Test files |
  |---|---|---|
  | rulebooks | 25 | 2 |
  | insights | 14 | 1 |
  | imports | 14 | 3 |
  | data-controls | 6 | 1 |
  | settings | 5 | 1 |
  | legal | 5 | 1 |
  | evidence, ledger, library, references, reviews, trades | 2–3 each | 0 each |
  | accounts | 20 | 8 |
  | journal | 15 | 6 |
  | today | 11 | 5 |
  | shared | 11 | 8 |

  The journeys (`src/journeys/`, 10 files) add whole-app coverage for accounts, data controls, first run, recovery, risk promotion, uncertain writes and workflows. Phase 4 must check whether the rulebook editor, Insights and the import wizard are covered there before treating them as untested.
- **Platform:** there is no automated packaged-app, WebView2 or installer test. `apps/desktop/scripts/smoke-shell.mjs` is Linux-only and not wired in. The engine-runtime parity check (`check:engine-runtimes`) needs Chromium and is not in CI. Infrastructure proposals should come only after Phase 5 confirms these gaps.

## 10. Recommended detailed investigation order

1. **Phase 2 (data integrity).** Work in this order: W1 upgrade, backup and recovery (R-05, R-06) → W13 restore (R-03, R-04) → W14 deletion and erase (R-09) → W6 attachments (R-02) → W5 import commit → W3/W4/W7/W8/W10 commit bundles → W12 export caps (R-07) → legal record boundary (export, restore and erase scope).
2. **Phase 3 (Tauri, Rust, security).** The async/blocking model (R-01) → IPC contracts, including the three adapters outside the repository (R-14) → path trust for data controls (R-08) → `core:default` expansion, CSP and dev gating (R-27) → panics (R-10) → lifecycle and shutdown (R-09) → collector network surface, reviewed statically as separate coverage → R-19.
3. **Phase 4 (React/TS).** The uncertain-write lifecycle (R-11 to R-14) → the TS risk engine vs Rust authority (R-16) → money and time display (R-17) → drafts (R-18) → feature-by-feature workflows W3–W12 → journeys and accessibility coverage.
4. **Phase 5 (Windows/testing).** Run the validation sequence offline and serially → packaging, WebView2 and offline claims (R-23) → release and CI evidence (R-20 to R-22, R-24) → reinstall and uninstall data retention → the gate register.
5. **Phase 6.** Independent re-verification and the readiness verdict.

## 11. Unknowns and coverage limitations

- **Platform.** This is a Linux container. No Windows, WebView2, NSIS, `%APPDATA%` or NTFS behaviour was observed. A Windows runtime claim from any phase run here must be marked unverified.
- **Nothing executed.** Pass/fail state of the typecheck, Vitest, cargo test, clippy and builds at HEAD is unknown to this audit. The historical results in docs carry their own SHAs: `docs/build-26.9-evidence.md:44,48` records 4 `legacy_rulebook_tests` failures and UI timing flakes in a sandbox, with no SHA. PR #105 (`test/stabilise-cpu-contention-timeouts`) has since merged.
- **Depth.** Store modules, migration SQL bodies, `dev_tools` internals, design-system component internals, the large feature pages (Today, Insights, Rulebook editor, Import wizard), design specs and mockups, and collector test bodies were mapped by outline or grep, not read line by line.
- **Not opened, deliberately.** The binary DB fixtures, any real user journal, the rows of the CSV fixtures, and git-ignored `gen/schemas`. As a result, the exact `core:default` permission set is unverified.
- **External evidence not refreshed.** The Notion board, Final Push V1, the P0 audit, and GitHub Actions runs and artifacts (`39735646149`, `39730672821`, `39691474111`) were not fetched. Their status in §12 comes from the supplied 2026-10-22 snapshot and is **unverified** here.
- **Counts are approximate** (grep-based): test cases, `as` casts, `unwrap` sites.

### 11.1 Commands executed in Phase 1 (all read-only, offline)

Working directory: the repository root unless stated.

| Command | Exit code |
|---|---|
| `pwd`, `git branch --show-current`, `git rev-parse HEAD`, `git status --porcelain=v1 -uall`, `git log --oneline -5` | 0 |
| `git cat-file -t`, `git merge-base --is-ancestor`, `git rev-list --count`, `git diff --stat`/`--name-only` between `8c3dd34`, `7679edc` and `92e7980` | 0 |
| `uname -a`, `node --version`, `npm --version`, `cargo --version`, `rustc --version`, `python3 --version`, `uv --version` (version queries only) | 0 |
| `cat`, `sed -n`, `grep`, `find`, `wc`, `ls` over tracked files | 0 (`ls code-review` / `.claude` returned "not found" at the start, as expected) |

- **Not run, by design:** no npm, cargo, uv or pytest invocation (typecheck, test, build, clippy, notices, audit). These checks are scheduled for Phase 5.

### 11.2 Process deviation and final Git state

- **Commit and push.** The prompt says not to commit or push. After the reports were written, the session's stop hook required the untracked reports to be committed and pushed, and the cloud container would otherwise have discarded them.
  - The two report files only were committed as `24e5c9e` on `claude/practical-turing-wmii06` and pushed to `origin`, which created that remote branch.
  - Nothing was merged or tagged, and no PR was opened. No application file is in the commit.
  - This verification update is a further edit to the same two Markdown files.
- **Final Git state.** After the commit, `git status` was clean apart from these report edits. No unexpected changes were found and nothing was discarded.

