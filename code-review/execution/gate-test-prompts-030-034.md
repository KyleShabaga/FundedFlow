# FundedFlow release gates TASK-030 to TASK-034: paste-ready test prompts

Prepared 2026-10-23 for the recorded candidate (TASK-029). Each section has a short why, what Sandbox can and can't do,
the expected results taken from the spec, and a fenced prompt to paste into Claude Code on the Sandbox PC. Where a
step needs a person (a screen reader, real data, a real display, OneDrive), the prompt stops and the steps for Kyle are
written out.

Sources read (audit branch `origin/claude/practical-turing-wmii06` unless noted): TASK-030 r5, TASK-031 r7,
TASK-032 r3, TASK-033 r3, TASK-034 r5; `11-remediation-execution-log.md`; `task-011-windows-baseline-results.md`;
`sandbox/results-2026-10-23/task-011-022-sandbox-rerun-report.md`; `docs/build-26.75-evidence.md` (origin/main) with
open PR #139 (B1–B3 measured, new B8); candidate source `1d13c43` for the UI wording quoted below.

## Read this first: findings that change what the specs expect

1. **The candidate has a newer journal schema than 0.1.0.** 0.1.0 (`7679edc`) stops at migration 21. The candidate
   (`1d13c43`) adds 0022 (TASK-042, fees recorded) and 0023 (TASK-045, frozen risk sources). TASK-031 r7 says "no
   migration was added", so the downgrade "is expected to open normally". That is no longer true:
   - Step 2 (0.1.0 → 0.1.1) runs migrations 22 and 23 and writes `fundedflow.db.before-v23.bak`.
   - Step 4 (0.1.1 → 0.1.0): 0.1.0 should refuse with NewerSchema ("Your journal was created by a newer version of
     FundedFlow. Install the latest version to open it. Your data has not been changed.", no Retry). The downgrade is
     record-only, so this does not fail the gate.
   - Step 4a: 0.1.0 runs `recover_cleanup` only after `db::open_file` succeeds (`runtime.rs:351-352` at `7679edc`).
     It therefore can't reach Ready (expected result (i)) or finish the marker (ii). Under the literal pass rule, a run
     4a makes the gate **Failed**. The prompt runs 4a, records exactly what happens and flags it **DECISION NEEDED**
     for Kyle: either accept a failed (i)/(ii) as "the premise changed" (and correct the TASK-015/016 declaration), or
     record 4a as Not Run with this reason.
2. **TASK-030 asks for two clean VMs: Windows 11 and Windows 10 22H2.** Sandbox runs the host's own OS build. The
   earlier runs reported "Windows 10 Enterprise 26H1, build 28000", so the Sandbox can stand in for the Windows 11 leg
   only if Kyle accepts it ("full VM preferred over Sandbox"). The **Windows 10 22H2 (build 19045) leg needs a Hyper-V
   VM**, not Sandbox.
3. **TASK-032 and TASK-033 still use the old legal wording** ("first-run agreement ... accept", `legal/index.ts:40-43`).
   The candidate shows the acknowledgment screen ("Before you start" / **Acknowledge and continue**). The prompts use the
   candidate's wording.
4. **The 0.1.0 baseline can still be downloaded from GitHub until 2026-11-20 23:19 UTC.** Artifact
   `fundedflow-0.1.0-7679edc-windows-nsis`, run 39691474111: `gh run download 39691474111 --repo
   KyleShabaga/FundedFlow -n fundedflow-0.1.0-7679edc-windows-nsis`. After that date Kyle must copy it over from
   `C:\Users\Kyle\Documents\FundedFlow-release-artifacts\0.1.0-7679edc\`. The candidate artifact expires 2026-11-22.
5. **Synthetic CSV hashes are for CRLF copies.** I checked the conversion snippet in the BUILD block against
   synthetic-5.csv (LF 490 bytes, `a8a956fb…`, becomes CRLF 496 bytes, `4a831312…`).

## Shared driving notes (from the TASK-011 / TASK-022 sandbox runs)

These notes are repeated in short form in every prompt. They are here so Kyle knows where they came from.

- Layout on the host: `C:\FFGate\kit` (installers, CSVs and tools, mapped **read-only** as `C:\kit`) and
  `C:\FFGate\<gate>\<run>\out` (mapped **writable** as `C:\out`). Use one `.wsb` per run, with `<MemoryInMB>8192</MemoryInMB>`.
  A driver script inside the sandbox polls a host-side step queue, as `driver.ps1` and `step.ps1` did.
- UI Automation (`InvokePattern`, `TogglePattern`, `ValuePattern`; focus plus `SendKeys` for typing) drives the
  WebView2 content. Send Alt+F4, Alt+Left and mouse X1 with `SendInput`. For the title-bar X, make a real mouse click
  at the X position; Tauri's native frame has no TitleBar element.
- Native Open/Save dialogs are `#32770`. The file-name box is `Edit` 1148 or 1001; type the full path there.
- Radix dropdowns (for example Date order) need the keyboard. `SelectionItem` and `Invoke` fail on them.
- A full-backup export needs "I understand this file is not encrypted" ticked first.
- Don't name a step `Kill`: it hits PowerShell's `kill` alias. Use `Stop-Process -Name fundedflow -Force`.
- After every step that matters, save a screenshot plus a UIA text dump (`*.uia.txt`).
- The installer needs about 70 s on a sandbox without WebView2, because it downloads the runtime. Sandbox has no
  WebView2 until FundedFlow's installer adds it.
- The sandbox user is `WDAGUtilityAccount`. `%APPDATA%\com.fundedflow.desktop` is absent before the first launch.

---

## TASK-030: clean smoke and offline acceptance

**Why.** This gate decides whether the installed candidate behaves as the TASK-028 checklist says on a clean machine.
That covers the hash, a per-user install with no UAC, first launch offline, the `0.2.1-draft` legal documents,
data surviving reopen, unticked uninstall, reinstall and over-install, and B1–B8. It also includes Kyle's
real-export import check (R1, counts only). It is **Passed** only if every mandatory step matches on both a clean
Windows 11 and a clean Windows 10 22H2 machine, with B7 on one image without WebView2 and R1 on one VM. Any failure
makes it Failed; any mandatory step not run makes it Blocked or Not Run. It also carries the packaged checks for
TASK-025 (legal documents and banners), TASK-044 (deletion wording about recovery copies) and TASK-018 (B1 recheck).

**Sandbox: can and can't**

| Item | In Sandbox? |
|---|---|
| 1–10, 4a, B1, B4, B5, R1 | Yes. Offline from step 3: disable the adapter inside the sandbox after install (`Disable-NetAdapter -Name * -Confirm:$false`), because install needs the network to fetch WebView2. |
| B7 (a) online, without WebView2 | Yes. A fresh sandbox has no WebView2, so run S1's install counts as B7(a) if "absent before" is recorded. |
| B7 (b) offline, without WebView2 | Yes. Use a separate sandbox with `<Networking>Disable</Networking>` from the start. |
| B2, junctioned-folder part | Yes. |
| B2, OneDrive part | **No.** Sandbox has no OneDrive, and the rules forbid sign-ins. It needs a real PC or VM with a throwaway Microsoft account, signed in by Kyle; otherwise record **Not Run**. |
| B3 and B8 (close and back guards, TASK-023/022) | Run by the separate **"Final manual tests §1"** prompt; copy its results in. |
| B6 (scaling 125/150/200%) | Sandbox does not reliably allow changing scaling. Kyle runs it on a Hyper-V VM or a real PC under a throwaway local user (steps in the prompt). |
| Windows 10 22H2 leg | **No.** It needs a Hyper-V VM with build 19045. Run the same table there (Claude inside the VM, or Kyle by hand). |
| 11 network observation (optional) | Partly. Resource Monitor works in Sandbox; Wireshark would need installing. Optional. |

**Expected results (from the spec and the checklist, PR #139 revision)**

- 1: `Get-FileHash` matches `SHA256SUMS.txt` and `60091DAF…0048646`.
- 2: no UAC; installs to `%LOCALAPPDATA%\FundedFlow`; Start menu entry; Publisher "Kyle Shabaga" in Installed apps.
  SmartScreen may show "Windows protected your PC" → More info → Run anyway.
- 3: offline from here to step 10.
- 4: the "Before you start" screen shows before any app content, with the "Draft documents" warning ("These documents
  are drafts and haven't been reviewed by a lawyer. …"), the "Your privacy" summary and two documents, "Privacy notice
  (draft)" and "License and product information (draft)", each "Version 0.2.1-draft". Buttons: **Close**, **Acknowledge
  and continue**. Afterwards Today's empty state shows, with no error and no network prompt.
- 4a: `LICENSE` and `THIRD_PARTY_NOTICES.txt` sit next to `fundedflow.exe`. The notices file starts "FundedFlow
  third-party notices". In-app, offline, Settings → Privacy & legal → Read the third-party notices shows the same
  sections and counts.
- L1 (TASK-025): Settings → Privacy & legal lists both documents at `0.2.1-draft`, with its "Draft documents" banner.
  Any other version, a missing document or a missing banner fails step 4.
- 5: `fundedflow.db` and `legal-acceptance.json` are in `%APPDATA%\com.fundedflow.desktop`.
- 6: the account and trades survive a reopen.
- 7: no Add Fake Data or Reset All Data; `#/settings/developer` can't be reached; F12 and Ctrl+Shift+I do nothing.
- L2 (TASK-044): the "Delete data permanently" description reads exactly "Failing or archiving an account keeps its
  history. Deleting removes it from the journal. Recovery copies FundedFlow keeps on this computer may still hold it
  until you erase the entire journal." With at least one recovery copy, the account-deletion dialog says "{n} recovery
  cop{y|ies} kept by FundedFlow on this computer (pre-upgrade database copies, pre-restore safety copies or leftover
  restore working files) may still contain this account's data. Deleting the account doesn't change them; erasing the
  entire journal removes them.", and "What stays" includes "FundedFlow's recovery copies on this computer stay.". The
  whole-journal erase dialog says "{n} local recovery cop{y|ies} kept by FundedFlow will also be removed." Every dialog
  is cancelled.
- 8: the program files (including LICENSE and THIRD_PARTY_NOTICES.txt), shortcuts and uninstall entry are gone; the
  journal folder remains.
- 9: reinstall opens the step-6 data, with no legal re-prompt (`legal-acceptance.json` was kept).
- 10: the over-install completes and the journal is kept.
- B1: TASK-018 (`eeda9a1`) is in the source SHA. A standard profile, and `%APPDATA%` behind a junction, both reach the
  app with no "retry" failure; the journal is under the junctioned path. If the app folder itself is a junction, the
  first-run notice shows, then after Acknowledge the app shows "FundedFlow doesn't trust its data folder" with no Retry,
  and no db or lock file exists in the junction or its target.
- B2: the known limitation (V1.1). Export to a junctioned folder is refused with "Nothing was exported. The archive
  contains an unsafe file path, so it was rejected."; nothing is written (no partial or temp file); the journal is
  unchanged. Export to a normal folder succeeds. The OneDrive part is checked for the first time here.
- B3: X and Alt+F4 on a dirty rulebook draft, trade review and daily review show the app's leave dialog. Cancel/Stay
  keeps the text and Leave closes. A clean window closes immediately, and first-run **Close** closes.
- B4: a ticked uninstall removes exactly `%APPDATA%\com.fundedflow.desktop` and `%LOCALAPPDATA%\com.fundedflow.desktop`,
  plus the program folder, shortcuts and uninstall entry. The exported archive remains.
- B5: the known limitation. The second window may show a failure screen; the first keeps working and still saves; the
  next launch opens normally; no data loss.
- B6: at 125%, 150% and 200%, every primary action is reachable on first-run, Today and Settings, with nothing clipped
  that blocks a task.
- B7: (a) online, the installer fetches WebView2 and the app launches. (b) Offline, the installer stops with a message
  or the app reports WebView2 missing, and no journal is created. Record the exact message.
- B8: mouse X1 and Alt+← on a dirty daily review show the dialog; Stay keeps the text.
- R1 (Kyle only): the real broker export imports. Record counts only, and pass/fail.
- 11 (optional): `fundedflow.exe` and its `msedgewebview2.exe` children connect to no non-Microsoft host.

```text
You are testing FundedFlow release gate TASK-030 (clean smoke and offline acceptance) on the recorded candidate.
Drive the app in Windows Sandbox with UI Automation, SendInput and screenshots, as in the TASK-011 sandbox runs.

RULES (do not deviate)
- Windows Sandbox only. Install, launch and test FundedFlow only inside a fresh sandbox; never install or run it on
  this host.
- Never read, list, copy, open or change the host's %APPDATA%\com.fundedflow.desktop or
  %LOCALAPPDATA%\com.fundedflow.desktop.
- No sign-ins of any kind (Microsoft account, OneDrive, GitHub, browser) inside the sandbox. On the host, use gh only
  for the downloads in BUILD.
- Use synthetic data only: synthetic-5.csv, synthetic-50k.csv and data you create in the app. Never paste CSV
  contents into chat or the report. The one exception is R1, which Kyle does by hand (see R1). You never open, read,
  screenshot or OCR his file or its import results.
- Leave every FUNDEDFLOW_* environment variable unset (not "0") at Process, User and Machine level, on the host and in
  the sandbox. Check this and record it.
- Use a fresh sandbox per run (S1, S2, S3, S4 below). Close each sandbox when its run ends. Only C:\FFGate\kit is
  reused.
- A case you can't do is Not Run, with the reason. Never mark Pass from inference or from an earlier build.
- Ask Kyle before anything this prompt does not cover.

BUILD (on the host, before any sandbox starts)
1. mkdir C:\FFGate\kit\candidate, C:\FFGate\kit\csv, C:\FFGate\kit\csv-lf, C:\FFGate\030
2. gh run download 40014761941 --repo KyleShabaga/FundedFlow -n fundedflow-0.1.1-1d13c43-windows-nsis -D C:\FFGate\kit\candidate
   Get-FileHash C:\FFGate\kit\candidate\FundedFlow_0.1.1_x64-setup.exe -Algorithm SHA256
   must equal 60091DAFD5BD8E6CDF9D40EB4610F75B735C15E0FBF7BE3E5F3B94A7E0048646 and the line in SHA256SUMS.txt.
   Also record the source_sha and version comment lines, expected to be 1d13c438c2cfa4752fb57fba8cef693ad3398d8f and 0.1.1.
   If anything differs, stop and report.
3. Synthetic CSVs (byte-exact; use cmd redirection, because PowerShell redirection re-encodes):
   cmd /c "gh api repos/KyleShabaga/FundedFlow/contents/code-review/execution/sandbox/kit/synthetic-5.csv?ref=claude/practical-turing-wmii06 -H Accept:application/vnd.github.raw > C:\FFGate\kit\csv-lf\synthetic-5.csv"
   (same for synthetic-50k.csv). Convert LF to CRLF:
   $e=[Text.Encoding]::GetEncoding(28591); foreach($n in 'synthetic-5.csv','synthetic-50k.csv'){
     $t=[IO.File]::ReadAllText("C:\FFGate\kit\csv-lf\$n",$e) -replace "`r?`n","`r`n"
     [IO.File]::WriteAllText("C:\FFGate\kit\csv\$n",$t,$e) }
   SHA-256 must be: synthetic-5.csv 4A8313121EBF377B20C1F7D2FF3E1F4153797672B5CA4B8B7F420287F6A297DA (496 bytes),
   synthetic-50k.csv 6E1404CBF24A8C9E0BACE76481F0750FF7F3D11501F74055E6B04343A93F189F (4,166,174 bytes).
4. .wsb for each run: map C:\FFGate\kit to C:\kit (ReadOnly true) and C:\FFGate\030\<run>\out to C:\out (writable),
   with MemoryInMB 8192. S1, S2 and S3 use default networking. S4 uses <Networking>Disable</Networking>.

DRIVER TIPS: UIA Invoke/Toggle/Value for WebView2 content; SendInput for Alt+F4, Alt+Left and X1; a real mouse click
for the title-bar X; Save/Open dialog #32770, file-name Edit 1148/1001 (type the full path); Radix dropdowns need the
keyboard; a full backup needs "I understand this file is not encrypted" ticked; never name a step Kill. After every
step, save C:\out\<case>-<n>.png and a matching .uia.txt.

RECORD FIRST (in every sandbox, before installing; write C:\out\environment.json)
- tester "Kyle Shabaga (driven by Claude Code)", date, time, time zone
- Windows: ProductName, EditionID, DisplayVersion, CurrentBuild.UBR (HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion)
- whoami (expect WDAGUtilityAccount); Test-Path "$env:APPDATA\com.fundedflow.desktop" (expect False)
- WebView2 before install: pv under HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}
  and the HKCU equivalent, or "absent"; Installed apps screenshot. Repeat after install.
- FUNDEDFLOW_* at Process, User and Machine (expect none)
- network state (Test-NetConnection github.com -Port 443)
- display resolution and scaling; CPU; RAM
- Get-FileHash of C:\kit\candidate\FundedFlow_0.1.1_x64-setup.exe and both CSVs, re-checked inside the sandbox

CASES
Run S1 (default networking; B7(a) and the base smoke)
| ID | Do | Expected |
|---|---|---|
| 1 | Hash check (RECORD FIRST) | Matches SHA256SUMS.txt and 60091DAF…0048646 |
| 2 | Run the installer interactively. SmartScreen → More info → Run anyway. Record every installer page. | No UAC; %LOCALAPPDATA%\FundedFlow; Start menu entry; Installed apps Publisher "Kyle Shabaga" |
| B7a | Only if WebView2 was "absent" before step 2: record the WebView2 version after install and that the app launches | Installer fetched WebView2; app launches |
| 3 | Disable-NetAdapter -Name * -Confirm:$false; Test-NetConnection fails | Offline until step 10 |
| 4 | First launch. Expand "Read the privacy notice" and "Read the license and product information"; record each title and "Version …" line; then Acknowledge and continue | "Before you start"; "Draft documents" banner; "Your privacy" summary; "Privacy notice (draft)" and "License and product information (draft)", both 0.2.1-draft; Close and Acknowledge and continue; then Today empty state, no error |
| 4a | dir $env:LOCALAPPDATA\FundedFlow; first line of THIRD_PARTY_NOTICES.txt; in-app Settings → Privacy & legal → Licence and third-party notices → Read the third-party notices; compare section names and counts | LICENSE and THIRD_PARTY_NOTICES.txt beside fundedflow.exe; starts "FundedFlow third-party notices"; in-app text has the same sections and counts |
| L1 | Settings → Privacy & legal: record the listed documents, versions and banner | Both documents at 0.2.1-draft; "Draft documents" banner |
| 5 | dir $env:APPDATA\com.fundedflow.desktop | fundedflow.db and legal-acceptance.json; record the full path |
| 6 | Add account "Smoke" (Evaluation, USD 50,000, America/Denver); import C:\kit\csv\synthetic-5.csv (Year-month-day); close; reopen | 5 trades kept after reopen |
| 7 | Sidebar; navigate to #/settings/developer; F12; Ctrl+Shift+I | No dev tools of any kind |
| L2 | Export a full backup to C:\Users\WDAGUtilityAccount\Documents; restore it (this creates a recovery copy); record the "Delete data permanently" description; open account deletion for "Smoke" → record the recovery-copy note and "What stays" → Cancel; open whole-journal erase → record the copies line → Cancel | Wording as in TASK-044 (expected list below); every dialog cancelled; data unchanged |
| B5 | With the app open, launch it again from the Start menu; screenshot both windows; in the first, edit a trade note and save; close all; relaunch | Second window may show a failure screen; first still saves; next launch normal; no data loss |
| B2-j | mklink /J C:\Users\WDAGUtilityAccount\Desktop\FFExportJunction C:\FFExportTarget (create the target first); dir /AL; full backup export into the junction | Refused "Nothing was exported. The archive contains an unsafe file path, so it was rejected."; C:\FFExportTarget empty; no stray file in Desktop or %TEMP%; journal unchanged |
| 8 | Uninstall from Installed apps with "Delete the application data" UNTICKED. Before and after, list %LOCALAPPDATA%\FundedFlow, %APPDATA%\com.fundedflow.desktop (recursive names and sizes only), %LOCALAPPDATA%\com.fundedflow.desktop (top level), Start menu FundedFlow shortcuts, and HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\* where DisplayName -like 'FundedFlow*' | Program files, shortcuts and uninstall entry gone; journal folder remains; record exactly what is left |
| 9 | Reinstall (offline; WebView2 is already present); launch | Smoke account and 5 trades open; no legal re-prompt |
| 10 | Run the same installer over the install (choose the reinstall option if offered); launch | Completes; journal kept |
| R1 | STOP. Tell Kyle "Ready for R1" and stop taking screenshots and UIA dumps. Kyle does R1 by hand (see R1 for Kyle). Resume only when he says "R1 done", and record only the counts he gives you. | Counts only; pass/fail from Kyle |
| 11 | Optional. Enable-NetAdapter; Resource Monitor → Network, filtered to fundedflow.exe and msedgewebview2.exe, for 3 minutes of use; record remote hosts | No non-Microsoft hosts |

Run S2 (B1, TASK-018 recheck; default networking)
| ID | Do | Expected |
|---|---|---|
| B1-1 | Install silently (/S); launch; acknowledge; dir the data folder | Standard profile reaches the app; db and lock file in %APPDATA%\com.fundedflow.desktop |
| B1-2 | Close the app; move Roaming behind a junction: mklink /J C:\FFRelocated C:\FFRelocatedReal, copy Roaming into it, set HKCU\...\Explorer\User Shell Folders AppData = C:\FFRelocated\Roaming (sandbox only); dir /AL; launch | Reaches the first-run screen or Today; journal under the junctioned path (also visible in the real folder); no "retry" failure |
| B1-3 | Undo B1-2. Close the app; replace %APPDATA%\com.fundedflow.desktop with a junction to C:\FFJunctionTarget\com.fundedflow.desktop (empty); launch; Acknowledge and continue; wait 30 s | First-run notice, then "FundedFlow doesn't trust its data folder", no Retry, stage data_directory; no db or lock file in the junction or its target (legal-acceptance.json there is a known Triage item, record it) |
| B1-4 | Remove the junction, restore the original folder, relaunch | Original data intact |

Run S3 (B4 ticked uninstall; default networking)
| ID | Do | Expected |
|---|---|---|
| B4 | Install; acknowledge; account and synthetic-5 import; export a full backup to C:\FFExports (outside both AppData trees); list as in step 8; uninstall with "Delete the application data" TICKED; list again; Test-Path on the archive | %APPDATA%\com.fundedflow.desktop and %LOCALAPPDATA%\com.fundedflow.desktop gone; program folder, shortcuts and uninstall entry gone; archive remains; any other leftover listed exactly |

Run S4 (B7(b), <Networking>Disable</Networking> from the start)
| ID | Do | Expected |
|---|---|---|
| B7b | Prove WebView2 absent (registry and Installed apps screenshot); run the installer interactively; record every message; try to launch if it installs; list %APPDATA%\com.fundedflow.desktop | Installer stops with a message, or the app reports WebView2 missing; no journal created; record the exact message text |

Not in this prompt (record their source in the report):
- B3 and B8 come from the "Final manual tests §1" run. Copy its PASS/FAIL, evidence paths, tester and date.
- B2 OneDrive is Kyle's, per the manual steps. If he did not do it, record Not Run: "needs throwaway Microsoft account".
- B6 is Kyle's, per the manual steps.
- The Windows 10 22H2 leg: repeat S1 to S4 on a Hyper-V VM (build 19045). Sandbox can't provide it.

R1 for Kyle (by hand, in S1 after step 10; nothing is recorded but counts)
1. Copy one current real broker export into the sandbox by clipboard (copy on the host, paste on the sandbox
   Desktop). Do not put it in C:\FFGate.
2. Import it into a new account in the app. Record: exporter name, file row count, imported trades, duplicates,
   skipped, and warning and error counts by kind (field or category). Do not record message text, symbols or IDs.
3. Delete the file in the sandbox, then tell Claude "R1 done" with the counts. Close S1 at the end; that discards the
   journal.

B6 for Kyle (a Hyper-V VM with a clean Windows, or a real PC under a new local Windows user that has no FundedFlow data)
- Install the candidate. For each of 125%, 150% and 200% (Settings → Display → Scale), screenshot the first-run screen,
  Today and Settings. Record the physical resolution and the scaling, and whether any primary action is unreachable or
  clipped.

B2 OneDrive for Kyle (optional; a VM or a spare local user signed into a throwaway Microsoft account, never his own)
- Turn Files On-Demand on and export a full backup to OneDrive\Documents. Record the target path, the Files On-Demand
  state, a screenshot of the result, the archive SHA-256 if one was saved, and any leftover at the target.

REPORT (write C:\FFGate\030\report.md, then summarize in chat)
- Header: tester; date; machine (Sandbox on <host model>); Windows ProductName, EditionID, DisplayVersion and build
  for each run; WebView2 before and after; source SHA 1d13c438c2cfa4752fb57fba8cef693ad3398d8f; version 0.1.1; EXE
  SHA-256 (Get-FileHash, host and sandbox); CSV hashes; FUNDEDFLOW_* state; TASK-018 (eeda9a1) and TASK-023 (1d13c43)
  in the source SHA: yes/no (git merge-base --is-ancestor on a fresh clone).
- One table row per case ID: Expected | Observed (exact on-screen text) | PASS / FAIL / NOT RUN (reason) | screenshot
  paths.
- Steps 4, 4a and L1 must show document titles, versions and whether each banner appears, recorded against TASK-025.
  L2 is recorded against TASK-044.
- R1: counts by kind and pass/fail only.
- Gate state for this machine (Passed / Failed / Blocked / Not Run) under the pass rule: every mandatory step 1–10,
  4a, B1–B8 and R1 must pass. State that the gate needs the Windows 10 22H2 leg too, so this run alone can't make
  it Passed.
- Surprises, and a proposed Triage card title for each failure. Do not create cards.
```

---

## TASK-031: upgrade, reinstall, downgrade and uninstall

**Why.** This gate decides whether a user's journal survives the real update path (0.1.0 → 0.1.1) and a same-version
reinstall, and whether the uninstaller's "Delete the application data" checkbox removes exactly what TASK-026
documents and nothing else. It also records what a downgrade does, and NSIS's own prompts. It is **Passed** iff
(a) the synthetic data is intact after the upgrade and after the reinstall, (b) an unticked uninstall keeps
`%APPDATA%\com.fundedflow.desktop`, and (c) a ticked uninstall removes exactly the TASK-026 list. Steps 4 and 4a are
recorded, but a run 4a with (i)–(iii) false gives Failed (see finding 1).

**Sandbox: can and can't.** Everything runs in Sandbox: installs, NSIS pages, HKCU uninstall entries, folder listings
and file locks. Networking must be on for the first install (WebView2). Getting the 0.1.0 baseline: GitHub until
2026-11-20 (see BUILD), after that a copy from the coordinator PC. 4a's file lock works in Sandbox. Nothing here needs
a person, except that Kyle rules on 4a.

**Expected results (spec r7)**

- 0: the 0.1.0 installer `FundedFlow_0.1.0_x64-setup.exe` (source `7679edc1ac117944ae31d81b6c6a29142b61a0fe`) hashes to
  `041983f5…0e0787f`. Record where the kept copy lives.
- 1: 0.1.0 installs. Synthetic account, trades and screenshots are created, and an archive is exported outside
  `%APPDATA%`.
- 2: after the upgrade the data is intact. The "Before you start" acknowledgment shows (0.1.0 left no record), naming
  the `0.2.1-draft` documents, and **Acknowledge and continue** opens the app. Expect `fundedflow.db.before-v23.bak`
  (finding 1).
- 3: after the same-version reinstall the data is intact and **no** acknowledgment prompt appears.
- 4: record the NSIS prompt, if any, and whether 0.1.0 opens. The spec says "opens normally"; finding 1 predicts the
  NewerSchema refusal. Record-only.
- 4a: spec expectations (i) 0.1.0 reaches Ready; (ii) it finishes the marker; (iii) the journal and other data are
  intact; (iv) quarantine and extras may remain. Finding 1 predicts (i) and (ii) fail. Record the marker name and
  contents before, screenshots, and the `data-controls-cleanup\` and `data-controls\` listings after.
- 5, unticked: `%APPDATA%\com.fundedflow.desktop` is kept (and `%LOCALAPPDATA%\com.fundedflow.desktop`). Ticked:
  `%APPDATA%\com.fundedflow.desktop` and `%LOCALAPPDATA%\com.fundedflow.desktop` are removed, plus the program folder,
  shortcuts and uninstall entry; the exported archive remains; nothing else is removed. After **each** uninstall, list
  every per-user data folder, recovery copy (`*.before-v*.bak`, `*.previous-*.bak`, `data-controls\`,
  `data-controls-work\`) and export that remains. The privacy notice says "Uninstall is not the journal-erasure
  control: do not rely on it to remove per-user data, recovery files or exports."

```text
You are testing FundedFlow release gate TASK-031 (upgrade, reinstall, downgrade, uninstall) on the recorded candidate.
Drive the app in Windows Sandbox with UI Automation, SendInput and screenshots, as in the TASK-011 sandbox runs.

RULES (do not deviate)
- Windows Sandbox only. Install, launch and test FundedFlow only inside a fresh sandbox; never install or run it on
  this host.
- Never read, list, copy, open or change the host's %APPDATA%\com.fundedflow.desktop or
  %LOCALAPPDATA%\com.fundedflow.desktop.
- No sign-ins of any kind inside the sandbox. On the host, use gh only for the downloads in BUILD.
- Use synthetic data only (synthetic-5.csv and screenshots you generate as plain PNGs). Never paste CSV contents into
  chat or the report.
- Leave every FUNDEDFLOW_* environment variable unset (not "0") at Process, User and Machine level; check and record
  it.
- Use a fresh sandbox per run (T1, T2). Only C:\FFGate\kit is reused.
- A case you can't do is Not Run, with the reason. Never infer a Pass.
- Ask Kyle before anything this prompt does not cover.

BUILD (on the host)
1. Candidate: gh run download 40014761941 --repo KyleShabaga/FundedFlow -n fundedflow-0.1.1-1d13c43-windows-nsis -D C:\FFGate\kit\candidate
   SHA-256 of FundedFlow_0.1.1_x64-setup.exe must be 60091DAFD5BD8E6CDF9D40EB4610F75B735C15E0FBF7BE3E5F3B94A7E0048646
   and match SHA256SUMS.txt (source_sha 1d13c438c2cfa4752fb57fba8cef693ad3398d8f, version 0.1.1).
2. 0.1.0 baseline (step 0): gh run download 39691474111 --repo KyleShabaga/FundedFlow -n fundedflow-0.1.0-7679edc-windows-nsis -D C:\FFGate\kit\baseline
   (it expires 2026-11-20 23:19 UTC; after that, ask Kyle to copy
   C:\Users\Kyle\Documents\FundedFlow-release-artifacts\0.1.0-7679edc\ into C:\FFGate\kit\baseline).
   SHA-256 of FundedFlow_0.1.0_x64-setup.exe must be 041983F565C7F6B41DBA2388C2F21BC8C4C7402C94E442ED0F75D00938E0787F
   (source 7679edc1ac117944ae31d81b6c6a29142b61a0fe). If it differs or is missing, the gate is Blocked; stop.
3. synthetic-5.csv: cmd /c "gh api repos/KyleShabaga/FundedFlow/contents/code-review/execution/sandbox/kit/synthetic-5.csv?ref=claude/practical-turing-wmii06 -H Accept:application/vnd.github.raw > C:\FFGate\kit\csv-lf\synthetic-5.csv"
   then convert LF to CRLF with ReadAllText/WriteAllText and GetEncoding(28591), replacing "`r?`n" with "`r`n", into
   C:\FFGate\kit\csv\synthetic-5.csv. It must hash to 4A8313121EBF377B20C1F7D2FF3E1F4153797672B5CA4B8B7F420287F6A297DA.
4. .wsb: map C:\FFGate\kit to C:\kit (ReadOnly) and C:\FFGate\031\<run>\out to C:\out; MemoryInMB 8192; default
   networking.

DRIVER TIPS: UIA Invoke/Toggle/Value; drive NSIS pages through UIA (record every page title, radio buttons and
checkboxes with their default state); Save/Open dialog #32770, file-name Edit 1148/1001; a full backup needs "I
understand this file is not encrypted" ticked; use Stop-Process, never a step named Kill. Screenshot and UIA dump
after every step. For screenshots in the app, generate small PNGs with System.Drawing (a coloured square with the text
"synthetic") in C:\Users\WDAGUtilityAccount\Pictures.

RECORD FIRST (in each sandbox; C:\out\environment.json)
tester "Kyle Shabaga (driven by Claude Code)"; date, time, time zone; Windows ProductName, EditionID, DisplayVersion
and CurrentBuild.UBR; whoami; WebView2 pv before and after install (HKLM WOW6432Node EdgeUpdate Clients
{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5} and HKCU), or absent; FUNDEDFLOW_* at all three levels; network; both installer
hashes re-checked in the sandbox; CSV hash; Test-Path %APPDATA%\com.fundedflow.desktop is False.

SNAPSHOT (use it wherever the cases say "snapshot"; save as C:\out\<case>-snapshot.txt)
- Recursive names, sizes and LastWriteTime (no contents) of %LOCALAPPDATA%\FundedFlow, %APPDATA%\com.fundedflow.desktop
  and %LOCALAPPDATA%\com.fundedflow.desktop (top two levels for the last one)
- Start menu and desktop FundedFlow shortcuts
- HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\* where DisplayName -like 'FundedFlow*': DisplayName,
  DisplayVersion, Publisher, UninstallString
- the export archive path and its SHA-256
- named recovery copies: *.before-v*.bak, *.previous-*.bak, data-controls\*, data-controls-work\*,
  data-controls-cleanup\*, data-controls-quarantine\*
- In the app: account names, trade count per account, screenshot count per trade

CASES
Run T1 (main path: steps 1, 2, 3, 5)
| ID | Do | Expected |
|---|---|---|
| 0 | BUILD step 2 hash check; record the baseline file path on the host | Matches 041983F5…0E0787F |
| 1 | Install 0.1.0 interactively; launch; add account "Upgrade" (Evaluation, USD 50,000, America/Denver); import synthetic-5.csv; attach 2 PNG screenshots to 2 trades; write a trade review note "T031-note"; export a full backup to C:\FFExports; snapshot | All created; archive outside %APPDATA%; record whether 0.1.0 shows any first-run screen |
| 2 | Run the 0.1.1 installer interactively. Record the "Uninstall before installing" page and keep "Delete the application data" unticked. Launch. Record the acknowledgment screen: title, documents, versions. Acknowledge and continue. Snapshot. | Prompt "Before you start" (or the changed-notice title) naming "Privacy notice (draft)" and "License and product information (draft)" at 0.2.1-draft; app opens; account, 5 trades, 2 screenshots and the note intact; fundedflow.db.before-v23.bak present; Installed apps shows 0.1.1 |
| 3 | Run the 0.1.1 installer again (same version); launch; snapshot | No acknowledgment prompt; data intact |
| 5u | Uninstall with "Delete the application data" UNTICKED (record the checkbox default); snapshot | %APPDATA%\com.fundedflow.desktop kept with all recovery copies; %LOCALAPPDATA%\com.fundedflow.desktop state recorded; program folder, shortcuts and uninstall entry gone; archive remains |
| 5r | Reinstall 0.1.1 /S; launch; verify the data (no prompt expected); snapshot | Data intact (supports (b)) |
| 5t | Uninstall with "Delete the application data" TICKED; snapshot | %APPDATA%\com.fundedflow.desktop and %LOCALAPPDATA%\com.fundedflow.desktop absent; program folder, shortcuts and uninstall entry gone; C:\FFExports archive still present with the same SHA-256; list anything else that remains or vanished |

Run T2 (downgrade: steps 4 and 4a)
| ID | Do | Expected |
|---|---|---|
| T2-setup | Install 0.1.0, add account and data as in step 1, upgrade to 0.1.1 as in step 2 (acknowledge); snapshot | As step 2 |
| 4 | Run the 0.1.0 installer interactively over 0.1.1. Record every NSIS page and prompt (downgrade warning, uninstall-first option, checkbox defaults); keep "Delete the application data" unticked. Launch 0.1.0. Screenshot. SHA-256 of fundedflow.db before and after the launch (app closed). | Record-only. Predicted: NewerSchema screen "Your journal was created by a newer version of FundedFlow. Install the latest version to open it. Your data has not been changed." with no Retry, db hash unchanged. The spec text says "opens normally"; record what actually happens. |
| 4-back | Reinstall 0.1.1 over 0.1.0 (unticked); launch; verify data | Data intact |
| 4a | In 0.1.1: restore the C:\FFExports backup so that data-controls\<uuid>\ exists. In a separate PowerShell that stays open, $h=[IO.File]::Open('<a file in data-controls\<uuid>\>','Open','Read','None'). Run Settings → Delete data permanently → Erase the entire local journal (type its phrase). Confirm that a marker *.json exists in data-controls-cleanup\ and save its name and contents to C:\out\4a-marker.json. Close FundedFlow; $h.Dispose(). Install 0.1.0 over it (unticked); launch; wait 60 s; screenshot; list data-controls-cleanup\, data-controls\ and data-controls-quarantine\ | Spec: (i) Ready; (ii) marker completed (listed copies removed, then the marker); (iii) journal and remaining data intact; (iv) quarantine may remain. Predicted: NewerSchema refusal, marker untouched. Record observed (i)–(iv) and mark DECISION NEEDED (see the report) |
| 4a-opt | Optional: repeat with the lock still held when 0.1.0 starts | OpenFailed "Pending deletion cleanup could not finish" is expected, not a failure (if the schema check doesn't stop it first; record which message) |

REPORT (C:\FFGate\031\report.md, then summarize in chat)
- Header: tester; date; Windows edition, DisplayVersion and build for each run; WebView2 version; source SHA
  1d13c438c2cfa4752fb57fba8cef693ad3398d8f, candidate version 0.1.1, EXE SHA-256 60091DAF…; older EXE
  FundedFlow_0.1.0_x64-setup.exe, source 7679edc1ac117944ae31d81b6c6a29142b61a0fe, version 0.1.0, SHA-256 041983F5…
  (Get-FileHash result), where the kept copy lives and the date it was checked (before 2026-11-20).
- One row per case ID: Expected | Observed (exact text, NSIS page names) | PASS / FAIL / NOT RUN | evidence paths.
- Step 2 must show the prompt's title, documents and versions, and that Acknowledge and continue opened the app. Step 3
  must show that no prompt appeared.
- After 5u and 5t: the full snapshot. Compare against the TASK-026 r5 list (pass rule (c)), and list the per-user data,
  recovery copies and exports that remain (privacy-notice check).
- Pass rule: (a) data intact after 2 and 3; (b) 5u keeps %APPDATA%\com.fundedflow.desktop; (c) 5t removes exactly the
  list. State Passed, Failed, Not Run or Blocked.
- DECISION NEEDED for Kyle: the candidate's journal is schema 23 (migrations 0022 and 0023 added after 0.1.0, which
  stops at 21), so 0.1.0 can't open it. Quote the observed 4 and 4a results. Under the literal pass rule a run 4a
  with (i) false is Failed. Kyle chooses: accept and amend the TASK-015/016 declaration, or record 4a as Not Run
  ("premise changed: schema 23"). Do not decide this yourself.
```

---

## TASK-032: manual recovery (ISSUE-001–004 scenarios)

**Why.** This gate decides whether FundedFlow's recovery paths, which have never run on a packaged build, keep data
safe on the installed candidate. It covers the export → erase → restore round trip, a locked journal, a corrupt
journal, a failed migration, a newer-schema journal, an interrupted restore, malformed cleanup markers, stray and
missing screenshots, and large-journal export. It is **Passed** only if R0–R8 all match their expected results with no
data loss. R9 (antivirus) and R10 (uncertain write) are record-only.

**Sandbox: can and can't.** R0–R8 all run in Sandbox. R1–R4 need a SQLite command-line tool to set
`PRAGMA user_version` and to checkpoint. The prompt fetches the official `sqlite-tools-win-x64` zip from sqlite.org on
the host, checks it, and maps it read-only into the sandbox. R5 kills the process at timed points. R8 needs about 8 GB
of sandbox memory and several 50k imports. R9: Defender behaviour in Sandbox may differ from a real PC, so it is
optional. R10: no reliable way to force an uncertain write is known. Record Not Run and propose a Triage card, as the
spec says.

**Expected results (spec r3)**

| # | Expected |
|---|---|
| R0 | "Journal restored" appears only after the runtime is Ready. Account, trades and screenshots match the state before the export. Record the export name, size and SHA-256. |
| R1 | An open failure explained, with Retry and an allowlisted summary ("FundedFlow could not open your journal database. If another copy of FundedFlow or a sync/backup tool is using it, close it and retry. Your data has not been changed."). After unlocking, Retry reaches Ready and the data is intact. |
| R2 | The failure is explained. No empty-journal claim. The file is not reset or overwritten (same SHA-256). |
| R3 | Rolled back. The message names the pre-upgrade backup (`fundedflow.db.before-v23.bak`). After the cause is fixed, the journal opens at its previous state. |
| R4 | Refused with code and versions (NewerSchema, found 24, supported 23). No Retry, reset or downgrade. File untouched. |
| R5 | The next start ends in either the pre-restore journal or the fully restored one, never a mix. Record which. |
| R6 | A zero-byte marker or a non-regular entry still reaches Ready at startup and at restore prepare. |
| R7 | A stray file is kept in the safety folder. A missing screenshot does not block restore or erase. |
| R8 | With more than 64 MiB of free pages and small live data, the export succeeds (the snapshot is vacuumed, never the live journal) and shows name, size and SHA-256; erase preview and restore inspect succeed. With live data over the cap, the export is refused with a detail naming the component, and the journal is unchanged. Record the journal size, free-page count, export result, and that the live journal was not vacuumed. |
| R9, R10 | Record if feasible; R10 Not Run → propose a Triage card. |

```text
You are testing FundedFlow release gate TASK-032 (manual recovery) on the recorded candidate. Drive the app in
Windows Sandbox with UI Automation, SendInput and screenshots, as in the TASK-011 sandbox runs.

RULES (do not deviate)
- Windows Sandbox only. Install, launch and test FundedFlow only inside a fresh sandbox; never install or run it on
  this host.
- Never read, list, copy, open or change the host's %APPDATA%\com.fundedflow.desktop or
  %LOCALAPPDATA%\com.fundedflow.desktop. Run sqlite3 only on journals inside the sandbox.
- No sign-ins of any kind inside the sandbox. On the host, use gh and the one sqlite.org download only, as in BUILD.
- Use synthetic data only (synthetic-5.csv, synthetic-50k.csv, subsets of them, PNGs you generate). Never paste CSV
  contents or journal rows into chat or the report; record counts, names, sizes and hashes only.
- Leave every FUNDEDFLOW_* environment variable unset (not "0") at Process, User and Machine level; check and record
  it.
- Use a fresh sandbox per run (P1 to P5). Only C:\FFGate\kit is reused. Within R5, a backup archive from an earlier
  attempt in this gate may be reused from C:\FFGate\032\shared.
- Edit or corrupt a journal only while FundedFlow is closed. Before every change, save a copy and its SHA-256 to
  C:\out.
- A case you can't do is Not Run, with the reason. Never infer a Pass.

BUILD (on the host)
1. Candidate: gh run download 40014761941 --repo KyleShabaga/FundedFlow -n fundedflow-0.1.1-1d13c43-windows-nsis -D C:\FFGate\kit\candidate
   SHA-256 must be 60091DAFD5BD8E6CDF9D40EB4610F75B735C15E0FBF7BE3E5F3B94A7E0048646 and match SHA256SUMS.txt
   (source_sha 1d13c438c2cfa4752fb57fba8cef693ad3398d8f).
2. CSVs: fetch synthetic-5.csv and synthetic-50k.csv with
   cmd /c "gh api repos/KyleShabaga/FundedFlow/contents/code-review/execution/sandbox/kit/<name>?ref=claude/practical-turing-wmii06 -H Accept:application/vnd.github.raw > C:\FFGate\kit\csv-lf\<name>"
   then convert LF to CRLF (ReadAllText/WriteAllText, GetEncoding(28591), "`r?`n" → "`r`n") into C:\FFGate\kit\csv.
   Hashes: 5 = 4A8313121EBF377B20C1F7D2FF3E1F4153797672B5CA4B8B7F420287F6A297DA,
   50k = 6E1404CBF24A8C9E0BACE76481F0750FF7F3D11501F74055E6B04343A93F189F.
   Make synthetic-40k.csv (header plus the first 40,000 data rows of the CRLF 50k file) and record its SHA-256. Its
   data.json must stay under 64 MiB; 50k gives 72 MB.
3. sqlite3: from https://www.sqlite.org/download.html take the current "sqlite-tools-win-x64-*.zip". Record the
   file name, size and the SHA3-256 the page lists. Verify it in PowerShell 7 with
   [Convert]::ToHexString([Security.Cryptography.SHA3_256]::HashData([IO.File]::ReadAllBytes($zip))). If SHA3 is
   unsupported, record the SHA-256 and say so. Extract to C:\FFGate\kit\tools\sqlite (an empty folder of its own).
4. .wsb: map C:\FFGate\kit to C:\kit (ReadOnly), C:\FFGate\032\<run>\out to C:\out, C:\FFGate\032\shared to
   C:\shared; MemoryInMB 8192; default networking.

DRIVER TIPS: UIA Invoke/Toggle/Value; Save/Open dialog #32770, file-name Edit 1148/1001; Radix dropdowns need the
keyboard; a full backup needs "I understand this file is not encrypted" ticked; use Stop-Process -Name fundedflow
-Force, never a step named Kill. Screenshot and UIA dump after every step. Generate PNG screenshots with System.Drawing.
J = %APPDATA%\com.fundedflow.desktop. Checkpoint before editing:
C:\kit\tools\sqlite\sqlite3.exe "$J\fundedflow.db" "PRAGMA wal_checkpoint(TRUNCATE);"

RECORD FIRST (in each sandbox; C:\out\environment.json)
tester "Kyle Shabaga (driven by Claude Code)"; date, time, time zone; Windows ProductName, EditionID, DisplayVersion
and CurrentBuild.UBR; whoami; WebView2 pv before and after install; FUNDEDFLOW_* at all three levels; installer and CSV
hashes re-checked; sqlite3 version; Test-Path J is False before install. Each run: install /S, launch, Acknowledge and
continue, add account "Base" (Evaluation, USD 50,000, America/Denver), import synthetic-5.csv, attach a PNG screenshot
to 2 trades. Record the baseline: accounts, trade counts, screenshot count, and SHA-256 of fundedflow.db after closing
and checkpointing.

CASES
Run P1 (R0, R6, R7)
| ID | Do | Expected |
|---|---|---|
| R0 | Settings → Export → full backup through the real Save dialog to Documents; record the on-screen name, size and SHA-256, and Get-FileHash. Settings → Delete data permanently → Erase the entire local journal (type the phrase). Then Restore → choose the archive → type the phrase → restore. Record the order in which Ready and "Journal restored" appear. | "Journal restored" only after Ready; the data equals the baseline |
| R6a | Close the app. Create J\data-controls-cleanup\<new-guid>.json (0 bytes) and a directory J\data-controls-cleanup\<guid2>.json. Launch. | Reaches Ready; record the J\data-controls-cleanup and J\data-controls-quarantine listings |
| R6b | With the app at Ready, create the same two entries again, then start a restore of the R0 archive up to the confirmation step (restore prepare) and complete it | Prepare and restore succeed; listings recorded |
| R7a | Close the app. Put a stray synthetic PNG J\attachments\stray-r7.png. Launch; restore the R0 archive | The stray file is preserved under J\data-controls\<uuid>\safety-attachments\; record its path |
| R7b | Close the app. Delete one referenced screenshot file from J\attachments (record which storage key). Launch; restore the R0 archive; then open the whole-journal erase dialog and complete the erase | Neither is blocked; record any "already gone from disk" notice text |

Run P2 (R1, R2)
| ID | Do | Expected |
|---|---|---|
| R1 | Close the app. In a separate PowerShell: $h=[IO.File]::Open("$J\fundedflow.db",'Open','ReadWrite','None'). Launch; screenshot the failure; record message, detail and buttons. $h.Dispose(); press Retry. | Open failure, retryable, with an allowlisted summary; after Retry, Ready with the baseline data |
| R2 | Close the app; checkpoint; copy fundedflow.db to C:\out\R2-before.db and hash it. Overwrite bytes 0–99 of J\fundedflow.db with zeros (FileStream, Seek 0, Write 100 zero bytes). Hash. Launch; screenshot; press Retry if offered; close. Hash J\fundedflow.db again and list J. | Failure explained (record category, message, detail); no empty-journal claim (no "Add an account" empty state presented as the journal); file hash unchanged after launch and Retry; no new or replaced db |
| R2b | Optional: on a fresh copy, overwrite 4 KiB of random bytes in the middle of the file instead | Record-only |

Run P3 (R3, R4)
| ID | Do | Expected |
|---|---|---|
| R3 | Close the app; checkpoint; hash. Simulate a failed migration: sqlite3 "$J\fundedflow.db" "PRAGMA user_version=22;". The tables of migration 23 already exist, so re-running 23 fails. Launch; record the message. List J for fundedflow.db.before-v23.bak. Fix the cause: close the app, then sqlite3 "PRAGMA user_version=23;". Launch or Retry. | "Upgrading your journal failed at step 23 and that step was rolled back … A copy from before the upgrade is saved as fundedflow.db.before-v23.bak …"; user_version still 22 after the failure; after the fix, Ready with the baseline data |
| R4 | Close the app; checkpoint. sqlite3 "PRAGMA user_version=24;". Hash fundedflow.db. Launch; record message, code and versions; check that there is no Retry, reset or downgrade action. Close; hash again; sqlite3 -readonly "PRAGMA user_version;" | NewerSchema: "Your journal was created by a newer version of FundedFlow. Install the latest version to open it. Your data has not been changed."; detail "journal schema version 24 is newer than this app supports (23)"; hash unchanged; user_version still 24 |

Run P4 (R5; repeat in fresh sandboxes as needed)
| ID | Do | Expected |
|---|---|---|
| R5-prep | First time only: account "Big archive", import synthetic-40k.csv, export a full backup, copy it to C:\shared\big.ffj.zip with its SHA-256. In each attempt sandbox, the baseline is account "Base" with 5 trades. | — |
| R5-n | Restore C:\shared\big.ffj.zip. After the final confirm, Stop-Process -Name fundedflow -Force (and any msedgewebview2 children of it) at t = 0.5 s, 1 s, 2 s and 4 s, one attempt per sandbox (or until the restore finishes before the kill; record that). Before relaunch, list J (data-controls-pending.json, data-controls\, data-controls-work\). Relaunch; record the screen, accounts and trade counts. | Every attempt ends in either Base with 5 trades or Big archive with 40,000 trades, never a mix; record which, and any recovery banner text |

Run P5 (R8)
| ID | Do | Expected |
|---|---|---|
| R8a | Account "Bulk1": import synthetic-50k.csv; delete account Bulk1 (account deletion, typed phrase). Repeat with Bulk2 if needed until, with the app closed, sqlite3 -readonly "PRAGMA page_size; PRAGMA freelist_count; PRAGMA page_count;" shows freelist_count × page_size > 67,108,864. Record the db size, page_size, freelist_count and page_count. Keep "Base" (5 trades) as the live data. | Precondition recorded |
| R8b | Launch; export a full backup; record the on-screen name, size and SHA-256 and the Get-FileHash. Close; record db size and freelist_count again. | Export succeeds; live db size and freelist_count unchanged (live journal not vacuumed) |
| R8c | Open the whole-journal erase preview (then Cancel) and Restore → choose the R8b archive → inspect summary (then Cancel) | Both succeed |
| R8d | Account "Cap": import synthetic-50k.csv; export a full backup; record the message. Close; compare the trade counts and db hash before and after the export attempt. | Refused: "This is larger than the supported archive limits. Over the limit: data.json: … bytes, limit 67108864 bytes."; nothing written at the target or in %TEMP%; journal unchanged |

Optional
| R9 | Antivirus lock: only if a safe way exists in the sandbox (for example a Defender custom scan of J while the app writes). Record the behaviour, or Not Run. | Record-only |
| R10 | Uncertain-write acknowledgement (rulebook, Today checkpoint, calculation, screenshot) | Record Not Run unless a reliable method exists; then put "Triage card needed: R10 uncertain-write packaged check" in the report |

REPORT (C:\FFGate\032\report.md, then summarize in chat)
- Header: tester; date; Windows edition, DisplayVersion and build for each run; WebView2 version; source SHA
  1d13c438c2cfa4752fb57fba8cef693ad3398d8f; EXE SHA-256 60091DAF…; CSV hashes; sqlite3 version and zip hash;
  FUNDEDFLOW_* state.
- One row per scenario: Expected | Observed (exact category, message and detail text) | PASS / FAIL / NOT RUN | data
  loss yes/no | evidence paths (screenshots, hashes, listings).
- R8 must state: db size, page_size, freelist_count before and after, and the export name, size and SHA-256.
- Gate state: Passed only if R0–R8 all pass with no data loss. Otherwise Failed, Blocked or Not Run.
- Proposed Triage card titles for failures and for R10 if Not Run. Do not create cards.
```

---

## TASK-033: accessibility and window/DPI matrix

**Why.** This gate decides whether the candidate is usable by keyboard and screen-reader users, in all themes,
including the four contrast themes, at 125%, 150% and 200% scaling, with 200% text, at the 800 × 480 minimum window,
on ultrawide and mixed-DPI displays. It runs Build 26 §9 (visible focus, contrast, scaling and zoom, reflow, NVDA,
file-chooser focus return, reduced motion), window matrix D1–D11, and W1–W10, W12 and W14–W20. It is **Passed** only if
every mandatory row passes. A row not run, including for lack of hardware, is Blocked or Not Run unless Kyle waives it
in writing in the execution log. W11 is record-only and W13 is N/A.

**Sandbox: can and can't**

| Rows | Where |
|---|---|
| D1–D4, D6–D11, W1, W2, W6, W7, W8, W10, W12, W18 (at 100%), §9 visible focus (keyboard), file-chooser focus return, reduced motion | Sandbox, automated. Rows whose window is bigger than the sandbox desktop become Not Run and move to Kyle. Run the sandbox maximised on the largest monitor. |
| W14–W17 contrast themes, §9 contrast | Sandbox, if Settings → Accessibility → Contrast themes applies there. Otherwise Kyle on a real PC. Contrast pass/fail is a visual judgement: Claude collects screenshots and measured colour pairs, and Kyle confirms. |
| W3, W4, W5, W9, §9 scaling 125/150% and zoom 200% | **Real PC or Hyper-V VM** (Sandbox scaling is not reliably changeable). Kyle. |
| D5 (real 3440 × 1440 ultrawide), W19 (two monitors with different scaling) | **Real hardware only.** Kyle. |
| §9 NVDA + WebView2, W20 | **Person required** (Kyle with NVDA). Claude must not judge screen-reader output. |
| W11 | Record-only. It needs a debug build's DevTools, so it is Not Run on the packaged candidate unless Kyle does it. |

**Expected results.** §9 (`build-26-accessibility-journeys.md:231-237`): visible focus on every control in both
themes; adequate contrast in both themes; usable at 125% and 150% scaling and at Ctrl+ 200% zoom; no blocking
overflow and reflow at narrow widths; NVDA reads in a sensible order, with headings, landmarks, table headers, and
status announcements for the Today headline, toasts and the validation summary; focus returns to the Settings button
after Save, Open or Cancel in the native chooser; works with animation effects off. D1–D11: the page title, account
selector, Import and body share one left and one right edge; content is centred beside the sidebar; no sideways
scroll; text and label/value pairs stay readable (per-row extras as listed in the matrix). W rows: core workflows work
(add an account, Quick import and confirm, the wizard to the confirm bar, open a trade and save its review, save the
daily review, edit and save a rulebook, Verify balance, Settings export, first-run acknowledgment), with every primary
and dialog action reachable and only vertical scrolling. Record for every run: build SHA, Windows, WebView2, physical
resolution, OS scaling, content viewport in CSS px, app zoom, theme, screenshots.

```text
You are testing FundedFlow release gate TASK-033 (accessibility and window/DPI matrix) on the recorded candidate.
Drive the app in Windows Sandbox with UI Automation, SendInput and screenshots, as in the TASK-011 sandbox runs.
Some rows need Kyle on a real PC; this prompt lists them and you do not attempt them.

RULES (do not deviate)
- Windows Sandbox only for anything you drive. Never install or run FundedFlow on this host.
- Never read, list, copy, open or change the host's %APPDATA%\com.fundedflow.desktop or
  %LOCALAPPDATA%\com.fundedflow.desktop.
- No sign-ins of any kind inside the sandbox. On the host, use gh only for the downloads in BUILD.
- Use synthetic data only (synthetic-5.csv plus data you create: long account names such as "Evaluation account with
  a deliberately very long display name 0123456789", large and negative money values typed in by you). Never paste
  CSV contents into chat or the report.
- Leave every FUNDEDFLOW_* environment variable unset (not "0") at Process, User and Machine level; check and record
  it.
- Use a fresh sandbox per run (A1 = light, A2 = dark and system-switch, A3 = contrast themes). Only C:\FFGate\kit is
  reused.
- Do not judge screen-reader output or final contrast acceptability. Collect evidence; Kyle decides those rows.
- A row you can't do is Not Run, with the reason. Never infer a Pass.

BUILD (on the host)
1. gh run download 40014761941 --repo KyleShabaga/FundedFlow -n fundedflow-0.1.1-1d13c43-windows-nsis -D C:\FFGate\kit\candidate
   The Get-FileHash SHA-256 of FundedFlow_0.1.1_x64-setup.exe must be
   60091DAFD5BD8E6CDF9D40EB4610F75B735C15E0FBF7BE3E5F3B94A7E0048646 and match SHA256SUMS.txt
   (source_sha 1d13c438c2cfa4752fb57fba8cef693ad3398d8f).
2. synthetic-5.csv: cmd /c "gh api repos/KyleShabaga/FundedFlow/contents/code-review/execution/sandbox/kit/synthetic-5.csv?ref=claude/practical-turing-wmii06 -H Accept:application/vnd.github.raw > C:\FFGate\kit\csv-lf\synthetic-5.csv"
   then convert LF to CRLF (GetEncoding(28591), "`r?`n" → "`r`n") into C:\FFGate\kit\csv;
   SHA-256 4A8313121EBF377B20C1F7D2FF3E1F4153797672B5CA4B8B7F420287F6A297DA.
3. .wsb: map kit (ReadOnly) and C:\FFGate\033\<run>\out; MemoryInMB 8192; default networking. Before starting, record
   the host monitor resolution and scaling, and run the sandbox window maximised on the largest monitor.

DRIVER TIPS: UIA Invoke/Toggle/Value; SendInput for Tab, Shift+Tab, Ctrl+B and Ctrl+plus; Save/Open dialog #32770;
Radix dropdowns need the keyboard. Set the window size with SetWindowPos on the FundedFlow top-level window, then read
the client rect. At 100% scaling with app zoom 1, the client size in px is the CSS viewport; record both. Visible focus
evidence: after each Tab, screenshot the focused element's bounding rect (UIA FocusedElement) plus 8 px, and record its
name and role. Colour evidence: sample the foreground and background pixels of text, the focus ring and status chips,
and compute WCAG contrast ratios. Screenshot and UIA dump after every step.

RECORD FIRST (in each sandbox; C:\out\environment.json)
tester "Kyle Shabaga (driven by Claude Code)"; date, time, time zone; Windows ProductName, EditionID, DisplayVersion
and CurrentBuild.UBR; WebView2 pv after install; FUNDEDFLOW_* at all three levels; sandbox desktop resolution and DPI
(GetDpiForWindow); installer hash re-checked. Then install /S, launch, Acknowledge and continue (screenshot the
first-run screen at every size the W rows list), add 1, 2, 4 and 8 accounts as D7 needs, and import synthetic-5.csv
into the first.

CASES (each row records: CSS viewport, scaling, theme, sidebar expanded and collapsed where the matrix asks, PASS /
FAIL / NOT RUN, evidence)
| ID | Run | Do | Expected |
|---|---|---|---|
| D1 | A1 | Today, Journal, Insights, Accounts, Settings, Import at 1280×800; sidebar expanded and collapsed | Shared left and right edges for title, account selector, Import and body; centred; no sideways scroll; readable |
| D2 | A1 | Same at 1440×900 | Same |
| D3 | A1 | Same at 1920×1080 (Not Run if the desktop is smaller) | Same |
| D4 | A1 | Same at 2560×1080 (Not Run if the desktop is smaller) | Same |
| D6 | A1 | Same at 1024×640 | Same |
| D7 | A1 | Today with 1, 2, 4 and 8 active accounts at 1920 wide (3440 → Kyle): card columns, long names, Unknown and setup states | Readable; no clipping; Unknown shows "—" |
| D8 | A1 | Today freshness at 1280 and 1920 wide | Values beside labels; no clipped badge or link |
| D9 | A1 | Resize in 40 px steps from 1024 to the widest possible, with an account selected, form text typed and a filter set | No jump; selection, form text and filter kept |
| D10 | A1 | At 1280×800 with a half-filled daily review, then a rulebook editor: Ctrl+B twice | Nothing resets |
| D11 | A1 | Today at 1920×1080: Tab through, recording the order | Freshness → accounts → selected account → risk |
| W1 | A1 | Core workflows at 800×480, light | All doable; actions reachable; vertical scroll only |
| W2 | A2 | Same, dark | Same |
| W6 | A1+A2 | 1024×640 and 1280×800, sidebar expanded and collapsed, light and dark | Expanded layout correct |
| W7 | A2 | Resize 800 → 1280 across 900 px and each filter fold point | Selection, counts and focus kept |
| W8 | A2 | 800×480: Verify balance, Add account, delete confirmations, export, validation summaries | All reachable; vertical scroll only |
| W10 | A2 | Settings → Accessibility → Text size 200% (if available in the sandbox), at 1280×800 and 800×480: forms, filters, tables, validation, dialogs, recovery screens | Usable; record the mechanism |
| W12 | A2 | Switch Windows app mode light ↔ dark with FundedFlow open, including an open dialog | The app follows; the dialog stays usable. Record the render-failure screen part as Not Run if it can't be triggered safely |
| W14–W17 | A3 | Aquatic, Desert, Dusk and Night sky contrast themes at 1280×800 and 800×480: focus ring, selected route/tab/segment/day, borders, Safe/Caution/Stop/Unknown, meters, dialogs | Screenshots and contrast ratios; Kyle confirms pass/fail |
| W18 | A1+A2 | Long names, large and negative money, loading, empty and error states, keyboard navigation and visible focus at 800×480 (the 200% text part follows W10) | Readable; focus visible |
| §9-focus | A1+A2 | Tab through every control on Today, Journal, a trade, the daily review, Accounts, Settings and Import, in light and dark | A visible focus indicator on every control |
| §9-contrast | A1+A2 | Contrast ratios for body text, secondary text, focus ring and status chips, in light and dark | Ratios recorded; Kyle confirms |
| §9-reflow | A1 | 800 px (the window minimum) and narrower via text size 200% | No blocking overflow (760 px is W11) |
| §9-chooser | A1 | Settings → Export → Save dialog → Cancel; again → Save; Restore → Open dialog → Cancel. Read UIA FocusedElement after each | Focus returns to the Settings button that opened it |
| §9-motion | A1 | Settings → Accessibility → Visual effects → Animation effects Off; use Today, dialogs and toasts | Nothing essential depends on motion; record any animation that still runs |

KYLE'S ROWS (real PC; Claude does not do these)
Use a Hyper-V VM, or a real PC signed in as a new local Windows user that holds no FundedFlow data. Kyle creates that
user himself. Install the same verified EXE. Record for every row: physical resolution, OS scaling, CSS viewport (if
known), theme, screenshots.
- W3 and W4: core workflows at 800×480 with 125% and then 150% scaling, light and dark.
- W5: the same at 200% on a display with enough physical room.
- W9: maximised on a 1920×1080 display at 200% (about 960×540 logical), light and dark: nothing cut off.
- §9 scaling and zoom: 125% and 150%, and Ctrl+plus to 200% (record whether app zoom works at all).
- D3, D4 and D7 at 3440 wide, if the sandbox desktop was too small. D5: the same routes on a real 3440×1440 ultrawide,
  maximised.
- W19: drag the window between two monitors at 100% and 150%, dark theme; nothing jumps, blurs or clips.
- W14–W17 and §9 contrast: confirm or reject Claude's screenshots and ratios; redo on the real PC if the sandbox could
  not apply the themes.
- NVDA (§9 and W20). Install NVDA from nvaccess.org on that PC or VM and turn on Speech Viewer (NVDA menu → Tools).
  1. Today: browse mode (H, D, T and arrow keys). Record whether the reading order is logical, the headings have
     levels, the landmarks exist (main, navigation), and whether the Today headline is announced when it changes.
  2. Journal and trade tables: T to the table, then Ctrl+Alt+arrows. Record whether the column and row headers are
     read.
  3. Import with an invalid file: is the validation summary announced? Save a review: is the toast announced?
  4. W20 at 800×480, dark: the navigation rail item names; a folded filter dropdown read as "Show rows, combo box"; the
     table scroll regions named.
  5. Copy the Speech Viewer text for each into C:\FFGate\033\nvda\<step>.txt and mark each item PASS or FAIL.
- W11 (record-only): Not Run on the packaged build, or Kyle's notes from a debug build's DevTools at 760 px.
- Any row Kyle cannot do: Not Run, or a waiver he writes in the execution log.

REPORT (C:\FFGate\033\report.md, then summarize in chat)
- Header: tester; date; Windows edition, DisplayVersion and build; WebView2 version; source SHA
  1d13c438c2cfa4752fb57fba8cef693ad3398d8f; EXE SHA-256 60091DAF… (and that Get-FileHash matched SHA256SUMS.txt);
  sandbox desktop resolution and DPI.
- The window-matrix header row (Build/SHA, Windows, WebView2, Display, Tester, Date), then every D, W and §9 row with:
  CSS viewport, scaling, app zoom, theme, sidebar state, PASS / FAIL / NOT RUN / "Kyle", screenshot paths.
- A list "Rows waiting for Kyle" with the exact steps above, so the gate state can be finished after his run.
- Gate state from your rows alone: say "Blocked pending Kyle's rows" unless every mandatory row is filled.
```

---

## TASK-034: real-journal-copy upgrade (owner run)

**Why.** This gate decides whether Kyle's own journal survives an upgrade to the candidate's schema without losing or
changing rows. It is tested on an offline copy only, with the redacted ignored test `upgrade_copy_of_a_real_journal`
that the TASK-034 code change added. It is the only real-data check before release. The test refuses while the
copy's `fundedflow.lock` is held and prints counts only. The code change is in the candidate (`1d13c43`): its doc
comment and `docs/data-model.md:622-626` point at the offline copy.

**Sandbox: can and can't.** **Not a Sandbox task, and not for the Sandbox PC.** The owner run is `cargo test`, so it
needs a Rust and MSVC toolchain plus Node to build `dist`, on the PC where the real journal already lives (the
coordinator PC). Do not copy the real journal to another PC. Kyle makes the copy and starts the run himself. Claude
may prepare a separate clone at the candidate SHA, build it, and run the synthetic redaction tests. Claude never
reads, lists inside, opens or queries the journal or its copy, and never touches the live `%APPDATA%` path.
`FUNDEDFLOW_UPGRADE_DB` is set only in Kyle's PowerShell session for this one command. `FUNDEDFLOW_UPDATE_FIXTURES` and
every other `FUNDEDFLOW_*` variable stay unset.

**Expected results (spec r5, owner-run criteria)**

- Kyle made the copy (with `-wal` and `-shm`) with FundedFlow closed. The test never touches the live path or takes its
  lock.
- `FUNDEDFLOW_UPGRADE_DB` points at the copied `fundedflow.db`, never at `%APPDATA%`.
- `cargo test --offline --locked --lib upgrade_copy -- --ignored` passes against the copy, with output of counts only
  ("vN -> vM: R rows kept, C trading days corrected" plus rows per table). The record shows the run result (counts,
  PASS/FAIL), the source SHA and the copy's SHA-256, and that `FUNDEDFLOW_UPGRADE_DB` was set to the copy.
- `FUNDEDFLOW_UPDATE_FIXTURES` stays unset (not `0`).

```text
You are helping Kyle with FundedFlow release gate TASK-034 (real-journal-copy upgrade). This is an OWNER RUN on the
PC that already holds Kyle's real journal. It does not use Windows Sandbox. Your part is to prepare and verify a clean
build at the candidate SHA; Kyle copies the journal and runs the test himself.

RULES (do not deviate)
- Never read, list inside, open, query, copy, move or hash anything under %APPDATA%\com.fundedflow.desktop, and never
  run sqlite3 or any tool on a journal file. Kyle does all journal handling.
- You may run Get-FileHash on the COPY's fundedflow.db only if Kyle asks you to, and you never read its contents.
- Never print, paste or store journal data. The only journal-derived text you may record is the counts lines Kyle
  pastes back.
- No sign-ins. Do not push, commit or open PRs. Work only in C:\FFGate\034\src (a fresh clone), never in Kyle's own
  FundedFlow checkout.
- Leave every FUNDEDFLOW_* variable unset at User and Machine level and in your own shells. Only Kyle sets
  FUNDEDFLOW_UPGRADE_DB, in his own PowerShell window, for the one command. Never set FUNDEDFLOW_UPDATE_FIXTURES.
- Do not run the --ignored test yourself.

BUILD (your part)
1. Record: tester, date, Windows ProductName, EditionID, DisplayVersion, CurrentBuild.UBR; rustc -V; cargo -V; node -v;
   npm -v; FUNDEDFLOW_* at all three levels (expect none).
2. gh repo clone KyleShabaga/FundedFlow C:\FFGate\034\src
   git -C C:\FFGate\034\src checkout --detach 1d13c438c2cfa4752fb57fba8cef693ad3398d8f
   git -C C:\FFGate\034\src rev-parse HEAD   (must equal 1d13c438c2cfa4752fb57fba8cef693ad3398d8f)
3. Confirm the safety code is present: in apps\desktop\src-tauri\src\db\upgrade_tests.rs the doc comment above
   upgrade_copy_of_a_real_journal names "<copy folder>\fundedflow.db" and says it refuses while fundedflow.lock is
   held; docs\data-model.md has the same instruction.
4. In C:\FFGate\034\src: npm ci; npm run build. In apps\desktop\src-tauri: cargo fetch --locked, then
   cargo test --offline --locked --lib upgrade_copy
   (this runs the synthetic tests: lock refusal and counts-only output). Record the exit code and the test names that
   passed. If anything fails, stop and report.
5. Then STOP and give Kyle the steps below, word for word.

KYLE'S STEPS (by hand; Claude does not do these)
1. Quit FundedFlow completely (check that no fundedflow.exe is running in Task Manager).
2. In File Explorer, copy the whole folder %APPDATA%\com.fundedflow.desktop to a new offline folder, for example
   C:\FFGate\034\journal-copy\com.fundedflow.desktop. Include fundedflow.db and any fundedflow.db-wal and
   fundedflow.db-shm. Don't open the copy, and keep it out of OneDrive and other synced folders.
3. In a new PowerShell window (not Claude's):
   Get-FileHash C:\FFGate\034\journal-copy\com.fundedflow.desktop\fundedflow.db -Algorithm SHA256
   and note the hash.
4. In the same window:
   cd C:\FFGate\034\src\apps\desktop\src-tauri
   $env:FUNDEDFLOW_UPGRADE_DB = 'C:\FFGate\034\journal-copy\com.fundedflow.desktop\fundedflow.db'
   cargo test --offline --locked --lib upgrade_copy -- --ignored --nocapture
   (--nocapture is safe at this SHA: step 4 above verified that the output is counts only. Without it the counts are
   hidden.)
   Then: Remove-Item Env:FUNDEDFLOW_UPGRADE_DB
5. Paste back to Claude only: the PASS/FAIL line, the "vN -> vM: … rows kept, … trading days corrected" line, the
   "rows per table" line, and the copy's SHA-256. If the test fails, paste only the failure message; it is
   counts-only by design. If you see anything that looks like an ID, symbol or note text, do not paste it; tell
   Claude "redaction leak" instead.
6. Afterwards, delete C:\FFGate\034\journal-copy (permanently, yourself) unless you want to keep it offline.

REPORT (write C:\FFGate\034\report.md after Kyle replies)
- tester (Kyle Shabaga, owner run), date, Windows edition, DisplayVersion and build, rustc and cargo versions
- source SHA 1d13c438c2cfa4752fb57fba8cef693ad3398d8f (git rev-parse), and the candidate installer EXE SHA-256
  60091DAFD5BD8E6CDF9D40EB4610F75B735C15E0FBF7BE3E5F3B94A7E0048646 for reference (not used by this test)
- the copy's SHA-256; that FUNDEDFLOW_UPGRADE_DB was set to the copy path, not %APPDATA% (path as Kyle gave it);
  FUNDEDFLOW_UPDATE_FIXTURES unset
- the synthetic upgrade_copy tests: names and pass; the owner run: the counts lines, PASS or FAIL
- the PASS rule: the test passes, row counts are kept, the output has no IDs or values. A "redaction leak" from Kyle is
  a FAIL and needs a Triage card title.
- no screenshots of journal data
```

---

## What can't be done from the Sandbox PC (summary)

- **TASK-030, Windows 10 22H2 leg:** needs a Hyper-V VM (build 19045). Whether Sandbox counts as the "clean Windows 11
  VM" is Kyle's call; the spec prefers a full VM.
- **TASK-030 B2, OneDrive part:** no OneDrive in Sandbox, and no sign-ins allowed. It needs a throwaway Microsoft
  account on a VM or a spare user, otherwise Not Run.
- **TASK-030 B6 and TASK-033 W3, W4, W5, W9 and §9 scaling and zoom:** OS scaling can't reliably be changed in
  Sandbox. They need a Hyper-V VM or a real PC under a throwaway local user.
- **TASK-030 R1:** Kyle imports his real broker export by hand. It can be done inside the sandbox by clipboard, with
  counts only.
- **TASK-030 B3/B8:** done by the separate "Final manual tests §1" prompt.
- **TASK-033 D5 and W19:** need a real 3440 × 1440 ultrawide and two monitors with different scaling. Rows D3, D4 and D7
  at 3440 also need a large display if the sandbox desktop is smaller.
- **TASK-033 NVDA rows (§9 and W20) and the final contrast judgement:** need a person.
- **TASK-033 W11:** needs a debug build's DevTools (record-only).
- **TASK-034:** an owner run with `cargo test` on the PC that holds the real journal. It is not a Sandbox task and not
  for the other PC.
- **TASK-031 step 4a:** runs in Sandbox, but the spec's expected result can't be met as written (0.1.0 can't open a
  schema-23 journal). Kyle must rule on it.
- **TASK-032 R9 and R10:** optional. R10 has no known reliable method, so it is expected to be Not Run plus a Triage
  card.
- **The 0.1.0 baseline after 2026-11-20:** must be copied from the coordinator PC.
