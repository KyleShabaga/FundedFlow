# Final manual test 1: unsaved-edit guards (TASK-023 close veto, TASK-022 back navigation)

**Gate result: PASS. All 14 cases (G1–G10, C1–C4) pass on the release candidate.**

## Environment

| Item | Value |
|---|---|
| Tester | Kyle Shabaga (Claude Code driving, coordinator session) |
| Date | 2026-10-23, 18:20–18:52 MDT (America/Edmonton) |
| Machine | Windows Sandbox on the coordinator PC (host Windows 11 Pro 25H2, build 26200.9711) |
| Inside the sandbox | Windows 10 Enterprise (EditionID Enterprise), DisplayVersion 24H2, build **26100.9711**; user `36e73517-d097-4\wdagutilityaccount`; 8 GB RAM |
| WebView2 | Registry pv before 155.0.4283.60 (stale; the runtime folder present was 155.0.4283.62). Runtime used: 155.0.4283.62. pv after: 155.0.4283.62 (see Sandbox setup note). |
| Build | FundedFlow 0.1.1, source `1d13c438c2cfa4752fb57fba8cef693ad3398d8f`, release run 40014761941 |
| Installer | `FundedFlow_0.1.1_x64-setup.exe`, SHA-256 `60091DAFD5BD8E6CDF9D40EB4610F75B735C15E0FBF7BE3E5F3B94A7E0048646` (matched on the host and in the sandbox); silent install exit code 0 |
| CSV | `synthetic-5.csv` (CRLF), SHA-256 `4A8313121EBF377B20C1F7D2FF3E1F4153797672B5CA4B8B7F420287F6A297DA` (matched); 5 trades imported, 0 duplicates, 0 errors |
| Env vars | `FUNDEDFLOW_DEV_DATA_DIR` and `FUNDEDFLOW_UPDATE_FIXTURES` UNSET at Process, User and Machine scope |
| Safety | The app ran only inside the sandbox, with no sign-ins. The host's real journal was not read or touched. |

**Driving method.** UI Automation (InvokePattern; ValuePattern to confirm markers), a real mouse click on the title-bar X, and `keybd_event`/`mouse_event` for Alt+F4, Alt+Left and XBUTTON1. Every typed marker was confirmed in its field before the action was sent.

## Results

| Case | Editor and field | Action | Dialog (exact title / body) | Cancel | Leave | Result |
|---|---|---|---|---|---|---|
| G1 | Rulebook draft, "What changes and why" | title-bar X | "Leave without saving?" / "Your edits aren't saved. Closing the window discards them; they can't be restored later." [Cancel] [Leave] | window stayed open, text kept | second X showed the dialog again; Leave closed the app | PASS |
| G2 | same | Alt+F4 | same as G1 | kept | closed | PASS |
| G3 | Trade SYNA 1 Nov 2022 14:00, "Notes and reflection" | title-bar X | "Leave without saving the review?" / "Closing the window discards your edits; they can't be restored later." | kept | closed | PASS |
| G4 | same | Alt+F4 | same as G3 | kept | closed | PASS |
| G5 | Daily review Tue 1 Nov 2022, "Focus for the session" | title-bar X | same as G3 | kept | closed | PASS |
| G6 | same | Alt+F4 | same as G3 | kept | closed | PASS |
| G7 | Daily review, dirty | mouse X1 | "Leave without saving the review?" / "Your edits stay available to restore in this window when you come back to this day." | kept, still on the day | back once to `#/journal` | PASS |
| G8 | same | Alt+Left | same as G7 | kept | back once to `#/journal` | PASS |
| G9 | Rulebook draft, dirty | mouse X1 | "Leave without saving?" / "Your edits aren't saved. They are kept in this window and offered back when you reopen this draft." | kept | back once to the rulebook overview | PASS |
| G10 | Trade review, dirty | Alt+Left | "Leave without saving the review?" / "Your edits stay available to restore in this window when you come back to this trade." | kept | back once to `#/journal` | PASS |
| C1 | Clean window (Today) | title-bar X | none | — | closed at once | PASS |
| C2 | Clean rulebook draft (nothing typed) | Alt+F4 | none | — | closed at once | PASS |
| C3 | Clean daily review | mouse X1 | none | — | went back at once to `#/journal` | PASS |
| C4 | First-run screen ("Before you start") | Close | — | — | app closed | PASS |

The close variants of the dialog say the edits are discarded. The back-navigation variants say the edits stay restorable in this window. Both match PR #138.

Evidence: screenshots `shots\<case>-1-typed / -2-dialog / -3-after-cancel / -4-after-leave.png` and UIA dumps under `C:\FFSandbox\out01` (zipped as `C:\FFGate\01-guards.zip`).

## Sandbox setup note (not a FundedFlow defect)

On this host, a fresh Windows Sandbox listed WebView2 `pv = 155.0.4283.60` in the registry, but only the `155.0.4283.62` runtime folder existed. FundedFlow's first launch showed "Could not find the WebView2 Runtime". This is the same blocker GPT-6.1 hit earlier today (`C:\FFSandbox\guards\report.md`).

These did not help:
- the Microsoft-signed WebView2 standalone installer exited `0x80040902` ("already installed");
- correcting the registry pv alone.

What worked: launching with `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER` set to the existing runtime folder, inside the sandbox only. That points the WebView2 loader straight at the runtime. The packaged app then ran normally.

This is a sandbox and WebView2-registration quirk on this host. The earlier sandbox on the other PC (build 28000) had no WebView2 at all, and there the installer downloaded the runtime and the app started. Proposed triage title, low priority: "Installer trusts the WebView2 pv registry value; a stale pv makes startup fail with 'Could not find the WebView2 Runtime'". A real install with a broken runtime registration is unusual.

## Surprises

- Two driving false starts were caught by the marker check and rerun. They are not app findings:
  - the first G1 "second X" read looked for the dialog too soon;
  - the first G3 attempt typed into an off-screen field, so the page wasn't dirty and the window correctly closed at once.
- None of the guard behaviour was unexpected.
