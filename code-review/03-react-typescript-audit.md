# FundedFlow Stage 1 audit, Phase 4 of 6: React, TypeScript, UI and application state

| Field | Value |
|---|---|
| Review date | 2026-10-22 |
| Scope status | **Complete** (static review). The **checks lane is blocked**: no tests or builds could be run offline (§10). |
| Repository root | `/home/user/FundedFlow` |
| Branch / HEAD | `claude/practical-turing-wmii06` at `feb00e204a434686c305f463f9d21650cd11010c`, with uncommitted report-only changes (`02-tauri-rust-security-audit.md` and the coverage matrix) |
| Source drift | None: the application source is identical to `92e7980` |
| Input reports | `00-repository-discovery.md`, `01-data-integrity-audit.md`, `02-tauri-rust-security-audit.md` (written in this session before this report) and `coverage-matrix.md` |
| Host / tools | Linux container (not Windows or WSL). Node 22.22.0. No `node_modules`. |
| Instruction files | `CLAUDE.md`, read for the design-system and money/time rules. `docs/design/README.md` and the specs listed below were also read. |
| Agents | The lead plus three read-only specialists, all of which returned. **L1**: contracts and calculations. **L2**: workflow and state reliability. **L3**: UI, tests and specs. The three were dispatched while Phase 3 was being finished; the lead reconciled them against the Phase 3 report. The lead re-verified every Medium-or-higher finding (§11). |
| Caveat | Every UI test cited runs under jsdom with a mocked repository or invoke. **None of it establishes native WebView2 behaviour.** |

---

## 1. Frontend architecture assessment

The frontend is well structured for its size.

- **Boot and gates.** `main.tsx` preloads the legal record and then mounts the providers (`app/AppProviders.tsx`): a root error boundary, a `HashRouter`, TanStack Query, `RuntimeProvider` and toasts. Above the routes sit `LegalGate` and a per-route `RuntimeGate`.
- **One state owner per concern:**
  - runtime state lives in one state machine (`app/RuntimeProvider.tsx`), whose StrictMode double-mount is safely joined by a single-flight gateway;
  - server state lives in TanStack Query under one key factory (`features/shared/query-keys.ts`);
  - writes go through one lifecycle (`useFeatureMutation` plus `Submissions`), which reserves a per-scope lock synchronously, applies a 30 s deadline and handles uncertain outcomes.
- **Shared money and time code.** All money handling is bigint, through `packages/domain/src/primitives/money.ts` and `design-system/format.ts`. Unknown values render as `—`.
- **Design system.** Every screen uses the design system. No feature formats money with `toFixed`, `Intl.NumberFormat` or `toLocaleString`.
- **Strengths verified:**
  - Unavailable data is never shown as "no accounts".
  - A failed write never appears successful.
  - A failed refetch after a confirmed write does **not** turn it into an error: `onSuccess` awaits `Promise.allSettled` (`use-feature-mutation.ts:26-31`).
  - Every IPC response is Zod-parsed.
  - The display time zone (P0-D05) is applied only to Today's freshness lines, as `08-today.md:72-77` specifies. Trade times use the account zone.
  - Insights `summarize` has genuine Rust-generated parity (`insights-metrics.json`, 10 cases).

The weaknesses cluster in three places:

1. **Calendar-day versus trading-day logic re-implemented in TypeScript**: UI-001, UI-009, UI-010.
2. **Uncertain-outcome edge handling** that is inconsistent across features: UI-003, UI-004, UI-011.
3. **Navigation guards and test fidelity**: UI-005, UI-006, UI-007.

## 2. Findings summary

| ID | Severity | Priority | Location | Finding | Verification | Confidence |
|---|---|---|---|---|---|---|
| UI-001 | Medium | P1 | `apps/desktop/src/features/accounts/setup.ts:32-35` → `rulebooks/components/context.ts:15`, `today/components/TodayPage.tsx:115,149`, `RiskSection.tsx:73`, `accounts/components/presentation.tsx:73`, `CalculationSettings.tsx:46,48` | The rulebook "in force" is resolved with the calendar day (`zonedDay`), not the Rust trading day (reset time plus weekend roll) | Confirmed (lead read) | High |
| UI-002 | Medium | P1 (owner decision) | `lib/data/calculate-risk.ts:66-77`; `packages/domain/src/engine/evaluate.ts`; `src-tauri/src/store/snapshots.rs:407-458`; `docs/handoffs/build-16.md:83` | Stored risk status and figures are computed by the TS engine. Rust checks consistency and source freshness but never recomputes. Only 6 arithmetic cases are Rust-pinned. | Confirmed, documented deviation (R-16) | High |
| UI-003 | Medium | P2 | `features/settings/hooks/settings.ts:7`; `accounts/active-account.ts:55`; `accounts/components/AccountSwitcher.tsx:42-45`; `today/components/AccountsOverview.tsx:31`, `SessionPrompt.tsx:31` | An uncertain setting write locks that key for the session. There is no review or acknowledge path except for the last-export setting. Switching the active account is then blocked, and the toast misleadingly reads "wasn't changed… Try again when local data is available." | Confirmed (lead read) | High |
| UI-004 | Medium | P2 | `accounts/components/LifecycleDialogs.tsx:166,188-192`; `journal/components/TradeLogView.tsx:146`; `TradeDetailPage.tsx:270`; `TradeWriteReview.tsx:19` | Uncertain outcomes are reported as definite failures ("It wasn't archived", "The trade wasn't restored"). Trade remove/restore uncertainty can only be reviewed from the trade form, which lists trades by symbol rather than the affected trade. | Confirmed (lead read) | High |
| UI-005 | Medium | P2 | `features/shared/hooks/use-leave-guard.ts:20-48`; `AccountSwitcher.tsx:68`; `app/AppShell.tsx:231`; `TradeDetailPage.tsx:267` | The leave guard intercepts only anchor clicks and `beforeunload`. Browser back/forward, Alt+←, the mouse back button and `navigate()` calls bypass it. | Confirmed (lead read). Related to DATA-008. | High |
| UI-006 | Medium | P2 | `TradeDetailPage.tsx:262-276`; `TradeLogView.tsx:119-155` | Trade delete, Undo and Deleted-trades restore have no production UI test. The only delete tests target the dev-only `components/DataModelPanel.test.tsx`. | Confirmed (test gap) | High |
| UI-007 | Medium | P2 | `test/app-store.ts:76-84`; `features/imports/test-store.ts:25-41`; `features/journal/test-store.ts:76-82,152,217-222`; `features/accounts/test-store.ts:64-68`; `test/boundaries.ts` | The journey fakes are looser than Rust: imports ignore token, dedupe and lineage; reviews model `has_content` incompletely; tags lack uniqueness; account update skips archived refusal and re-derive; trade P&L uses floats and the trading day is a UTC slice. Journeys bypass the Tauri adapter entirely. | Confirmed (cross-ref TR-011) | High |
| UI-008 | Medium | P3 | `today/hooks/today.ts:49-76`; `accounts/components/presentation.tsx:71-90`; `insights/api/snapshots.ts:20` | Today and Accounts issue about 10 IPC reads per account, including the full import history and full calculation inputs. Keys include the per-minute `checkedAt`, so every minute or focus change refetches every account. | Confirmed (perf; not measured) | Medium-High |
| UI-009 | Low | P2 | `rulebooks/components/CalculationExplanation.tsx:54-55` | The "Calculated for X, not today (Y)" badge compares the Rust trading day with the calendar day, so it is false after the reset time and at weekends | Confirmed (lead read) | High |
| UI-010 | Low | P2 | `accounts/components/LifecycleDialogs.tsx:282-283,293`; `src-tauri/src/store/rulebooks.rs:785-787,835` | The attempt-reset rulebook `effectiveFrom` uses the calendar day, and Rust `assign_in` does not enforce Monday–Friday, so a weekend `effectiveFrom` can be stored | Confirmed | High |
| UI-011 | Low | P3 | `daily-reviews/components/DailyReviewPage.tsx:353-360` | "Check the stored review" acknowledges before re-reading. It fails silently (`() => {}`) if the request hasn't settled, and releases the lock even if the reload fails. | Confirmed (distinct from DATA-009) | High |
| UI-012 | Low | P3 | `main.tsx:9-11`; `features/legal/hooks.ts:31-43`; `LegalGate.tsx:17-22`; `app/AppProviders.tsx` (`retry:false`) | A hung legal read leaves the app on "Opening FundedFlow…" forever. A rejected read shows first-run to an accepted user, and Accept then overwrites `acceptedAt`. The comment's claimed retry doesn't exist. Fails closed. | Confirmed | High |
| UI-013 | Low | P3 | `design-system/format.ts:227-241`; callers `TradeFormDialog.tsx:94`, `LifecycleDialogs.tsx:93,282` | An ambiguous (repeated-hour) DST wall time resolves silently, to the earlier occurrence for negative offsets and the later for positive. Only `VerifyBalanceDialog` refuses ambiguous times. | Confirmed (hand-traced) | High |
| UI-014 | Low | P3 | `journal/components/journal-model.ts:137-152`; `ByDayView.tsx:65`; `TradeLogView.tsx:65` | The Journal computes profit factor as a float with `toFixed(2)`; Insights uses exact half-away-from-zero (`ratioText`). The two can differ (1.00 vs 1.01), and the Journal shows it below the minimum sample. | Confirmed | High |
| UI-015 | Low | P3 | `packages/domain/src/contracts/fields.ts:10-11`, `reviews.ts:252`, `daily-reviews.ts:194`, `account-lifecycle.ts:78` | `Number(v) > 0` refines disagree with Rust micro-unit checks: `"0.0000004"` passes in TS and is refused by Rust; `"0.0000005"` is stored as `0.000001` | Confirmed (R-17) | High |
| UI-016 | Low | P3 | `imports/hooks/imports.ts:31-35`; `accounts/hooks/accounts.ts:13`; `rulebooks/hooks/rulebooks.ts:130` | Invalidation is inconsistent: an import commit omits review and journal keys, an account update omits reviews, and rulebook writes omit Insights. This can leave up to 30 s of stale data. | Unverified (depends on DTO content) | Medium |
| UI-017 | Low | P3 | `DeletionDialog.tsx:118`; `RestoreArchiveDialog.tsx:305`; `ImportWizardPage.tsx:182-200`; `QuickImportPage.tsx:114-181`; `data-controls/hooks/data-controls.ts:258-261` | Small state gaps (detailed in §3) | Confirmed / Unverified (marked in §3) | Medium |
| UI-018 | Low | P3 | `features/journal/components/presentation.tsx:76-82`; `RulebookPage.tsx:108`; `insights/view-models/insights.ts:63` | The zone label shows today's abbreviation rather than the instant's (EDT beside EST times). "Last saved" on the rulebook page uses the computer's zone with no label. `?month=2026-13` renders "undefined 2026". | Confirmed | High |
| UI-019 | Low | P3 | `journeys/accessibility.test.tsx:31-61`; `journeys/workflows.journey.test.tsx:96-118` | Several screens and states have no axe scan (see §9). The "lost import answer" journey tests only the *did-not-save* case (`.fail`, not `.lose`). | Confirmed (test gap) | High |
| UI-020 | Informational | P3 / owner | `lib/data/tauri-repository.ts:123-302`; `features/ledger/hooks/ledger.ts`; `CalculationSettings.tsx:15` | 18 repository methods and all ledger hooks have no production caller, so there is no UI to record ledger entries, yet Calculation settings ask whether the ledger is complete. Spec drift: export button (`15-settings-data-controls.md:119-120` vs `DataControlsPage.tsx:79-81`); import history (`06-import.md:172-176` vs `:182-183`). | Confirmed; card check needed | High |

**Cross-references, not duplicated here:**

| Prior finding | Topic |
|---|---|
| DATA-006 | Create idempotency |
| DATA-007 | Mutex and deadlines |
| DATA-008 | Native close guard; sessionStorage durability |
| DATA-009 | Daily-review edits during a save |
| DATA-013 | Misleading failed import batch |
| TR-006 | Screenshot IPC |
| TR-008 | String errors misclassified as uncertain writes |
| TR-010 | Freshness gateway |
| TR-011 | Wire-fixture gaps |
| R-13 | Phase 1 candidate: `acknowledgeUncertainOutcome` uses the render-time spec. **Not a bug**: the handler releases the scope the user is shown (L2 §1). Informational only. |

## 3. Functional correctness findings: details

### UI-001: rulebook "in force" uses the calendar day

**Root cause.** `currentAssignment` computes `today = zonedDay(now.toISOString(), timeZone)` (lead-verified, `setup.ts:32-35`). That is the calendar date in the account zone. It ignores the account's trading-day reset (for example 17:00 New York) and the weekend roll to Monday, which Rust applies (`docs/data-model.md#trading-day`).

**Trigger.** A new rulebook version is assigned effective from the next trading day, and the account is viewed after the reset or over a weekend. Example: Friday 18:00 ET to Sunday 23:59, including Sunday's Globex open.

**Impact:**
- Today, the rulebook screens and Accounts show the previous version as "In use".
- `CalculateNow` builds the rule-currency and breach-boundary source claim IDs from that wrong version, while the engine uses Rust's applicable assignment. Monetary rules then become **Unknown** (`evaluate.ts:937-972`).
- This fails safe (never a false "Safe"), but the trader sees a stuck Unknown during the session and a wrong label.
- `AccountDetailPage.tsx:89` uses Rust's `facts.rulebookVersion`, so two screens disagree.

**Fix.** Use the Rust effective trading day or `applicableAssignment` (from risk inputs or `get_applicable_rulebook`), and delete the calendar computation. CLAUDE.md: Rust is authoritative.

**Test.** Assignments v1 (effective 2026-10-19) and v2 (effective 2026-10-26); now = 2026-10-23T22:30Z; New York zone; reset 17:00. Expect v2. Repeat with Saturday noon.

### UI-002: risk results stored from the TypeScript engine

**Root cause.**
- `calculateAndSaveRisk` captures the sources natively, evaluates them in TS and promotes the result.
- Rust's `validate_engine_payload` checks identity, the `inputsHash`, status equality and projected columns. `risk_promotion` checks that the sources are unchanged inside `BEGIN IMMEDIATE`.
- `docs/handoffs/build-16.md` says explicitly that Rust does not rerun the TS rule algorithms.
- `engine-contract.json` is **generated from TS output** (`packages/domain/scripts/generate-engine-contract-fixture.mjs`). Only `engine-math.json` (6 arithmetic cases) is Rust-generated.

**Impact.** CLAUDE.md, `docs/architecture/packages.md:126` and `docs/data-model.md:16-20` state that Rust is authoritative for stored calculations. For risk status this is not true, and status aggregation, applicability, evidence gating, prior breaches and historical crossings rest only on TS tests. This is not a hidden defect, but it is an undocumented exception to a project rule.

**Fix (owner decision).** Either:
- amend CLAUDE.md and `packages.md` to name the TS engine as the authority, with its own fixture policy; or
- add Rust-generated golden status and rule-state outputs across the scenario matrix.

### UI-003: an uncertain setting write blocks the account switcher

`useSetSetting` (`useFeatureMutation`, scope `["setting", key]`) backs these settings:

- active account
- display zone
- freshness policy
- Today layout
- session-prompt skips
- curve style

An uncertain outcome keeps the scope locked, but only the last-export setting renders `UncertainOutcomeReview` (`DataControlsPage.tsx:35`).

**Triggers:**
- the 30 s deadline expires, for example during a long import or export (DATA-007);
- a `database`-kind error;
- an IPC string error (TR-008);
- a parse failure.

**Impact.** Every later active-account switch rejects until restart, and the toast (lead-verified, `AccountSwitcher.tsx:42-45`) wrongly says nothing changed and blames local data.

**Fix.** Setting upserts are idempotent: on settle, re-read the key and auto-acknowledge when it equals the submitted value. Otherwise render a generic setting review, and distinguish uncertain from failed in the toasts.

**Test.** Make `settings.set` reject with a non-RepositoryError. Assert that a later select can proceed after the re-read, and that the toast does not say "wasn't changed".

### UI-004: uncertain outcomes reported as definite failures

`describeError` returns fixed "wasn't archived" / "wasn't restored" text (lead-verified, `LifecycleDialogs.tsx:160-170`). The trade-restore toasts behave the same way.

**Impact:**
- After a timeout or a `database` error, the user is told nothing happened when it may have.
- Retries hit the scope lock and repeat the same false message.
- This contradicts the P0-03 "check, never claim failure" rule that `LibraryView.tsx:288-291` and `Screenshots.tsx:163` follow correctly.

**Fix.** Branch on `uncertain-outcome` and show an account or trade write review keyed to the affected id.

**Test.** Make the archive mutation reject with `FeatureDataError("uncertain-outcome")`. Expect the "may have been archived" text and a check affordance.

### UI-005: the leave guard misses history and programmatic navigation

The guard (lead-verified, `use-leave-guard.ts:20-48`) captures `a[href]` clicks and `beforeunload` only. `HashRouter` has no blocker. Unsaved trade-review, daily-review or rulebook-draft text leaves the page without a prompt when the user:

- uses back or forward navigation;
- clicks "Manage accounts" in the account switcher;
- clicks the shell's Quick Import button.

Only the sessionStorage copy survives (DATA-008). The comment in `AccountSwitcher` that forms are modal does not apply to page editors.

**Fix.** Route `navigate()` through the existing `useGuardedNavigate`. Handle `popstate` (re-push the entry and ask), or move to a data router with `useBlocker`.

**Test.** With the daily review dirty, call `history.back()` and click "Manage accounts". Expect the confirm dialog both times.

### UI-006 and UI-007: test fidelity

**UI-006.** The destructive delete/Undo/restore workflow, including its uncertain path, ships with no production test.

**UI-007.** Journeys pass where Rust would conflict, deduplicate or re-derive:

- The import fake commits the same file twice as new trades (`app-store.ts:76-84`).
- The review fake accepts `(None, Some)` and content-only reviews, unlike `reviews.rs:299-313`.
- The tag fake skips uniqueness, unlike `ux_tags_kind_name`.
- The account update fake skips the archived refusal and the re-derive, unlike `accounts.rs:293-326`.
- The trade fake uses float P&L and a UTC-day `tradingDay`.

Because journeys mock `lib/data/api`, they never exercise `tauri-repository.ts`. Payload drift in uncovered commands (TR-011) therefore goes undetected.

**Fix:**
- Tighten the fakes: token equality, dedupe on commit, `has_content`, tag uniqueness, archived refusal.
- Parse fake outputs with the domain response schemas.
- Extend the Rust wire fixtures (TR-011).

**Fakes that do model Rust faithfully:** rulebooks (draft `updatedAt` conflicts), daily reviews (the three revision cases) and data controls (phrases and tokens).

### UI-017: smaller state gaps

- **Stale tokens.** A stale deletion or restore token shows its message, but "Check again" appears only in the failed or rejected phase. The user must close and reopen the dialog (Confirmed).
- **Import button.** The Import button stays enabled during the async destination `recheck()`. A double click is rejected safely, but it clears the preview and confirmation while the first commit runs. Cosmetic (Confirmed).
- **Quick Import auto-preview.** The effect reads `preview.isPending` and `preview.error` without listing them as dependencies, so it may not re-run after a key change. A manual retry is needed (Unverified).
- **Submission locks after restore or erase.** `forgetJournal` resets queries but not `Submissions` locks, so an uncertain lock for erased data persists until acknowledged (Confirmed, low impact).
- **Saving spinner.** "Saving…" can persist for up to about 20 s if a post-write refetch hangs, although the write is committed (Confirmed, low).

## 4. Application state assessment

| Topic | Assessment |
|---|---|
| Initialization | Runtime and legal state are owned once, StrictMode-safe and cleaned up. The legal gate fails closed on a read failure (UI-012). |
| Derived state | Display derivations are memo-free but cheap, except for the per-account fan-out (UI-008). The trading-day derivation is wrong in TS (UI-001, UI-009, UI-010). |
| Shared and global state | `active_account_id` and `display.time_zone` are journal settings with safe read degradation (Phase 2). The uncertainty lock lives only in memory (DATA-006). |
| Persistence sync | Writes invalidate the right prefixes for trades. Some secondary keys are missed (UI-016). Restore and erase reset the feature root. |
| Async operations | Single-flight reservations prevent double submits. Late results are dropped by key (`latestKey`) in the import wizard. |
| State transitions and error recovery | The uncertain → check → acknowledge flow is correct in the shared component, but some screens bypass it (UI-003, UI-004, UI-011). |
| UI vs persisted divergence | No case of a failed write appearing successful. False "failed" claims exist (UI-004). |
| Lost user changes | DATA-008, DATA-009, UI-005 |
| Duplicates | Prevented within a session. Across a restart, see DATA-006. |
| Stale data after navigation | Up to 30 s through missed invalidations (UI-016). `refetchOnWindowFocus` is off by design. |

## 5. Type safety findings

- **No `any`** in non-test source.
- **About 36 value casts.** Those that touch external data:
  - sessionStorage drafts: `JSON.parse(...) as Kept` plus a shallow check (self-written data);
  - `location.state` casts: optional strings only;
  - `rulebooks/api/risk.ts:25`: truthiness gate only.

  All low risk. Zod-parsing the drafts is recommended (part of UI-018 / DATA-008 follow-up).
- **All IPC responses are Zod-validated.** On writes, parse failures become uncertain outcomes.
- **Snapshot DTO nullability** matches Rust field by field (`snapshots.rs:24-82` vs `contracts/snapshots.ts:18-85`).
- **Trade output money fields** are `z.string()`, not canonical-checked. A non-canonical value renders `—`, never 0.
- **`noUncheckedIndexedAccess`** is off in the desktop config. Concrete minor risks:
  - `formatTradingDay` on a malformed day renders "undefined";
  - `EquityCurve` with an empty `floor` array produces `NaN%`;
  - `Math.min(...values)` on very large arrays (hypothesis).

  Recommendation: enable it gradually (P3).
- **Unknown versus zero holds** on every reachable path: journal stats, Insights `summarize`, the engine's `missing` gating, Today metrics, and the calendar's complete-only sums.
  - Latent `?? 0n` in `RuleMeter`/`MiniMeter` (gallery-only) and `?? 0` in the chart props.
  - `sumMoney` throws on i64 overflow; it needs an `isMicros` guard (P3).
- **TSD-008 (Rust policy, routed to Phase 6 / owner).** Rust stores blank manual-trade fees as 0 (`validate_trade`, `None => Some(0)`), so "unknown fees" become indistinguishable from zero. Mitigated only by the user's `coverage.fees` statement in calculation settings. **Owner decision**; recorded here so it is not lost.

## 6. UI reliability concerns

- **Error boundary.** There is only a root `RootErrorBoundary`. A render error on any route replaces the whole shell, including navigation and the recovery notice (Informational; per-route boundaries are recommended at P3).
- **Legal gate.** UI-012.
- **Loading, empty, unknown and unavailable states.** These match the specs for Today, Import, Trade review, Daily review and Data controls (L3 spot checks). Two mismatches:
  - The export button is not disabled until acknowledgement. The code and the test (`data-controls.test.tsx:139`) agree; the spec is stale. Per the card-wins rule, fix the spec.
  - Import-history decisions contradict "changes proposed" in `06-import.md`: doc drift.
- **Zone label.** The time-zone abbreviation comes from "now" (UI-018).
- **Accessibility.** Axe covers 11 routes plus 6 overlay states and keyboard flows (skip link, focus return, trapped destructive dialogs). Contrast and target size are deferred in jsdom. The manual NVDA/WebView2, scaling and contrast checklist (`docs/architecture/build-26-accessibility-journeys.md` §9) is **not executed**; it stays an unrun gate. Gaps: UI-019.

## 7. Frontend/backend integration observations

- The contract is consistent: Phase 3 §5 found 108/108 callers and every argument key mapped.
- **Risk calculation crosses the boundary twice:** native capture, then TS compute, then native promote. Promotion atomicity is strong (UI-002 covers governance).
- **The trading day must come from Rust everywhere.** Today's staleness check already does this (`today.ts:92`, `effectiveTradingDay`). UI-001, UI-009 and UI-010 do not.
- **Long operations.** Long reads and writes interact with the 10 s and 30 s deadlines (DATA-007, TR-006). The UI does not disable feature writes during data-control operations.
- **Unused Rust surface.** Several Rust commands have no production UI: catalogue writes, evidence corrections and ledger creation (UI-020). Confirm against the cards whether ledger entry UI is V1 scope; Calculation settings imply it is.

## 8. Performance risks

- **Per-account read fan-out** (UI-008): about 10 invokes per account, re-keyed every minute. Prefer a batched overview command, a `checkedAt`-independent `currentRisk` key, and a shorter `gcTime` for full inputs.
- **Screenshot cards** (TR-006).
- **Lists are paginated:**
  - trade log: 10–100 rows per page;
  - import rows: sliced, and Rust omits plain rows;
  - By-day view: 20 days per page.

  Virtualization isn't needed.
- **Minor:**
  - `ByDayView.tsx:158` is O(R×G);
  - the freshness re-read fires on every mutation success, including read-only mutations.
- **No listener or timer leaks** were found. All effects clean up, including the runtime focus handler and the import preview abort.

## 9. Maintainability recommendations and missing regression tests

**Maintainability, pragmatic only:**

1. Centralize trading-day resolution on the Rust value (fixes UI-001, UI-009, UI-010 at once).
2. One shared "trade data changed" invalidation set (UI-016).
3. One uncertain-outcome presentation helper for dialogs and toasts (UI-003, UI-004, UI-011).
4. Split `LibraryView.tsx` (586 lines), and give `DailyReviewPage.tsx` (537) a state-model seam.
5. Remove the unused repository methods or mark them planned (UI-020).
6. Dev-only legacy components (`DataModelPanel`, `AccountLifecycle`, `CsvImportSection`) are confirmed DEV-gated. Move the trade-delete coverage to production components (UI-006).

**Missing regression tests, by priority:**

| Finding | Test |
|---|---|
| UI-001, UI-009 | Calendar vs trading day at the reset and weekend boundaries |
| UI-003 | Uncertain setting write, then account switch |
| UI-004 | Uncertain archive, restore and trade restore wording |
| UI-005 | Back/forward and `navigate()` with a dirty editor |
| UI-006 | Delete, Undo and restore journey, including the held/lost/fail variants |
| UI-007 | Fake parity: re-import dedupe, preview-token mismatch, review `has_content`, duplicate tag, archived update |
| UI-019 | Import "committed but lost" `.lose()` journey |
| UI-019 | Axe on `/import/quick`, the rulebook version editor, `?view=log`, `?view=library`, runtime failure and unsupported-schema screens, the restore validated/installing states, the verify-balance dialog, and the daily-review conflict/uncertain/restore-edits states |
| UI-019 | Import drawer focus return (`06-import.md:179-180`) |
| UI-012 | Legal gate: a hung read and a rejected read |
| UI-013 | Ambiguous DST times in both zone families |
| UI-014 | Journal vs Insights profit-factor agreement |
| UI-015 | `"0.0000004"` refused inline |
| UI-008 | Bounded invoke count on Today with N accounts |

## 10. Remaining uncertainties and verification limits

- **Nothing was executed.** `npm test`, `npm run typecheck` and `npm run build` were skipped: there is no `node_modules`, and installing would need the network. Test-count and coverage statements are from reading the test files.
- **jsdom only.** All UI evidence is from jsdom with a mocked repository and invoke. Native WebView2 behaviour is unverified, including window close (DATA-008), focus behaviour, scaling and contrast.
- **Cards not checked.** Notion card text was not available. For ledger entry UI scope (UI-020) and the TS-engine authority decision (UI-002), the cards win and must be checked.
- **UI-016** depends on whether the review-summary DTOs carry trade-derived fields (not traced).
- **Commands executed** (read-only, repo root or `apps/desktop/src`):

  | Command | Result |
  |---|---|
  | `git status --porcelain` | Exit 0; report files only |
  | `sed -n`/`grep -n` on `features/accounts/setup.ts`, `AccountSwitcher.tsx`, `use-leave-guard.ts`, `LifecycleDialogs.tsx`, `CalculationExplanation.tsx`, `lib/data/runtime.ts` | Exit 0 |

## 11. Reconciliation register (Phase 4 delta) and agent coverage

| Prior item | Phase 4 result |
|---|---|
| R-11, R-12 | DATA-006, DATA-007 (unchanged) |
| R-13 | Not a bug (Informational) |
| R-14 | TR-010; legal raw mutation: by design; data-controls lock: DATA-007 |
| R-15 legal fail-open | By design and tested (`first-run.journey`: "record can't be saved"). The new related issue is UI-012 (fails *closed* on a read failure). |
| R-16 TS risk engine | UI-002 (owner decision) |
| R-17 Number checks / zone default | UI-015; `AccountsPage.tsx:126` is labelled and intended; `RulebookPage.tsx:108` is UI-018 |
| R-18 drafts | DATA-008 / DATA-009; stale-draft overwrite is warned (not an issue) |
| R-29 tsconfig / casts | §5 (P3) |
| P0-D UI cards (31 merged, Final Push V1) | Spot-checked five screens: Today, Import, Trade review, Daily review, Data controls. These match the specs, apart from the spec drift in UI-020. P0-D24 review controls is HEAD's merge. Partially Confirmed (sampled). |
| P0-03 uncertain-outcome rule | Generally followed; gaps UI-003, UI-004, UI-011 |
| P0-02 risk promotion | Sound atomicity; governance UI-002 |
| Accessibility / manual gates | Automated axe coverage confirmed; manual checklist **unrun** (gate) |
| P0-13/NA-3 legal | First-run flow tested extensively in jsdom. Draft text unchanged (open). |

**Separation by category:**

| Category | Findings |
|---|---|
| Confirmed defects | UI-001, -003, -004, -005, -009, -010, -011, -012, -013, -014, -015, -018 |
| Test gaps | UI-006, -007, -019 |
| Performance | UI-008 |
| Governance / owner | UI-002, UI-020, TSD-008 (fees) |
| Hypotheses | UI-016; parts of UI-017 |
| Escalation | None (no data-loss or security issue beyond Phases 2 and 3) |

**Lead verification:**

- UI-001: `setup.ts:28-38`
- UI-003: `AccountSwitcher.tsx:36-50`
- UI-004: `LifecycleDialogs.tsx:160-170`
- UI-005: `use-leave-guard.ts:15-50`
- UI-009: `CalculationExplanation.tsx:54`, via grep

UI-002 was checked against the `build-16` statement and the Phase 3 reading of `snapshots.rs`.

**Lane mapping:**

| Lane | Candidates | Became |
|---|---|---|
| L1 | TSD-001 to TSD-011 | UI-001, -002, -009, -010, -013, -014, -015, -018 and §5 |
| L2 | Items 1–12 | UI-003, -004, -005, -008, -011, -012, -016, -017; R-13 dismissed |
| L3 | F1 to F11 | UI-006, -007, -019, -020; F2 merged into UI-004, F3 into DATA-008, F9 into UI-018 |
