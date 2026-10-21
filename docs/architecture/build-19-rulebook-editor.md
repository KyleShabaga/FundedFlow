# Build 19: rulebook version editor and calculation explanation

Card: https://app.notion.com/p/3fe1bd4b6bde810fbdeffc57ea4f8ad8 · Screen spec: [13 Account rulebook](../design/screens/13-rulebook.md)
Base: main `9d49d71` (schema v14, after Builds 15.5 and 18). Branch `feat/build-19-rulebook-editor`.

## Audit before building (2026-10-20, before Build 16 existed)

The audit below is historical: Build 16 then arrived as PR #42 and is integrated (see the next section).

**Build 16 status.** The card says "In development", but there is no branch, PR or code for a rules engine on
main or any remote branch. `packages/domain` has the Build 9.5 rulebook contracts and the Build 15.5 evidence
contracts (`AccountRiskInputs`, `requiredRuleEvidence`, `assessRuleEvidence`). It has no evaluator and no
result/explanation type. `account_snapshots` stores what an engine computed, but nothing writes snapshots yet.
So the engine preview (D) and the engine explanation (F) are **blocked**. Build 19 does not build a second
engine: it shows them as unavailable and wires everything else for real.

**Missing Build 16 contracts** (needed to finish D and F):
1. A pure `evaluate(version: RulebookVersionDetail, inputs: AccountRiskInputs, asOf, policy)` that returns
   per-rule results and reasons, formula operands and steps, contributing trade/checkpoint ids, engine version
   and a canonical inputs hash.
2. A read-only native (or in-process) preview operation that runs it for an unpublished draft and writes nothing.
3. A snapshot mapper with nullable balance and day P&L, so an Unknown result can be stored honestly.

When those exist, `EvidencePreview` gets the result next to the evidence table, and `CalculationExplanation`
reads the engine's typed explanation instead of the generic JSON view.

### Gap matrix

| UI action | Existed (9.5 / 14 / 15.5) | Added in Build 19 | Tests |
|---|---|---|---|
| Overview, version history | `list_rulebooks`, `list_rulebook_versions`, `get_rulebook_version`, `list_account_rulebook_assignments`, `get_catalogue`, read hooks | Screens; `useAccountRulebookContext` | `rulebooks.test.tsx` overview, isolation |
| Who and why (audit) | Timestamps only, no actor or reason | Migration 15 `rulebook_events`, `list_rulebook_events`, events from every write (including reset assignments) | `rulebook_editor_tests.rs`, wire fixture, UI |
| Start a draft (copy) | `create_rulebook_draft` | Optional audit context; `StartDraftDialog` | Rust + UI journey |
| Edit and save a draft | None (drafts were write-once) | `update_rulebook_draft` with revision check | Rust (conflict, rollback, restart), UI (conflict keeps edits) |
| Safe cancel | None | `discard_rulebook_draft` (draft → rejected, kept) | Rust, UI |
| Validate | `validate_rulebook_draft`, `checkRuleDefinitions`, Zod | Field-level form validation through the same schemas | view-model + UI tests |
| Compare | None | `compareVersions` (words only, no figures), `VersionComparison` | view-model + UI |
| Preview | None (no engine) | Explicit unavailable state + read-only evidence check (`get_account_risk_inputs` + `assessRuleEvidence`) | Rust `total_changes()` no-write test; UI no-write test |
| Publish / verify | `publish_rulebook_version` | Optional `expectedUpdatedAt` + context; stale-base conflict | Rust, UI |
| Assign | `assign_rulebook_to_account` | Optional guard (open assignment the caller saw, actor, reason) | Rust, UI (stale window refused) |
| Explanation | `get_latest_account_snapshot` | `CalculationExplanation` / drawer showing the stored record | UI |

## Integration with Build 16 (2026-10-21)

PR #44 now targets PR #42's branch and merges it (`82b0b25` and later merges); no history was rewritten.

**Migration sequence.** Both PRs numbered their migration 15. Integrated: **15 `nullable_engine_snapshots`**
(Build 16, unchanged) and **16 `rulebook_events`** (Build 19, now a Rust step). Neither had shipped, but a journal
opened by a pre-integration Build 19 build could be at 15 with the audit log and without nullable snapshots, so
migration 15 would never run on it. Migration 16 detects that (`account_snapshots.balance_micros` still NOT NULL)
and applies the migration 15 rebuild first, keeping every row; its own SQL is idempotent so existing audit rows
survive. Tests (`db/rulebook_editor_tests.rs`): populated v14 → 15 → 16 with a legacy snapshot kept, rollback
at 16, idempotent rerun, the divergent-15 repair, restart persistence through `open_file`; Build 16's own v14 →
15 tests still pass.

**Typed API added.**
- `@fundedflow/domain`: `simulateRulebookVersion(inputs, proposed, policy) → RulebookSimulation`
  (`SIMULATION_ASSIGNMENT_PREFIX`); `resolveEngineApplicability(input, { simulation })`. Active evaluation is
  unchanged (`canAssign` still gates it; a test proves an assigned draft is refused).
- Desktop (`lib/data/calculate-risk.ts`, on #42): `loadRiskCalculation`, `evaluateRisk`.
- Desktop (`features/rulebooks/api/risk.ts`): `readCalculationInputs`, `readFreshness`, `calculateNow`,
  `recordedEngineResult`, `priorBreachesFrom`; hooks `useCalculationInputs`, `useCalculationFreshness`,
  `useCalculateRisk`. Preview and freshness queries sit under the account's `snapshotsRoot` key, which trade,
  import, ledger and (now) rulebook writes already invalidate.
- Rust: publishing an account-private draft sets `user_confirmed_at` (the engine refuses unconfirmed private
  rules, and nothing could set it before).

**Unsupported calculations (engine, by design).** Intraday trailing / equity-based limits, position size and
trades per day (no live equity, positions or executions in V1), payout waiting days and cycles, payout-count
transitions, scaling capacity, provider-session or conditional daily limits, ledger effects on floors. These are
Unknown, Unsupported or Manual with reasons, never zero or Safe.

**Build 21 (Today) blockers and notes.** The drawer (`CalculationExplanationDrawer`) and the typed view are ready.
Today still needs: a decision on when calculations run (they are saved on request here; there is no background
recalculation), the provider claims that let catalogue rulebooks produce figures, and the atomic
read/evaluate/save gate above if Today is to show a result as current without a re-check.

## Block checklist

| Block | Status | Notes |
|---|---|---|
| A Overview and history | Done | Provider, programme, phase, path, version, state, dates, last review, rules with states and sources, versions, assignments, activity. Unknown, empty, unavailable and unsupported are separate states |
| B Draft creation and editing | Done | Through the typed gateway; tagged presence first; domain validation; unsaved-edit guard and recovery; safe cancel; published versions frozen (UI, Rust and triggers) |
| C Comparison | Done | Field level, accessible tables, includes unsaved edits, unknown/manual stay labelled |
| D Preview | Done (on Build 16, #42) | `simulateRulebookVersion` over read-only canonical inputs, unsaved edits included, labelled a simulation; zero writes |
| E Review, publish, assign | Done | Explicit confirmation; reviewer for catalogue verification; effective trading day; reason; guarded against stale views; audit kept |
| F Explanation | Done | Typed engine record (formula, operands, sources, versions, hash, assurance, times); freshness re-check; legacy snapshots generic |
| G UX and tests | Done, with limits | Keyboard/focus via design-system controls, tested for the assign dialog; no visual check in a running app (see below) |
| H Gap audit | Done | Above |
| I Draft persistence | Done | Revision checks, append-only assignments, isolation, provenance |
| J Migration | Done | Migration 16 (after Build 16's 15) is additive (one new table, no row changes), with an explicit repair for a journal that reached 15 on the pre-integration branch; failure rollback, idempotency, populated v14 → v15 → v16 upgrade and restart tested |
| K Engine integration | Done, one gate | Calculate-and-save, prior breaches, invalidation on trade/import/ledger/rulebook writes; read → evaluate → save not atomic (Build 16 gate) |
| L Wire and failure tests | Done | See evidence |
| M Delivery | This PR | Draft; not merged; card not moved |

## What was reused and what is new

Reused: the Build 9.5 contracts, triggers and store (drafts, publish, assign, conflicts, applicability), the
`canAssign`/`checkPublish`/`checkRuleDefinitions` integrity helpers, the Build 14 query/mutation hooks,
`toAsyncState`/`toMutationState`, the Build 13 components (`StateBoundary`, `DataTable`, `StatList`, `Dialog`,
`ConfirmDialog`, `Drawer`, `RuleStateBadge`, `RulebookLine`, forms), the Build 15 account pages and test store,
the Build 15.5 `get_account_risk_inputs` and `assessRuleEvidence`, and the existing snapshot read.

New: migration 15 and three commands (`update_rulebook_draft`, `discard_rulebook_draft`,
`list_rulebook_events`); optional guard/context arguments on `create_rulebook_draft`,
`publish_rulebook_version` and `assign_rulebook_to_account` (old call shapes unchanged and tested); domain
schemas for them; `features/rulebooks` (api, hooks, view models, pages, dialogs, tests); `TabPanel keepMounted`.

## Evidence (Windows 11, 2026-10-21, integrated branch)

- `npm ci`, `npm run typecheck`, `npm run build`, `npm run check`, `git diff --check`: pass.
- `npm test`: pass. Domain 450 tests (incl. 7 simulation tests); desktop 427 tests (incl. `rulebooks.test.tsx`
  with the engine journeys: exact preview figures with unsaved edits and zero writes, unstated currency stays
  Unknown, catalogue terms without a phase stay Unknown, calculate-and-save with freshness turning to "changed"
  after a trade correction and history kept, confirmed private rules evaluated for real).
- `npm run check:engine-runtimes -w @fundedflow/domain` (Edge as Chromium): Node and browser identical for 9
  scenarios, SHA-256 parity.
- `cargo test`: 206 passed, 0 failed, 2 ignored. `cargo clippy --all-targets -- -D warnings`: pass.
- `cargo fmt --check`: not clean before or after (no `rustfmt.toml`; code at ~120 columns); nothing reformatted.
- Earlier evidence for the editor (2026-10-20): the same suites before integration.

## Not verified

- **No native Tauri run.** The app always opens the journal in the per-user data directory and has no override,
  so `tauri dev` on this machine would migrate the real journal to v16 (an older build would then refuse it). All migration testing used in-memory or temporary databases.
  Native behaviour is covered by the Rust store/command tests and the wire fixture, not by a packaged window.
- No visual check in a running app (layout, wrapping at narrow widths, dark theme). Behaviour is tested in
  jsdom, which does no layout.
- Screen-reader announcements are asserted through roles only; no assistive-technology run.

## Follow-ups (Triage)

- Build 16: the three contracts above (Build 16 card).
- An isolated data directory for native QA (environment variable or CLI flag), so a branch can be run without
  touching the real journal.
- External links from the webview: source URLs are shown as text until links open in the system browser.
- A `rustfmt.toml` that matches the code, so `cargo fmt --check` can be enforced.
