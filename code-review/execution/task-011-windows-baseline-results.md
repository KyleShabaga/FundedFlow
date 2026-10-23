# TASK-011 r3: Windows baseline results (partial)

Recorded 2026-10-23 from Kyle's results page (Notion "TASK-011 Results", https://app.notion.com/p/4021bd4b6bde80a8bbcbe9e1a6085c49). Tester: Kyle Shabaga. Parts (a) and (c) were run; part (b) was not run.

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

## (b) Junctions: not run

B1 to B7 were not run. TASK-018 keeps its own `cfg(windows)` junction tests (step 5), which build the junctions in temp directories. Its manual Windows check is still owed and moves to the candidate smoke run (TASK-030). TASK-028 B1 and B2 stay "unmeasured", as r7 allows.

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
