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
