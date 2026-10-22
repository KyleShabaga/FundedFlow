# TASK-023 — Fix: native window close asks before discarding unsaved edits

| Field | Value |
|---|---|
| Status | Proposed (r3; awaiting independent review) |
| Type | Fix |
| Audit priority | P1 |
| Roadmap lane | Unassigned (owner) |
| Mandatory gate | No |
| Severity | Medium |
| Confidence | Medium (needs TASK-011 result) |
| Canonical issue | ISSUE-009 (close part) (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | DATA-008 |
| Source card / date | Stage 1 audit 2026-10-22 |
| Wave | W2 |
| Effort / risk | M / Medium–High (window lifecycle) |
| Verification platform | Windows only (+ Any OS for component tests) |
| Path convention | Paths starting `src-tauri/` are under `apps/desktop/`; `features/`, `lib/`, `journeys/`, `design-system/` are under `apps/desktop/src/` unless written in full |
| Inspected source revision | b01e2b9 (application source identical to 92e7980) |
| Specification revision | r3 (2026-10-22; r2 + Block 4 corrections from 10 §8.2/§8.3) |
| Execution log | `code-review/11-remediation-execution-log.md` — created by the first task executed after approval (template in 08 index §I); every task appends its evidence there |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / a7310fd (HEAD). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | — (none; requires Kyle's explicit approval of this task ID and specification revision) |

## Purpose / risk
Title-bar close / Alt+F4 may discard unsaved text; there is no `onCloseRequested` handler anywhere. Partially Confirmed until TASK-011(a) shows WebView2 behaviour.

## Trigger / reproduction
Dirty editor + window close.

## Root cause / evidence
Only `beforeunload` is used (`use-leave-guard.ts:37-46`).

## Expected change scope
`use-leave-guard.ts` (register `getCurrentWindow().onCloseRequested` only while any guard is active; `preventDefault` + confirm), `apps/desktop/src-tauri/capabilities/default.json` (add `core:window:allow-destroy` if the JS path is used — **config change; confirm against generated schema**), legal decline path (`apps/desktop/src/lib/data/legal.ts:30-31`) must still close.

## Out of scope
Durable drafts in localStorage (V1.1).

## Implementation approach
1. Before branching: create or link the Notion roadmap Triage card for this task (CLAUDE.md plan of record); branch `feat/build-<n>-<slug>` and link the card in the PR. (Notion writes need their own approval; Block 4A.)
2. If TASK-011(a) shows no prompt: implement the close veto registered only while dirty. If TASK-011(a) shows a native prompt: stop, implement nothing, and close this task as Not Needed with the recorded TASK-011(a) evidence.
3. Ensure the legal Decline path and a clean window close immediately.
4. Tests: mock `@tauri-apps/api/window`; dirty form → close-requested is prevented and a confirm appears; clean → not prevented.

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-011 (a); TASK-022.
- Likely shared-file conflicts: Capabilities file (no other V1 task edits it).

## Acceptance criteria (pass/fail)
- [ ] If TASK-011(a) shows a native prompt, close as Not Needed with the recorded evidence (TASK-011(a) execution-log entry cited); the remaining criteria then do not apply.
- [ ] New component tests pass.
- [ ] Windows manual check (owner/VM, recorded): dirty review + title-bar X → prompt; Alt+F4 on a dirty review → prompt; clean window + X closes immediately; Decline on first run closes.
- [ ] Manual record in `code-review/11-remediation-execution-log.md` has: tester, date, Windows edition and build, WebView2 Runtime version, installer EXE SHA-256 (from `SHA256SUMS.txt`) or dev build note, source SHA, steps performed, observed result per step (PASS/FAIL), screenshots or notes. jsdom or mock results do not count.
- [ ] Full root checks → exit 0.
- [ ] Keep `FUNDEDFLOW_UPDATE_FIXTURES` **unset (not `0`)** for every check; never regenerate fixtures unless this card explicitly names the fixture and its diff is reviewed.

## Verification plan
Windows only for native close.

Standard checks (run serially, frontend build before Rust):
- Repository root: `npm run check:boundaries -w @fundedflow/domain` → exit 0
- Repository root: `npm run typecheck` → exit 0
- Repository root: `npm test` → exit 0 (domain + desktop Vitest incl. journeys/axe, test:notices, test:ci-scripts)
- Repository root: `npm run build` → exit 0 (includes the dev-tools dist check)
- Repository root: `npm run check:dist -w @fundedflow/domain` → exit 0
- `apps/desktop/src-tauri`: `cargo test --offline --locked` → exit 0 (after `npm run build`, run serially)
- `apps/desktop/src-tauri`: `cargo clippy --offline --locked --all-targets -- -D warnings` → exit 0

## Safety, rollback and side effects
A hung JS handler could block closing: register only while dirty; document Task Manager fallback.

## Definition of done
Code merged through an approved PR on a `feat/build-<n>-<slug>` branch per CLAUDE.md; diff reviewed; new regression tests fail before and pass after the change; every acceptance criterion has recorded evidence (command, directory, exit code); Windows-only criteria have owner/VM evidence. Compiling or passing unrelated tests is not completion.

## Changes in r3
- 10 §8.2 TASK-023 (G10): added the criterion "If TASK-011(a) shows a native prompt, close as Not Needed with the recorded evidence" (and the matching stop in step 2).
- 10 §8.2 TASK-023 (G14): listed the manual record fields for the Windows check; spelled out the Alt+F4 and clean-close steps already in Purpose and step 3.
- 10 §8.3 fixture rule: fixture line says `FUNDEDFLOW_UPDATE_FIXTURES` unset (not `0`).

## Independent review notes
Independent review (Block 3, 2026-10-22): READY as drafted. r2 adds only global items (execution-log pointer; Triage-card step on Fix/Test cards).
Block 4 review (10 §8.2/§8.3): CHANGES — applied in r3: Not Needed exit on a TASK-011(a) native prompt (G10); manual record fields (G14); fixture rule unset (not 0).
