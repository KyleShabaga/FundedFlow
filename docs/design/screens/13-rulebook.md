# 13 · Account rulebook, version editor and calculation explanation

**Card:** Build 19 (rulebook version editor and calculation-explanation UI). Needs Builds 9.5 (rulebook contracts),
14 (hooks), 15 (accounts), 15.5 (evidence) and 16 (rules engine, PR #42; this screen is integrated on it).
No canvas mockup exists (the design task "Design rulebook editor, version comparison and explanation UX" is in
the backlog), so this screen follows the Accounts screens' layout and the Build 13 components.

## Routes and entry points
- `/accounts/:accountId/rulebook`: overview for one account attempt.
- `/accounts/:accountId/rulebook/versions/:versionId`: one version; the editor when it is a draft.
- Entry: the account page's Setup panel ("Set up the rulebook" when none is assigned, "Review or change" beside
  the rulebook line) and the Accounts row menu ("Rulebook and assignment" / "View rulebook"). Today (Build 21) is a
  placeholder: it will open `CalculationExplanationDrawer` from a value.
- The account is in the URL, so switching the active account never changes which attempt a page shows, and
  every read is keyed by that account.

## Overview (block A)
1. Head: "Rulebook · {firm · name}", subtitle, **Write my own rules / New draft of my rules**, **Assign a version…**
   (primary). Archived accounts are read-only (notice, no actions).
2. **In force today** (assignment covering today in the account zone): `RulebookLine`, state sentence,
   provider, programme, phase, path, version link, state, in force from (trading day + zone), until, provider-stated
   from, last reviewed (verified or user-confirmed time), assigned at; rules table (rule, `RuleStateBadge`
   state, source claims); **Start a draft from vN**.
3. Tabs: **Versions and drafts** (the current rulebook, the account's own rulebook, other catalogue rulebooks;
   row opens the version), **Assignment history**, **Activity** (audit log, newest first, "By You (on this
   computer)"), **Calculation** (see F).

States, all distinct: loading; no assignment ever (`EmptyState` not-configured, with actions; personal/demo
wording differs); assignments exist but none today (notice); assignment unreadable (`ErrorState` + retry); version
unreadable; catalogue unavailable (names show "Catalogue unavailable", ids are never guessed into names); stale
version (warning notice); archived account.

## Version states (wording is the contract)
| Stored | Shown | Meaning shown |
|---|---|---|
| draft | Draft | Being edited; not in use until published |
| rejected | Discarded draft | Set aside; kept for the record |
| needs_review, private rulebook | Account rules (private) | Your own rules; estimates; never the firm's verified terms |
| needs_review, catalogue | Needs review | Can't be assigned until a named reviewer verifies it |
| verified | Verified | Checked against the source by {reviewer} |
| stale | Stale | A newer source contradicts it |
| superseded | Superseded | Replaced; accounts keep it until reassigned |

Rule states use `RuleStateBadge` (Needs setup, Manual check, Not tracked, None, Off, Not applicable) and the
"Not calculated" badge for manual-only, unsupported and needs-setup rules.

## Version page and editor (blocks B, C, D, E)
Tabs: **Edit rules** (draft) / **Rules** (published), **Compare**, **Preview**, **Review and publish** /
**Status**, **Details**.
- **Start a draft** copies a version into a new draft: into the account's own rules (created on first use,
  never verified), or as a correction to the catalogue rulebook (needs a named reviewer). A superseding draft needs
  a reason. The source version is never changed.
- **Editor**: per rule, label, support (manual rule types offer only Manual check / Not tracked), parameters,
  provider wording, source text; move up/down, remove, add a rule of any type (new values start Unknown and the
  rule Needs setup). Tagged values choose a state first (Unknown, None, Off, Not applicable, Value); only Value
  asks for the value, with the account currency as suffix. Money is decimal text. Draft details: reason,
  provider-stated from/until (stored as 00:00 UTC; *not* the assignment day).
- **Validation**: the domain's `ruleDefinitionInputSchema` + `checkRuleDefinitions` before saving, Rust again on
  save. `ValidationSummary` links each issue to its field and focus moves to the first invalid field.
- **Save** sends the revision the editor loaded. If the draft changed elsewhere: error notice, edits kept, "Load
  the saved draft (drops your edits)". Sticky save bar: "Unsaved changes / All changes saved", Undo changes,
  Save draft. The edit tab stays mounted (`TabPanel keepMounted`) so compare/preview never drop edits.
- **Unsaved edits**: in-app links ask "Leave without saving?"; closing the window asks (`beforeunload`); edits are
  also kept in session storage against their revision, and reopening the draft offers "Restore them / Discard
  them" (or says they were set aside because the draft changed since).
- **Compare** (C): one real table per section (caption, column and row headers), Field · version in use · this
  version (with unsaved edits) · Change (Added / Removed / Changed / Same in words). "Show unchanged fields"
  checkbox. Values are what each version states; Unknown/None/Off/Manual check are never shown as zero.
- **Preview** (D): a **simulation** on the Build 16 engine, labelled "Simulation: not this account's status" and
  "Simulated: {status}". The account's canonical inputs are read for an explicit cutoff (now, to the minute; "Use
  now" moves it) through `loadRiskCalculation` (no write), and `simulateRulebookVersion` evaluates this version,
  with the editor's unsaved edits when they are valid (otherwise the saved draft, with a warning). The trader
  states, for this calculation only: whether trades, fees and ledger are complete; the currency of the rule
  amounts; whether touching a limit is a breach; an optional personal caution buffer. Nothing is assumed: an
  unstated value leaves the affected rules Unknown with the reason. Prior breaches from earlier engine
  calculations are passed to the engine. Nothing is assigned, published or saved.
- **Review and publish** (E): server publish checks for the saved revision; "Save your edits first" while dirty;
  required acknowledgement checkbox; `ConfirmDialog` naming what changes. Catalogue versions in review get
  **Verify** (reviewer name + checkbox). Publishing a private draft opens **Assign**. **Discard draft…** asks
  for a reason. Conflicts (changed meanwhile, newer version published) say what happened and how to recover.
- **Assign** (`AssignDialog`): version (only those the domain's `canAssign` allows), applies-to (the version's
  applicability rows, or "This account only"), first trading day (weekday, after the latest assignment, in the
  account zone), optional reason; a "What changes" notice (previous assignment ends that day, earlier days keep
  their version, stored calculations are not rewritten, own rules are estimates). The write names the open
  assignment the dialog saw; a different one is a conflict.

## Calculation explanation (block F)
`CalculationExplanation` / `CalculationExplanationDrawer` show the latest stored snapshot **as recorded**, never
recalculated:
- A Build 16 snapshot is shown typed (`EngineResultView`): status with its assurance in words (verified rules and
  reported data / your own rules / not verified), why it isn't Safe, cutoff vs newest data used vs calculated at,
  trading day, rulebook version (name and state), assignment, engine version, inputs hash, qualified balance,
  today's realized P&L, trading days; then per rule: outcome, reason, formula, operands, results, missing inputs,
  evidence, assumptions and the source/contributing record ids.
- **Freshness**: its sources are read again for its own cutoff, coverage statement and frozen policy and compared
  with `isEngineResultCurrent`: "Sources unchanged for its cutoff" or "Sources changed since it was calculated".
  A calculation for an earlier trading day says "Calculated for {day}, not today". One made with another version
  than the one in use says so. The latest row is never called current because it is the latest.
- A snapshot from before Build 16 shows "Recorded before the rules engine" and its explanation as nested rows.
- **Calculate now** (account page, not archived): the same statements as the preview, then "Calculate and save"
  runs `calculateAndSaveRisk` as of now and saves a new snapshot; earlier ones are kept.
- Manual-only, unsupported and needs-setup rules are listed as "Not part of any calculation". With no snapshot:
  "No calculation recorded". React computes nothing.

## Keyboard and focus
- Every control is a native or Radix control from the design system: Tab order follows the layout; Selects open
  with Enter/Space/arrows; dialogs trap focus, start on Cancel for confirmations, close on Escape (except while a
  write runs) and return focus to the opener.
- Route changes focus the page heading (shell). Save errors focus the first invalid field.
- Status lines (`role="status"`) announce save state and comparison counts; errors are alerts.

## Blockers and open decisions
- Read, evaluate and save are separate operations (Build 16 gate): a source edit in between can save a result for
  inputs that changed; the freshness check then reports "Sources changed".
- Catalogue rulebooks need reviewed provider claims for every parameter (and for currency and breach boundary)
  before the engine produces figures for them; the catalogue data here has none, so they stay Unknown.
- Publishing the account's own rules records the user's confirmation (`user_confirmed_at`), which the engine
  needs; the checkbox says so.
- Applicability rows of a catalogue draft are copied from its source and shown, not edited (catalogue authoring
  is Build 9's screens).
- Source claims are not copied into drafts: they are evidence for the version they were recorded against.
- Actor labels are local ("You (on this computer)"); FundedFlow has no sign-in.
