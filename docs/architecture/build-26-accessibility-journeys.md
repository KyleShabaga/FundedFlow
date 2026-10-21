# Build 26: frontend accessibility and critical-journey tests

Card: [Add frontend accessibility and critical-journey tests](https://app.notion.com/p/3fe1bd4b6bde81898d52e4350670566a)
(Build 26, P0 V1). Branch `feat/build-26-accessibility-journeys` from main `7709d29` (Builds 24/25, PR #43).

This document separates three things:

- **Implemented and verified here:** jsdom/Vitest component, cross-feature journey and axe tests; design-system fixes
  they exposed; the overlay flake and rulebook timeout investigation; CI wiring. Evidence below.
- **Inherited evidence, not re-proved by fakes:** archive integrity, transactional deletion, restart persistence,
  duplicate detection per attempt, trading-day/DST derivation and stored P&L (Rust tests, goldens, parity fixtures).
- **Pending:** the native desktop smoke (Tauri WebDriver), destructive native runs on a verified disposable profile,
  and manual NVDA/WebView2, scaling, zoom, contrast and native-dialog checks. Nothing here claims packaged-app
  behaviour or release readiness.

## 1. Baseline

| Item | Result |
|---|---|
| Main at start | `7709d2943c44be5c2773b0e4c10494550fb0c6ea` |
| First `npm test` on the existing checkout | 6 desktop files failed to load: `@tauri-apps/plugin-dialog` missing from a stale `node_modules`. Not a code defect; `npm ci` (as CI does) fixed it. |
| `npm test` after `npm ci` | 495 domain + 563 desktop passed |
| Overlay flake on clean main (4 runs of `overlays.test.tsx` at once, 6 rounds) | **8 of 24 runs failed**, all in "DropdownMenu opening a dialog…" (focus returned to `<body>`) |
| Rulebook journey on clean main, 2 full desktop runs at once (3 rounds) | **6 of 6 runs timed out** "runs the whole journey…"; 17 timeouts in total across 7 tests |

## 2. Harness and fixtures (Block A)

All under `apps/desktop/src/test/` and test-only (never imported by production code):

| File | What it is |
|---|---|
| `boundaries.ts` | The only three fakes: the Tauri `invoke` bridge (answers `runtime_status`/`retry_runtime` from queued `RuntimeStatus` values, optional `onRetry` hook; any other command throws), `lib/data/api`'s `repository`, and `@tauri-apps/plugin-dialog` (`save`/`open` answer a path, `null` for Cancel, or an error). No application imports, so `vi.mock` factories can load it. |
| `app-store.ts` | One in-memory journal composed from the feature-owned fakes rather than rewriting them: Today store (Build 19/21: accounts, settings, rulebooks, snapshots, evidence), Journal store (Build 20/22/23: trades, reviews, library, daily reviews, Insights) sharing the same accounts, and the Build 17 golden import fake. Data-control outputs follow Build 24 rules (exact phrases, preview tokens that go stale on change, link and ownership blockers, real removal, staged restore installed on runtime retry) and are parsed by the portable DTO schemas. `hold(path, when)` pauses any repository call until the test releases or fails it (late responses, double submits, uncertain writes). |
| `harness.tsx` | `renderApp(path, seed)` renders the real `<App />`: HashRouter, a fresh QueryClient per mount, the real RuntimeProvider, ToastProvider, AppShell and every route. `resetHarness()` clears hash, storage, the module-level data-control lock and boundary queues. `installBrowserShims()` covers Radix's jsdom gaps. |
| `axe.ts` | `expectNoAxeViolations()`: axe-core 4.14.0 (pinned) over `document.body`, so portalled dialogs, drawers, menus and toasts are included. Tags: WCAG 2.0/2.1 A and AA, 2.2 AA, best-practice. |

Fixture changes in feature-owned test stores (test-only): `createJournalStore` takes an optional shared base store
and resolves accounts from it; the Build 18 import fake moved from `import-wizard.test.tsx` to
`features/imports/test-store.ts` so both suites use one copy.

Fixture set used by the journeys: empty journal; two independent accounts (USD New York, EUR Berlin); failed,
active and archived attempts linked by reset and sharing a provider number; the catalogue rulebook version;
supported, unknown-P&L (`missing_instrument`) and open trades; a known zero headroom against Unknown; a Berlin
trading day after the EU DST change (2026-10-26) while New York is still on summer time.

Time and pending work are explicit: Today tests fake only `Date` (`toFake: ["Date"]`), pending reads/writes use
store holds and runtime answer queues, and nothing waits on an arbitrary sleep. The one real timer is the runtime
provider's 500 ms first poll after `retry_runtime`.

## 3. Coverage matrix (Blocks B–D)

Test files: `src/journeys/accessibility.test.tsx` (A11y), `accounts.journey.test.tsx` (Acc),
`data-controls.journey.test.tsx` (DC), `workflows.journey.test.tsx` (Wf). Existing feature tests are cited by file
and name. Layer is jsdom/Vitest throughout; "native" marks inherited Rust evidence.

| Journey | State | Existing evidence | New test (Build 26) | Notes / owner |
|---|---|---|---|---|
| First run → account → active → Today → rulebook | success | accounts.test "shows a first-run empty state…" | Acc "creates the first account from Accounts, makes it active, and shows Today as Unknown with setup needed"; Acc "assigns a verified rulebook version…" | real routes end to end |
| | empty/unknown | today.test "with no account, asks for one…" | same tests: Today Unknown, no Safe, "Setup needed for limits" | |
| | validation failure | accounts.test "shows friendly field errors…" | Acc "keeps the typed values after a rejected save, then creates exactly one account on a double press" (field error linked, summary link, **focus moves to the field**) | found defect 5.3 |
| | interrupted/failed | accounts.test "keeps entered values after a backend failure…" | Acc "after an uncertain save, keeps the values, never resends, and offers Check result instead of Retry" | |
| Change account / rulebook while a read is pending | late response | today.test "switching to another account never shows the previous account's estimate", "while the next account's calculation is still loading…" | Acc "never shows the previous account's trades when its read resolves after switching" | old answer resolves last |
| | invalid active selection | accounts.test "reports an archived active account…" | Acc "reports an archived or deleted active account instead of silently switching"; DC deletion/restore tests assert "Chosen account is gone · choose another" | |
| | rulebook change | rulebooks.test "refuses an assignment made from a stale view…", "does not show one attempt's rulebook on another" | — | feature-level is sufficient |
| CSV → preview → commit → history → Journal → Today/Insights | success | import-wizard.test "imports a generic CSV end to end…" | Wf "imports a CSV into the active attempt, and Journal, Today and Insights show it without a reload" | cross-route invalidation |
| | validation / errors / duplicates | import-wizard.test "separates new rows from errors…", "won't continue when every row is invalid", "asks for the date order…" | — | Rust golden previews |
| | interrupted/uncertain | import-wizard.test "treats a lost answer as uncertain…", "reports a definite failure…" | Wf "after a lost commit answer keeps the file and context, never imports again by itself, and adds no trades" | |
| | reused account number | import-wizard.test "names linked attempts sharing a broker number…" | Wf "imports into the chosen attempt when an earlier attempt reuses the account number…" | no cross-attempt dedup: native (Rust import tests) |
| Today Safe/Caution/Stop/Unknown/stale/unsupported/no-trade | Safe, zero vs unknown, stale, unsupported | today.test "shows a current estimate…", "a known zero headroom shows $0.00…", "a trade dated after the cutoff…", "the next trading day…", "Not supported" in "shows a current estimate…" | Wf "renders a saved Caution/Stop estimate as its label and icon, never as Safe" | Caution was model-only before |
| | unknown / no-trade | today.test "with nothing calculated is Unknown…" | Wf "with a rulebook but no trades and nothing calculated, is Unknown and shows no $0.00" | |
| | failed reads | today.test "a failed read of the saved calculation never leaves a Safe…", "a failed check of the sources is Unknown…" | — | |
| | changed by another feature | today.test "a corrected, deleted or restored trade…" (store edits) | Wf "a Safe estimate stops being Safe once a trade before its cutoff is corrected in the Journal" | through the Journal UI |
| Journal → trade → review/correction → back | success / invalidation | journal.test "corrects a trade against the revision it opened", "saves notes, rating…" | Wf "keeps the review's edits after a failed save, then saves and the Journal list shows it reviewed" | |
| | failure keeps edits | journal.test "reports a stale review as a conflict and keeps the edits", "asks before leaving with unsaved review edits" | same Wf test (rejected save keeps edits) | |
| | account-scoped links | journal.test "never shows another account's trade" | Wf drill-down test (`?account=` survives) | |
| Trading day → daily review → linked trades | success / unsaved / failure | daily-review.test "starts, saves as draft…", "keeps the text after a failed save…", "asks before leaving with unsaved edits…", "reviews a day with no trades as an explicit no-trade day…" | Wf "opens the active account's trading day from Today, shows its trades in the account's zone across the DST change, and links to a trade" | DST derivation is native |
| Insights filters → drawer → trade → back | success | insights.test "opens exactly the contributing trades…", "opens a drilled trade of an archived attempt…" | Wf "keeps the URL filters and exact contributing trades through the trade page and back" | real routes |
| | unknown / mixed currency / empty | insights.test "never adds currencies…", "separates no closed trades from filters…", "shows a load failure with retry, never zeros" | A11y "names Insights metrics with their basis, keeps unknown P&L out of sums…" | |
| Fail → reset → archive/restore | success | accounts.test "creates a linked attempt with the same broker number…" | Wf "fails an attempt, starts a linked one with the same number, and the new attempt shows no carried-over risk or trades"; Wf "archives a failed attempt read-only and restores it…" | distinct ids, no cached risk |
| | failure | accounts.test "keeps the inputs and creates nothing when the reset fails", "archives and restores… reports a restore conflict safely" | — | |
| Export | success / consent / cancel | data-controls.test (Build 25) export cases | DC "asks for plaintext consent, does nothing on Cancel, then saves a full backup and remembers it without the path" | CSV says it isn't a backup |
| | failure / busy | data-controls.test "explains a native failure…", "disables every data action while an export runs…" | DC "explains a chooser that can't open and a failed export…" (no % progress) | |
| Restore | rejected archive | data-controls.test "shows an invalid archive as rejected…" | DC "rejects an invalid archive and never offers to replace"; data-controls.test "does nothing when the restore chooser is cancelled", "explains a restore chooser that can't open…" | |
| | cancel / wrong phrase / stale | — | DC "refuses Cancel, a wrong phrase and a stale preview without restoring anything" | |
| | restart_required → Ready | data-controls.test "previews the archive, requires the exact phrase…" (mocked runtime hook) | DC "reports success only once the runtime is Ready on the restored journal, and every view shows the restored data" (real RuntimeProvider, held install) | restart persistence: native |
| | install failure | data-controls.test "reports an interrupted install…" | DC "shows an install failure, keeps the dialog honest and never submits the restore again" | |
| Permanent deletion | success, exact phrases, cache | data-controls.test "deletes one account only after its exact ID phrase…" | DC "from Accounts: exact ID phrase, Cancel and the journal phrase refused, then deletes only that account and every view forgets it" | transactional deletion: native |
| | stale | data-controls.test "keeps the dialog open… when the data changed after the preview" | DC "never deletes from a stale preview and keeps the dialog open with a plain reason" | |
| | blocked | data-controls.test "blocks a linked account…" | DC "keeps linked attempts and native blockers non-bypassable, and offers Archive instead" | policy unchanged |
| | one operation | — | DC "runs one data operation at a time across Settings and Accounts" | |
| | cleanup_pending | data-controls.test "erases the whole journal through a separate flow…" | DC "erases the journal with its own phrase, says file cleanup is pending…"; data-controls.test "keeps cleanup pending visible when the cleanup retry fails…" | |

N/A, not invented: there is no Today "validation failure" (Today has no form apart from balance checkpoints, covered by
today.test "records a confirmed opening balance…"); Insights has no writes; deletion has no "empty" state beyond
"No records." in an empty preview.

### Keyboard and semantics (Block B)

A11y "keyboard: shell": skip link is the first Tab stop and moves focus to `main`; navigation focuses the page `h1`
and sets `aria-current`; Tab/Shift+Tab order through the sidebar; Ctrl+B. "keyboard: menus and dialogs": Enter
opens a menu, arrows move, Escape closes and returns focus; End + Enter from a menu to the destructive dialog, Tab and
Shift+Tab stay inside, Escape returns focus to the menu button; Cancel is focused first in a confirmation; focus
survives the opener being removed. "keyboard and semantics: data": sortable header activated by keyboard with
`aria-sort`, row headers; metric basis text, unknown P&L excluded and named, chart `img` alternative and table view.
Existing feature tests add today.test "explanations open and close from the keyboard…", "the status is text and an
icon, not colour alone", daily-review.test "…with the keyboard", rulebooks.test "opens the assign dialog from the
keyboard…", design-system overlays/forms/data tests.

## 4. Axe coverage and exceptions

`accessibility.test.tsx` runs axe on all 11 routes on an empty and a populated journal (22 scans) and on six open
states: Add account with errors and summary, account actions menu, header account selector, trade form with errors,
Insights contributing-trades drawer, journal erasure dialog. Any violation fails the test, so a new violation fails CI.

Not evaluated by axe in jsdom (no layout or colour), each a pending manual check, not a waiver: `color-contrast`,
`color-contrast-enhanced`, `target-size`.

One scoped exception: rule `region` on `[data-radix-popper-content-wrapper]` only. Radix portals menu and tooltip
popups to `<body>`, outside landmarks; they are owned by a trigger inside a landmark and close on focus loss. The rule
still runs on everything else. Owner if changed: design system (Build 13), by giving popups a container inside the
app's landmarks.

## 5. Defects found and fixed

1. **DropdownMenu → Dialog focus race (the reported overlay flake).** `DropdownMenu` ran the item's action on a 0 ms
   timer that raced Radix's own 0 ms focus-return timer. When the action won, the dialog recorded `<body>` as its
   return target and focus was lost on close. The action now runs from the menu's `onCloseAutoFocus`, after the trigger
   has focus. `design-system/components/overlays.tsx`.
2. **Focus return when the opener is gone.** Closing a dialog whose opener was removed (row archived or deleted) left
   focus on `<body>`. It now goes to the first tabbable control in the nearest surviving container. Test:
   overlays.test "moves focus to a surviving control in the same container…".
3. **Repository field errors never received focus.** Account, trade, trade-review and daily-review forms called
   `focusFirstInvalid` in a microtask after a rejected save, but React Query renders the mutation error later, so focus
   stayed on Save. New `focusFirstInvalidWhenShown` waits (≤ 1 s) for the invalid field and only moves focus if the
   user hasn't. The journey fails on the old code.
4. **RadioGroup `aria-required` on a `group` (axe `aria-allowed-attr`, critical).** The fieldset now has
   `role="radiogroup"`. Four feature tests query `radiogroup` instead of `group`.
5. **Heading levels skipped h1 → h3** on Journal, Insights, Accounts and Settings (axe `heading-order`). `DataTable`,
   `ChartPanel` and `FormSection` take `headingLevel`; `TabPanel` takes a hidden `heading`; dialog subheads are `h3`.

Each fix is in the design system first, with tests (overlays, forms, data and components tests) and notes in
`docs/design-system.md`. No business rule or financial calculation changed.

## 6. Flake and timeout investigation (Block E)

**Overlay focus flake.** Reproduced on clean main: 8 of 24 runs failed (4 processes at once). Cause and fix: §5.1. After
the fix: 0 of 36 runs (4 processes at once, 9 rounds), and 0 failures in 6 runs of the overlay, rulebook and journey
suites while `cargo test` compiled in parallel.

**Rulebook journey timeout.** CI run 39605412982 attempt 1 timed out "runs the whole journey…" at 5045 ms; the rerun took
2288 ms; locally 1.7 s. Profiling showed no hang, leaked timer or slow step: about 17 jsdom interactions at
50–200 ms each. On clean main under 2x CPU contention it timed out in 6 of 6 runs. The test is split at its natural
seam (edit, compare, preview and save; then publish and assign from a saved draft built with the same repository
calls), keeping every assertion: about 1.0 s and 0.7 s. No retries, skips or timeout changes.

**Contention evidence** (two full desktop runs at once, three rounds, 6 runs each):

| Tree | Timeouts (5 s) |
|---|---|
| main `7709d29` | 17: rulebook whole journey 6, Today opening balance 4, accounts first-run 4, daily review 1, Today failed check 1, DataModelPanel 1 |
| this branch | 4: Today opening balance 2, accounts first-run 1, presentation 1. New journeys 0, split rulebook tests 0 |

Unloaded, five consecutive full desktop runs passed 635/635 each. All failures under load were 5 s test timeouts or
1 s `findBy` waits; none asserted wrong content. With `rustc` compiling in parallel (about 3x slower), 2 of 6 runs of the
focus/race suites hit those budgets; the other 4 passed. CI runs `npm test` before cargo, so that overlap doesn't occur
there. Journey design keeps each new test at or under about 1.3 s locally (typed phrases pasted, long journeys split).
Remaining risk: the pre-existing Today, Accounts and presentation tests above still time out under heavy contention.
Follow-up: a Triage card to trim those tests' per-step cost, or cap CI workers, if they appear in CI.

## 7. CI and commands (Block E)

`.github/workflows/ci.yml` already ran root `npm test` on `windows-latest`; the step label now says what it covers
(domain + desktop components, journeys and axe accessibility). New script for focused runs:
`npm run test:journeys -w @fundedflow/desktop`.

Local results on the final implementation commit:

| Command | Result |
|---|---|
| `npm ci` | ok |
| `npm run typecheck` | pass |
| `npm test` | 495 domain + 638 desktop passed (49 desktop files; +75 over the 563 baseline: 66 journey/axe tests in 4 new files, 5 design-system, 3 data-controls, 1 from the rulebook split) |
| `npm run build` | pass |
| `npm run check` | pass (domain boundaries; dist 299 exports) |
| `git diff --check` | pass |
| `cargo test` (apps/desktop/src-tauri) | 279 passed, 0 failed, 2 ignored |
| `cargo clippy --all-targets -- -D warnings` | pass |

Platform: Windows 11 Pro 10.0.26200, Node from the repo's engines (≥ 22), local checkout. CI evidence: the PR's
Windows run.

## 8. Desktop automation approach (decided, not yet run)

**Choice: Tauri's WebDriver support (`tauri-driver`) driving the built FundedFlow executable with WebdriverIO.** It
exercises the real WebView2, the Rust commands, the SQLite journal and the native dialogs, which jsdom never does.
Playwright against Vite with a mocked `invoke` would only repeat the jsdom evidence.

Prerequisites (Windows): Rust toolchain; `cargo install tauri-driver --locked`; Microsoft Edge WebDriver
(`msedgedriver.exe`) of the same version as the installed WebView2 runtime, on `PATH`; Node 22; a debug build without
an installer (`npm run tauri build -- --debug --no-bundle`, binary `apps/desktop/src-tauri/target/debug/fundedflow.exe`);
WebdriverIO (`@wdio/cli`, local runner, mocha) in a separate `e2e/` package so it never enters the unit run.

Safe data setup: the app always opens `%APPDATA%\com.fundedflow.desktop` for the Windows user running it. There is no
runtime data-directory override, and `scripts/reset-test-data.mjs --data-dir` only changes what the script resets, not
where the running app reads. So native runs must use a disposable Windows identity:

1. Windows Sandbox (available on Windows 11 Pro), or a throwaway VM, or a separate local user that holds no real journal.
2. Before any restore or delete: confirm `$env:USERNAME` is the disposable user (Sandbox: `WDAGUtilityAccount`) and
   that `%APPDATA%\com.fundedflow.desktop` is absent or was created by the test run. Abort otherwise.
3. Never point a native run at the owner's profile.

Representative smoke case (non-destructive, first to implement): start `fundedflow.exe` under `tauri-driver` on an
empty profile → wait until the runtime is Ready (no recovery banner, Settings shows journal version 18) → Today shows
"Add an account to see today's risk" → create an account through the real dialog → quit and relaunch → the account is
still listed and active. A destructive second case (only after step 2): export a full backup through the real save
dialog, erase the journal with its phrase, restore the backup, and wait for the app's "Journal restored" only after the
runtime is Ready.

Status: **pending.** No native profile isolation was verified in this session, so no native or destructive UI run was
attempted. Build 26.5 (runtime recovery), 26.75 (installer) and 27 (release acceptance) can reuse these cases.

## 9. Manual checklist (pending, not executed)

| Check | How | Owner |
|---|---|---|
| Visible focus on every control, both themes | keyboard only, light and dark | Build 26 manual pass, then Build 27 |
| Contrast in both themes | WebView2, contrast checker | same |
| Windows scaling 125% and 150%, zoom 200% | Display settings; Ctrl + | same |
| Overflow and reflow at narrow widths | resize to 760 px and below | same |
| NVDA + WebView2 reading order, headings, landmarks, table headers, status announcements (Today headline, toasts, validation summary) | NVDA browse and focus modes | same |
| Native file chooser: focus returns to the Settings button after Save/Open/Cancel | packaged or debug build | Build 26.75 / 27 |
| Reduced motion | Windows "Animation effects" off; no essential motion exists today | same |
| Native smoke and destructive cases in §8 | disposable profile | Build 27 |

## 10. Limitations and follow-ups

- Fakes prove frontend behaviour only. Native invariants in the matrix are inherited from Rust evidence (Build 24
  data-control tests, import goldens, daily review and DST tests, parity fixtures), not re-proved here.
- Deletion policy is unchanged: linked attempts and shared/immutable history stay blocked
  ([policy follow-up](https://app.notion.com/p/4001bd4b6bde81d09774d36d727b77be)).
- Inherited presentation gaps (PR #43): no data-folder path command, no per-account status in the archive manifest,
  linked attempts shown by ID. Not faked.
- Under heavy CPU contention, some existing feature tests exceed the 5 s default (§6). Suggested Triage card.
- After an uncertain account save, "Check result" closes the form, but a new Add account form still shows "Couldn't
  confirm it saved" and won't save until the app restarts: the account form never acknowledges the uncertain
  submission (the import wizard does, with "I've checked the history"). Seen with a jsdom probe; not changed here
  because it is product behaviour outside this card. Recorded for Triage.
