# Build 19: rulebook version editor and calculation explanation

Card: https://app.notion.com/p/3fe1bd4b6bde810fbdeffc57ea4f8ad8 · Screen spec: [13 Account rulebook](../design/screens/13-rulebook.md)
Base: main `9d49d71` (schema v14, after Builds 15.5 and 18). Branch `feat/build-19-rulebook-editor`.

## Audit before building

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

## Block checklist

| Block | Status | Notes |
|---|---|---|
| A Overview and history | Done | Provider, programme, phase, path, version, state, dates, last review, rules with states and sources, versions, assignments, activity. Unknown, empty, unavailable and unsupported are separate states |
| B Draft creation and editing | Done | Through the typed gateway; tagged presence first; domain validation; unsaved-edit guard and recovery; safe cancel; published versions frozen (UI, Rust and triggers) |
| C Comparison | Done | Field level, accessible tables, includes unsaved edits, unknown/manual stay labelled |
| D Preview | **Blocked on Build 16** | "Preview unavailable — rule evaluator not connected" plus the read-only evidence check; no figures |
| E Review, publish, assign | Done | Explicit confirmation; reviewer for catalogue verification; effective trading day; reason; guarded against stale views; audit kept |
| F Explanation | Partly done | Stored snapshot as recorded, version mismatch flagged, manual rules listed; engine formula details need Build 16 |
| G UX and tests | Done, with limits | Keyboard/focus via design-system controls, tested for the assign dialog; no visual check in a running app (see below) |
| H Gap audit | Done | Above |
| I Draft persistence | Done | Revision checks, append-only assignments, isolation, provenance |
| J Migration | Done | v15 is additive (one new table, no row changes); failure rollback, idempotency, populated v14 upgrade and restart tested |
| K Engine integration | **Blocked on Build 16** | Contracts named above |
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

## Evidence (recorded on Windows 11, 2026-10-20)

- `npm run typecheck`: pass.
- `npm test`: pass. Domain 370 tests; desktop 418 tests in 33 files, among them `rulebooks.test.tsx` (14 journeys),
  `view-models.test.ts` (11) and `rulebook-wire.test.ts` (13).
- `npm run build`: pass (the existing chunk-size warning remains).
- `npm run check`: pass.
- `git diff --check`: pass.
- `cargo test` (src-tauri): 199 passed, 2 ignored, 0 failed. New: 10 tests in `db/rulebook_editor_tests.rs`.
- `cargo clippy --all-targets -- -D warnings`: pass.
- `cargo fmt --check`: **not clean, before and after this branch**. The repository has no `rustfmt.toml`, and
  its code is written at about 120 columns, so default rustfmt would reformat almost every file. New code
  follows the surrounding style; nothing was reformatted.
- Native wire: `src/test/fixtures/rulebook-wire.json` is generated by the Rust store
  (`rulebook_command_wire_fixture`) and replayed through the Tauri adapter, which checks every argument and
  output and that each command is registered in `lib.rs`.

Test coverage of the requested cases: drafts, editing, validation, publishing, comparison, immutable history
(UI, store and SQL triggers), isolation (another account's private version, another attempt's overview, event
queries), effective dates (weekday, after the latest assignment, previous assignment ends), stale and
conflicting edits (revision, stale base, stale assignment view), failed saves (validation before writing,
injected mid-transaction failure rolled back, retry), unknown/unsupported/manual-only rules, preview with no
side effects (native `total_changes()` and UI write log), real SQLite persistence and restart (file-backed
journal reopened twice), wire compatibility, keyboard (assign dialog: Enter opens, Escape closes, focus returns).

## Not verified

- **No native Tauri run.** The app always opens the journal in the per-user data directory and has no override,
  so `tauri dev` on this machine would migrate the real journal to v15 (a build at v14 would then refuse it).
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
