# TASK-032: manual recovery on the candidate

**Gate state: PASSED.** R0–R8 all match their expected results, with no data loss. R9 and R10 are Not Run; both are optional and record-only.

## Environment
| Item | Value |
|---|---|
| Tester | Kyle Shabaga (driven by Claude Code, coordinator session) |
| Date | 2026-10-23, 19:53–20:40 MDT |
| Machine | Windows Sandbox on the coordinator PC (AMD Ryzen 7 9700X). Each run in a fresh sandbox: Windows 10 Enterprise 24H2, build 26100.9711, wdagutilityaccount, 8 GB. |
| WebView2 | Host-provided 155.0.4283.62, launched with WEBVIEW2_BROWSER_EXECUTABLE_FOLDER (sandbox quirk) |
| Candidate | 0.1.1, source 1d13c438c2cfa4752fb57fba8cef693ad3398d8f, EXE SHA-256 60091DAFD5BD8E6CDF9D40EB4610F75B735C15E0FBF7BE3E5F3B94A7E0048646 |
| CSVs | synthetic-5 4A831312...; synthetic-50k 6E1404CB...; synthetic-40k (first 40,000 rows of 50k) E2209286F530BA6608B9A52EE01D1BED3D82D6B675733215A5643F22AE05D2D4 |
| sqlite3 | sqlite-tools-win-x64-3540100.zip, 6,984,432 B, SHA3-256 e171f3993a992edf076746926dd52b5e2ebfabaee38818e74987e1d8112ab987 (matches sqlite.org); version 3.54.1 |
| FUNDEDFLOW_* | Unset |

Runs: P1 (R0, R6, R7), P2 (R1, R2), P3 (R3, R4), P4 (R5: a prep run plus 4 attempts), P5 (R8). Detailed notes: `p1-notes.md` (all runs) and `r5-results.txt`.

## Results
| # | Expected | Observed | Result | Data loss |
|---|---|---|---|---|
| R0 | "Journal restored" only after Ready; data matches | Export r0.ffj.zip (1,159,628 B, SHA-256 8590BB17...). Erased the whole journal, then restored. "Journal restored" appeared about 1.4 s after confirming, with the runtime showing "Local data is available." 5 trades and both screenshots are back. | PASS | No |
| R1 | Locked journal: explained, Retry, then Ready | "Your journal couldn't be opened" / "FundedFlow could not open your journal database. If another copy of FundedFlow or a sync/backup tool is using it, close it and retry. Your data has not been changed." Retry shown; Stage: open. After unlocking, Retry reached Ready with 5 trades. | PASS | No |
| R2 | Corrupt header: explained, no empty-journal claim, file untouched | Same open-failure screen with Retry, which fails again. No empty state. SHA-256 BB53CCA8... before and after. | PASS (wording note) | No |
| R3 | Failed migration rolled back, names the .bak; opens after the fix | "Your journal upgrade didn't finish" / "Upgrading your journal failed at step 23 and that step was rolled back, so your data has not been changed. A copy from before the upgrade is saved as fundedflow.db.before-v23.bak. ..." Retry shown; "Journal version 22; this app supports 23. Stage: migrate." After the fix, the journal opens with 5 trades. | PASS | No |
| R4 | NewerSchema refused, no Retry, reset or downgrade; file untouched | "This journal needs a newer FundedFlow" / "Your journal was created by a newer version of FundedFlow. Install the latest version to open it. Your data has not been changed." "Journal version 24; this app supports 23. Stage: open." No Retry or reset. SHA-256 58DA19C7... unchanged. | PASS | No |
| R5 | Interrupted restore ends pre-restore or fully restored, never a mix | Big archive: 40,000 trades, 113,656,963 B, SHA-256 7BB597C7.... Killed at 0.5 s, 1 s and 2 s after confirming: no pending marker; 5 files left in data-controls-work; on relaunch, Ready with the **pre-restore** journal (Base: 5). At 4 s the restore had already finished: Ready with the **fully restored** journal (Big archive: 40,000). | PASS | No |
| R6 | Zero-byte or non-regular markers still reach Ready, at startup and at restore prepare | A 0-byte `<guid>.json` and a directory named `<guid>.json` in data-controls-cleanup: the app started, and both were moved to data-controls-quarantine. The same two entries created while running: the restore succeeded and both were quarantined. | PASS | No |
| R7 | Stray file kept in the safety folder; missing screenshot doesn't block | A stray `attachments\screenshots\<uuid>.png` was preserved at `data-controls\<uuid>\safety-attachments\screenshots\`. With a referenced screenshot deleted, the restore succeeded (the file came back from the archive). The erase showed "Some screenshots are already missing or changed ... erased with the journal" and completed. | PASS | No |
| R8 | Free pages over 64 MiB with small live data: export succeeds without vacuuming the live db; previews work; over-cap live data refused | After importing three 50k accounts and deleting them: page_size 4096, freelist 27,887 of 28,163 pages (114,225,152 free bytes), db 115,355,648 B, live data 5 trades. Export r8b.ffj.zip succeeded (1,153,085 B, SHA-256 C6ADDC02..., shown on screen). The db size and freelist were unchanged afterwards. The erase preview and restore inspect both opened. With 50,005 live trades: "Nothing was exported" / "This is larger than the supported archive limits. Over the limit: data.json: 72071044 bytes, limit 67108864 bytes." Nothing written, %TEMP% unchanged, journal unchanged. | PASS | No |
| R9 | Antivirus lock | Not run. Defender behaviour in the sandbox isn't representative. | NOT RUN (optional) | — |
| R10 | Uncertain write | Not run. No reliable method is known. **Triage card needed: R10 uncertain-write packaged check.** | NOT RUN | — |

## Notes and proposed triage titles
- **Corrupt journal message:** "Corrupt journal shows the lock-oriented open-failure text". In R2 the message says "If another copy of FundedFlow or a sync/backup tool is using it…", which is misleading for a damaged file. Low priority.
- **Unrecognised file in attachments:** "Unrecognised file in the attachments root blocks restore (by design) — release-note it". A non-FundedFlow name at `attachments\` makes restore refuse with "A file in FundedFlow's attachments folder wasn't created by FundedFlow and belongs to no record, so nothing was changed. Move it out of that folder, then try again." Safe; this is TASK-016's behaviour.
- **Restore working files after a kill:** "Interrupted restore leaves files in data-controls-work". After a kill at 0.5–2 s, 5 working files remain in data-controls-work and the app opens normally. Whether a later start cleans them up was not checked. TASK-044 already says "leftover restore working files" may remain.
- **Exporting into the sandbox's mapped folder** (C:\FFOut, a host-mapped path) is refused with "Nothing was exported". That is consistent with the link checks; not a defect.
- **R10:** "R10 uncertain-write packaged check" (from the spec).
