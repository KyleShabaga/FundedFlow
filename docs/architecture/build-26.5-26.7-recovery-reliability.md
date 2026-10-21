# Builds 26.5, 26.6 and 26.7: recovery diagnostics, uncertain writes and test reliability

Cards: [26.5 runtime recovery diagnostics](https://app.notion.com/p/3fe1bd4b6bde8149a092e09906efc055),
[26.6 account form stays locked after an uncertain save](https://app.notion.com/p/4001bd4b6bde816c8fb5f654ff4704f8),
[26.7 feature tests that time out under CPU contention](https://app.notion.com/p/4001bd4b6bde819f9640ecfca19b2f01).
Delivered in [PR #53](https://github.com/KyleShabaga/FundedFlow/pull/53) together with Build 26, at the owner's request.
Builds on [build-26-accessibility-journeys.md](build-26-accessibility-journeys.md) (harness, boundaries, axe).

Evidence classes used below: **jsdom** (Vitest + Testing Library over the real `<App />` with fakes only at the
repository, Tauri `invoke` and native dialog), **native** (Rust tests on file journals), **CI** (Windows runner),
**manual/packaged** (not executed; pending). Nothing here is packaged-app acceptance.

## 0. CI fixes on this PR

**Rust archive regression (main and #53 red).** `data_controls::current_schema_tests::
schema18_archive_restores_reviews_daily_history_corrections_screenshots_and_null_snapshots` failed `20 != 18`.
(#52 then landed the same `latest_version()` comparison on main and renamed the test to
`current_schema_archive_restores_…`; merging main kept that name and these extra schema-object checks.)
Root cause: Build 10.5 (#50) merged migrations 19 (`rulebook_binding_provider`) and 20 (`source_fact_immutability`)
after Build 24's test was written. Both are trigger-only (no tables or columns). The test creates its source journal
at the latest schema, so the archive manifest correctly said 20; the literal 18 was stale, not the data. The test
now compares with `db::latest_version()` and additionally checks that the restored image reports the current
`user_version` and still has the migration 19/20 triggers, which the row dump can't see. The round-trip, reviews,
daily history, corrections, screenshot bytes and null-snapshot assertions are unchanged. Deliberate legacy-18 fixtures
(`MIGRATIONS[..18]`, the v8 upgrade test) are untouched. No migration or fixture was regenerated.
Evidence: local `cargo test --lib current_schema_tests` 7/7; CI on `1629f2f`: cargo test 293 passed / 2 ignored.

**Node 20 action runtime deprecation.** From each action's `action.yml` and release notes:
`actions/checkout` v4 → v7 (node24; v7's only behaviour change concerns `pull_request_target`/`workflow_run`, unused
here), `actions/setup-node` v4 → v7 (node24; v6 auto-cache and v7's removed `NODE_AUTH_TOKEN` fallback don't affect
these workflows), `astral-sh/setup-uv` v6 → v10.3.0 (v6 was node20; since v8 releases are immutable with no floating
major tag, so the release is pinned). `Swatinem/rust-cache@v2` and `dtolnay/rust-toolchain` already run on node24. The
application's Node (`lts/*` in CI, `22` in dev tools, engines `>=22`) is unchanged. Evidence: CI on `1629f2f`
(CI, Prop-firm collector, Developer tools all success); no "Node.js 20 is deprecated" line in the CI log.

## 1. Build 26.5: recovery and diagnostics

### Audit (Block A)

Existing coverage, kept: runtime gateway (`lib/data/runtime.test.ts`: command contract, timeout, coalescing, pending
after timeout, no leaked bridge text), RuntimeProvider (`app/RuntimeProvider.test.tsx`: StrictMode, every failure
category, malformed/rejected/timeout, finite backoff, overlapping checks/retries, unmount, late success after timeout),
RuntimeGate and RuntimeRecovery (`components/RuntimeGate.test.tsx`, `app/RuntimeRecovery.test.tsx`: progress, slow
mark, newer schema, empty vs unavailable, inline draft preserved, focus), native runtime
(`src-tauri/src/runtime/tests.rs`: first run, existing journal, unreadable file, newer schema untouched, failed
migration rolled back with backup, failed backup, unresolvable data directory, retry no-op when ready, concurrent
retries one at a time). Status checks (`runtime_status`) are read-only; only an explicit Retry calls
`retry_runtime`; focus revalidation never retries; mutations are never replayed by any of these.

Gaps found and closed:

| Gap | Fix |
|---|---|
| The recovery notice's "Technical details" rendered native `failure.detail` (`e.to_string()` of IO/SQLite errors, which can hold absolute paths under the Windows user folder) and gateway error text | Replaced by an allowlisted **diagnostic summary** (`lib/diagnostics.ts`, `DiagnosticDetails` in the design system). Versions stay visible as typed numbers. |
| Root error fallback had no diagnostics | Same summary, built from the error's built-in class only |
| A modal form open when local data dropped had no reachable Retry (the shell notice is behind the modal) | `RuntimeInlineRecovery` in the account and trade forms: same explicit Retry, values kept, saving paused |
| Boundary recovery and uncertain-write protection unproven | Proven by a journey (below). The QueryClient is created in `AppProviders` above `RootErrorBoundary`, so its submission coordinator (uncertain locks) survives a crash; router, runtime owner and screens remount. |

Recoverable vs not: data directory, open, backup and migration failures are retryable after the user fixes the cause
(the copy says what to check; nothing is reset, deleted, replaced, downgraded or overwritten). A newer schema is
deliberately non-retryable and offers no reset or downgrade. Gateway `pending` (a timed-out native call still running)
refuses another call until it settles, and its late answer is ignored.

### Diagnostic redaction contract (Block B)

Built from typed values only, never from any error string. Fields: incident id (`FF-` + 12 random hex, from
`crypto.getRandomValues`, independent of data; stable while the same failure persists, new after recovery), UTC time,
app version (from `apps/desktop/package.json`, 0.1.0), surface (runtime/render), stable code (runtime failure category,
gateway kind, or `render_<built-in Error class>`), runtime state, stage, journal and supported schema versions, failed
migration step numbers, retry allowed, screen section (top-level route name only). Anything outside an allowlist
becomes `unknown`.

Never included: error messages, causes or stacks, SQL, absolute or relative paths, file names, account names or ids,
trade, journal, review or attachment content, tokens or secrets, full routes or query strings. No telemetry, upload or
logging was added; copying is explicit (Copy summary) and a refused clipboard keeps the selectable text on screen.
There is no native correlation id; the incident id is frontend-only and says so by not claiming more. No logging
exists in the native or frontend code to audit beyond these surfaces.

### Recovery regression matrix (Blocks C and B)

| Scenario | Test (jsdom unless noted) |
|---|---|
| data directory / open / backup / migration failure: explained, Retry, allowlisted summary, no private text, no empty-journal claim | `recovery.journey.test.tsx` › "startup failures" › "%s: explains it, offers Retry, and copies an allowlisted summary" ×4 |
| Unsupported newer schema: no Retry/reset/downgrade, code and versions | › "refuses a newer journal…" |
| One incident id across a failed Retry; copy success and clipboard refusal | › "keeps one incident id while the same failure is re-polled…" |
| Ready → unavailable → Ready with an open modal form: values kept, save refused, inline Retry, saves once after | › "keeps navigation and an open form's values…" |
| Rapid Retry presses and overlapping focus checks: one `retry_runtime` | › "runs one retry for rapid Retry presses and overlapping focus checks" |
| Timed-out status check: pending lock, no second native call, late answer ignored, explicit recovery | › "after a timed-out status check, keeps the command locked until it settles…" (fake timers) |
| Render failure: contained, focused heading, summary without message/cause/path/SQL/ids | › "contains a crash, focuses its heading…" |
| Crash recovery keeps an unconfirmed write locked and sends nothing | › "returns to the app without releasing an unconfirmed save or sending it again" |
| Adversarial privacy inputs (nested causes, custom error names, private reasons/routes) | `lib/diagnostics.test.ts` |
| Copyable component, refused clipboard | `design-system/overlays.test.tsx` › "DiagnosticDetails" |
| Restore: Ready required before success; retry never resubmits the restore | Build 26 `data-controls.journey.test.tsx` (restore tests) |
| Fresh install, existing journal, DB-open failure and retry, migration rollback with backup, newer schema untouched | **native** `src-tauri/src/runtime/tests.rs` |

### Windows/Tauri smoke and safe data (Block D): blocked, pending

Checked on this machine (read-only): the session user is the owner (`Kyle`) and `%APPDATA%\com.fundedflow.desktop`
exists, so any debug or packaged launch would open the real journal, and a build at schema 20 would migrate it.
Windows Sandbox is not enabled (`WindowsSandbox.exe` absent). `tauri-driver` and `msedgedriver` are not installed.
WebView2 runtime 155.0.4283.62. No native, failure, restore or deletion run was attempted.

WebDriver capability notes: Tauri's WebDriver support (`tauri-driver`) drives the WebView2 page through Microsoft
Edge WebDriver on Windows; it can't operate native OS dialogs (Save/Open file pickers), so export/restore smoke needs a
manual step or a pre-placed file path. Driver and WebView2 versions must match.

Next steps for the owner (Build 26.75/27 can reuse): enable Windows Sandbox or use a VM/throwaway local user; in it,
confirm `$env:USERNAME` and an absent `%APPDATA%\com.fundedflow.desktop`; install `tauri-driver` and the matching
`msedgedriver`; build with `npm run tauri build -- --debug --no-bundle`; run the cases in
[build-26 §8](build-26-accessibility-journeys.md#8-desktop-automation-approach-decided-not-yet-run) plus: controlled
open failure (journal file locked by another process) → fix → explicit Retry → integrity check; a synthetic schema-21
journal → refusal with the file untouched. Record executable commit, OS, WebView2 version, profile isolation, commands
and outcomes. A debug executable run is not packaged-installer acceptance.

Backup and diagnostic locations: the journal and its pre-upgrade backups live in `%APPDATA%\com.fundedflow.desktop`
(backup file names are shown in the migration-failure message). Recovery is non-destructive: keep files in place,
fix the named cause, press Retry; restore from an exported archive only through Settings. The diagnostic summary is
on-screen only; nothing is written to disk.

## 2. Build 26.6: uncertain writes

Root cause: the shared submission coordinator keeps an `uncertain` scope locked until
`acknowledgeUncertainOutcome({ recordsReviewed: true })`; only the import wizard (after "I've checked the history")
and the daily review called it. "Check result" in the account form, status change, reset and trade form only closed
the dialog, so the scope stayed locked until restart. The account lock scope is shared by edit, status, archive,
restore and reset of that account, and the trade scope by every trade write of that account.

Fix (shared): `useFeatureMutation().checkUncertainOutcome(readReviewed)` re-reads the records under review with a
throwing refresh and marks the write's other reads stale; it never resends or unlocks. `UncertainOutcomeReview`
(features/shared) runs Check result → review → "I've checked; allow saving again", which is disabled until the
original request has settled (`canAcknowledge`) and the reviewed records loaded. A failed re-read shows "Couldn't
check…" with Check again and keeps the lock. Acknowledging saves nothing; the form keeps its values and the trader may
save again deliberately. Applied to account create (matching account names, archived included), account edit, status
change and reset (the account as stored), and manual trade/correction (trades with that symbol, or the trade).

Tests (`uncertain-writes.journey.test.tsx`, jsdom): did not save → none listed → acknowledge → one deliberate save;
did save → listed → acknowledge → no second account; lock kept across close and reopen; failed check (both read
attempts) keeps the lock and Check again recovers; original still running after the 30 s write timeout → acknowledge
disabled, late success claims nothing, acknowledge allowed once settled; manual trade; lock scope isolated per account
(another account's status change proceeds). Recovery journey: the lock survives a render crash.

Audit of other forms (not changed; distinct decisions recorded):

| Surface | Behaviour now | Decision |
|---|---|---|
| Import wizard | Acknowledge after "Check import history" | Correct pattern (unchanged) |
| Daily review | "Check the stored review" acknowledges, keeps the edits and reloads the stored review | Acknowledges before showing; product decision to keep (edits are kept locally, so no loss) |
| Rulebook draft save/publish, assign, start draft, calculation, Today checkpoints, screenshots | Uncertain state shown without a Check action, so the scope stays locked until restart | Same gap; needs per-surface review content. **Closed by P0-03** ([p0-01-p0-03.md §2](p0-01-p0-03.md#2-p0-03-uncertain-write-recovery)) |
| Data controls | Own operation lock and native preview tokens; no uncertain-write lock | Not applicable |

## 3. Build 26.7: test reliability

Protocol (unchanged from Build 26; run before main's #52 merge): two full desktop Vitest runs at once, three rounds, six separate logs, default
timeouts (5 s test, 1 s `findBy`), on the owner's Windows 11 machine.

| | Runs | Timeouts | Tests |
|---|---|---|---|
| Before (head `21d2215`, 660 tests) | 6 | **17**: Today opening balance 4, accounts first-run 2, prop account 2, daily review keyboard 2, first-run journey 2, uncertain-writes 3, import journey 2 | 8, 7, 1, 1, 0, 0 failed |
| After (head `5255ca8`, 663 tests) | 6 | **0** | 663/663 in every run |

Profiling (per-step timings) showed the cost was key-by-key typing (about 20 ms a key in jsdom; one `datetime-local`
field about 310 ms) and long single journeys, not hangs or leaked timers. A datalist memoization was measured, showed
no gain and was reverted. Changes: values whose per-key behaviour isn't under test are pasted (account helper, Today
checkpoint, daily review notes, rulebook dates, journey forms); long journeys are split at natural seams with the
second half seeded through the same repository calls and every assertion kept (Today checkpoint → opening / current
and compare; rulebook "published account rules" → publish and assign / evaluate for real; uncertain lock → close and
reopen / failed check). The daily review still completes with Enter. Build 26's overlay and rulebook fixes are intact.
No retries, skips, timeout changes, weakened assertions or worker caps.

## 4. Checks

Local, Windows 11 Pro 10.0.26200, on the merged head (main `2a65c18` with #52 merged in):

| Command | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm test` | 496 domain + 674 desktop passed (674 includes main's new import tests) |
| `npm run build` | pass |
| `npm run check` | pass (dist 299 exports) |
| `git diff --check origin/main` | pass |
| `cargo test --lib current_schema_archive` | 1 passed |
| `cargo test` | 303 passed, 0 failed, 2 ignored |
| `cargo clippy --all-targets -- -D warnings` | pass |

Windows CI for the pushed head is recorded in the PR description.

## 5. Pending and owners

- Native/packaged smoke and controlled-failure runs (§1 Block D): blocked by isolation and tooling; owner action, then
  Build 26.75/27.
- Manual NVDA/WebView2 reading of the diagnostic disclosure and inline recovery; contrast and scaling (Build 26 §9).
- Uncertain-write acknowledgement for rulebook, Today checkpoint, calculation and screenshot surfaces (§2 audit):
  implemented in P0-03 (jsdom evidence); packaged/manual acceptance still pending.
- None of these cards is marked Done; the PR is not merged.
