# TASK-033: accessibility and window/DPI (partial, sandbox-runnable rows only)

**Gate state: Not Run (partial).** These are the rows that can be checked objectively in Windows Sandbox. The visual-judgment rows, NVDA, contrast, scaling and hardware rows still need Kyle on a real PC. No row is marked Pass from inference.

Environment: Windows Sandbox on the coordinator PC, 26100.9711, candidate 0.1.1 (1d13c43, EXE 60091daf…), WebView2 155.0.4283.62 (folder workaround), 2026-10-23 20:41–20:46 MDT, driven by Claude Code. Account "Access" with 5 synthetic trades.

| Row | Observed | Result |
|---|---|---|
| §9-chooser | After Export → Save dialog → Cancel, focus is on "Choose location and export…". After Save, the same. After Restore → Open dialog → Cancel, focus is on "Choose backup to restore…" (UIA FocusedElement). | PASS |
| D10 (daily review part) | At 1280×800 with a half-filled daily review, Ctrl+B twice: the text is kept and no leave dialog appears. The rulebook-editor part was not run. | PASS (partial) |
| D11 | Tab order from Today at 1136×900: account selector "Access" > Quick Import > Start plan > Skip for now > Check again > "How fresh this is …" > Finish setup > Calculate estimate > Import CSV > Verify balance > Review rulebook > View trades > Add account > Review session > the day row > Skip to main content > Collapse sidebar > Today. The spec expects "Freshness → accounts → selected account → risk". Here the plan prompt comes before freshness, and the account selector is first. | CHECK (Kyle to judge; not 1920×1080) |
| W12 | With FundedFlow open, setting AppsUseLightTheme to 0 and broadcasting WM_SETTINGCHANGE "ImmersiveColorSet": mean window brightness went 237 → 36, and back to 237 when reverted. The app follows the Windows app mode. The open-dialog part was not run. | PASS (partial) |
| D1 / D6 / W1 (no sideways scroll) | At 1280×800, 1024×640 and 800×480, Today, Journal, Insights, Accounts, Settings and Import Wizard have no horizontal scrolling (UIA ScrollPattern: HorizontallyScrollable False, VerticallyScrollable True). Layout and readability judgment was not done (screenshots `C:\FFSandbox\out033\shots\size-*.png`). | PASS for no-sideways-scroll only |
| Everything else | D2–D4, D7–D9, W2, W6–W8, W10, W18, §9-focus, contrast, reflow, motion, and the NVDA, scaling (W3–W5, W9, §9 125/150/200%) and hardware rows (D5, W19): need visual judgment, a real display or a person | NOT RUN |
