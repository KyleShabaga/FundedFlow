# TASK-011 r3: Windows baseline results (partial)

Recorded 2026-10-23 from Kyle's results page (Notion "TASK-011 Results", https://app.notion.com/p/4021bd4b6bde80a8bbcbe9e1a6085c49). Tester: Kyle Shabaga. Parts (a) and (c) were run; part (b) was not run.

> **Superseded, 2026-10-23 (Kyle: "Use the report as the truth").** A full rerun in Windows Sandbox replaces parts (a) and (c) below. The rerun used build eeda9a1 (installer SHA-256 91c12889…) on Windows 10 Enterprise 26H1 build 28000.2269, with WebView2 156.0.4314.42 and an AMD Ryzen 5 5600U with 3.99 GB RAM. Report: `sandbox/results-2026-10-23/task-011-022-sandbox-rerun-report.md`.
>
> - **(a) Rerun:** **no prompt in any case.** Title-bar X and Alt+F4 both closed the window at once in the rulebook draft, the trade review and the daily review. The typed text was lost and was not offered back after relaunch. The only guard is `beforeunload` (`use-leave-guard.ts:95-100`), which does not run when the native window closes. **TASK-023 is therefore needed: its "Not Needed" closure is reversed.** The earlier "P" results were most likely the in-app navigation dialog from step 2.
> - **TASK-022 manual check:** **not met.** Mouse X1 and Alt+Left leave a dirty daily review with no dialog. The text can only be recovered through the "Restore them" banner. An in-app sidebar link does show the dialog.
> - **B6, export to a junctioned folder:** refused with "Nothing was exported. The archive contains an unsafe file path, so it was rejected." Nothing was written, including partial or temp files. Exporting to a normal folder succeeded. The message wording is misleading (a nit).
> - **(c) Rerun:** the preview took ≤ 3.1 s per step (50,000 new, 0 errors) and the commit took 10.7 s. The journal was then 57,982,976 bytes with a 58,895,432-byte WAL. **C3 was refused after 3.0 s: data.json was 72,059,754 bytes, over the 67,108,864 limit** (the known V1 gap). The window stayed responsive throughout. **ISSUE-010 does not escalate.**
> - **CSV hashes:** the expected hashes are for CRLF files. A raw GitHub download has LF line endings and does not match until it is converted to CRLF.

## Missing from the header (to be filled by Kyle)

The header fields are blank: date and time zone, machine, Windows edition and build, WebView2 version, installer SHA-256 check (Y/N), environment-variable checks, and the synthetic CSV hash check. The header template still names the earlier local build (`FundedFlow_0.1.0_x64-setup.exe`, e8acfb4f…, source 2135d79). The CI build on the kit page was `FundedFlow_0.1.1_x64-setup.exe`, 18ebc9ae…, source 819f967. Which build was tested is unconfirmed.

## (a) Close with unsaved text

| Case | Editor | Action | In-app guard first | Outcome | Cancel kept window and text | Leave closed | Text after reopen |
|---|---|---|---|---|---|---|---|
| A1 | Rulebook draft | X | Y | P | Y | Y | lost |
| A2 | Rulebook draft | Alt+F4 | Y | P | Y | Y | lost |
| A3 | Trade review | X | Y | P | Y | Y | lost |
| A4 | Trade review | Alt+F4 | Y | P | Y | Y | lost |
| A5 | Daily review | X | Y | P | Y | Y | lost |
| A6 | Daily review | Alt+F4 | Y | P | Y | Y | lost |
| A7 | Clean window | X | - | closed immediately | | | |
| A8 | Clean rulebook draft | Alt+F4 | - | closed immediately | | | |

Every dirty editor showed a prompt on both the title-bar X and Alt+F4. Cancel kept the window and the text, and Leave closed the window. Clean windows closed immediately. "Lost" after reopening is expected, because the text was never saved.

Caveat: the recorded "prompt text" is the app's in-app dialog copy, for example "Leave without saving?". main has no `onCloseRequested` handler. Window close is guarded only by `beforeunload` (`use-leave-guard.ts:95-100`, `rulebooks/components/unsaved.ts`), and WebView2 shows that as a native "Leave site?" style prompt. The copied text is therefore probably from the step-2 navigation check, not the close prompt. The outcome (a prompt appears and protects the text) is the same either way. Kyle to confirm the wording of the close prompt.

**Decision (TASK-023 step 2):** a prompt appears and protects the text on X and Alt+F4, so TASK-023 closes as **Not Needed**, with this entry as the evidence.

**TASK-028 B3:** the expected result is "prompt on both X and Alt+F4; Cancel keeps the text".

## (b) Junctions: scripted run in Windows Sandbox (2026-10-23)

Kyle ran the script `code-review/execution/sandbox/run-cases.ps1` through Claude Code on another PC, with no clicks. Report: `task-011b-findings.md`, uploaded to the coordinator session.

- **Build:** `FundedFlow_0.1.1_x64-setup.exe` from release-installer run 39991525917 (main eeda9a1, includes TASK-018). SHA-256 `91c1288926ac35503545b1a59ea73dda2838c1114b6ed72ce5341deb7a51e29c` (matches). Silent install exit code 0.
- **Environment:** Windows Sandbox, Windows 10 Enterprise 26H1 build 28000.2269, user `wdagutilityaccount`. No WebView2 before install (the installer added it), no `%APPDATA%` folder before install, and `FUNDEDFLOW_DEV_DATA_DIR` unset.

| Case | Setup | Screen | Data folder after launch | Result |
|---|---|---|---|---|
| B1 standard profile | none | "Before you start" (first-run) | `fundedflow.db`, `-shm`, `-wal`, `fundedflow.lock` | Pass |
| B2 Roaming behind a junction | `C:\FFRelocated` → `C:\FFRelocatedReal` (junction); User Shell Folders `AppData` = `C:\FFRelocated\Roaming` | "Before you start" | db files created, seen through the link and in the real folder | Pass (TASK-018 behaviour: a junction above the data folder is trusted) |
| B3 app folder is itself a junction | `<APPDATA>\com.fundedflow.desktop` → `C:\FFJunctionTarget\com.fundedflow.desktop` | "Before you start", no error, no Retry, at 5, 20 and 60 s | junction and target both stay **empty**: no db or lock file created anywhere | Journal refused, as intended. The `data_folder_link` screen is not shown before the first-run screen (see below). |
| B3 undo, then relaunch | junction removed, original folder restored | "Before you start" | original db files intact | Pass |
| B4 to B7 | — | — | — | Not run. B5 is covered, because the run itself was in Windows Sandbox. B6 and B7 need clicks. |

**Reading of B3.** The first-run notice is shown before any app content by design (NA-3): `App.tsx:30` wraps every route in `LegalGate`, and the `RuntimeGate` that shows `data_folder_link` sits inside it. The junction target holds no acceptance record, so the first-run screen comes first. The backend refused the folder, since no journal file was created. The expected result written into the run instructions ("B3 shows a non-retry error") was wrong for a profile with no acceptance record.

**B3 after "Acknowledge and continue"** (probe `b3-ack.ps1`, clicked through UI Automation): the app shows the Today page with the error card "FundedFlow doesn't trust its data folder". The card explains that the data folder is behind a link and the journal was not opened, that the data is unchanged, and how to replace the link and restart. It offers no Retry, shows stage `data_directory`, and the sidebar stays usable. No db or lock file was created anywhere. The screen was identical 30 s later. B3 therefore **passes** (TASK-018: the app root itself a junction is refused with the new non-retry category).

Evidence: `execution/sandbox/results-2026-10-23/` (findings, screenshots, results.json, listings).

Follow-ups:
- Two copy nits on the error card. Its two paragraphs say nearly the same thing. "Quick Import" stays visible while accounts are unavailable. Neither blocks V1.
- **Confirmed:** writing the acknowledgement goes through `legal::write` (`legal.rs:60-83`), which has no link check. It wrote `legal-acceptance.json` through the junction into the target folder. That file is the acknowledgement record, not journal data. It is covered by the TASK-018 follow-up Triage card for the legal-record, database, backup and attachment paths (4021bd4b6bde818f8b81cacaf66ff026).

**Results for other tasks:**
- **TASK-018** manual check ("junctioned profile layout starts Ready; standard profile unaffected"): met by B2 and B1 on the eeda9a1 build, in Windows Sandbox.
- **TASK-028** B1/B2 expected results: now measured. B1 and B2 reach the app normally. B3 shows the first-run notice, then the non-retry data-folder error after Acknowledge.

## (c) Write timing

| Step | Rows | Seconds | Result | UI responsive |
|---|---|---|---|---|
| C1 preview | 50,000 | 3.5 | 50,000 rows | Y |
| C2 commit | 50,000 | 6.9 | | Y |
| C3 full backup export | - | - | **Refused:** "Nothing was exported. This is larger than the supported archive limits. Over the limit: data.json: 70520337 bytes, limit 67108864 bytes." | Y |

Journal after the import: `fundedflow.db` 57,978,880 bytes, `-wal` 59,167,352 bytes, `-shm` 131,072 bytes.

**ISSUE-010 (slow import and export):** does not escalate. The import of 50,000 trades took 10.4 s in total and the UI stayed responsive.

**New finding:** a journal with about 50,000 trades cannot be backed up at all. `data.json` (70.5 MB) is over the 64 MiB per-entry limit (`data_controls/filesystem.rs:9`, `MAX_ENTRY`). The refusal is clear and safe, but the owner loses full backup at that size. This is related to TASK-010 / ISSUE-002, which found 64 MiB reachable within 12 months. TASK-045 deduplicates calculation snapshots and does not shrink trade rows in `data.json`. Filed as a Triage card for an owner priority decision.

**Owner decision (Kyle, 2026-10-23):** the full-backup size limit is accepted for V1 as a known gap. It goes in the V1 release notes (TASK-035) and in TASK-036's known-gaps input. The fix is planned for V1.1; Development Board card https://app.notion.com/p/4021bd4b6bde81249483d1071c21c6e6.
