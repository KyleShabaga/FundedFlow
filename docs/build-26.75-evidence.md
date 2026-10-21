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
- **No phone-home.** Neither the installer nor the app contacts a server of ours. The one network touch is
  Microsoft's WebView2 bootstrapper, and only on a machine without WebView2 (below).

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
| Licence page | none | The user agreement is shown in the app (NA-3), not by the installer. |

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

**Uninstall and data.** Tauri's NSIS uninstaller has a "Delete the application data" checkbox, **unchecked by
default**. Left unchecked, the journal (`%APPDATA%\com.fundedflow.desktop\fundedflow.db` and its backups) and the
WebView2 profile (`%LOCALAPPDATA%\com.fundedflow.desktop`) are kept, so a reinstall opens the existing journal. Checked,
both folders are removed. The smoke confirms this on a real machine (steps 8–9).

**Developer tools cannot ship.** `tauri build` always runs `beforeBuildCommand` (`npm run build`), whose `build:app`
ends with `scripts/check-no-dev-tools.mjs`; a leak exits non-zero and fails the build. The workflow never passes
`--no-before-build-command`, and runs the same check again on the bundled `dist` afterwards. On the Rust side the
dev commands are registered only under `cfg(debug_assertions)`, which a release build excludes.

## Release workflow (`.github/workflows/release-installer.yml`)

- **Triggers:** manual (`workflow_dispatch`), tags `v*`, and pull requests that change `tauri.conf.json` or the workflow.
- **Job (`windows-latest`, `permissions: contents: read`, no secrets):** checkout → Node LTS with npm cache → `npm ci` →
  stable Rust with `x86_64-pc-windows-msvc` → rust-cache → read the version from `tauri.conf.json` (a `v*` tag must
  equal `v<version>`) → `npm run tauri -- build` → dev-tools check → exactly one `.exe` in
  `target/release/bundle/nsis/` → `Get-FileHash` → `SHA256SUMS.txt` → `upload-artifact`.
- **Source SHA:** a pull request builds its **head commit**, not GitHub's temporary merge commit, so the recorded SHA
  is a real commit you can check out. Tag and manual runs use `github.sha`.
- **Artifact:** `fundedflow-<version>-<short sha>-windows-nsis`, containing the installer and `SHA256SUMS.txt`; kept
  30 days. The hash and SHA are also in the run's job summary.
- `SHA256SUMS.txt` has three `#` comment lines (title, `source_sha`, `version`) and one `<sha256>  <file>` line.

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
has a different hash (the build is not bit-for-bit reproducible) and is not the one to test.

## Clean-machine smoke checklist (owner; not yet run)

Machine: a fresh Windows 11 VM or Windows Sandbox with **no** Node, Rust, Visual Studio or other developer tooling.

| | |
|---|---|
| Tester / date | |
| Windows edition and build (`winver`) | |
| WebView2 runtime present before install? (Installed apps → "Microsoft Edge WebView2 Runtime") | |
| Artifact name | |
| Installer SHA-256 | |
| Source SHA | |

| # | Step | Expected | Pass/Fail | Notes |
|---|---|---|---|---|
| 1 | Download the artifact zip from the run, extract it, and run `Get-FileHash .\FundedFlow_<version>_x64-setup.exe -Algorithm SHA256`. | Matches `SHA256SUMS.txt` and the table above (case-insensitive). | | |
| 2 | Run the installer. SmartScreen shows "Windows protected your PC" because it is unsigned: choose **More info → Run anyway**. | No UAC prompt (per-user install). Installs to `%LOCALAPPDATA%\FundedFlow`; Start menu entry created. Publisher shows "Kyle Shabaga" in Installed apps. | | |
| 3 | Disconnect the network (disable the adapter, or in Sandbox turn networking off). | Offline from here to step 10. | | |
| 4 | First launch. | The runtime gate shows briefly, then Today's empty state. No error, no network prompt. | | |
| 5 | Record the exact journal path (`dir $env:APPDATA\com.fundedflow.desktop`). | `fundedflow.db` exists under `%APPDATA%\com.fundedflow.desktop`. Write the full path. | | |
| 6 | Create an account, import a small synthetic CSV (a few rows; not real trading data), close the app, reopen. | Account and trades are still there after reopening. | | |
| 7 | Look for developer tools: sidebar has no **Add Fake Data** / **Reset All Data**; `#/settings/developer` is not reachable; F12 / Ctrl+Shift+I do nothing. | None visible. | | |
| 8 | Uninstall from Installed apps, leaving "Delete the application data" **unchecked**. List what remains: `%LOCALAPPDATA%\FundedFlow`, `%APPDATA%\com.fundedflow.desktop`, `%LOCALAPPDATA%\com.fundedflow.desktop`, Start menu, `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall`. | Program files, shortcuts and the uninstall entry are gone; the journal folder remains. Record exactly what is left. | | |
| 9 | Reinstall with the same installer and launch. | The step-6 account and trades open. | | |
| 10 | Run the same installer again over the existing install (choose the reinstall option if offered). Launch. | Install completes; the journal is kept. | | |
| 11 | Optional: with the network reconnected, run Resource Monitor (Network tab) or Wireshark while using the app for a few minutes. No connections from `fundedflow.exe` or its `msedgewebview2.exe` children to non-Microsoft hosts. WebView2 itself may contact Microsoft (for example SmartScreen); record any such hosts. | | |

Attach screenshots of steps 2, 4, 5, 8 and 9. Any failure gets a Triage card.

## Install and verify (for the NA-7 release notes)

> **Install FundedFlow on Windows 10 or 11**
>
> 1. Download `FundedFlow_<version>_x64-setup.exe` and `SHA256SUMS.txt`.
> 2. Check the download in PowerShell:
>    `Get-FileHash .\FundedFlow_<version>_x64-setup.exe -Algorithm SHA256`
>    The hash must match the line in `SHA256SUMS.txt`. If it doesn't, delete the file and don't run it.
> 3. Run the installer. The installer isn't code-signed yet, so Windows SmartScreen says "Windows protected your PC".
>    Choose **More info**, check the file name, then **Run anyway**. No administrator rights are needed.
> 4. FundedFlow works offline. If your PC lacks the Microsoft Edge WebView2 runtime (Windows 10 and 11 normally
>    include it), the installer downloads it from Microsoft once.
>
> **Your data** lives in `%APPDATA%\com.fundedflow.desktop\fundedflow.db` on this PC only.
>
> **Updating:** download the new installer, verify it the same way and run it. If it offers to uninstall the old
> version first, go ahead, but leave "Delete the application data" **unticked**: that keeps your journal.
> FundedFlow doesn't check for updates.
>
> **Uninstalling** keeps your journal unless you tick "Delete the application data".
