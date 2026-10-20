# Legacy rulebook migration matrix (Build 8.75 → Build 9.5)

Status: **handoff, not implemented.** This is the field-level plan for converting the legacy account-owned
`rulebook_versions` and `rules` (migration 0001) into the reusable rulebooks of Build 9.5. Build 9.5 owns the
target schema and may rename target fields. Any decision below that it changes must be recorded here, with
the evidence tests updated to match.

Evidence: `apps/desktop/src-tauri/src/db/fixtures/fundedflow-v8-legacy-rules.db` and
`src/db/legacy_rulebook_tests.rs`. The tests pin the fixture's contents, check that this build opens it
unchanged, and check that the derived values below (assignment intervals, rule keys, parameter keys) can be
computed from the legacy rows alone.

## What exists today

- The legacy tables are **reserved**: no command or store code reads or writes them, in any release so far.
  So a user's journal can hold legacy rulebook rows only if they were written outside the app. The
  conversion is still required, must be lossless, and is exercised by the fixture. It should expect few or
  no rows, and must not assume none.
- `account_snapshots.rulebook_version_id` references legacy versions (`ON DELETE CASCADE`). Snapshots are
  reserved too.
- Catalogue phases and paths (migration 6) hold `default_rulebook_version_id` / `rulebook_version_id` with no
  foreign key. They are never filled from legacy rows: legacy rulebooks have no catalogue identity.

## Decisions for Build 9.5

1. **Table names.** Build 9.5's planned `rulebook_versions` collides with the legacy table. Build 9.5's
   migration renames the legacy tables to `legacy_account_rulebook_versions` and `legacy_account_rules`
   (`ALTER TABLE … RENAME`, which also rewrites the snapshot foreign key) before creating the new tables.
   The legacy rows are kept, read-only, as the audit trail of the conversion. Shipped migrations are never
   edited.
2. **Account-private rulebooks.** A legacy rulebook was authored by the user for one account. It becomes an
   account-private rulebook: `rulebooks.owner_account_id` is set and `provider_id` is the account's
   `provider_id` (or NULL). It is never listed as a provider catalogue rulebook and never offered to other
   accounts.
3. **No promotion to verified.** Legacy `verified_at` means "the user confirmed this matches the firm". It
   maps to `user_confirmed_at`, never to the catalogue's `verified_at`/`verified_by`. Converted versions take
   `verification_status = 'needs_review'` (active or retired) or `'draft'`. They stay assignable because they
   are account-private and user-authored (`authority = 'user_authored'`). A provider-verified rulebook can
   replace them only through an explicit new assignment.
4. **Stable IDs.** A converted version **keeps its legacy ID**. Snapshots, audit events and exports that hold
   a legacy version ID therefore still resolve, without rewriting them. Rule IDs are kept the same way.
5. **Money stays in micro-units.** Legacy params already store `*_micros` integers, like the rest of the
   schema. The `amountMinor` in the Build 9.5 card's sample is superseded: rulebook DTOs carry decimal
   strings and storage carries `*_micros`, with no rescaling and no floats.
6. **Forward-only.** Back up before the conversion (`open_file` already does this before any upgrade). Run
   it in one migration transaction. It must be idempotent: a version already converted, matched by ID, is
   skipped.

## Rulebook versions

One target rulebook per account that has legacy versions. Each legacy version becomes one target version
and, if it was ever active, one assignment.

| Legacy `rulebook_versions` field | Target | Mapping / backfill | Evidence |
|---|---|---|---|
| (per account) | `rulebooks` | One per `account_id`: `owner_account_id = account_id`, `provider_id = accounts.provider_id`, `slug = 'account-' ‖ account id`, `display_name = accounts.name ‖ ' rules'`, `record_status = 'active'` (`'archived'` if the account is archived) | fixture: 3 accounts with versions, 1 archived |
| `id` | `rulebook_versions.id` | Same value (decision 4) | `snap-*` rows resolve |
| `account_id` | `rulebook_versions.rulebook_id` and `account_rulebook_assignments.account_id` | Through the account's rulebook | |
| `version_number` | `rulebook_versions.version_number` | Same value; unique per rulebook as it was per account | |
| `status = 'draft'` | `verification_status = 'draft'` | Not assigned | Eval v3 |
| `status = 'active'` | `verification_status = 'needs_review'` + an open assignment | Assignment `effective_to` NULL unless a later version exists | Eval v2, Funded v1 |
| `status = 'retired'` | `verification_status = 'needs_review'` + a closed assignment | Interval below | Eval v1 |
| `effective_from` (trading day) | `account_rulebook_assignments.effective_from` | Same trading day | |
| (derived) | `account_rulebook_assignments.effective_to` | Next active-or-retired, non-deleted version of the account by `effective_from` (query below); half-open | `assignment_intervals_…` test |
| `source = 'manual' / 'template' / 'copied'` | `rulebook_versions.origin` and `assignment_source` | `'legacy_manual'` / `'legacy_template'` / `'legacy_copied'` | all three present |
| `source_reference` | `rule_sources` (one per version) | `source_type = 'manual_descriptor'`, `descriptor = source_reference`, `captured_at = created_at`, verification `'candidate'`; linked to every rule of the version as an unreviewed claim | 3 versions |
| `verified_at` | `rulebook_versions.user_confirmed_at` | Same instant; **not** `verified_at` (decision 3) | 2 versions |
| `activated_at` | `account_rulebook_assignments.assigned_at` | Same instant | |
| `notes_md` | `rulebook_versions.change_reason` | Same text | |
| `created_at` / `updated_at` | same | Copied | |
| `deleted_at` (only drafts can carry it) | `rulebook_versions.record_status = 'archived'` | Kept, never assigned | Eval v4 |

Assignment intervals, as tested:

```sql
SELECT v.id, v.account_id, v.effective_from AS effective_from,
       LEAD(v.effective_from) OVER (PARTITION BY v.account_id ORDER BY v.effective_from, v.version_number)
           AS effective_to
FROM rulebook_versions v
WHERE v.status IN ('active', 'retired') AND v.deleted_at IS NULL
```

Equal `effective_from` values cannot both be active (a unique index prevents it). A retired and an active
version sharing a day give the earlier version number an empty interval. That is kept as history, not
dropped.

## Rules

| Legacy `rules` field | Target `rule_definitions` | Mapping |
|---|---|---|
| `id` | `id` | Same value |
| `rulebook_version_id` | `rulebook_version_id` | Same value (the version keeps its ID) |
| `rule_type` | `rule_type` | Same identifier; `max_drawdown.mode` values are renamed (below) |
| (derived) | `rule_key` | `rule_type`; plus `':personal'` for a personal one-per-type rule; `manual_check` and `max_position_size` use `rule_type:origin:sort_order` (query in the tests) |
| `origin = 'firm'` | rule of the version | `override_kind = NULL` |
| `origin = 'personal'` | rule of the version, marked as the user's own limit | `override_kind = 'personal_limit'`; never a provider claim |
| `evaluation = 'manual_confirmation'` | `support_status = 'manual_only'` | Never treated as compliant |
| `evaluation = 'calculated'`, `value_state = 'known'` | `support_status = 'supported'`, `presence = 'known'` | |
| `value_state = 'unknown'` | `presence = 'unknown'`, `support_status = 'needs_setup'` | Params are `{}`; stays indeterminate, never zero |
| `params_json` | `parameters_json` | Per-type mapping below, validated by the Build 9.5 Zod schema; `parameter_schema_version = 1` |
| `label` | `display_label` | The user's label; **not** `provider_label` (a provider label needs a source) |
| `sort_order` | `display_order` | Same value |
| `created_at` / `updated_at` | same | Copied |

### Rule parameters

Every legacy key, and nothing else, appears in the fixture (`legacy_parameters_use_only_the_keys_the_matrix_maps`).

| `rule_type` | Legacy params | Target parameters |
|---|---|---|
| `profit_target` | `amount_micros` | `{ kind: "amount", amount }` (decimal string from micros) |
| `daily_loss_limit` | `amount_micros`, `basis` (`realized` / `realized_and_unrealized`) | `{ amount, includesUnrealized: basis = 'realized_and_unrealized', resetBasis: "account_trading_day" }` |
| `max_drawdown` | `mode` (`static` / `eod_trailing` / `intraday_trailing`), `amount_micros`, `includes_unrealized`, `lock` (`{trigger_balance_micros, locked_floor_micros}` or null) | `{ method: "static" / "end_of_day_trailing" / "intraday_trailing", amount, includesUnrealized, lock: { triggerBalance, lockedFloor } / null }` |
| `min_trading_days` | `days`, `min_day_profit_micros` (or null) | `qualifying_profit_days`-compatible `{ days, minDayProfit / null }` |
| `consistency` | `max_best_day_share_bps` | `{ maxBestDayShare: bps / 10000 as decimal string }` (3000 → `"0.3"`) |
| `max_position_size` | `max_contracts`, `symbol_root` (or null) | `{ capacity: [{ contractClass: symbol_root / "any", max: max_contracts }] }`; several legacy rows of one version stay separate rules and are **not** merged into an "either/or" capacity |
| `max_trades_per_day` | `count` | `{ count }` |
| `manual_check` | `description` | `{ description }` |

## Related legacy fields (Build 9, already mapped)

| Legacy | Target | Status |
|---|---|---|
| `firms` | `providers` (`legacy_firm_id`) | Migration 7 |
| `programmes` | `programme_families` (`legacy_programme_id`) | Migration 7 |
| `accounts.firm_id` | `accounts.provider_id` | Migration 7 |
| `accounts.account_type` | Compatibility metadata; the phase comes from `account_phase_events` | Documented (data-model.md) |
| `accounts.status`, `account_status_events` | Unchanged; record status is not a phase | Documented |
| `accounts.parent_account_id` | Unchanged successor link; each account keeps its own assignment | Fixture: Funded 50K → Eval 50K |
| `account_snapshots.rulebook_version_id` | Unchanged value; resolves to the converted version (decision 4) | Fixture: 3 pinned, 1 NULL |

## Deletion

- Archiving an account archives its private rulebook and leaves assignments and snapshots untouched.
- Hard-deleting an account (not yet a command; Build 24) still cascades its private rulebook, as the legacy
  table does today. Catalogue rulebooks are never deleted with an account.
