| Field | Value |
|---|---|
| Review date | 2026-10-22 |
| Scope status | **Complete** (static review). The checks lane is **Blocked**: no tests or builds can run offline (§9). |
| Repository root | `/home/user/FundedFlow` |
| Branch / HEAD | `claude/practical-turing-wmii06` at `feb00e204a434686c305f463f9d21650cd11010c` |
| Source drift | None. The only change since `92e7980` is in `code-review/`: the Phase 2 report, committed in `feb00e2` at the session stop hook's request (an exception to the prompt's no-commit rule). |
| Working tree at start | Clean |
| Input reports | `00-repository-discovery.md` and `coverage-matrix.md` at `4fee79e`; `01-data-integrity-audit.md` at `feb00e2`. All are current. |
| Host / tools | Linux x86_64 container (not Windows, not WSL). Node 22.22.0, cargo 1.97.0, Python 3.13.16. No Cargo registry cache and no `node_modules`. |
| Instruction files | `CLAUDE.md` only. No conflict. |
| Agents | The lead plus three read-only specialists, all of which returned:<br />**L1**, IPC contracts. It ran two throwaway cross-check scripts from the session scratchpad, which read repository files only.<br />**L2**, Rust reliability and native safety.<br />**L3**, configuration, security, the dev/release boundary and the collector.<br />The lead re-verified every Medium-severity finding and the main security claims (§10). |
| Note | The user sent the Phase 4 prompt while Phase 3 was still running. Phase 3 was finished and saved first. |

---

## 1. Executive summary

The Tauri surface is small and well configured:

- one local window;
- no remote IPC;
- only the dialog plugin;
- no shell, fs, http or opener plugin;
- a strict CSP with IPC-only `connect-src` and no `unsafe-eval`;
- no HTML sinks, external links, or network code in the app;
- a per-user NSIS installer that needs no elevation;
- debug commands correctly excluded from release builds by `cfg(debug_assertions)`.

The TypeScript↔Rust contract is consistent. The lane 1 cross-check found:

- all 108 commands have callers;
- every argument key maps to its Rust parameter;
- all request structs use `deny_unknown_fields`;
- every response is parsed with Zod;
- money is decimal text on the wire and instants carry milliseconds and `Z`.

No Critical or High finding was established, and no P0 blocker.

The most important findings are:

1. **TR-001 (Medium):** the restore archive schema check can be bypassed by naming an object `sqlite` followed by any character, because the SQL `LIKE` filter treats `_` as a wildcard. A tampered backup could then plant hidden triggers in the live journal.
2. **TR-002 (Medium):** an unchecked `Decimal` subtraction on review planned entry and stop. Extreme values are committed first, then every later read of that review and of the account's Insights panics.
3. **TR-006 (Medium):** full-size screenshots travel as base64 JSON on every thumbnail read, while the single DB mutex is held.

The rest are Low or Informational, many of them defence in depth.

## 2. Tauri architecture assessment

| Area | Evidence | Assessment |
|---|---|---|
| Initialization | `src-tauri/src/lib.rs:172-209`: dialog plugin; setup manages `LegalStore` and `Runtime`, then spawns an init thread | Sound. Init failure is non-fatal except a panic on the init thread (DATA-005). |
| Command registration | `lib.rs:29-163`: 108 release commands; 5 dev commands under `cfg(debug_assertions)`; module `cfg(any(debug_assertions,test))` | Correct. A release build has no dev commands. TR-012 is a missing release check. |
| Capabilities | `capabilities/default.json`: window `main`; `core:default`, `core:window:allow-close`, `dialog:allow-open`, `dialog:allow-save`; no `remote` | Good. `allow-close` is needed for Decline (`lib/data/legal.ts:30-31`). `core:default` is wider than needed (TR-013). |
| Plugins | Only `tauri-plugin-dialog` 2.8.3. `tauri-plugin-fs` is a transitive crate only, not registered, so picked paths gain no fs scope. | Good |
| CSP | `tauri.conf.json:24-27`: `script-src 'self'`; `style-src 'unsafe-inline'`; `img-src 'self' data:`; `connect-src ipc: http://ipc.localhost`; `object-src 'none'`; `frame-ancestors 'none'`. `withGlobalTauri`, `dangerousDisableAssetCspModification` and `freezePrototype` are not set. | Strong. The `devCsp` relaxations apply to dev only. |
| Window | One window, `dragDropEnabled:false`, minimum 800×480 | Good |
| Lifecycle handlers | No `RunEvent`, `on_window_event` or `on_navigation`; no Rust event listeners (grep) | Acceptable for data (DATA-017). It does mean there is no native close veto (DATA-008). |
| Bundle | NSIS `currentUser`; `downloadBootstrapper` (installer-time network); no updater; no `externalBin` | Appropriate for owner use. The privacy wording is in TR-014. |
| Release profile | `Cargo.toml:42-48`: LTO, strip, unwinding panics; no `debug-assertions` override | Correct |

## 3. Findings

### 3.1 Summary table

| ID | Severity | Priority | Location | Finding | Verification | Confidence |
|---|---|---|---|---|---|---|
| TR-001 | Medium | P1 | `src-tauri/src/data_controls/archive.rs:466` (also `:77`); `restore.rs:71-75, 114-119` | Restore schema comparison and dump exclude `name NOT LIKE 'sqlite_%'`, where `_` matches any character, so objects such as `sqlitex_t` are invisible to validation | Confirmed (code; SQLite `LIKE` semantics) | High |
| TR-002 | Medium | P1 | `store/reviews.rs:527-532` (via `get` `:633`, `save` `:505-507`); `store/insights.rs:220` | `(entry - stop).abs()` panics on `Decimal` overflow after the review save commits, so every later `get_trade_review` / `get_insights_dataset` for that account panics | Confirmed | High (mechanism); Low (trigger realism, except through an archive) |
| TR-003 | Low | P2 | `domain.rs:410`; `validate_trade` has no price sign/magnitude check | Trade P&L `exit - entry` panics on overflow (manual trade, generic CSV); nothing persists | Confirmed | High |
| TR-004 | Low | P2 | All `async` commands; `runtime.rs:389-400` | No `catch_unwind`. A panicking command probably never answers the invoke, so the UI waits 30 s and then shows "uncertain" | Unverified (hypothesis) | Medium |
| TR-005 | Low | P2 | `commands.rs` (all `async fn` with blocking `with`) | Blocking SQLite and filesystem work on tokio workers without `spawn_blocking`. Status polling (sync, main thread) stays responsive. | Confirmed (design). **Canonical: DATA-007.** | High |
| TR-006 | Medium | P2 | `store/attachments.rs:70-77, 338-369`; `features/journal/components/Screenshots.tsx:17-28, 126-133` | Every screenshot card reads the full file as base64 JSON (up to 20 × 10 MB, about 280 MB), hashing under the DB mutex within a 10 s read deadline | Confirmed mechanism; impact Unverified | High / Medium |
| TR-007 | Low | P2 | `data_controls/mod.rs:107-153`; `archive.rs:223-229, 329-331, 552-558`; `restore.rs:13-34, 71` | Export destinations and inspect/restore sources are free strings from the webview. Not bound to the dialog; UNC accepted; the data directory is not excluded; `inspect` acts as an existence oracle. | Confirmed (defence in depth) | High (code), Low (exploitability) |
| TR-008 | Low | P2 | `lib/data/tauri-repository.ts:113-114`; `features/shared/errors.ts:28,35`; `lib/data/data-controls.ts:48-53` | Tauri or serde argument errors, which are plain strings, are mapped to `database`. On a write that becomes an uncertain lock although nothing ran. | Confirmed (latent) | High |
| TR-009 | Low | P2 | `runtime.rs:225-239` vs `apps/desktop/src/lib/data/runtime.ts:62` | `prepare_restore` sets Failed but leaves `created=true` after a first-run journal creation, which the TS status schema rejects as an invalid response | Confirmed | High |
| TR-010 | Low | P3 | `apps/desktop/src/lib/data/freshness.ts:20` | Freshness bypasses the repository adapter: `unavailable` shows as "unexpected", and one bad row fails every account | Confirmed (R-14) | High |
| TR-011 | Low | P3 | `features/shared/wire-contract.test.ts:31-55`; `src-tauri/src/wire_contract.rs` | No test binds TS argument keys to Rust parameter names. No Rust-generated output fixture covers TradeDetail, TradeReview, Library, screenshots, CsvPreview, ApplicableRulebook, catalogue, freshness, ResetResult, DeletedTrade, RuntimeStatus or LegalAcceptance. | Confirmed (test gap) | High |
| TR-012 | Low | P3 | `.github/workflows/release-installer.yml:73-86` | Nothing checks that the release binary lacks the dev command names. The frontend `dist` check exists. | Confirmed (hardening) | High |
| TR-013 | Informational | P3 | `capabilities/default.json` | `core:default` grants path, event, menu, tray, image and webview defaults the app doesn't use; `freezePrototype` is off | Unverified against the generated schema (git-ignored) | Medium |
| TR-014 | Informational | P2 (owner wording) | `apps/desktop/src/legal/index.ts:12-14` vs `tauri.conf.json` `downloadBootstrapper`; `privacy-notice.ts:32` already discloses it | The first-run summary says "no internet connection", but the installer may download WebView2 | Confirmed (R-23; Phase 5 owns packaging) | High |
| TR-015 | Low | P3 | `csv_import/dedup.rs:156` | `at[..10]` byte slice panics if a stored timestamp has non-ASCII bytes (reachable only through a crafted archive) | Confirmed | High (mechanism) |
| TR-016 | Low | P3 | `archive.rs:346-347` | The zip central directory is parsed before the entry-count cap. A crafted archive of up to 258 MiB with millions of entries might allocate heavily (allocation failure aborts the process). | Unverified | Low |
| TR-017 | Informational | P3 | `store/authoring.rs:136-240`; `rulebook.rs:374-436`; `legal.rs:94-122` | Catalogue and rulebook draft collections have no count or length caps. `record_legal_acceptance` fsyncs on the main thread. | Confirmed | High |
| TR-018 | Low | P3 | `apps/desktop/src/features/data-controls/api/data-controls.ts:67-73` | A Zod failure after an irreversible delete or restore succeeded is shown as "couldn't be completed" rather than "check state". The account-scope deletion preview is not fixture-pinned. | Confirmed | Medium |
| TR-019 | Low (collector, secondary) | P3 | `tools/prop-firm-collector/src/fundedflow_collector/render/browser.py:66-79, 113-128` | The Playwright render path does not block WebSockets or non-80/443 ports. Possible LAN reach from page JavaScript. The `httpx` path is fully guarded. | Unverified (hypothesis) | Low-Medium |
| TR-020 | Informational (owner) | Owner decision | `test_csvimport/Performance*.csv` | The fixtures may be real trade exports (fill IDs) in a source-available repository. Two are unreferenced. | Unverified (R-19) | Low |

### 3.2 Details for the significant findings

#### TR-001: restore schema check bypass through a `LIKE` wildcard

**Evidence:**
- `archive.rs:466`: `SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'`. The same filter appears in `dump` (`:77`).
- In SQLite `LIKE`, `_` matches any single character and matching ignores case. SQLite reserves only the literal `sqlite_` prefix, so `CREATE TRIGGER sqlitex_t …` or `CREATE TABLE SQLITE1(…)` is legal and is excluded from the comparison with the reference schema.

**Trace:**
1. `inspect_to` → `validate_database` (read-only, `trusted_schema=OFF`, lead-verified at `archive.rs:201-208, 476-487`). The comparison passes, and `integrity_check` and `foreign_key_check` don't see triggers.
2. Restore `inspect` then calls `db::open_file` → migrate on the staged copy (`restore.rs:71-75`).
3. `prepare` copies, migrates and re-validates with the same filter (`:114-119`), then installs `candidate.db` as the live journal.
4. The live connection does not set `trusted_schema=OFF` (`db/mod.rs:152-157`). A trigger fires whatever that setting is.

**Trigger:** the owner restores a tampered or crafted archive (manifest hashes are unauthenticated, and the UI says so).

**Impact:** persistent hidden SQL in the journal. It could silently alter P&L or ledger rows on insert, delete data, or abort writes, and it is carried into every later export.

**Safeguards:** schema comparison (bypassed), the plaintext/unauthenticated warning, and no `load_extension`. No code execution is possible.

**Fix:**
- Filter exact internal names (`NOT IN ('sqlite_sequence','sqlite_stat1','sqlite_stat4')`) or escape the underscore (`NOT LIKE 'sqlite\_%' ESCAPE '\'`).
- Reject non-table `sqlite_*` objects.
- Apply the same filter in `dump`.
- Set `trusted_schema=OFF` in `db::configure`.

**Regression test:** extend `data_controls/security_tests.rs:157-175` (it currently uses the name `evil`) with `CREATE TRIGGER sqlitex_evil`, `CREATE TABLE SQLITE1` and `CREATE VIEW sqliteA`, and expect `Integrity`.

**Priority rationale:** P1 because it defeats an explicit safety control on the only restore path and the fix is a one-line filter. It is not P0: it needs a tampered archive, and the owner normally restores their own exports.

#### TR-002: review planned entry and stop overflow bricks the review and Insights reads

**Evidence (lead-verified):**
- `store/reviews.rs:527-532`: `risk_from_plan` computes `(entry - stop).abs().checked_mul(...)`. The subtraction uses the panicking `Sub` operator; only the multiplications are checked.
- `decimal_text` → `domain::parse_decimal` (`domain.rs:135-147`) accepts any sign and any magnitude up to about 7.9e28.
- `save` commits (`reviews.rs:505-506`), then calls `get` → `derived_risk` (`:633`).
- `store/insights.rs:220` uses the same function.

**Trigger:** a planned entry of `79228162514264337593543950335` and a stop of `-79228162514264337593543950335`, on a trade whose instrument is quoted in the account currency, with no entered risk. This can come from the UI (the regex at `ReviewCard.tsx:256` allows it) or from a restored archive.

**Impact:**
- The save commits, then panics.
- Every later `get_trade_review` for that trade, and `get_insights_dataset` for the account, panics (see TR-004 for what the UI then sees).
- There is no UI way to repair it, because the review can't be loaded to edit.

**Fix:** use `entry.checked_sub(stop)` and return `None` on overflow. Bound or validate price fields in `decimal_text` for planned prices.

**Test:** save with these values, then assert that `get` returns `risk: None` (or the save is rejected) and that the insights dataset loads.

**Priority rationale:** severity is Medium because the damage persists; the likelihood is very low for hand-entered values. P1 because the fix is a one-liner and it removes a persistent read panic.

#### TR-006: screenshot reads move full images as base64 under the mutex

**Evidence:**
- `read` (`attachments.rs:338-369`) reads the file, re-hashes it, sniffs the MIME type and returns `data_base64` inside `db.with`.
- `Screenshots.tsx:126-133` calls `useScreenshot` for every card and builds a `data:` URL.

**Impact:**
- With large screenshots, every card holds the connection while reading and hashing (compounds DATA-007).
- The data crosses IPC as JSON, then is copied 3–4 times in the webview.
- Thumbnails can hit the 10 s read deadline.

**Fix:**
- Copy the key and size out under the lock, then hash outside it.
- Return raw bytes (`tauri::ipc::Response`) rendered with `Blob`/`createObjectURL`, or add a thumbnail command.
- Lazy-load visible cards only.

**Test:** a component test that only opened or visible cards invoke `read_trade_screenshot`, and a Rust check that the lock is not held while hashing.

#### TR-007: unbound filesystem paths from the webview

**Evidence:** the request structs carry `String` paths (`data_controls/mod.rs:107-122`, `restore.rs:13-34`). Rust never checks that a path came from the dialog.

**What the checks do and don't cover:**
- Export requires an existing parent directory, then writes through `persist_noclobber`, so it creates new files and never overwrites.
- Symlink and reparse components are rejected.
- The hard-link check runs on unix only (`filesystem.rs:79-85`).
- `relative()`, which rejects `:` and `\`, is applied to archive entry names and storage keys, not to destination or source paths.
- UNC paths reach SMB.
- A destination inside `attachments/` or `data-controls/` creates a stray entry, which triggers DATA-002 or DATA-012.
- `inspect` returns different error codes for "missing", "directory", "too large" and "not a zip", which makes it an existence oracle.

**Exploitability:** needs a compromised renderer or a user mistake. The strict CSP and the absence of HTML sinks make renderer compromise unlikely.

**Fix:**
- Reject destinations and sources under the data root.
- Reject UNC, `\\?\` and device prefixes.
- Reject `:` after the drive letter.
- Require the expected extension.
- Return one generic code for inspect pre-checks.
- Optionally keep a Rust-side allow-list of dialog-returned paths.

**Test:** path-validator unit tests.

#### TR-008: plain-string Tauri argument errors become uncertain writes

**Evidence:** `tauri-repository.ts:110-115` falls back to `{kind:"database", message:String(e)}`, which `normalizeError(write=true)` maps to `uncertain-outcome` (`errors.ts:28`).

**Trigger:** contract drift, such as a missing required key or `deny_unknown_fields`.

**Impact:** a false uncertain lock on a write that never executed. Unlikely today, because Zod validates inputs first.

**Fix:** treat `typeof e === "string"` rejections as a distinct "not executed / contract" kind.

**Test:** mock `invoke` rejecting with `"invalid args …"`; the write must not be uncertain.

#### TR-009: a staged restore after first-run creation produces an invalid status

**Evidence (lead-verified):**
- `prepare_restore` sets `state=Failed`, `stage=Open` and an `OpenFailed` failure, but does not reset `status.created` (`runtime.rs:234-237`).
- `initialize` sets `created=true` when it created the journal (`:310`).
- `runtime.ts:62` rejects a failed status with `created` set.

**Trigger:** a new PC: the app creates a journal, then the owner restores a backup in the same session.

**Impact:**
- "The local runtime returned an invalid response" instead of the staged-restore message.
- `installStagedRestore` still retries, so the install usually completes.
- If the dialog is closed first, the state stays invalid until restart.

**Fix:** set `created=false` in `prepare_restore` (or use a shared failed-state helper).

**Test:** a runtime test: fresh path → initialize → `prepare_restore` → `!created`.

## 4. Rust correctness and reliability

**Panic audit.** Lane 2 traced each prior R-10 site; all are guarded or unreachable:

- `catalogue.rs:25`: enum-only.
- `domain.rs:373-379`: issue-gated.
- `csv_import/mod.rs:292-293, 388`.
- `values.rs` slices (ASCII boundaries).
- `daily_reviews.rs:893, 1111, 1139`.
- `rulebooks.rs:414, 782`.
- `accounts.rs:135-136`.
- `snapshots.rs:397`.
- `reconciliation.rs:239`.
- `authoring.rs:159`.
- `attachments.rs` `sniff`.
- `filesystem.rs:52`.
- `archive.rs:483`.

The reachable panics are TR-002, TR-003 and TR-015, plus DATA-005 on init.

**Errors and propagation.**
- `?` is used throughout. No silent success (consistent with Phase 2).
- `AppError` uses `#[serde(tag="kind")]`, which matches `appErrorSchema` exactly.
- Data-control errors are fixed strings, and `From` impls drop the source.

**Shared state and locks.**
- Lock order is always `conn → status` or `conn → ownership`. No inversion.
- No std mutex is held across an `.await`.
- Poisoned locks are recovered.
- `with()` returns `Unavailable` when a queued command finds `conn=None`, for example after `prepare_restore`.

**Blocking.** TR-005 / DATA-007.
- Sync commands (`runtime_status`, `retry_runtime`, legal) run on the main thread and take only the short-held status lock. Status polling and the recovery UI stay responsive.
- `record_legal_acceptance` fsyncs on the main thread (TR-017). One small file: brief jank at most.

**Resources.**
- TempDir and NamedTempFile are dropped on error paths, after connections close.
- Failed Windows removals are ignored (residual copies: DATA-012, DATA-018).
- No leaked handles. The ownership lock is held by design.

**Command execution and logging.**
- `std::process::Command` appears only in debug-only `dev_tools/reset.rs` (args without a shell) and a test.
- No `println!` or logging of user data in shipping code.
- No hardcoded secrets (lane 3 grep over tracked files).

## 5. IPC contract analysis

| Aspect | Result | Evidence |
|---|---|---|
| Command coverage | 108/108 release commands have TS callers. No unregistered invoke. Dev names are reachable only in DEV. | `lib.rs:31-139`; `tauri-repository.ts:124-302`; `data-controls.ts:58-95`; `runtime.ts:126`; `freshness.ts:20`; `legal.ts:21,28`; `app/dev-tools/api.ts:115-119` |
| Argument key mapping | Every key matches its parameter after camelCase→snake_case (scripted cross-check plus manual review). No `rename_all` on commands. | e.g. `includeArchived`→`include_archived` (`commands.rs:39`) |
| Request serde | 114 `deny_unknown_fields` across the request/input/query structs. TS inputs are strict or stripping. | L1 §2 |
| Omitted vs null | The only distinction is `CsvExportRequest.account_id` (`explicit_nullable`, `data_controls/mod.rs:121,172-176`); TS always sends it (`contracts/data-controls.ts:66`; test `data_controls/tests.rs:795-802`). Updates are full-replace, and callers send every field. | Correct |
| Responses | All Zod-parsed, with no `passthrough`. A Zod failure on a write becomes an uncertain outcome. | `operations.ts:26-31` |
| Money / time / duration | No `f64` in DTOs (only the dev seeder). Money is canonical text. Instants are `to_rfc3339_opts(Millis, true)` (`domain.rs:79-85`). Durations are numbers up to 2^53−1, digit strings above that, mirrored in `contracts/trades.ts:15-33`. Unknown is `null` or the tagged `Presence`, never `"0"`. | Sound |
| Errors | `AppError` ↔ `appErrorSchema`; `ControlError` ↔ `dataControlErrorSchema`. SQL text can appear in `Database`/`Conflict` messages, but production UI shows only category plus `safeIssueMessage` (`errors.ts:24-55`). Dev-only panels show raw messages. | Sound (TR-008 for string errors) |
| Events | No `listen`, `emit` or `Channel` in TS or Rust: all traffic is request/response | No listener leaks possible |
| Concurrency / long operations | Runtime gateway single-flight with a 10 s timeout. Reads 10 s, CSV preview 60 s, writes 30 s with a per-scope lock, data controls no deadline. No cancellation: JS timeouts only abandon the result. | DATA-007; TR-006 |
| Fixture coverage | Wire fixtures cover 16 + 12 + 4 + 11 commands plus the data controls. Gaps listed in TR-011. | — |

## 6. Permission and security assessment

| Concern | Status |
|---|---|
| Capabilities / permissions | Minimal apart from `core:default` (TR-013). No remote IPC. |
| Filesystem scope | No fs plugin. Rust owns all file access. Webview paths only for export, inspect and restore (TR-007). |
| Input validation | Text fields capped: notes 20k, journal body 100k, settings 64 KiB, CSV 10 MB / 50k rows, screenshots 10 MB × 20 with pixel caps. Catalogue and rulebook drafts uncapped (TR-017). Prices unchecked (TR-002, TR-003). |
| Path handling | Archive entries: ASCII names, no `..`, no reserved names, case-insensitive de-duplication, Stored only, size caps (`filesystem.rs:33-67`, `archive.rs:329-464`). Storage keys: schema `CHECK` (`0001:271-272`) plus `relative()`. `read_trade_screenshot` takes ids, not paths. Safe. |
| OS command execution | None in shipping code |
| Deserialization | serde with `deny_unknown_fields`. Archive SQLite opened read-only with `trusted_schema=OFF` and schema-compared before migration, but the comparison can be bypassed (TR-001). |
| WebView security | No `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `window.open`, `target=_blank`, external hrefs or markdown rendering. Screenshot `data:` MIME types are sniffed PNG/JPEG/WebP on write and read. Fonts are bundled locally. |
| Untrusted imported content | CSV parsed in Rust with limits. Generic-CSV price overflow (TR-003). Archives (TR-001, TR-015, TR-016). |
| External URLs / network | None in the app: no reqwest/hyper usage and no TLS crates in the lockfile. Whether `reqwest` is compiled for the target is unverified. WebView2/SmartScreen and the installer bootstrapper are platform behaviour (TR-014). |
| Logs | No logging of user data |
| Secrets | None found. No workflow uses `secrets.*`. |
| Privileges | NSIS `currentUser`; no elevation |
| Dev/release boundary | Rust `cfg(debug_assertions)`; frontend `import.meta.env.DEV` plus a `dist` marker check (`apps/desktop/scripts/check-no-dev-tools.mjs`, run in `build:app` and the release workflow). Dev isolation (`dev_tools/mod.rs:83-156`) refuses the real journal without falling back. Debug spawn uses separate args with no shell. The binary itself is unchecked (TR-012). |
| Collector (secondary) | Static review only. Strong `httpx` path: GET only, `trust_env=False`, no cookies, manual redirects re-checked, DNS pinning with all addresses required public, IP-literal/port/userinfo rejection, decoded-size caps, PDF parsed in a sandboxed subprocess, `defusedxml`, robots per RFC 9309. Its database guard refuses the desktop journal. The desktop does not consume it. Its intended fetching is **not** a desktop privacy regression. Render-path hypothesis: TR-019. |

## 7. Lifecycle and concurrency

- **Startup.** The window and bridge come up immediately, while the init thread opens, locks, recovers and migrates. Failures are categorized; a panic leaves the runtime stuck (DATA-005, and TR-004 for commands).
- **Window creation.** One static window, no multi-window code. Debug "another window" runs a separate process, kept apart by the lock.
- **Background tasks.** Only the init thread, gated by `running`. The debug handoff thread exits the app.
- **Event listener cleanup.** Not applicable on the Rust side, which has no listeners. The frontend runtime focus listener is cleaned up (Phase 4).
- **Normal shutdown.** No hook. Resources are released at process exit, and committed data is safe (DATA-017). No native close veto exists for unsaved UI text (DATA-008).
- **Unexpected termination.** Covered in Phase 2 §5.
- **Multiple instances.** The `fs2` exclusive lock makes the second instance `open_failed` before it touches the database. Its UI still opens, and status shows the "already owned" failure. Correct.

## 8. Cross-module concerns

1. **Panics and uncertain writes.** A panicking command (TR-002, TR-003, TR-015) probably leaves the invoke unanswered (TR-004). The frontend then marks a 30 s uncertain outcome, which is the DATA-006/DATA-007 machinery. A Rust panic therefore surfaces to the user as a write that "may have saved". `catch_unwind` in `Runtime::with` would close the gap for every command at once.
2. **Archive trust boundary.** TR-001, TR-015 and TR-016, plus TR-002 via restore, share one root cause: archives are treated as untrusted by design, but the validation has gaps. All four fixes belong in one `data_controls` hardening change.
3. **The single connection mutex** underlies DATA-007, TR-005 and TR-006. Moving hashing outside the lock and running commands with `spawn_blocking` is a shared remedy.

