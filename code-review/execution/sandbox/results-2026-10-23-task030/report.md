# TASK-030: clean smoke and offline acceptance on the candidate

**Gate state on this machine: Blocked.** Every mandatory step that Windows Sandbox could run **passes**. Two mandatory items are still open:
- **R1:** Kyle's real broker export, done by hand.
- **B7:** installing without WebView2. This host's sandbox always contains the host's WebView2, so B7 can't be set up here.

B6 (display scaling) is Kyle's, on a real PC or VM. The Windows 10 22H2 leg is skipped by owner decision (Not Run, known gap).

## Environment
| Item | Value |
|---|---|
| Tester | Kyle Shabaga (driven by Claude Code, coordinator session) |
| Date | 2026-10-23, 19:04–19:37 MDT (America/Edmonton) |
| Machine | Windows Sandbox on the coordinator PC (AMD Ryzen 7 9700X); host Windows 11 Pro 25H2, build 26200.9711 |
| Sandbox OS | Windows 10 Enterprise (EditionID Enterprise), DisplayVersion 24H2, build 26100.9711; user wdagutilityaccount; 8 GB; screen 1136x2007 |
| WebView2 | Before install: pv 155.0.4283.60 registered, runtime folder 155.0.4283.62 (host-provided). The app was launched with WEBVIEW2_BROWSER_EXECUTABLE_FOLDER set to the .62 folder, a sandbox quirk (see Final manual test 1). |
| Candidate | 0.1.1, source 1d13c438c2cfa4752fb57fba8cef693ad3398d8f (contains TASK-018 eeda9a1 and TASK-023 1d13c43), run 40014761941 |
| Installer SHA-256 | 60091DAFD5BD8E6CDF9D40EB4610F75B735C15E0FBF7BE3E5F3B94A7E0048646 (checked on the host and in the sandbox) |
| CSV | synthetic-5.csv (CRLF), 4A8313121EBF377B20C1F7D2FF3E1F4153797672B5CA4B8B7F420287F6A297DA |
| FUNDEDFLOW_* | None at any scope |

Runs:
- S1: base smoke (`C:\FFSandbox\out030s1`)
- S2: B1 (`out030s2`)
- S3: B4 (`out030s3`)
- S4: B7b. Not started (see B7).

## Results
| ID | Expected | Observed | Result |
|---|---|---|---|
| 1 | Hash matches | 60091DAF...0048646, same as SHA256SUMS.txt | PASS |
| 2 | Per-user install, no UAC, Start menu entry, Publisher | Pages: Welcome, Choose Install Location (C:\Users\WDAGUtilityAccount\AppData\Local\FundedFlow, 18.9 MB), Installation Complete, Completing (Run FundedFlow, Create desktop shortcut). No UAC; no SmartScreen in the sandbox. Start menu FundedFlow.lnk. HKCU uninstall entry has Publisher "Kyle Shabaga" and version 0.1.1; no HKLM entry. | PASS |
| 3 | Offline | Disable-NetAdapter; TCP 443 to github.com returns False | PASS |
| 4 | "Before you start", Draft documents banner, both documents at 0.2.1-draft | "Before you start"; "Draft documents" banner; "Your privacy"; "Privacy notice (draft)" and "License and product information (draft)", each "(draft, version 0.2.1-draft)". The privacy notice opens at "Version 0.2.1-draft · Draft dated October 22, 2026". Close and "Acknowledge and continue" are shown; Acknowledge leads to Today's empty state, with no error while offline. | PASS (TASK-025) |
| 4a | LICENSE and THIRD_PARTY_NOTICES.txt next to the exe; same content in the app | The program folder holds fundedflow.exe, LICENSE (1,090 B), THIRD_PARTY_NOTICES.txt (180,081 B) and uninstall.exe. The file starts "FundedFlow third-party notices" and lists Rust crates (232) and npm packages (58). In the app, offline: "Read the third-party notices (293 components)", titled "FundedFlow third-party notices", Rust crates (232). | PASS, with a note: 293 in the app against 232 + 58 = 290 in the file |
| L1 | Privacy & legal shows both documents at 0.2.1-draft, with the banner | "Draft documents" banner; both documents at "Version 0.2.1-draft · Draft dated October 22, 2026" | PASS (TASK-025) |
| 5 | Journal and legal record in %APPDATA% | C:\Users\WDAGUtilityAccount\AppData\Roaming\com.fundedflow.desktop holds fundedflow.db, -shm, -wal, fundedflow.lock and legal-acceptance.json | PASS |
| 6 | Data survives a reopen | Created "Smoke", imported 5 trades, closed. After reopening, the Journal shows "Tue, Nov 1, 2022 · 5 trades". | PASS |
| 7 | No developer tools | No Add Fake Data, Reset All Data or developer items. F12 and Ctrl+Shift+I open nothing. #/settings/developer can't be typed (no address bar) and nothing links to it. | PASS |
| L2 | TASK-044 deletion wording | Description is exactly "Failing or archiving an account keeps its history. Deleting removes it from the journal. Recovery copies FundedFlow keeps on this computer may still hold it until you erase the entire journal." After a restore there are 2 recovery copies. The account-deletion dialog says "2 recovery copies kept by FundedFlow on this computer (pre-upgrade database copies, pre-restore safety copies or leftover restore working files) may still contain this account's data. Deleting the account doesn't change them; erasing the entire journal removes them." "What stays" includes "FundedFlow's recovery copies on this computer stay." The erase dialog says "2 local recovery copies kept by FundedFlow will also be removed." Every dialog was cancelled. | PASS (TASK-044) |
| B5 | Second instance: known limitation, no data loss | The second window shows "Your journal couldn't be opened ... If another copy of FundedFlow or a sync/backup tool is using it, close it and retry. Your data has not been changed." The first window saved a trade note, and the note is still there after relaunch. | PASS |
| B2-j | Export into a junction is refused and nothing is written | Desktop\FFExportJunction points to C:\FFExportTarget. The app shows "Nothing was exported" / "The archive contains an unsafe file path, so it was rejected." The target is empty, there is no stray file on the Desktop, the %TEMP% file count is unchanged, and the journal is intact. The OneDrive case is out of scope by owner decision. | PASS |
| 8 | Unticked uninstall keeps the journal | The program folder, the Start menu and desktop shortcuts, and the HKCU uninstall entry are gone. %APPDATA%\com.fundedflow.desktop is fully kept (db, legal record, data-controls recovery copies), and so is %LOCALAPPDATA%\com.fundedflow.desktop\EBWebView. | PASS |
| 9 | Offline reinstall opens the data with no legal re-prompt | /S exit code 0 while offline; no first-run screen; the Smoke account, its trades and the B5 note are all there | PASS |
| 10 | Over-install keeps the journal | NSIS "Already Installed", Add/Reinstall components, Install Location, Complete, Finish. Journal and note kept. | PASS |
| R1 | Kyle's real export (counts only) | Not done; needs Kyle by hand | NOT RUN (Kyle) |
| 11 | Optional network check | Not run | NOT RUN (optional) |
| B1-1 | Standard profile reaches the app | Today shown; db and lock in %APPDATA% | PASS (TASK-018) |
| B1-2 | Roaming behind a junction reaches the app | C:\FFRelocated points to C:\FFRelocatedReal, with AppData redirected there. First-run then Today, no Retry. The journal is visible both through the link and in the real folder. | PASS |
| B1-3 | The app folder itself is a junction | First-run screen; after Acknowledge, "FundedFlow doesn't trust its data folder" with "Stage: data_directory" and no Retry. The junction target holds only legal-acceptance.json (known gap 6), no db or lock file. | PASS |
| B1-4 | Undo | Original folder restored; Today opens with its data, no first-run | PASS |
| B3, B8 | Close and back guards | From Final manual test 1 (same candidate, same day): 14/14 PASS | PASS |
| B4 | Ticked uninstall removes exactly the documented list | Before: the program folder, %APPDATA%\com.fundedflow.desktop, %LOCALAPPDATA%\com.fundedflow.desktop\EBWebView, the shortcuts and the uninstall entry. After a ticked "Delete the application data", all of them are gone. C:\FFExports\b4-backup.ffj.zip remains with the same SHA-256 (38FC43D4...). | PASS |
| B6 | Display scaling | Kyle's, on a real PC or VM | NOT RUN (Kyle) |
| B7a/b | Install without WebView2, online and offline | This host's sandbox always has the host's WebView2 (155.0.4283.62), so "without WebView2" can't be set up here. B7a evidence exists from a different build: the earlier sandbox on Kyle's other PC (build 28000, 2026-10-23) had no WebView2, and the installer downloaded 156.0.4314.42 in about 70 s and launched. | NOT RUN here |
| Win10 22H2 | — | Skipped by owner decision | NOT RUN (known gap) |

## Surprises and proposed Triage titles
- **Third-party notice count:** the app shows 293 components, but the file's sections add up to 232 Rust + 58 npm = 290. Low priority; the extra 3 may be FundedFlow itself or grouped entries.
- **WebView2 registration in this host's sandbox:** the registry entry is stale, so FundedFlow can't find the runtime until the folder is set explicitly. This is not a product defect.
- **Desktop shortcut:** the finish page ticks "Create desktop shortcut" by default. Note only.
