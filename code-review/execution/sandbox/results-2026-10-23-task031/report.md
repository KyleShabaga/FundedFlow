# TASK-031: upgrade, reinstall, downgrade and uninstall on the candidate

**Gate state: PASSED.** All three pass rules hold:
- **(a)** Synthetic data is intact after the 0.1.0 → 0.1.1 upgrade and after the same-version reinstall.
- **(b)** An unticked uninstall keeps `%APPDATA%\com.fundedflow.desktop`.
- **(c)** A ticked uninstall removes exactly the TASK-026 list.

Step 4 (downgrade) is recorded below. Step 4a is Not Run by owner decision.

## Environment
| Item | Value |
|---|---|
| Tester | Kyle Shabaga (driven by Claude Code, coordinator session) |
| Date | 2026-10-23, 19:37–19:52 MDT |
| Machine | Windows Sandbox on the coordinator PC; sandbox Windows 10 Enterprise 24H2, build 26100.9711; user wdagutilityaccount; 8 GB |
| WebView2 | Host-provided 155.0.4283.62. The registry pv in the sandbox was stale, so the app was launched with WEBVIEW2_BROWSER_EXECUTABLE_FOLDER (sandbox quirk, see Final manual test 1). |
| Candidate | 0.1.1, source 1d13c438c2cfa4752fb57fba8cef693ad3398d8f, EXE SHA-256 60091DAFD5BD8E6CDF9D40EB4610F75B735C15E0FBF7BE3E5F3B94A7E0048646 |
| Baseline | FundedFlow_0.1.0_x64-setup.exe, source 7679edc, SHA-256 041983F565C7F6B41DBA2388C2F21BC8C4C7402C94E442ED0F75D00938E0787F (checked 2026-10-23). Kept copy: C:\Users\Kyle\Documents\FundedFlow-release-artifacts\0.1.0-7679edc\ |
| CSV | synthetic-5.csv (CRLF), 4A8313121EBF377B20C1F7D2FF3E1F4153797672B5CA4B8B7F420287F6A297DA |
| FUNDEDFLOW_* | Unset |

Runs: T1 (`C:\FFSandbox\out031t1`) and T2 (`out031t2`), each in a fresh sandbox.

## Results
| ID | Expected | Observed | Result |
|---|---|---|---|
| 0 | Baseline hash | 041983F5...0E0787F matches | PASS |
| 1 | 0.1.0 install and data | 0.1.0 installed (pages: Welcome, Install Location, Complete, Finish; copyright "All rights reserved"; no LICENSE file in the program folder). **0.1.0 shows no first-run screen.** Account "Upgrade" created; 5 trades imported; trade review note "T031-note" saved; full backup exported to C:\FFExports\t031-010.ffj.zip (1,140,277 B, SHA-256 E79392E3...). Screenshots were NOT attached (simplified; see Notes). | PASS (screenshots not tested) |
| 2 | Upgrade to 0.1.1, acknowledgment, data intact | The 0.1.1 installer shows "Already Installed": "An older version of FundedFlow is installed on your system. It's recommended that you uninstall the current version before installing." Options: "Uninstall before installing" (default) or "Do not uninstall". The old 0.1.0 uninstaller ran with "Delete the application data" unticked, then setup continued. On launch, "Before you start" listed "Privacy notice (draft)" and "License and product information (draft)", both "(draft, version 0.2.1-draft)". After Acknowledge, the account "Upgrade", the 5 trades and "T031-note" are intact. Settings shows journal version 23. fundedflow.db.before-v23.bak (1,097,728 B) was created. | PASS (a) |
| 3 | Same-version reinstall, no prompt, data intact | "Already Installed": 0.1.1 maintenance (Add/Reinstall). No acknowledgment prompt; note and trades intact. | PASS (a) |
| 5u | Unticked uninstall keeps the journal | "Delete the application data" defaults to unticked. Afterwards the program folder, shortcuts and uninstall entry are gone. %APPDATA%\com.fundedflow.desktop is kept: fundedflow.db, -shm, -wal, fundedflow.db.before-v23.bak, fundedflow.lock and legal-acceptance.json. %LOCALAPPDATA%\com.fundedflow.desktop\EBWebView is kept. The archive SHA-256 is unchanged. | PASS (b) |
| 5r | Reinstall restores access | /S exit code 0; no prompt; "T031-note" and the trades are intact | PASS |
| 5t | Ticked uninstall removes exactly the list | %APPDATA%\com.fundedflow.desktop and %LOCALAPPDATA%\com.fundedflow.desktop are gone, along with the program folder, Start menu and desktop shortcuts, and the uninstall entry. C:\FFExports archive is still present, same SHA-256. Nothing else of FundedFlow's remains. | PASS (c) |
| T2-setup | 0.1.0 data upgraded to 0.1.1 | Account "Downgrade" with 5 trades; upgraded and acknowledged | PASS |
| 4 | Downgrade 0.1.1 → 0.1.0 (record only) | The 0.1.0 installer shows "Already Installed": "A newer version of FundedFlow is already installed! It is not recommended that you install an older version. If you really want to install this older version, it's better to uninstall the current version first." Options: "Uninstall before installing" (default) or "Do not uninstall". The 0.1.1 uninstaller ran (data kept), then 0.1.0 installed. On launch, 0.1.0 shows "This journal needs a newer FundedFlow" / "Your journal was created by a newer version of FundedFlow. Install the latest version to open it. Your data has not been changed.", with no Retry. | RECORDED (refusal as predicted) |
| 4-back | Reinstall 0.1.1; data intact | The setup ran the 0.1.0 uninstaller (data kept), then installed 0.1.1. No acknowledgment prompt; account "Downgrade" and 5 trades intact. | PASS |
| 4a, 4a-opt | — | Owner decision 2026-10-23: premise changed (the candidate's journal is schema 23, which 0.1.0 can't open) | NOT RUN |

## Notes and observations
- **The 0.1.0 launch rewrote the db file without changing its content.** In step 4, 0.1.0 opened the journal before refusing it. The WAL was checkpointed into the main file: fundedflow.db grew from 4,096 B to 1,130,496 B, the -wal file disappeared, and the file hash changed. The logical content is unchanged (4-back reopens all data in 0.1.1), so "Your data has not been changed" holds in substance but not byte-for-byte. Proposed low-priority triage title: "Older build checkpoints the WAL before refusing a newer schema (file bytes change, data does not)".
- **Screenshots not covered.** Step 1's "attach 2 PNG screenshots" was skipped to save time. Screenshot survival across the upgrade is therefore not covered by this run. The TASK-017 automated tests cover attachments.
- **Upgrade behaviour.** "Uninstall before installing" runs the old version's own uninstaller with "Delete the application data" unticked by default, and the journal is kept. Choosing that option and ticking the box would delete the journal during an upgrade. That is NSIS default behaviour; a note for the release notes.
