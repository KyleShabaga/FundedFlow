# FundedFlow TASK-011 (a, b6, c) + TASK-022 — Windows Sandbox results

FundedFlow 0.1.1, built from main `eeda9a1` (CI run 39991525917). All runs took place on 2026-10-23, each in a fresh Windows Sandbox. Nothing was installed or run on the host PC, and nothing was signed in. The tests used only the synthetic CSVs.

## Summary

| Area | Result |
|---|---|
| **TASK-011(a) A1–A6**: window close with unsaved text | **No prompt in any case.** The X button and Alt+F4 both closed the window immediately, and the typed text was gone after relaunch. The app's own dialog never appeared, and neither did a native "Leave site?" box. |
| A7–A8 controls | Closed immediately (as expected). |
| **TASK-022 (Run B)**: mouse X1 and Alt+Left on an unsaved daily review | **No dialog.** Both navigated straight back to the Journal. The text wasn't in the field afterwards, but the review page then offered "You have unsaved edits from earlier → Restore them", which brought it back. An in-app sidebar link *does* show "Leave without saving the review?", and Cancel keeps the text. |
| **TASK-011 B6 (Run C)**: export into a junctioned folder | **Refused:** "Nothing was exported — The archive contains an unsafe file path, so it was rejected." Nothing was written to the target, not even a temp or partial file. The same export to a normal folder succeeded. |
| **TASK-011(c) C1–C3**: 50,000 rows | Preview in about 3 s per step, with 50,000 new and 0 errors. Import in **10.7 s**. Export refused for **data.json 72,059,754 bytes > 67,108,864 limit** (the known V1 gap), shown after 3.0 s. The window stayed responsive throughout. |

## Environment

The same environment was recorded in all three sandboxes (`environment.json` in `out/runAB`, `out/runC`, `out/runD`).

| Item | Value |
|---|---|
| OS | Windows 10 Enterprise (EditionID `Enterprise`), DisplayVersion 26H1, build **28000.2269** (CurrentBuild.UBR) |
| whoami | `<sandbox>\wdagutilityaccount` |
| WebView2 after install | `HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-…}` pv = **156.0.4314.42** (none before install; the installer took ~70 s, including the WebView2 download) |
| Installer | `FundedFlow_0.1.1_x64-setup.exe`, SHA-256 `91c1288926ac35503545b1a59ea73dda2838c1114b6ed72ce5341deb7a51e29c` ✔, `/S` exit code 0 |
| synthetic-5.csv | 496 bytes, SHA-256 `4a8313121ebf377b20c1f7d2ff3e1f4153797672b5ca4b8b7f420287f6a297da` ✔ |
| synthetic-50k.csv | 4,166,174 bytes, SHA-256 `6e1404cbf24a8c9e0bace76481f0750ff7f3d11501f74055e6b04343a93f189f` ✔ |
| FUNDEDFLOW_DEV_DATA_DIR / FUNDEDFLOW_UPDATE_FIXTURES | unset at Process, User and Machine level |
| CPU | AMD Ryzen 5 5600U with Radeon Graphics (6 cores / 12 logical, as reported in the sandbox) |
| RAM | 3.99 GB |
| Disk C: | 79.9 GB total, 75.9 GB free (Get-Volume and Get-PhysicalDisk return nothing inside the sandbox) |

**CSV line endings.** GitHub returns both CSVs with LF line endings. Downloaded as-is, their hashes were `a8a956fb…beaea0` (5) and `691db3b9…1ccf1d5` (50k), which don't match. Converted to CRLF, both match the expected hashes exactly. So the expected hashes are for a Windows (CRLF) checkout. The runs used the CRLF copies. The LF originals are in `C:\FFSandbox\kit-src`.

## How the app was driven

- UI Automation (`InvokePattern`, `TogglePattern`, and focus plus `SendKeys` for typing) drove the WebView2 content.
- Alt+F4, Alt+Left and mouse X1 were sent with `SendInput`.
- The title-bar X was a real mouse click at the X position. Tauri's native frame exposes no TitleBar element.
- The native Open/Save dialog was found through UIA (`#32770`, file-name box `Edit` 1148 or 1001). Paths were typed into that box.
- Radix dropdowns (Date order) needed keyboard input; `SelectionItem` and `Invoke` failed on them.
- A screenshot and a UIA text dump (`*.uia.txt`) were saved after each step that mattered.
- Every step file and its output is in `out/<run>/cmd/`.

## Run A — window close with unsaved text (TASK-011 a)

Setup: account "Close test" (Evaluation, USD 50,000, America/Denver). I imported synthetic-5.csv (Year-month-day, default zone America/Denver): 5 imported, 0 duplicates, 0 errors. Then Rulebook → "Write my own rules" → dialog "Start your own rules" → **Create draft**. That opens the draft editor "Close test rules · v1 · DRAFT".

| Case | Field | Close | Prompt (exact title/text) | App dialog or native? | Cancel/Stay keeps window + text | Leave closes | Text after relaunch |
|---|---|---|---|---|---|---|---|
| A1 | Rulebook draft "What changes and why" | title-bar X | **none**; the window closed within 3 s and the process exited | n/a | n/a | n/a | **No** (field empty; the draft list shows reason "None given") |
| A2 | same | Alt+F4 | **none**; closed at once | n/a | n/a | n/a | **No** |
| A3 | Trade SYNA 2022-11-01 14:00 → review "Notes and reflection" | X | **none**; closed at once | n/a | n/a | n/a | **No** |
| A4 | same | Alt+F4 | **none**; closed at once | n/a | n/a | n/a | **No** |
| A5 | Daily review Tue, Nov 1, 2022, first box "Focus for the session" | X | **none**; closed at once | n/a | n/a | n/a | **No** (and no "Restore them" offer) |
| A6 | same | Alt+F4 | **none**; closed at once | n/a | n/a | n/a | **No** (no restore offer) |
| A7 | Clean window (Today) | X | none, closed at once ✔ | — | — | — | — |
| A8 | Rulebook draft opened, nothing typed | Alt+F4 | none, closed at once ✔ | — | — | — | — |

For every case, the typed marker was confirmed in the field through UIA ValuePattern just before closing. The screenshots are `A*-1-typed.png`, then `A*-2-prompt.png` (which shows the desktop), then `A*-3-after-relaunch.png`.

**Notes:**
- The trade review editor is on the trade page. Its field is "Notes and reflection", not "Reflection".
- "Write my own rules" first opens a "Start your own rules" dialog, which has its own "What changes and why" box. A1/A2 used the field in the draft editor after "Create draft".

## Run B — TASK-022 back navigation (same sandbox as Run A)

Daily review for Tue, Nov 1, 2022, opened from Journal → "Plan / review day", with a marker typed in "Focus for the session".

| Input | Dialog shown? | Result | Typed text |
|---|---|---|---|
| Mouse X1 (SendInput XBUTTON1) | **No** | Navigated straight back to Journal (`#/journal`) | Not in the field on return. The page showed "Unsaved changes — **You have unsaved edits from earlier**. They were made on this version of the review. [Restore them] [Discard]". *Restore them* brought the marker back. |
| Alt+Left (SendInput) | **No** | Navigated straight back to Journal | Same as above: a restore banner on return |
| Control: sidebar link "Today" (in-app navigation) | **Yes**: app dialog **"Leave without saving the review?"** / "Your edits stay available to restore in this window when you come back to this day." Buttons: **Cancel**, **Leave** | Cancel kept the page and the text (`TASK022-ctrl-unsaved` still in the field) | Kept |

Expected was the app's "Leave without saving the review?" dialog for X1 and Alt+Left. **That didn't happen.** The guard only fires for in-app link navigation. Back navigation passes through without it, and only the restore banner recovers the text. The restore banner did not appear after a window close and relaunch (A5/A6).

## Run C — export to a junctioned folder (TASK-011 B6)

Fresh sandbox: account "Export test", with synthetic-5.csv imported (5 trades). I created `Desktop\FFExportJunction` → `C:\FFExportTarget`; `dir /AL` confirms `<JUNCTION> FFExportJunction [\??\C:\FFExportTarget]`.

Settings → Export → **Full backup (.ffj.zip)**. The export first said "Nothing was exported — Confirm that you understand the file is not encrypted." That's expected, because "I understand this file is not encrypted" has to be ticked first. I ticked it, then chose "Choose location and export…" → Save As → navigated into `C:\Users\WDAGUtilityAccount\Desktop\FFExportJunction` → file name `fundedflow-2026-10-23.ffj` (the default) → Enter.

| Item | Result |
|---|---|
| On-screen result | **Refused**: "**Nothing was exported**" / "**The archive contains an unsafe file path, so it was rejected.**" |
| `Get-ChildItem -Force C:\FFExportTarget` | **Empty**: no files, no partial or temp files |
| Desktop after the attempt | only `FFExportJunction`, `desktop.ini` and the two shortcuts; no stray backup file (%TEMP% wasn't checked in this run) |
| Control: same export to `Documents` (plain folder) | **Saved**: "Saved fundedflow-2026-10-23.ffj.zip · 1.1 MB · SHA-256 83d7393591f5172fc51b6f824cc0eca922ce43fa1c303ee086aa0ea9cfd21417". The file on disk is 1,132,356 bytes with the same SHA-256. |

**Surprise:** the refusal is correct, but its wording is misleading for an export. It talks about "the archive" containing an unsafe file path, as if a restore had failed. It doesn't mention that the chosen folder is a link.

## Run D — write timing with 50,000 rows (TASK-011 c)

Fresh sandbox (same CPU, RAM and disk as in the Environment table). Account "Timing test", Import trades → synthetic-50k.csv, Year-month-day.

| Step | Time | Result |
|---|---|---|
| C1a: "Check the file" → Match columns step ready | ≤ 3.1 s | 9 columns, Generic trade list, every timestamp YYYY-MM-DD |
| C1b: "Review rows" → preview table shown | ≤ 3.1 s | All 50000 · **Will import 50000** · Restores 0 · Duplicates 0 · **Errors 0** · Warnings 0 · "Continue with 50,000 trades" |
| C2: "Import 50,000 trades into Timing test" → completion screen | **10.7 s** (10.67) | "**Imported 50000 trades into Timing test**": Imported 50,000; Skipped 0; Duplicates 0; Errors left out 0 |
| Journal size after import | — | `fundedflow.db` 57,982,976 bytes · `fundedflow.db-shm` 131,072 · `fundedflow.db-wal` 58,895,432 |
| C3: Full backup → Documents → Save → result | **3.0 s** (3.04) | **Refused**: "Nothing was exported" / "**This is larger than the supported archive limits. Over the limit: data.json: 72059754 bytes, limit 67108864 bytes.**" No file was left in Documents or %TEMP%. |
| Responsiveness | — | `Process.Responding` stayed true at every poll during C1, C2 and C3 (0 not-responding samples). The title never showed "(Not Responding)". |

Nothing came close to the 10-minute limit.

**Timing resolution:**
- The C1 times include a fixed 1-second pause the script takes after each click. Polling the UIA tree took up to ~2 s per check on the 50k preview, so the C1 figures are upper bounds.
- C2 and C3 were timed from the click or Enter itself, with 250 ms polling.

## Surprises

1. **TASK-011(a) isn't covered in this build.** No unsaved-changes prompt appears on window close (X or Alt+F4) for the rulebook draft, the trade review or the daily review. The text is lost on relaunch.
2. **TASK-022 isn't met.** Mouse X1 and Alt+Left navigate away without the "Leave without saving the review?" dialog. Only in-app links trigger it. The text can still be recovered in the same window through the "Restore them" banner.
3. **B6 refusal text is misleading.** The export into a junctioned folder is refused correctly, with nothing written, but the message reads like a restore failure ("The archive contains an unsafe file path").
4. **The full-backup export needs a checkbox first.** It requires "I understand this file is not encrypted"; without it, the result is "Nothing was exported — Confirm that you understand the file is not encrypted."
5. **CSV hashes are for CRLF files.** The raw GitHub download (LF) doesn't match the expected hashes (see Environment).
6. **The Run A/B sandbox has no done.txt.** That's a script bug of mine: the step named `Kill` hit PowerShell's built-in `kill` alias, so the closing step failed. All A/B data had already been recorded; I closed that sandbox by hand. Other errors in the transcripts are automation retries (Radix list item Invoke, file-dialog focus), Get-Volume not being available in the sandbox, and one "missing Id" error from that same `Kill` step. None of them are app errors.

## Files

- `out/runAB`, `out/runC`, `out/runD`: environment.json, steps.log, transcript.txt, every screenshot with its `.uia.txt` dump, `cmd/` step files and outputs, `timings.jsonl` (Run D), `C-links.txt`, `C-target-listing.txt` (empty), `C-control-documents-listing.txt`, and `D-journal-size.txt`.
- `out/new`, `out/b3`, `out/b3ack`: earlier TASK-011(b) runs.
- `scripts/`:
  - `driver.ps1` (sandbox driver), `helpers2.ps1`, `step.ps1` (host-side step queue);
  - `ff-runAB.wsb`, `ff-runC.wsb`, `ff-runD.wsb`;
  - the earlier `run-cases.ps1`, `b3-probe.ps1` and `b3-ack.ps1`, with their .wsb files.
