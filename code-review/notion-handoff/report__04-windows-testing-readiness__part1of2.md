| Field | Value |
|---|---|
| Review date | 2026-10-22 |
| Scope status | **Partial** on execution and **Complete** on static review. Four repository checks ran and passed. The main checks are **Blocked**: typecheck, Vitest, build, `check:dist`, `cargo test`, clippy and the collector all need dependencies that would have to be installed (§5). |
| Repository root | `/home/user/FundedFlow` |
| Branch / HEAD | `claude/practical-turing-wmii06` at `aad865fae8bbec089ca01a382004a4ded383c51b` |
| Source drift | None. Only `code-review/` changed since `92e7980`: Phase 3 and 4 reports committed as `aad865f` at the session stop hook's request. |
| Working tree at start | Clean |
| Input reports | `00` (4fee79e); `01` (feb00e2); `02`, `03` and `coverage-matrix` (aad865f). All current. |
| Host / tools | Linux x86_64 container, bash, **not Windows or WSL**. Node v22.22.0, npm 10.9.4, cargo/rustc 1.97.0 with clippy, uv 0.11.32, Python 3.13.16. Playwright Chromium exists at `/opt/pw-browsers`, but no browser check was run. Present: an npm cache (`~/.npm/_cacache`). Absent: `node_modules`, a Cargo registry or vendored crates, the collector `.venv`, any `dist/` or `target/`. |
| Instruction files | `CLAUDE.md`; no conflict |
| Agents | Lead plus two read-only specialists, both returned. **L1**: Windows compatibility and packaging. **L2**: tests, CI, evidence and the gate register. The lead re-verified WIN-001, the installer provenance claims and the stale checklist step (§11). |
| **No Windows behaviour was validated.** | Every Windows statement below is either traced in code or config, or marked Unverified. |

---

## 1. Summary

**What is sound:**

- The packaging configuration is coherent:
  - NSIS, per-user install, no elevation;
  - stable identifier `com.fundedflow.desktop`;
  - bundled LICENSE and third-party notices, and all listed icons are present;
  - no updater; unsigned (an owner decision).
- After installation the app needs no network: the CSP allows IPC only and there is no network code.

**What is missing is evidence:**

- No installer built from current source has been smoke-tested on any Windows machine.
- The recorded installer, `7679edc`, is 128 commits old and predates both the first-run legal gate and the bundled notices.
- The newer PR artifact `b94fb1b` is 14 commits behind `main` and is missing source changes made since.
- The owner-only legal text is not integrated.
- Every manual gate is **Not Run**: smoke, recovery, accessibility, window and DPI matrix, offline, cohort and upgrade.

**One new Windows-only code risk:**

- **WIN-001.** Any reparse point anywhere in the data-folder path (`C:\` → … → `%APPDATA%\com.fundedflow.desktop`) permanently blocks the journal from opening. The message wrongly blames another app copy or a sync tool.

**Preliminary readiness:** **Insufficient Evidence**, with confirmed open mandatory gates. These are a missing candidate artifact, an unrun clean smoke and P0-13/NA-3 not integrated. Phase 6 makes the final call.

## 2. Windows compatibility assessment

| Area | Finding | Evidence | Status |
|---|---|---|---|
| Data directory | The journal and every related file live in **Roaming** `%APPDATA%\com.fundedflow.desktop`: attachments, backups, data-controls state, the lock and `legal-acceptance.json`. The WebView2 profile is in Local. | `src-tauri/src/lib.rs:181,184` | Confirmed |
| Reparse points in the path | `no_symlink_components` walks **every** ancestor from the drive and rejects any `FILE_ATTRIBUTE_REPARSE_POINT` (0x400). It runs on the data root at every start, through `filesystem_ownership`. | `data_controls/filesystem.rs:89-109` (lead-read), `data_controls/mod.rs:155-168`, `runtime.rs:330-335` | **WIN-001** |
| User-chosen export and restore paths | The same check applies to export destinations and restore sources. OneDrive Known Folder Move or junctioned Documents folders may be refused. | `archive.rs:223,552,330-331` | WIN-002 |
| Unicode, spaces, long paths | Should work. Rust std adds the long-path prefix; rusqlite uses a strict UTF-8 conversion; storage keys are ASCII-only and Windows-safe. `VACUUM INTO` uses `to_string_lossy`, which matters only for unpaired surrogates, and those fail earlier anyway. | `db/mod.rs:254,283`; `filesystem.rs:33-67` | Low; Unverified on Windows |
| Case-insensitive filesystem | Handled: inventory de-duplicates case-insensitively; dev tools lowercase paths on Windows | `archive.rs:159`; `dev_tools/mod.rs:66` | Confirmed |
| Locked files, antivirus, indexer | Mandatory `LockFileEx` lock. Renames, `persist` and `remove_dir_all` have **no retry** on sharing or access-denied errors. | `filesystem.rs:145-150`; `restore.rs:174,255-282`; `legal.rs:105`; `attachments.rs:213` | WIN-010 (Unverified) |
| Durability | `sync_dir` is a no-op on Windows; the WAL mode result is not asserted | DATA-017 | Cross-ref |
| Hard links | Refused on unix only. Windows does not check `nlink`. | `filesystem.rs:80-86` | TEST-005 |
| Multiple instances | The second instance shows a failed-runtime window. No data risk. | `runtime.rs:330-335` | WIN-012 |
| Installation directory | `%LOCALAPPDATA%\FundedFlow` (per-user); no admin rights. Data is never stored in the install directory. | `tauri.conf.json:57-59` | Confirmed |
| User account differences | Per-user data and install. Roaming or redirected profiles put WAL on network storage, which is unsupported. | `lib.rs:181`; `db/mod.rs:262` | WIN-011 (Post-Stage 1) |
| Startup and shutdown | No `RunEvent` or `WM_ENDSESSION` handling. Committed data is safe (WAL replay). Unsaved UI text is at risk. | `lib.rs:172-209` | DATA-008 |
| Display scaling | The window opens at a fixed 1280×800 with a minimum of 800×480 logical pixels. Window state is not saved. At 150% on 1366×768 or 200% on 1080p the window may not fit. | `tauri.conf.json:15-22` | WIN-009 (Unverified) |
| File dialogs | Filters for zip and csv, with a suggested `.ffj.zip` name. The backend does not enforce the extension. Restore checks the PK magic bytes. | `features/data-controls/api/data-controls.ts:99-134`; `archive.rs:336-341` | Low |

## 3. Packaging and installation findings

| Item | Evidence | Assessment |
|---|---|---|
| Bundle | `tauri.conf.json:29-61`: `targets:["nsis"]`, `currentUser`, `downloadBootstrapper` (silent). Icons exist (`icon.ico` has 7 sizes). Resources `LICENSE` and `THIRD_PARTY_NOTICES.txt` both exist. `main.rs:5` sets `windows_subsystem="windows"`. | Correct |
| Toolchain | `@tauri-apps/cli` 2.12.3, `tauri` 2.12.4, `tauri-plugin-dialog` 2.8.3. Release profile: LTO, strip, unwind. | Correct; unpinned in CI (WIN-008) |
| WebView2 / offline | The app runs offline: CSP IPC-only, no network code. The **installer is not offline-capable** if the Evergreen runtime is missing: the bootstrapper downloads from Microsoft. Windows 11 ships the runtime. Some Windows 10 images (offline images, LTSC/IoT, N editions) may lack it. The README claims Windows 10 1803+. | WIN-005: wording, plus an owner choice between `offlineInstaller` and `fixedVersion` |
| Uninstall | Ticking "Delete the application data" removes all of `%APPDATA%\com.fundedflow.desktop`: the journal, WAL, **screenshots**, pre-upgrade backups, restore safety copies, the deletion queue and `legal-acceptance.json`. The docs mention only "the journal and its backups". The smoke checklist tests only the **unticked** box. | WIN-003 |
| Upgrade and downgrade | The identifier is stable, and `%APPDATA%` survives an upgrade if the box is left unticked. **Every build is 0.1.0** (`tauri.conf.json:4`, `Cargo.toml:3`), so candidates can't be told apart. Installing an older commit over a newer journal triggers a non-retryable `NewerSchema` refusal ("install the latest version"). Data is safe. | WIN-004 |
| Signing | Unsigned, so SmartScreen and Mark-of-the-Web prompts appear (documented). Owner decision. | Not a defect |
| Release workflow | Runs `npm ci`, then `tauri build` (which runs `npm run build`, including the dev-tools dist check), then the dev-tools check again. It records **the EXE's** SHA-256 in `SHA256SUMS.txt` and the summary (`release-installer.yml:94-105`). Problems: **no tests or clippy**; the `v*` tag trigger is not gated on CI (`ci.yml` has no tag trigger); the PR path filter **omits `apps/desktop/src/**`, `packages/**` and the bundled `THIRD_PARTY_NOTICES.txt`**; PR artifacts are kept 3 days, other runs 30. | WIN-006; WIN-008 (pinning) |
| Recorded installer evidence | The doc records `7679edc`, EXE SHA-256 `041983f5…787f`, status "Not Done", with a blank checklist. The lead confirmed `1a0d8af` (LegalGate) and `c9feb38` (notices) are **not** ancestors of `7679edc`. `b94fb1b`→`92e7980` is **14 commits** touching 28 files under `apps/` and `packages/` (lead-verified). The doc's trigger and retention text has drifted from the workflow (`:63,70-71`; `README.md:72`). | WIN-007, TEST-001, TEST-002 |
| Debug tools | Frontend: the dist marker check runs in `build:app` and again in release. Rust: `cfg(debug_assertions)`. No check that the release binary excludes debug code. | TR-012 |

## 4. Runtime dependency analysis

| Dependency | Needed when | Offline? | Notes |
|---|---|---|---|
| Microsoft Edge WebView2 Evergreen runtime | Every launch | Yes, once installed | Installer downloads it if missing (WIN-005). Updates come through Windows or Edge (platform behaviour). |
| VC++ runtime | No | n/a | MSVC static CRT (Tauri default). Not verified, because no build artifact was inspected. |
| SQLite | Built in | Yes | `rusqlite` bundled |
| Fonts | Built in | Yes | `@fontsource` bundled |
| Network | Never, after install | n/a | App CSP `connect-src` is IPC only. TR-014: the first-run wording says "no internet connection" while the installer may download. |
| Local filesystem | Every launch | Yes | Must be a local, non-reparse path (WIN-001, WIN-011) |

## 5. Executed check results

All checks ran from the repository root with `FUNDEDFLOW_UPDATE_FIXTURES` unset.

| # | Command | Result | Exit |
|---|---|---|---|
| 1 | `npm run check:boundaries -w @fundedflow/domain` | "Domain boundaries OK" | 0 |
| 2 | `npm run test:dev-scripts` | 20 tests, 20 pass, 0 fail, 0 skipped | 0 |
| 3 | `npm run test:ci-scripts` | 8 tests, 8 pass | 0 |
| 4 | `npm run test:notices` | 10 tests, 10 pass | 0 |

**Side effects, inspected before running:**

- The scripts use only Node built-ins.
- Tests write to `os.tmpdir()` temporary directories and clean them up.
- `audit-guard` tests spawn `node -e` child processes; no npm audit runs.
- `git status` was unchanged afterwards.

**Two deviations:**

1. npm printed a "New major version of npm available" notice. npm's update notifier, not the repository scripts, **may have contacted the npm registry**. This was not intended.
2. The lead redirected command output to `/tmp/claude-0/out.txt` (outside the repository) rather than the session scratchpad.

**Skipped or Blocked:**

| Check | Reason |
|---|---|
| `npm run typecheck`, `npm test` (domain and desktop Vitest, including journeys and axe), `npm run build`, `npm run check:dist`, `npm run test:journeys` | No `node_modules`. `npm ci`, even from the local cache, is an install, which is forbidden. |
| `cargo test --offline --locked`, `cargo clippy --offline --locked --all-targets -- -D warnings` | No Cargo registry or vendored crates, so `--offline` cannot resolve dependencies. The frontend build prerequisite is also missing. |
| `npm run check:engine-runtimes` | Needs a built domain package. A Chromium binary exists locally but was not used. |
| `npm run check:notices` / `notices` | Needs `cargo-about` plus `cargo fetch` (network). Not authorized. |
| npm audit, cargo audit | Network; not authorized. **No fresh advisory scan was performed.** |
| Collector ruff, mypy, pytest | No `.venv`; `uv sync` is forbidden |
| Any installer build, install, app launch or real-journal upgrade | Not authorized; Linux host |

**CI evidence available offline:** only the owner handoff statement that `main` `92e7980` CI run 39735646149 succeeded. Its logs were not read. That run's job summary may show the advisory audits as NOT RUN, because `audit-guard.mjs:111-115` returns 0 on push and PR outages. **Unverified.**

## 6. Testing inventory

Counts are static grep counts at HEAD.

| Suite | Size | Proves | Gaps |
|---|---|---|---|
| Rust `#[test]` | 393 total. db/upgrade 72, store 141, csv_import 79, data_controls 34, runtime 14, dev_tools 24, legal 5, parity/wire 7, domain 14, other 3 | Persistence, migrations (real legacy journals v3/v4/v8), transaction rollback, restore and deletion, hostile archive entries, startup failures, preview tokens | Ignored: `upgrade_copy_of_a_real_journal` (`db/upgrade_tests.rs:430`, needs `FUNDEDFLOW_UPGRADE_DB`). Unix-only tests (`dev_tools/tests.rs:422,433`; `data_controls/tests.rs:784`) never run in CI, which is Windows-only. No `cfg(windows)` tests for junctions, 8.3 names, `\\?\` or hard links. The lock is tested in-process only. No shutdown tests. |
| Domain Vitest | 17 files, about 188 test sites (historical runs: 496 cases) | Contracts, money, engine, insights parity | — |
| Desktop Vitest | 85 files, about 956 sites. Features 458, design system 277, journeys 98, lib 46, components 23, legal 5 | Components, journeys (accessibility/axe, first run, uncertain writes, data controls, recovery, risk promotion), wire contracts | jsdom only. Journeys mock the repository (UI-007). Trade delete/restore untested (UI-006). |
| Node `--test` | dev-scripts 20, ci-scripts 8, notices 10 | Reset tooling, audit guard, notices generator | **Executed at HEAD: all pass** |
| Collector pytest | 226 tests in 17 files, socket-disabled | Collector policy and parsing | Not run here |
| Packaging | None automated beyond the build and hash in the release workflow | — | No packaged smoke on any SHA |
| Manual procedures | `docs/build-26.75-evidence.md` checklist (blank); `docs/architecture/build-26-accessibility-journeys.md` §9 (pending); `docs/design/window-support-matrix.md` (blank); `build-26.5-26.7-recovery-reliability.md` §5 (pending) | — | All Not Run |

**CI scope** (`.github/workflows/ci.yml`, windows-latest, push to `main`, PR, schedule, dispatch; **no tag trigger**):

- Runs: `npm ci`, boundaries, typecheck, `npm test` (which includes journeys and axe), build (which includes the dev-tools check), `check:dist`, `cargo test`, `cargo clippy -D warnings`, `check:notices` (cargo-about 0.9.2), and the dependency audit through `audit-guard`.
- Does not run: `cargo fmt` (a known historical failure, `docs/build-10-5-closeout.md:61`), `test:dev-scripts` (that runs only in path-filtered `dev-tools.yml`), `check:engine-runtimes`, or the ignored tests.
- Toolchains are unpinned: Rust `stable`, Node `lts/*`, cargo-audit.
- `FUNDEDFLOW_UPDATE_FIXTURES` truthiness is inconsistent (TEST-009).

**Historical evidence and provenance.** All recorded SHAs are ancestors of HEAD.

| Doc | SHA(s) | Commits behind HEAD | Passed then | Still pending |
|---|---|---|---|---|
| `build-26.75-evidence.md` | `7679edc` | 128 | Installer built; EXE hash recorded | Clean smoke not run |
| `build-26.9-evidence.md` | none (doc `d3d1a1b`) | 170 | cargo 334 passed with 4 `legacy_rulebook_tests` failures on Linux | Windows/WebView2. Fix `ee52ec9` landed afterwards; no re-run is recorded. |
| `build-10-5-closeout.md` | `cf3f614` | 240 | CI pass; local NSIS hash `C46B8E0C…` | `cargo fmt` failed; packaged workflow, real-journal upgrade and human acceptance not executed |
| `build-18-5-evidence.md` | `fa6aca8`, `a282671`, `2a65c18`, `5f319f4` | 198–221 | cargo 303, desktop 721 | Physical drag, real scaling, sign-off |
| `build-26-accessibility-journeys.md` | `7709d29` | 229 | jsdom and axe | §9 manual checklist |
| `build-26.5-26.7-recovery-reliability.md` | `21d2215`, `5255ca8`, `2a65c18`, `1629f2f` | 207–216 | Win11 local test runs | Packaged and controlled-failure smoke |
| Owner handoff | `92e7980` CI; `b94fb1b` installer | 4; 18 (14 to `92e7980`) | CI green (advisory may be NOT RUN) | No smoke; no EXE hash in the repo |

None of these is current evidence for HEAD.

## 7. Findings

| ID | Severity | Stage 1 class | Location | Finding | Verification | Confidence |
|---|---|---|---|---|---|---|
| WIN-001 | Medium (High if the owner's machine matches) | **Recommended**; becomes a Blocker if the owner's profile or the smoke environment triggers it | `src-tauri/src/data_controls/filesystem.rs:89-109` (0x400 test at `:97`); `data_controls/mod.rs:155-168`; `runtime.rs:330-335, 130` | Any reparse point between `C:` and the data folder blocks every start. Triggers: a profile or `C:\Users` moved through a junction or symlink, a redirected Roaming folder, mount points, possibly Windows Sandbox. The "retryable" message blames another copy or a sync tool. | Confirmed in code (lead read); environment frequency Unverified | High / Medium |
| WIN-002 | Medium | Recommended | `archive.rs:223,552,330-331`; `filesystem.rs:73,97` | Export and restore may be refused for OneDrive Known Folder Move or junctioned folders, which is the likely save-dialog default | Junction case Confirmed; OneDrive Unverified | Medium |
| WIN-003 | Medium | Recommended (document before use) | `docs/build-26.75-evidence.md:51-54,140,166`; `README.md:79` | The uninstall "Delete the application data" box removes screenshots, all backups and restore safety copies, but the docs say only "journal and backups". The ticked case is untested. | Folder contents Confirmed; NSIS behaviour Unverified | Medium |
| WIN-004 | Low-Medium | Recommended | `tauri.conf.json:4`; `Cargo.toml:3`; `release-installer.yml:67-69`; `runtime.rs:133` | Fixed version 0.1.0: candidates can't be told apart, and installing an older build over a newer journal gives a confusing `NewerSchema` refusal | Confirmed | High |
| WIN-005 | Low-Medium | Recommended (wording); `offlineInstaller` is an owner choice | `tauri.conf.json:54-57`; `README.md:7,11` | The installer needs the internet when WebView2 is missing, and the docs don't say so. The app itself runs offline. | Config Confirmed; failure UI Unverified | Medium |
| WIN-006 | Medium | Recommended (process gate for the candidate) | `release-installer.yml:6-21,41-85`; `ci.yml` | The release workflow runs no tests, tags are not gated on CI, and the PR filter omits the frontend, the domain package and the bundled notices | Confirmed | High |
| WIN-007 | Medium | **Blocker (release-gate evidence)** | `docs/build-26.75-evidence.md:8,63,70-71,107-111` | No valid candidate exists. The recorded EXE is from `7679edc`, which lacks LegalGate and notices; `b94fb1b` lacks 14 commits of source. Docs have drifted from the workflow. | Confirmed (lead git check) | High |
| WIN-008 | Low | Post-Stage 1; record versions now | `release-installer.yml:41-58` | Unpinned Rust, Node, runner and actions; tool versions not logged with the hash | Confirmed | High |
| WIN-009 | Low-Medium | Recommended (manual check) | `tauri.conf.json:15-22` | The window may not fit at high DPI on small screens; window state is not persisted | Unverified | Low |
| WIN-010 | Low | Post-Stage 1 | `filesystem.rs:145-150`; `restore.rs:174,255-282`; `attachments.rs:213`; `legal.rs:105` | No retry on antivirus or indexer sharing violations during renames or `remove_dir_all` | Unverified | Low |
| WIN-011 | Low | Post-Stage 1 | `lib.rs:181`; `db/mod.rs:262` | Roaming AppData plus WAL on redirected or network profiles is unsupported | Location Confirmed; impact Unverified | Medium |
| WIN-012 | Informational | Post-Stage 1 | `runtime.rs:330-335` | A second instance opens a window in a failed state (no single-instance focus) | Confirmed | High |
| TEST-001 | Medium | **Blocker (gate evidence)** | `release-installer.yml:9-19`; owner-handoff artifacts | Installer evidence doesn't match `main`; frontend-only changes never build an installer. Duplicate relationship: canonical WIN-007 and WIN-006. | Confirmed | High |
| TEST-002 | Low-Medium | **Blocker (the checklist is the gate instrument)** | `docs/build-26.75-evidence.md:135` (step 4 skips the first-run gate, lead-read), `:65`; `README.md:72` | The smoke checklist and NA-7 text are stale for any current artifact | Confirmed | High |
| TEST-003 | Medium | **Blocker (P0-13 / NA-3)** | `apps/desktop/src/legal/privacy-notice.ts:8-11`, `user-agreement.ts:7-10`; `legal.test.ts:11-21`; `journeys/first-run.journey.test.tsx:45,61-62,148`; `docs/design/screens/16-first-run.md:7-8`; `legal/index.ts:12-14` | Owner-only v1.1 text is not integrated; tests hard-code the draft state. Changes needed together: texts, versions and digests; `legal.test.ts`; the first-run journey; the spec; the summary wording (TR-014). | Confirmed | High |
| TEST-004 | Low | Recommended | `scripts/audit-guard.mjs:111-115`; `ci.yml:103,121` | Advisory audits can be NOT RUN on a green push or PR run | Confirmed (by design) | High |
| TEST-005 | Medium | Recommended | `filesystem.rs:80-86,134-144`; `dev_tools/tests.rs:422,433`; `data_controls/tests.rs:784` | Windows-only filesystem behaviour is untested, and weaker than on unix (no hard-link refusal, no directory flush, unix-only alias tests) | Confirmed (code) | High |
| TEST-006 | Medium | **Blocker if the owner keeps the 10.5 gate**; otherwise Recommended | `db/upgrade_tests.rs:427-457`; `docs/build-10-5-closeout.md:66` | The real-journal-copy upgrade has never run. The ignored test opens the source directly without lock awareness, and prints trade IDs and days to stdout. | Partially Confirmed | Medium |
| TEST-007 | Medium | **Blocker for P0-18** (acceptance gates) | `docs/architecture/build-26-accessibility-journeys.md:227-238`; `docs/design/window-support-matrix.md`; `build-26.5-26.7-recovery-reliability.md:187-194` | Manual accessibility (NVDA, contrast, 125/150% scaling, zoom, reduced motion), window matrix, recovery and offline gates are all unrun | Confirmed | High |
| TEST-008 | Informational | **Blocker (owner dispositions)** | grep finds **0** hits for P0-09, P0-10 and P0-18 in the repository (lead-verified). 0BSD is allow-listed (`scripts/third-party-notices.mjs:38`, `src-tauri/about.toml:27`) and **in use by tslib 2.8.1** (`apps/desktop/THIRD_PARTY_NOTICES.txt:2078-2083`). "D5" is ambiguous: a window-matrix row or the collector export envelope. | P0-09, P0-10, D5, P0-05 and 0BSD have no recorded disposition | Confirmed | High |
| TEST-009 | Low | Post-Stage 1 | e.g. `data_controls/wire_tests.rs:90` (`is_some`) vs `parity.rs:34` (`=="1"`) | `FUNDEDFLOW_UPDATE_FIXTURES=0` still rewrites some fixtures | Confirmed | High |
| TEST-010 | Low | Recommended / Post-Stage 1 | `ci.yml` | CI gaps: no `cargo fmt`, no `check:engine-runtimes`, no `--locked` on cargo, unpinned toolchains | Confirmed | High |
| TEST-011 | Informational | Post-Stage 1 | §6 | Historical pass counts are 4–338 commits stale; the 26.9 legacy failures predate fix `ee52ec9`, and no re-run is recorded | Confirmed | High |

**WIN-001 detail.**

- **Trace:** `Runtime::open` → `create_dir_all(root)` → `filesystem_ownership(root)` → `no_symlink_components(root)`. That check iterates over `path.components()` from the drive prefix, calls `symlink_metadata` on each prefix, and returns `UnsafePath` if any has the 0x400 attribute. The runtime maps this to `OpenFailed` with "Journal is already owned or its directory is unsafe".
- **Standard case works:** Windows CI runs runtime tests under `%TEMP%`, which is not a reparse point.
- **Where it fails:** a relocated profile, Roaming moved through a junction (for example to another drive or a sync folder), or a volume mount point. The journal never opens. The data is untouched, but the only fix is to change the filesystem layout or the code.
- **Fix:**
  1. Trust the OS-resolved `app_data_dir` prefix and check only components at or below the app folder.
  2. Reject only symlink, junction and mount-point reparse tags, not every 0x400 attribute.
  3. Separate "unsafe directory" from "already owned" in categories and wording.
- **Verification:**
  - Windows tests with the profile behind a junction and with Roaming redirected.
  - A first launch in Windows Sandbox, which the smoke checklist allows.
  - Run the smoke on a full VM until this is resolved.

## 8. Missing test coverage (Stage 1-relevant)

1. **Packaged smoke on the candidate SHA**, covering:
   - install;
   - the first-run gate;
   - offline use;
   - restart persistence;
   - export and restore;
   - uninstall with the box unticked **and** ticked (after an external export);
   - upgrade from the previous candidate;
   - downgrade (`NewerSchema`).
2. **Windows path semantics:**
   - a data root behind a junction (WIN-001);
   - an OneDrive or junctioned export target (WIN-002);
   - hard-link and 8.3 aliases (TEST-005);
   - an antivirus lock during a rename (WIN-010).
3. **Lifecycle:**
   - second-process lock (WIN-012);
   - title-bar close with unsaved text (DATA-008);
   - a panic during init (DATA-005);
   - shutdown during a write.
4. **Recovery under failure on a packaged build:** the DATA-001 to DATA-004 scenarios.
5. **Accessibility and DPI:** the manual matrix (TEST-007, WIN-009).
6. **A real-journal-copy upgrade**, with owner approval, on a copied file with output redacted (TEST-006).
7. **Test infrastructure items carried forward:** UI-006, UI-007 and UI-019 (Phase 4), and TR-011 (wire fixtures).

## 9. Stage 1 blockers and recommended improvements

**Blockers.** These are gates and evidence, not confirmed P0 code defects:

| Item | Finding IDs |
|---|---|
| Produce and record a release candidate (§10) | WIN-007, TEST-001 |
| Integrate the owner-only v1.1 notices and their tests | TEST-003; P0-13/NA-3 |
| Fix the smoke checklist, then run the clean Windows smoke on the candidate | TEST-002 |
| Run the manual recovery, accessibility, window, offline and cohort gates, or record the owner's disposition | TEST-007 |
| Record the owner dispositions | TEST-008: P0-09, P0-10, D5, 0BSD, P0-05 |
| Real-journal-copy upgrade, if the owner keeps that gate | TEST-006 |

**Recommended before or with the candidate:**

- WIN-001; it becomes a blocker if it reproduces on the owner's machine;
- WIN-002, WIN-003, WIN-004, WIN-005 (wording), WIN-006, WIN-009 (check);
- TEST-004 (inspect the advisory summary);
- TEST-005;
- carried forward:
  - Phase 2: DATA-001 to DATA-004, DATA-006 to DATA-008;
  - Phase 3: TR-001, TR-002;
  - Phase 4: UI-001 to UI-005.

**Post-Stage 1:** WIN-008, WIN-010, WIN-011, WIN-012, TEST-009, TEST-010, TEST-011.

