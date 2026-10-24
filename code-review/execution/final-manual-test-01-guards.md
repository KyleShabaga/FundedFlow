# Final manual test §1: unsaved-edit guards on window close and back navigation (TASK-023, TASK-022)

Run this first. It confirms PR #138 in the installed candidate.

**Expected results**
- Every dirty editor (rulebook draft, trade review, daily review) shows the app's own leave dialog for each of title-bar X, Alt+F4, mouse X1 and Alt+Left.
- Stay or Cancel keeps the window open and the text intact.
- Leave closes the window (X, Alt+F4) or goes back exactly once (X1, Alt+Left).
- A clean window closes at once with X or Alt+F4, and a clean editor goes back at once with X1.
- On the first-run screen, Close (Decline) closes the app.

## Prompt

```
Recheck FundedFlow's unsaved-edit guards in Windows Sandbox (TASK-023 window-close veto and TASK-022 back navigation), then report.

RULES
- Only inside Windows Sandbox. Never install or run FundedFlow on the host, and never touch any real %APPDATA%\com.fundedflow.desktop there.
- Don't sign in to anything inside the sandbox. Use only the synthetic CSV.
- FUNDEDFLOW_DEV_DATA_DIR and FUNDEDFLOW_UPDATE_FIXTURES stay unset.
- Use a fresh sandbox for each run.

BUILD (the TASK-029 release candidate)
- gh run download 40014761941 --repo KyleShabaga/FundedFlow -D C:\FFGate\candidate
- FundedFlow_0.1.1_x64-setup.exe, SHA-256 must be 60091dafd5bd8e6cdf9d40eb4610f75b735c15e0fbf7be3e5f3b94a7e0048646. Stop if it isn't.
- Source commit 1d13c438c2cfa4752fb57fba8cef693ad3398d8f.
- CSV: code-review/execution/sandbox/kit/synthetic-5.csv on branch claude/practical-turing-wmii06. Convert LF to CRLF; the SHA-256 must be 4a8313121ebf377b20c1f7d2ff3e1f4153797672b5ca4b8b7f420287f6a297da.

RECORD FIRST
winver build (CurrentBuild.UBR), edition, the WebView2 pv value after install, whoami, the installer and CSV hashes, and the env vars above.

SETUP
1. Install silently with /S, launch, and click "Acknowledge and continue".
2. Accounts → add an account "Guard test".
3. Import synthetic-5.csv (Year-month-day, default time zone).
4. Rulebook → "Write my own rules" → Create draft.

CASES
For each case:
- Type a unique marker (for example TASK023-G1-unsaved) into the field, confirm it with ValuePattern, then send the action.
- Take a screenshot and a UIA dump after typing, when the dialog shows, and after the choice.
- Record whether the dialog shows (its exact title, text and buttons), what Stay/Cancel does to the window and the text, and what Leave does.

| Case | Editor and field | Action | Then |
|---|---|---|---|
| G1 | Rulebook draft "What changes and why" | title-bar X (real mouse click) | Stay, and check the text is kept. Then X again and Leave → window closes |
| G2 | same | Alt+F4 | Stay, then Alt+F4 + Leave → closes |
| G3 | Trade SYNA 2022-11-01 14:00 → "Notes and reflection" | title-bar X | Stay, then Leave |
| G4 | same | Alt+F4 | Stay, then Leave |
| G5 | Daily review Tue 1 Nov 2022 → "Focus for the session" | title-bar X | Stay, then Leave |
| G6 | same | Alt+F4 | Stay, then Leave |
| G7 | Daily review (dirty) | mouse X1 (SendInput XBUTTON1) | Stay (text kept, still on the review), then X1 + Leave → back to Journal exactly once |
| G8 | same | Alt+Left | Stay, then Leave → back once |
| G9 | Rulebook draft (dirty) | mouse X1 | Stay, then Leave |
| G10 | Trade review (dirty) | Alt+Left | Stay, then Leave |
| C1 | Clean window (Today) | title-bar X | closes at once, no dialog |
| C2 | Clean rulebook draft (nothing typed) | Alt+F4 | closes at once |
| C3 | Clean daily review | mouse X1 | goes back at once |
| C4 | Fresh sandbox, first-run screen | click Close (Decline) | app closes |

After each case that closes the window, relaunch FundedFlow.
- If a dialog shows but the text is gone after Stay, record FAIL.
- If the window can't be closed (hangs), record it, end the process with Task Manager, and report it.

REPORT
Write C:\FFGate\01-guards\report.md:
- the environment block;
- a G1–G10 and C1–C4 table with PASS/FAIL against the expected results;
- the exact dialog texts;
- surprises.
```
