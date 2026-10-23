# Build 26.75 / NA-2 — Windows installer in CI: evidence

Sources: [NA-2 card](https://app.notion.com/p/4001bd4b6bde8185ba05d0dc1d2d4080) (scope and acceptance),
[Build 26.75 roadmap card](https://app.notion.com/p/3ff1bd4b6bde81d6ae48fca0f52d5659). Unblocks
[P0-06](https://app.notion.com/p/4001bd4b6bde8105b463d7a3d0378017). Branch `feat/build-26-75-windows-installer`
from `main` at `2e372b3`.

**Not Done:** CI builds and hashes the installer. The clean-machine smoke below has **not been run**; the owner runs it
on a fresh Windows 11 VM or Windows Sandbox and fills in the results.

## Decisions in force (owner, 2026-10-21)

- **Unsigned NSIS installer, manual updates.** No certificate, `signCommand`, thumbprint or timestamp URL; no Tauri
  updater plugin and no update checks (`createUpdaterArtifacts` stays unset). A new version is installed by running
  the new installer over the old one. For a newer version, Tauri's NSIS installer pre-selects "Uninstall before
  installing", which runs the old uninstaller; its "Delete the application data" checkbox is unchecked by default and
  must stay unchecked to keep the journal. Testing that upgrade path belongs to NA-5, not this smoke.
- **No phone-home.** Neither the installer nor the app contacts a server of ours. The installer's only download is
  Microsoft's WebView2 bootstrapper, and only on a machine without WebView2 (below). WebView2 and Windows are separate
  software with their own network behaviour; the privacy notice makes no promise about it.

## Bundle configuration (`apps/desktop/src-tauri/tauri.conf.json`)

| Setting | Value | Reason |
|---|---|---|
| `bundle.targets` | `["nsis"]` | V1 ships one Windows installer. `"all"` also built an MSI (WiX) on Windows, which is out of scope and doubled build time. |
| `bundle.publisher` | `Kyle Shabaga` | The copyright holder (LICENSE, `copyright`, Cargo `authors`). Shown as Publisher in Installed apps. Without it Tauri derives `fundedflow` from the identifier. |
| `bundle.homepage` | `https://github.com/KyleShabaga/FundedFlow` | The project's real public page (the README points readers there). No product website exists, so none is invented. Shown as a link in Installed apps only; nothing fetches it. |
| `bundle.shortDescription` / `longDescription` | Based on the Cargo `description` and the README "Local data" section | Installer and file metadata. |
| `bundle.windows.webviewInstallMode` | `{ "type": "downloadBootstrapper", "silent": true }` | Tauri's default, set explicitly so the choice is visible. See below. |
| `bundle.windows.nsis.installMode` | `currentUser` | See below. |
| `identifier` | `com.fundedflow.desktop` (**unchanged**) | It names the journal folder `%APPDATA%\com.fundedflow.desktop`; changing it would orphan existing journals. |
| Licence page | none | The License and product information is shown in the app (NA-3), not by the installer. `licenseFile` stays unset. |
| `bundle.resources` | `LICENSE`, `THIRD_PARTY_NOTICES.txt` (Build 26.78) | Licence notices travel with the binaries. See [Third-party notices](#third-party-notices). |

**WebView2: `downloadBootstrapper` (silent).** Windows 11, and Windows 10 kept current by Windows Update, normally have the Evergreen WebView2 runtime,
so on the V1 target machines the installer skips this step and makes no network call. Only when the runtime is
missing does it download Microsoft's ~2 MB bootstrapper, which then downloads the runtime. Trade-offs:

- `embedBootstrapper` adds ~1.8 MB to every installer but **still needs the internet** to fetch the runtime, so it
  buys nothing offline. Its stated advantage is Windows 7 support, which V1 doesn't target.
- `offlineInstaller` (~127 MB) is the only fully offline option. Not justified while every supported Windows version
  already carries WebView2; reconsider only if the smoke or a user finds a machine without it.
- `skip` would leave a machine without WebView2 unable to start the app. The README already lists WebView2 as a
  prerequisite; this makes the installer ensure it.

**Install mode: `currentUser`.** No UAC/admin prompt; installs to `%LOCALAPPDATA%\FundedFlow` with uninstall metadata
under `HKCU`. It matches the journal, which is per-user in `%APPDATA%\com.fundedflow.desktop`, and lets a user
without admin rights install and update. `perMachine` would need admin for every manual update.
`both` would show an extra choice that V1 users don't need.

**Uninstall and data.** Uninstall is not the journal-erasure control (privacy notice, "Deletion and uninstall"). To
remove journal data, export a backup first if you want one, then use Settings → "Delete data permanently" → **Erase
the entire local journal**. Tauri's NSIS uninstaller has a "Delete the application data" checkbox, **unchecked by default**. Left
unchecked, both folders below are kept, so a reinstall opens the existing journal. Checked, it is *expected* to remove
both; this is unverified until TASK-031 and the smoke (steps 8–9) confirm it on a real machine:

- `%APPDATA%\com.fundedflow.desktop`: the journal (`fundedflow.db` and its WAL), managed attachments including
  screenshots, pre-upgrade backups (`fundedflow.db.before-v*.bak`), restore safety copies and working files
  (`data-controls`, `data-controls-work`), the cleanup queue (`data-controls-cleanup`) and the first-run
  acknowledgment record (`legal-acceptance.json`);
- `%LOCALAPPDATA%\com.fundedflow.desktop`: the WebView2 data.

Exports and other copies saved outside these folders are never touched by uninstall.

**Developer tools cannot ship.** `tauri build` always runs `beforeBuildCommand` (`npm run build`), whose `build:app`
ends with `scripts/check-no-dev-tools.mjs`; a leak exits non-zero and fails the build. The workflow never passes
`--no-before-build-command`, and runs the same check again on the bundled `dist` afterwards. On the Rust side the
dev commands are registered only under `cfg(debug_assertions)`, which a release build excludes.

## Release workflow (`.github/workflows/release-installer.yml`)

- **Triggers:** manual (`workflow_dispatch`), tags `v*`, and pull requests that change bundler inputs: `apps/desktop/**`,
  `packages/**`, `LICENSE`, `apps/desktop/THIRD_PARTY_NOTICES.txt`, the root `package.json` and `package-lock.json`,
  `.github/workflows/checks.yml` and the workflow itself.
- **Checks first (TASK-027):** a `checks` job runs every check in `checks.yml` on the exact commit that is packaged;
  the installer job `needs` it, so failed, cancelled or timed-out checks mean no installer and no artifact.
- **Job (`windows-latest`, `permissions: contents: read`, no secrets):** checkout → Node LTS with npm cache → `npm ci` →
  stable Rust with `x86_64-pc-windows-msvc` → rust-cache → read the version from `tauri.conf.json` (a `v*` tag must
  equal `v<version>`) → `npm run tauri -- build` → dev-tools check → exactly one `.exe` in
  `target/release/bundle/nsis/` → `Get-FileHash` → `SHA256SUMS.txt` → `upload-artifact`.
- **Source SHA:** a pull request builds its **head commit**, not GitHub's temporary merge commit, so the recorded SHA
  is a real commit you can check out. Tag and manual runs use `github.sha`.
- **Artifact:** `fundedflow-<version>-<short sha>-windows-nsis`, containing the installer and `SHA256SUMS.txt`; kept
  3 days for pull requests and 30 days for tag and manual runs. The hash and SHA are also in the run's job summary.
- `SHA256SUMS.txt` has three `#` comment lines (title, `source_sha`, `version`) and one `<sha256>  <file>` line.

## Third-party notices

Added by [Build 26.78](https://app.notion.com/p/4001bd4b6bde814ba508eec6d607e37d).

- **Installed files.** `bundle.resources` maps the root `LICENSE` and `apps/desktop/THIRD_PARTY_NOTICES.txt` to the
  install folder: `%LOCALAPPDATA%\FundedFlow\LICENSE` and `%LOCALAPPDATA%\FundedFlow\THIRD_PARTY_NOTICES.txt`, next
  to `fundedflow.exe`. Tauri's generated `installer.nsi` copies them in `Section Install` after `SetOutPath $INSTDIR`
  (`File /a "/oname=LICENSE" …`, `File /a "/oname=THIRD_PARTY_NOTICES.txt" …`), and its uninstaller deletes both.
  The installer still has no licence page (`!define LICENSE ""`). The same notices are in Settings → Privacy & legal.
- **Generation.** `npm run notices` (`scripts/third-party-notices.mjs`) runs `cargo about generate --format json
  --offline --locked --fail` with `apps/desktop/src-tauri/about.toml` (target `x86_64-pc-windows-msvc`, no dev or
  build dependencies, FundedFlow's own crate ignored), walks `package-lock.json` for the production dependency tree
  of `apps/desktop` and `packages/domain` (the OFL-1.1 Fontsource packages get their own Fonts section), and writes
  one sorted text file with each component's version, licence, copyright and a reference to its licence text, each
  distinct text printed once. It also writes `apps/desktop/src/legal/third-party-summary.json` (the counts Settings
  shows). Both files contain no dates or paths, so they change only with a dependency.
- **Licence policy.** Both tools share one allow-list (MIT, Apache-2.0, Apache-2.0 WITH LLVM-exception, BSD-2-Clause,
  BSD-3-Clause, ISC, Zlib, Unicode-3.0, MPL-2.0, CC0-1.0, 0BSD, OFL-1.1). Anything else, or a package with no licence
  text, fails generation; two npm packages published without a licence file are covered by version-pinned entries
  in `MISSING_TEXT_OVERRIDES` that record where the copyright line was checked.
- **CI.** `ci.yml` installs `cargo-about@0.9.2` with `taiki-e/install-action` and runs `npm run check:notices`, which
  regenerates both files in a temp folder and fails, telling the contributor to run `npm run notices`, if either
  differs from the checked-in copy. `npm test` includes the generator's unit tests.
- **Not covered.** The WebView2 runtime isn't bundled (`downloadBootstrapper`) and Microsoft licenses it under its own
  terms. NSIS builds the installer but isn't part of the installed app. Its zlib/libpng licence asks for its notice
  only in source distributions, but the installer stub also carries NSIS's own compression code (Tauri uses LZMA),
  which NSIS lists under separate terms; whether that needs a notice is an open question for the owner and counsel.
  Both are named in the notices header.

## CI evidence (this PR)

| Item | Value |
|---|---|
| Run | [Release installer #39691474111](https://github.com/KyleShabaga/FundedFlow/actions/runs/39691474111) (success); CI run [39691474015](https://github.com/KyleShabaga/FundedFlow/actions/runs/39691474015) also green |
| Source SHA | `7679edc1ac117944ae31d81b6c6a29142b61a0fe` (PR head when built) |
| Artifact | `fundedflow-0.1.0-7679edc-windows-nsis` (5.0 MB zip; expires 2026-11-20) |
| Installer file | `FundedFlow_0.1.0_x64-setup.exe` |
| SHA-256 | `041983f565c7f6b41dba2388c2f21bc8c4c7402c94e442ed0f75d00938e0787f` |

Later commits on this branch change only this document, so they don't re-run the installer build; the artifact
above is the one to test. The same config was also built locally on Windows 11 before pushing. That local installer
came from an earlier commit on a different machine, has a different hash, and is not the one to test.

## Clean-machine smoke checklist (owner; not yet run)

Machine: a fresh Windows 11 VM or Windows Sandbox with **no** Node, Rust, Visual Studio or other developer tooling.

| | |
|---|---|
| Tester / date | |
| Windows edition and build (`winver`) | |
| WebView2 runtime present before install? (Installed apps → "Microsoft Edge WebView2 Runtime") | |
| WebView2 runtime version after install (Installed apps, or "absent") | |
| Artifact name | |
| Installer SHA-256 | |
| Source SHA | |
| TASK-018 and TASK-023 merged into the source SHA? (needed for B1 and B3) | |

Steps 1–11 are the base smoke; B1–B7 below are added by TASK-028 and run on the same artifact. Every row records
Pass/Fail, tester and date. A mandatory step that fails or is not run means the TASK-030 gate cannot be Passed.

| # | Step | Expected | Pass/Fail | Notes |
|---|---|---|---|---|
| 1 | Download the artifact zip from the run, extract it, and run `Get-FileHash .\FundedFlow_<version>_x64-setup.exe -Algorithm SHA256`. | Matches `SHA256SUMS.txt` and the table above (case-insensitive). | | |
| 2 | Run the installer. SmartScreen shows "Windows protected your PC" because it is unsigned: choose **More info → Run anyway**. | No UAC prompt (per-user install). Installs to `%LOCALAPPDATA%\FundedFlow`; Start menu entry created. Publisher shows "Kyle Shabaga" in Installed apps. | | |
| 3 | Disconnect the network (disable the adapter, or in Sandbox turn networking off). | Offline from here to step 10. | | |
| 4 | First launch (still offline). Read the first-run screen, then choose **Acknowledge and continue**. | The first-run acknowledgment screen shows before any app content, titled "Before you start", with the "Draft documents" warning, the "Your privacy" summary and two documents: "Privacy notice (draft)" and "License and product information (draft)", both version `0.2.1-draft`. Its buttons are **Close** and **Acknowledge and continue**. After **Acknowledge and continue**, Today's empty state opens. No error, no network prompt. Evidence: expand each document ("Read the privacy notice", "Read the license and product information"; collapsed they show only these labels, `LegalDocuments.tsx:13-14`), then record the title and the "Version 0.2.1-draft" line each one shows, and a screenshot of the screen. | | |
| 4a | Check the installed legal files: `dir $env:LOCALAPPDATA\FundedFlow`, then `notepad $env:LOCALAPPDATA\FundedFlow\THIRD_PARTY_NOTICES.txt`. In the app, open Settings → Privacy & legal → **Licence and third-party notices** → **Read the third-party notices**. | The folder lists `LICENSE` and `THIRD_PARTY_NOTICES.txt` next to `fundedflow.exe`. The notices file opens in Notepad (starts "FundedFlow third-party notices"). The in-app notices, offline, show the same text (Rust crates, npm packages, Fonts and Licence texts sections with the same counts). | | |
| 5 | Record the exact journal path (`dir $env:APPDATA\com.fundedflow.desktop`). | `fundedflow.db` exists under `%APPDATA%\com.fundedflow.desktop`, with `legal-acceptance.json` (the step-4 acknowledgment record) beside it. Write the full path. | | |
| 6 | Create an account, import a small synthetic CSV (a few rows; not real trading data), close the app, reopen. | Account and trades are still there after reopening. | | |
| 7 | Look for developer tools: sidebar has no **Add Fake Data** / **Reset All Data**; `#/settings/developer` is not reachable; F12 / Ctrl+Shift+I do nothing. | None visible. | | |
| 8 | Uninstall from Installed apps, leaving "Delete the application data" **unchecked**. List what remains: `%LOCALAPPDATA%\FundedFlow`, `%APPDATA%\com.fundedflow.desktop`, `%LOCALAPPDATA%\com.fundedflow.desktop`, Start menu, `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall`. | Program files (including `LICENSE` and `THIRD_PARTY_NOTICES.txt`), shortcuts and the uninstall entry are gone; the journal folder remains. Record exactly what is left. | | |
| 9 | Reinstall with the same installer and launch. | The step-6 account and trades open. | | |
| 10 | Run the same installer again over the existing install (choose the reinstall option if offered). Launch. | Install completes; the journal is kept. | | |
| 11 | Optional: with the network reconnected, run Resource Monitor (Network tab) or Wireshark while using the app for a few minutes. No connections from `fundedflow.exe` or its `msedgewebview2.exe` children to non-Microsoft hosts. WebView2 itself may contact Microsoft (for example SmartScreen); record any such hosts. | | |

### Added steps B1–B7 (TASK-028)

State at this document's revision (`main` at `819f967`): TASK-011 has not recorded its results, and TASK-018 and
TASK-023 are not merged. Until TASK-011 records them, B1 case (2) and B3 case (2) have no record to compare with:
the tester records the observed behaviour as **unmeasured** and lists it as a known gap for Kyle's explicit
acceptance in TASK-036, not as Pass. Any journal data loss is a Fail in every case.

| # | Step | Expected result | Evidence fields | Mandatory | Pass/Fail | Tester / date |
|---|---|---|---|---|---|---|
| B1 | Data root behind a junction: on a test account, place `%APPDATA%` (or the relocated profile) behind a junction, then launch. | Record first whether TASK-018 is merged into the source SHA. **(1) TASK-018 in the candidate:** the app reaches the first-run acknowledgment screen / Today with the journal under the junctioned path; no "retry" failure. If the app folder itself is a junction: refused with TASK-018's non-retry message. **(2) TASK-018 not in the candidate** (only if Kyle formally defers TASK-018; the remediation plan and TASK-029 otherwise require every W1 task Verified): the expected result is the pre-018 behaviour that TASK-011(b) recorded for the same junction setup; the step passes only as a **known gap** (listed for Kyle's explicit acceptance in TASK-036) when the observed behaviour equals that record and no journal data is lost; behaviour different from the record is a Fail. Without a TASK-011(b) record, see the note above. | Junction command used and `dir /AL` (or `fsutil reparsepoint query`) output for the junctioned folder; resolved journal path; screenshot of the screen reached; message text if refused; TASK-018 state at the source SHA and, for case (2), the TASK-011(b) record compared with (or "unmeasured"). | Yes | | |
| B2 | Export to OneDrive Documents (Files On-Demand on) and to a junctioned folder. | Known limitation (V1.1): the export is refused with a clear message and the journal is unchanged, unless TASK-011(b) recorded that it works, in which case the archive is saved and its name, size and SHA-256 are shown. TASK-011(b) has not recorded this yet, so the known-limitation result applies. | Target path; OneDrive Files On-Demand state; on-screen result (screenshot); archive SHA-256 if produced; whether any file was left at the target. | Yes | | |
| B3 | Title-bar close (X) and Alt+F4 with unsaved text in a trade review and a daily review. | Record first TASK-023's state at the source SHA. **(1) TASK-023 Verified and merged into the candidate:** a prompt asks before discarding; Cancel keeps the text; Leave closes. **(2) TASK-023 not in the candidate (still Deferred, or closed Not Needed):** the behaviour matches what TASK-011(a) recorded for the same close action. If TASK-011(a) recorded a prompt (Not Needed case), that prompt appears, Cancel keeps the text and Leave closes. If it recorded that the window closes and the unsaved text is lost, the step passes only as a **known gap** (ISSUE-009 window close): the observed behaviour equals the TASK-011(a) record, and the gap is listed for Kyle's explicit acceptance in TASK-036; behaviour different from the record is a Fail. TASK-011 r3 measures only the title-bar X, so if there is no TASK-011(a) record for Alt+F4, record the observed Alt+F4 behaviour as **unmeasured** and list it as a known gap for TASK-036, not as Pass. In every case a clean window closes immediately. | TASK-023 state at the source SHA (Verified / Deferred / Not Needed) and, for case (2), the TASK-011(a) record compared with (or "unmeasured", separately for X and Alt+F4); screen and field dirtied; screenshot of the prompt (or of the closed window and the lost text on reopening, for a known gap); result of Cancel and of Leave; text present after Cancel. | Yes | | |
| B4 | Ticked uninstall after an export (part of V-023): export an archive to a folder outside `%APPDATA%` and `%LOCALAPPDATA%`, then uninstall with "Delete the application data" ticked. | Removes exactly the folders listed under [Uninstall and data](#bundle-configuration-appsdesktopsrc-tauritauriconfjson) (`%APPDATA%\com.fundedflow.desktop` and `%LOCALAPPDATA%\com.fundedflow.desktop`) plus the program folder, shortcuts and uninstall entry; the exported archive remains. | `dir` of `%LOCALAPPDATA%\FundedFlow`, `%APPDATA%\com.fundedflow.desktop` and `%LOCALAPPDATA%\com.fundedflow.desktop` before and after; the `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall` entry before and after; archive path still present; any leftover listed exactly. | Yes | | |
| B5 | Second instance: with the app open, launch it again from the Start menu. | Known limitation (V1.1, ISSUE-031/WIN-012): the second window may show a failure screen; the first instance keeps working and the journal opens normally on the next launch. Any data loss is a Fail. | Screenshots of both windows; message text; first instance still saves; next-launch result. | Yes | | |
| B6 | Windows scaling 125%, 150% and 200% (first-run acknowledgment screen, Today, Settings). | Every primary action reachable; nothing clipped that blocks a task. The full matrix is TASK-033. | Scaling; physical resolution; screenshots per scaling. | Yes | | |
| B7 | Install without WebView2, online and offline (V-023): on a Windows image whose Installed apps lists no "Microsoft Edge WebView2 Runtime", run the installer (a) with the network on, (b) on a fresh copy of the image with the network off. | `downloadBootstrapper` (TASK-006 Option A, `apps/desktop/src-tauri/tauri.conf.json:49-52`), as documented above: (a) the installer downloads the runtime from Microsoft and the app launches; (b) the runtime cannot be fetched: pass if the installer stops with a message or the app reports that WebView2 is missing, no journal is created or changed, and the behaviour matches the NA-7 sentence that installing needs internet when WebView2 is missing; record the exact message. | Windows edition and build; proof that WebView2 was absent before (Installed apps screenshot); network state; installer screens and messages; WebView2 version after install (or "absent"); first-launch result. | Yes | | |

Attach screenshots of steps 2, 4, 4a, 5, 8 and 9 and the screenshots B1–B7 list. Any failure gets a Triage card.

## Install and verify (for the NA-7 release notes)

**Draft.** Not release text: the final wording is TASK-035, after the smoke above has run. Each statement is checked
against the sources listed under the draft at `main` `819f967`.

> **Install FundedFlow on Windows 10 or 11**
>
> 1. Download `FundedFlow_<version>_x64-setup.exe` and `SHA256SUMS.txt`.
> 2. Check the download in PowerShell:
>    `Get-FileHash .\FundedFlow_<version>_x64-setup.exe -Algorithm SHA256`
>    The hash must match the line in `SHA256SUMS.txt`. If it doesn't, delete the file and don't run it.
> 3. Run the installer. The installer isn't code-signed yet, so Windows SmartScreen says "Windows protected your PC".
>    Choose **More info**, check the file name, then **Run anyway**. No administrator rights are needed.
> 4. If your PC lacks the Microsoft Edge WebView2 runtime, the installer downloads it from Microsoft, so installing
>    then needs an internet connection. Once installed, FundedFlow works offline.
> 5. On first launch, FundedFlow shows its privacy notice and its License and product information (both drafts,
>    version `0.2.1-draft`). Choose **Acknowledge and continue** to open the app, or **Close** to exit.
>
> **Your data:** the journal is stored, without app encryption, in `%APPDATA%\com.fundedflow.desktop\fundedflow.db`,
> with attachments beside it. FundedFlow doesn't upload it. Exports and copies you save elsewhere are yours to
> protect: saving one in a cloud-synced folder, or sharing it, can transmit it through the services you choose.
>
> **Updating:** download the new installer, verify it the same way and run it. If it offers to uninstall the old
> version first, go ahead, but leave "Delete the application data" **unticked**: that keeps your journal.
> FundedFlow doesn't check for updates.
>
> **Uninstalling** removes the program, its shortcuts and its uninstall entry. With "Delete the application data"
> unticked (the default) it keeps your journal; ticked, it also removes `%APPDATA%\com.fundedflow.desktop` and
> `%LOCALAPPDATA%\com.fundedflow.desktop`. Exports and other copies saved elsewhere are never touched. Uninstall is
> not the journal-erasure control: do not rely on it to remove per-user data, recovery files or exports. To erase
> the journal, export a backup first if you want one, then use Settings → **Delete data permanently** → **Erase the
> entire local journal**.

Sources for the draft (all at `main` `819f967`):

| Statement | Source |
|---|---|
| Windows 10 or 11 | `README.md:7`, `README.md:11` |
| Download, `Get-FileHash`, `SHA256SUMS.txt` | `README.md:76`; workflow summary in [Release workflow](#release-workflow-githubworkflowsrelease-installeryml) |
| Unsigned, SmartScreen, no administrator rights | Decisions in force (unsigned NSIS); `apps/desktop/src-tauri/tauri.conf.json:53-55` (`installMode: currentUser`); `README.md:77` |
| WebView2 downloaded when missing; install then needs internet; offline afterwards | `apps/desktop/src-tauri/tauri.conf.json:49-52` (`downloadBootstrapper`, TASK-006 Option A); `README.md:78` (TASK-026); `apps/desktop/src/legal/privacy-notice.ts:29` |
| First-run screen, document titles and versions, buttons | `apps/desktop/src/features/legal/components/LegalGate.tsx:55-58, 63-67`; `apps/desktop/src/legal/privacy-notice.ts:5-6`; `apps/desktop/src/legal/user-agreement.ts:5-6` |
| Journal path, attachments beside it, no app encryption | `apps/desktop/src/legal/privacy-notice.ts:20, 22` |
| No upload; exports and cloud-synced or shared copies | `apps/desktop/src/legal/privacy-notice.ts:28, 30, 46` |
| Updating, "Delete the application data" unticked | `README.md:79`; Decisions in force (manual updates) |
| Uninstall removal list; copies elsewhere untouched; not the erasure control; Settings erase path | [Uninstall and data](#bundle-configuration-appsdesktopsrc-tauritauriconfjson) (TASK-026); `apps/desktop/src/legal/privacy-notice.ts:46`; `apps/desktop/src/features/data-controls/components/DataControlsPage.tsx:201, 224`. The ticked removal is expected, not yet observed: B4 and TASK-031 confirm it. |
