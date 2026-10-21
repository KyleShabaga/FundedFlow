# 2 · Accounts table

**Card:** Build 15 (account onboarding and management UI); rulebook assignment and editor: Build 19; risk inputs
and checkpoints: Build 15.5. Needs Build 14 hooks.
Mockup: `Accounts.dc.html`. Reference: `tw-accounts.png`.

## Purpose
Every account with its rules and how much room is left; the place to add, edit, archive and open accounts.

## Layout
1. Page head: title, subtitle, Import trades (secondary), Table/Cards toggle, **Add account** (primary).
2. KPI row (`StatTile` ×4): active accounts, combined balance of active accounts, closest to a limit, last import.
3. `DataTable` (Table view) or a grid of `AccountCard` (Cards view).
4. Footnote on how meters and rule states work.

## Table columns
| Column | Source |
|---|---|
| Select | — |
| Account (initial mark, prop firm + size, name) | `propFirm`, `name`; size label: see open questions |
| Platform | `broker` |
| Type | `accountType` as a badge (Evaluation, Sim funded, Live funded, Personal, Demo, Other) |
| Status | `status` badge (Active flow, Passed profit, Failed loss, Paused/Closed neutral) |
| Balance | `startingBalance` + sum of `realizedPnl` (see data) |
| P&L | sum of `realizedPnl` |
| Drawdown used | `MiniMeter` from the assigned rulebook's `max_drawdown`, or `RuleState` |
| Profit target | `MiniMeter` from `profit_target`, or "Funded, no target" / `RuleState` |
| Rulebook | name · version and Verified / Needs review / Account rules (private) |
| Trades | count |
| Last import | latest `list_csv_imports` batch |
| Actions | menu: Open dashboard, Edit, Assign rulebook, Archive |

Toolbar: search (name, firm, external ref), status segmented filter with counts (All, Active, Passed, Failed,
Paused), bulk Archive and Export CSV when rows are selected, Columns menu. Default sort: balance descending.
Footer: count, "n archived" link (shows archived accounts), rows per page, pager.

## Data
- `list_accounts`, `list_trades(accountId)`, `list_csv_imports(accountId)`, `list_account_rulebook_assignments`,
  `get_rulebook_version`.
- Balance and P&L: sum `realizedPnl` with `sumMoney` (exact). If any trade's `realizedPnl` is null, show `—` and a
  note ("2 trades without P&L"). A Rust command that returns per-account totals would be better than loading all
  trades; add one if this is slow.
- Drawdown used and target progress need rule evaluation (Build 16). Until then, show the rulebook values and
  `RuleState`, and only draw meters where the value is known and the calculation is defined (profit target:
  P&L vs target). Do not compute trailing drawdown in the UI.

## States
- Empty: "Add your first account" with the Add account button.
- Archived accounts hidden by default.
- Account with no rulebook: Rulebook column "Not set up" + Assign action; meters hidden.

## Decisions
- Meters: amber at 70% (`WARN_AT`), red at 100%, compared in micro-units (`ruleState`).
- Failed accounts stay in the list; the card tints `loss-soft`. Failed, passed, closed and archived attempts
  are history: they never feed Today's active-account risk.
- An account can be saved without a rulebook (Build 6): it shows Needs setup and Unknown risk, never Safe.
- A reset attempt is a new account with its own basis; link to the predecessor, never reuse its values.

## Open questions
- Account size label ("$100K"): `account_size_micros` exists in the schema but no command returns it yet.

## Build 15 implementation (2026-10-21)

Code: `apps/desktop/src/features/accounts/` (`components/`, `active-account.ts`, `setup.ts`); routes `/accounts` and
`/accounts/:accountId`; header selector in the shell's account-context slot. Data only through the Build 14 hooks.

### Decisions
- **Active account.** One value, `accounts.active_account_id` in the local settings table (survives restarts; no
  second copy in component state or browser storage). Selection is by id. Archived accounts can't be chosen;
  finished attempts (passed, failed, closed) can, and are labelled. An archived or missing selection is shown in the
  selector ("… was archived · choose an account") and never replaced silently. The first account added, or one added
  while none is active, becomes active. Create/edit/lifecycle dialogs are modal, so the selector can't change the
  account while a form is unsaved.
- **Setup completeness** (`setup.ts`) is separate from validity, lifecycle, rulebook verification and risk. A stored
  account is valid. Evaluation, sim-funded and live-funded accounts show **Needs setup** while the firm or a
  rulebook assignment in force today (account zone) is missing; personal, demo and other accounts need neither.
  Unknown while assignments can't be read: never "complete" without the facts. Nothing blocks journaling or imports.
- **Risk** is shown as "Not calculated yet" (`StatusIndicator` unknown) until Builds 15.5/16. Never Safe.
- **Archived accounts are read-only** in the UI: view and Restore only (domain contract), even though
  `update_account` doesn't refuse them (see dependencies).
- **Edits that re-derive trades.** Changing currency, time zone or day start warns with the trade count from the
  lineage summary: Rust re-derives trading days and P&L in the same transaction; amounts are not converted. A
  starting-balance change gets an informational note. A dirty form asks before discarding.
- **Status changes** use `change_account_status` with an optional cause (empty = unknown), effective time in the
  account zone and notes. Nothing is archived, deleted or inferred.
- **New attempt** is a four-step dialog (previous result, new attempt, rulebook, confirm) on the atomic
  `reset_account_attempt`. The prior result is prefilled only when the account already records it. Rulebook choices
  are verified, active catalogue versions with their phase/path; "Decide later" is explicit. Catalogue programme
  selection is not offered (`catalogue: null`): the reset's rulebook applicability already names the phase.

### Differences from the mockup (and why)
| Mockup | Build 15 | Why |
|---|---|---|
| Balance column, "combined balance" KPI | Starting balance column; Current balance KPI shown as unavailable | No current-balance source until Build 15.5 checkpoints; currencies are never added together |
| P&L column | Net P&L = Rust's lineage `netPnl` (known closed trades), with "n unknown" | Rust-computed, never a UI sum; unknown stays unknown |
| Drawdown used / Profit target meters | Not shown; footnote explains | Needs Build 16 rule evaluation; no meters at zero |
| "Closest to a limit" KPI | "Need setup" count | Same reason; a truthful, supported fact instead |
| Status filter All/Active/Passed/Failed/Paused | Live (default)/All/Active/Paused/Passed/Failed/Closed/Archived | Card's history filters and the domain's `filterAccounts` |
| Import trades button | Not shown | CSV import is Build 18 |
| Row selection, bulk Archive/Export, Columns menu | Not shown | Not in the card's scope; per-row actions cover archive |
| Default sort: balance descending | Name ascending; starting balance sorts within each currency | Amounts in different currencies aren't comparable |
| Size label ("$100K") | Not shown | `account_size_micros` isn't returned by any command (open question above) |
| Cards view balance | AccountCard with "—" and "Current balance not available yet" | Same as Balance |

### Backend dependencies found (not built here)
- `update_account` doesn't refuse archived accounts (domain says archived is read-only). The UI enforces it; Rust
  should too. Owner: backend (Build 10 follow-up).
- Per-account totals (trade count, net P&L, last import) come from `get_account_lineage` and `list_csv_imports` per
  account. Fine for tens of accounts; a summary command would scale better. Owner: backend.
- Restore conflicts carry the conflicting account's name in the Rust message, but Build 14 maps all conflicts to a
  generic message; the UI explains the likely cause instead.
- Rulebook assignment from the Accounts page waits for the Build 19 editor.
