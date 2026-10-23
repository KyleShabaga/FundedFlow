# TASK-011(b) Windows Sandbox results — FundedFlow 0.1.1 (main eeda9a1)

**Summary:** B1, B2 and B3-undo pass. B3 shows only the first-run screen until "Acknowledge and continue" is clicked. After the click it shows the non-retry "data folder is a link" error (Run 3). Acknowledging first writes legal-acceptance.json through the junction.

- Installer: `FundedFlow_0.1.1_x64-setup.exe` from run 39991525917. SHA-256 `91c1288926ac35503545b1a59ea73dda2838c1114b6ed72ce5341deb7a51e29c` (matches). Silent install exit code 0.
- Sandbox: Windows 10 Enterprise 26H1 28000.2269, user wdagutilityaccount. No WebView2 before install, no APPDATA folder before install, `FUNDEDFLOW_DEV_DATA_DIR` not set.

## Run 1 — `run-cases.ps1 -Build new` (branch claude/practical-turing-wmii06)

| Case | Screen | Error / Retry | Data folder | Result |
|---|---|---|---|---|
| B1 standard profile | "Before you start" | none / no | fundedflow.db, -shm, -wal and fundedflow.lock | PASS |
| B3 app folder is a junction (`<APPDATA>\com.fundedflow.desktop` → `C:\FFJunctionTarget\com.fundedflow.desktop`) | "Before you start" | none / no | junction and its target both **empty** | **FAIL** (expected a non-retry data_folder_link error) |
| B3 undo + relaunch | "Before you start" | none / no | the restored folder still has its db files | PASS |
| B2 Roaming behind a junction (`C:\FFRelocated` → `C:\FFRelocatedReal`, User Shell Folders\AppData = `C:\FFRelocated\Roaming`) | "Before you start" | none / no | db files present, seen both through the link and in the real folder | PASS |

The app was still running after 20 s in every case. transcript.txt has no errors.

## Run 2 — B3 only (custom probe, same state as before)

The probe did one normal launch first. It then renamed the original folder and created the junction.

- Screenshots at 5 s, 20 s and 60 s: all show "Before you start", with Close and "Acknowledge and continue" buttons. No error and no Retry. The 5 s and 20 s screenshots are byte-identical.
- fundedflow.exe was still running at 60 s (window title "FundedFlow", 6 msedgewebview2 child processes) and never exited.
- I searched for fundedflow* files under C:\Users and C:\FF* before launch, at 5/20/60 s and after stop. **The app created no fundedflow.db or fundedflow.lock anywhere during B3.** The only db files were the ones in `com.fundedflow.desktop.b3-orig` from the setup launch, and B3 didn't change them. The junction and its target stayed empty. Besides those, the app only has its own WebView storage folder (`AppData\Local\com.fundedflow.desktop\EBWebView`).
- Logs: only WebView2's internal .log files exist. None mentions data_folder, a link, a retry or an error. The transcript has no errors.

## Run 3 — B3 + Acknowledge (`b3-ack.ps1`)

**Summary:** after "Acknowledge and continue", the expected non-retry data-folder-is-a-link error appears. Before the click, the first-run screen is shown. The acknowledgement writes `legal-acceptance.json` through the junction into its target.

- Setup: the installer hash was checked again (matches) and the silent install exited with code 0. One normal launch (15 s) created fundedflow.db, -shm, -wal and fundedflow.lock at 12:07:28. The folder was then renamed to `.b3-orig` and a junction was created pointing to `C:\FFJunctionTarget\com.fundedflow.desktop`.
- **Click method:** UI Automation `InvokePattern` worked on the first try. The button was found and already enabled, and Invoke() was called at 12:08:03. The SendKeys fallback wasn't needed. The documents didn't need to be opened first.

| Screenshot | Screen | Text | Buttons | Retry? |
|---|---|---|---|---|
| 1-before-ack (15 s) | First-run screen | "Before you start" | Close, Acknowledge and continue | no |
| 2-after-ack (+10 s) | Main app, Today page, with the sidebar. Subtitle: "Accounts unavailable" | error card (text below) | Quick Import, Collapse sidebar, "Diagnostic summary" expander | **no** |
| 3-after-ack-30s (+30 s) | Identical to 2 (PNG and on-screen text are byte-identical) | same | same | no |

Error card text:
> **FundedFlow doesn't trust its data folder**
> The data folder is behind a link FundedFlow does not trust, so your journal was not opened. Your data has not been changed. Replace the link with a real folder, then restart FundedFlow.
> The FundedFlow data folder is a link (a symbolic link, junction or mount point) to another place. Replace it with a real folder that holds the same files, then restart FundedFlow. Keep your journal files.
> Journal version unknown; this app supports 22. Stage: data_directory.

The literal text `data_folder_link` doesn't appear on screen. It may be inside the Diagnostic summary, which stayed closed. The app was still running 30 s after the click.

**Listings after the click:**
- `C:\FFJunctionTarget\com.fundedflow.desktop`: `legal-acceptance.json` (383 bytes, written at 12:08:03.377, 40 ms after the click)
- `%APPDATA%\com.fundedflow.desktop.b3-orig`: fundedflow.db (4096 bytes), -shm (32768), -wal (1561512), fundedflow.lock (0). All are from 12:07:28 and unchanged.
- Is legal-acceptance.json in the junction target? **Yes.**
- Did any new fundedflow.db or fundedflow.lock appear under C:\Users or C:\FF*? **No** (checked before launch, before the click, 10 s and 30 s after it, and after stop).
- Transcript: no errors.

**What this suggests:** the first-run screen doesn't check the data folder. So acknowledging writes legal-acceptance.json through the junction into a folder the app later refuses to trust. The check only runs after that, when the app tries to open the journal. Earlier runs never got past the first-run screen because the scripts didn't click anything.

## Interpretation (runs 1–2, before Run 3)

On a normal launch the app creates its db within about 2 s. With the junction it creates nothing, so the backend seems to refuse the folder. But that refusal never shows in the interface: the window stays on the first-run screen instead of showing the data_folder_link error. Either the refusal isn't passed to the window, or the first-run screen is chosen before the data-folder check runs.

Not tested: whether clicking "Acknowledge and continue" would then show the error (the scripts click nothing).

Output files on the tester's PC: `C:\FFSandbox\out\new` and `C:\FFSandbox\out\b3`. Probe script: `C:\FFSandbox\kit\b3-probe.ps1`.
