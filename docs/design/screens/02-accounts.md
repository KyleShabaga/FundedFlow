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

## Post-V1
- Account size label ("$100K"): `account_size_micros` exists in the schema but no command returns it. Post-V1 (owner
  decision 2026-10-21, [NA-1](https://app.notion.com/p/4001bd4b6bde8176b254e307bd204933)); tracked on the [P1 boards card](https://app.notion.com/p/4001bd4b6bde813da4f3c258bc18bc74).

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
- **Risk** (superseded by NA-4, below): the detail page's Risk section reads the overview card's model. It was a
  permanent "Not calculated yet" until NA-4.
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
| Balance column, "combined balance" KPI | Starting balance column; Current balance KPI per currency from current estimates (NA-4, below) | Build 15.5 stores user-reported balance/equity observations and exact reconciliations (`JournalRepository.evidence`), but no hook or screen enters or shows them yet, and a reconciled balance is not a live balance; currencies are never added together |
| P&L column | Net P&L = Rust's lineage `netPnl` (known closed trades), with "n unknown" | Rust-computed, never a UI sum; unknown stays unknown |
| Drawdown used / Profit target meters | Not shown; footnote explains | Needs Build 16 rule evaluation; no meters at zero |
| "Closest to a limit" KPI | "Need setup" count | Same reason; a truthful, supported fact instead |
| Status filter All/Active/Passed/Failed/Paused | Live (default)/All/Active/Paused/Passed/Failed/Closed/Archived | Card's history filters and the domain's `filterAccounts` |
| Import trades button | Not shown | CSV import is Build 18 |
| Row selection, bulk Archive/Export, Columns menu | Not shown | Not in the card's scope; per-row actions cover archive |
| Default sort: balance descending | Name ascending; starting balance sorts within each currency | Amounts in different currencies aren't comparable |
| Size label ("$100K") | Not shown | `account_size_micros` isn't returned by any command (open question above) |
| Cards view balance | Build 18.5 overview card: engine balance or checkpoint with provenance, else Not available | See below |

### Backend dependencies found (not built here)
- `update_account` doesn't refuse archived accounts (domain says archived is read-only). The UI enforces it; Rust
  should too. Owner: backend (Build 10 follow-up).
- Per-account totals (trade count, net P&L, last import) come from `get_account_lineage` and `list_csv_imports` per
  account. Fine for tens of accounts; a summary command would scale better. Owner: backend.
- Restore conflicts carry the conflicting account's name in the Rust message, but Build 14 maps all conflicts to a
  generic message; the UI explains the likely cause instead.
- Rulebook assignment and editing: Build 19, [13 Account rulebook](13-rulebook.md), opened from the Setup panel and the row menu.
- Account edits may change currency, time zone or day start after Build 15.5 observations exist. Observations keep the
  units and session they were recorded with, so later comparisons refuse mismatches instead of converting. The edit
  warning covers re-derived trades only; warning about recorded checkpoints needs an evidence hook (future Claude
  card, with the checkpoint-entry UI).

## Build 18.5 account overview cards

The Cards view uses `OverviewCard` (`features/accounts/components/OverviewCard.tsx`) on the design system's
`AccountOverviewCard`; the mapping is `view-models/overview.ts` and is pure. Table stays the default dense view; both
layouts share the search and status filter. Each card reads the same hooks as Today (latest snapshot, freshness check,
canonical inputs as of now, checkpoints), so a card never shows another attempt's values.

| Card field | Source |
|---|---|
| Firm / "Personal · no firm" / "No firm set" | `account.propFirm`, `accountType` |
| Name, masked number (`••••1234`) | `account.name`, `account.externalRef` (last four kept); internal ids never shown |
| Type · phase · attempt | `accountType`; latest effective phase event (`derivePhaseHistory` on the inputs' `phaseHistory`), else "Phase not recorded"; lineage `attemptNumber` of lineage length when there are resets |
| Lifecycle, Archived, Needs setup, Active in FundedFlow | `status`; `archivedAt`; `setupItems`; active-account setting. Separate badges |
| Drawdown headroom (primary), floor | `max_drawdown` outcome `metrics.drawdownHeadroom` / `drawdownFloor` of the latest saved engine result, only when Today's rules call it current; otherwise Not calculated / Needs setup / No rulebook / Not current (Stop stays "Stop · not current") / History only |
| Balance | Current engine `balance` ("From your records", as-of, stated-incomplete coverage named), else the latest checkpoint ("Confirmed by you" / "Not confirmed", its source and time, trades since not included), else Not available. Starting balance is a muted "Started with" line, never the balance |
| Max drawdown | Assigned version's `max_drawdown` amount (presence state) and method |
| Profit target | Only when the assigned version has one and the engine doesn't call it not applicable; progress (`profit`, `profitTarget`, `remaining`) only from a current result; explicit none / off stay distinct words |
| Consistency | Threshold from the version; result only from a current known outcome, else "result not calculated/unknown" |
| Bars (≤ 2) | Drawdown headroom of the rule amount (`operands.amount`) and profit target progress, current results only |
| Last traded | Newest trade (exit, else entry) for this attempt in the inputs, account zone with zone name; "No imported trades" |
| View details | Button to `/accounts/:id` of that attempt; the menu adds Quick import into this attempt and the existing row actions |

No figure is computed in the UI: every amount is passed through from the engine result, a checkpoint or the
rulebook. Each card reads the canonical inputs for its attempt (one `get_account_risk_inputs` per card), which is
fine for tens of accounts; a summary command would scale better (backend follow-up).

## P0 design: account detail (Build 25.1)

Boards in [`mockups/p0/`](../mockups/p0/): 4A `AccountDetail` (states: calculated, not current, needs setup, failed
attempt, archived, loading; tabs Overview, History, Attempts), 4B `AccountDialogs` (edit with re-derive warning,
change status, archive and restore, new attempt step 3, ⋯ menu, discard changes, toast), 4C `NarrowAccount`.
This redesigns `/accounts/:accountId` from Builds 15, 15.5 and 18.5. Every figure comes from a source the Accounts
cards already read (engine result, checkpoint, lineage, rulebook, imports); nothing new is calculated.

### Layout (Overview tab)
1. **Identity**: initial mark, eyebrow "firm · platform", name with masked number, then badges (type, status,
   Archived, Needs setup) and the "Active account" pill, then "phase · attempt n of m · last traded {time, zone}".
   Actions: Import trades (menu: Quick import / Full wizard), ghost Import history, primary Edit, ⋯ menu. Archived:
   Restore from archive replaces them.
2. **Notices**: archived (read-only), finished attempt (history only, Start new attempt…), needs setup (Set up the
   rulebook).
3. **Four figures** (the `OverviewCard` fields, as `MetricCard`s): Balance with its provenance badge ("From your
   records", "Confirmed by you", "Not current"), Net P&L (known closed trades; unknown count named), Drawdown headroom
   with floor and a `ProgressMeter`, Profit target progress with "to go". Meters only from a current result; not
   current figures are muted with a badge; missing ones are "—" with the reason; finished attempts say "History only".
4. **Rules and risk** card: `StatusIndicator` + "why it isn't Safe", How this was calculated / Calculate now…, the
   `RulebookLine` with Review or change, five key rules from the assigned version, and the estimate disclaimer.
5. **Recent trades** (5, links to Journal) and **Recent imports** (3, links to Import history).
6. Right rail: **Setup** checklist (firm, rulebook in force today, optional balance checkpoint; "a complete setup isn't
   a Safe account"), **Activity** (the built StatList), collapsed **Account settings**.

History tab: lifecycle timeline (status events with cause "as you recorded it", reset link to the previous attempt)
and rulebook assignments. Attempts tab: the built attempts table.

### Actions
⋯ menu on a live attempt: Use as active account, **Rulebook and assignment**, **Quick import into this attempt**, Change
status…, Mark failed…, Start new attempt…, Archive…, Delete permanently… (loss). The two bold items are new on this page
(they exist on cards and the Setup panel). Archived: Restore from archive, Delete permanently…. Delete opens the Build
25 deletion dialog ([15](15-settings-data-controls.md)).

### Keyboard and narrow windows
Tabs, menu and dialogs are the design-system components. Below 1100 px the figures are 2×2 and the rail moves under
the main column; at 720 px "Import history" moves into the ⋯ menu and tables scroll inside their cards.

### Changes proposed for the built screen (UI only)
Header breadcrumb; figures row and Rules and risk card (reusing the overview-card view model); recent trades and
imports lists; the two new menu items; Import trades as a menu (today it goes straight to the wizard).

## NA-4: account detail Risk section and Current balance KPI

Card: NA-4 (finishes P0-11; Build 18.5 and Build 15). No new calculation and no new command: both read Today's truth
model (`useTodayAccount`), the same source as the overview card.

### Detail page Risk section
`AccountDetailPage` and `OverviewCard` both call `useAccountOverview` (`features/accounts/hooks/overview.ts`), which
builds `overviewModel()`. The Risk section shows `model.risk` (state, why, reasons, last saved), the card's own
figures (`headroom`, `floor`, `balance`, through the design system's `OverviewFigure`) and its meters. For the same
attempt the detail page and the card therefore name the same state and show the same figures.

| State (truth) | Status shown | Figures | "Never shown as safe" line | Calculate |
|---|---|---|---|---|
| Current | Today's status ("Safe (estimate)", "Caution (estimate)", "Stop") | Engine headroom ("Current estimate", or Caution / Limit reached), floor, balance "From your records", each "As of {time, zone}"; meters | No | Yes |
| Not current (stale, including the P0-02 "not promoted" reason after upgrade) | "Not current" (a recorded Stop stays "Stop · not current") | — with the reason; balance falls back to the latest checkpoint | Yes | Yes |
| Not current (sources couldn't be checked) | "Not current" | — with the reason | Yes | Yes |
| Unknown (saved calculation unreadable, or saved before the engine) | "Unknown" | — with the reason, never 0 | Yes | Yes, with a rulebook |
| No rule (current result without a drawdown outcome) | Today's status | Headroom and floor "No rule" (—) | No | Yes |
| Not calculated (rulebook, nothing saved) | "Not calculated" | — | Yes | Yes |
| Needs setup / No rulebook | "Needs setup" (prop account) or "No rulebook" | — | Yes | No: set up the rulebook first |
| History only (failed, passed, closed, paused, archived) | "History only" | — | No (not part of today's risk) | No |

Stale reasons are listed one per line (`STALE_TEXT`), followed by what the last saved estimate said and its cutoff
in the account's zone. Actions: **Calculate estimate** opens Today's existing `CalculateNow` dialog (only for a live
attempt with a rulebook in force today). **Open Today** links to `/` when the attempt is active; otherwise **Use as
active and open Today** makes it the active account first (Today shows the active account; same as Today's own
"Show"). Archived attempts get neither.

### Current balance KPI
`currentBalanceKpi` (`view-models/balance-kpi.ts`), fed by the existing per-account `FactsProbe`, which now also
reads `useTodayAccount` for each live account:
- Only a balance Today calls **current** (`truth.kind === "current"`, engine `balance` not null) counts: the card's
  "Estimated balance". Checkpoints, stale estimates and unknowns are left out, never treated as zero.
- **One currency:** the exact sum (`sumMoney`, bigint micro-units) as money, with "n of m live accounts · current
  estimates".
- **Several currencies:** one total per currency, sorted by code, on one line ("€12,480.55 · $150.50"), with "n of m
  live accounts · each currency totalled on its own". Currencies are never added together or converted.
- **None current:** — with "None of the m live accounts has a current estimate" (or "No live accounts").
- While any live account is still being checked the value is loading, never a partial total.

The table view now makes Today's reads for every live account (about seven queries each, as the cards already do).
A native account-summary command would scale better; see the proposed card in the NA-4 pull request (related to
Build 27.25).

Screenshots (native debug build, synthetic UI Smoke test journal, before = main 8c3dd34, after = NA-4; 1280, 1024 and 800 px): [`02-accounts-na4/`](02-accounts-na4/).
