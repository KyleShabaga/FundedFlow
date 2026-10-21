# Comparison-publisher adapters (Build 29.25)

A **comparison publisher** is a third-party directory site that lists prop firms and their programmes. It is never
a prop firm and never a first-party rule source. The collector keeps publishers in their own registry
(`directory_publishers`), fetches their pages through the same Build 29 pipeline as firm sites, and turns stored
page versions into **unverified, field-level observations** with full provenance.

This page is for whoever maintains the adapters. Operators should start with the user guide (section 15).

## Source-by-source matrix

Policy reviewed on **2026-10-21** from public pages only (robots.txt, the terms page, the visible page). This is
information for the operator, not a permission: each operator reads the current terms and records their own decision.

| Publisher | Preset key | Adapter | robots.txt (2026-10-21) | Terms (2026-10-21) | Preset mode | Automated fetch today | Synthetic fixtures | Live-site check |
|---|---|---|---|---|---|---|---|---|
| OnlyPropFirms | `onlypropfirms` | `onlypropfirms` 1.0.0 | one `*` group, disallows `/wp-admin/` only | combined privacy/terms page; silent on automated access and reuse | `auto`, **disabled** | only after the operator records a review (suggested: `unclear`, with acknowledgement and the slow 5 s pace) or obtains permission | comparison (2 pages), cost to funding, starting costs, JS shell, 4 profiles, layout drift | not run: selectors written from the public page structure; never fetched by this build |
| Trader's Second Brain | `traderssecondbrain` | `traderssecondbrain` 1.0.0 | allows `/`; disallows `/api/` and `/go/` | forbids abusive automation and scraping protected areas; reuse of research presentation restricted; silent on reading public pages | `auto`, **disabled** | as above; asking permission is recommended | directory (2 pages, empty page 2), 3 programme pages (one missing its section), rule guide | not run |
| Prop Firm Match (Futures) | `propfirmmatch-futures` | `propfirmmatch-futures` 1.0.0 | allows most; disallows `sort=`, `extendedFilters=`, `/_next/data/`, `/api/surveys`, `/decide/`, profile discussions | **not readable automatically**: `/futures` and the terms page answered HTTP 403 to an automated request | `manual_only` (cannot be enabled) | **no**: manual capture only | challenge-table capture (phases, steps, sizes), redesigned-table capture | not applicable (manual) |
| Prop Firm Gorilla | `propfirmgorilla` | `propfirmgorilla` 1.0.0 | allows `/`; disallows `/admin/` and `/api/` | section 8 forbids unauthorised reproduction or distribution; silent on automated access | `auto`, **disabled** | as for OnlyPropFirms; static lists are empty (built in the browser), so expect `js_unavailable` without the `[browser]` extra | empty static list, JS-rendered list (browser test), rendered-list capture, 2 firm pages with evaluation and funded rules | not run |

"Not run" is deliberate: CI and the tests never touch the network, and this build made no automated request to
these sites beyond the one-off policy review above. The first live run is an operator decision after their own
terms review, with `--dry-run` first.

## What an adapter does (and never does)

An adapter (`src/fundedflow_collector/directory/adapters/`) is a small class with three jobs:

1. **Scope.** `page_rules` map URL paths to a page kind (`listing`, `comparison`, `profile`, `rules_guide`). Any
   other URL is out of scope. A query string is refused unless it is exactly the pagination parameter
   (`?page=N`, 2 to `max_pagination_pages`), so sort and filter permutations are never generated or followed.
2. **Following.** `follows` says which page kinds may be followed from which (for example listing to profile).
   Links are only ever on the publisher's own authorised host. Links to firms' sites, affiliate redirects
   (`/go/`, `/out/`, `/recommends/`, `/visit/`) and tracking URLs are never followed.
3. **Reading.** `read_page` turns stored HTML into records: a firm, programme, variant, account size, phase and
   market as displayed, plus field values as displayed. Values are read by `values.py`, which never invents a unit,
   a currency or a phase.

An adapter never makes a request, never sends cookies or logs in, never reverse-engineers private APIs or reads
`/_next/data/` or unlicensed data files, and never solves a challenge. The runner does all network work under the
Build 29 rules: authorised hosts, terms gate, robots.txt, pacing, circuit breaker, budget, deadline, redirect
checks and the optional allowlisted browser. A publisher's `allowed_paths` and `excluded_paths` narrow the scope
further; nothing in the registry or the GUI can widen what Build 29 allows.

## Reading tables without shifting columns

Tables are read by their **visible header text** (`tables.py`), not CSS classes:

* A wide table is identified by a `signature` (header labels it must contain). Every header must be known to the
  adapter: an unknown column, a missing required column, or a row whose cell count differs from the header count
  makes the page `structure_changed` and **no values are read from it**. Columns are never guessed or shifted.
* `rowspan` and `colspan` are expanded, so a firm name spanning several size rows is carried down correctly.
* Columns that are not rules are declared and ignored with a reason, and the page warnings say so:
  ratings, rankings, fit scores (`EDITORIAL`), offers, coupons and checkout buttons (`COMMERCIAL`) and the
  publisher's own calculations such as "true cost" (`DERIVED`).
* Key-value tables (label | value) and `<dl>` lists cannot shift, so an unknown label is skipped and listed in the
  page warnings rather than failing the page.
* An empty list is `no_records` only when the page says so (`empty_markers`). An app shell with no data
  (template placeholders, an empty `#__next` root, a "needs JavaScript" notice) is `js_unavailable`. Anything else
  missing is `structure_changed`.

## Adding another permitted publisher

1. **Policy first.** Read robots.txt and the terms; look for a public data licence or API. If automated access is
   prohibited or the site blocks automated clients, stop: use `--manual-only` and manual capture. Record the review
   in the publisher's notes or in a preset's `policy_review`.
2. **Without an adapter:** `collector directory add KEY --name ... --homepage ... --adapter generic`. Pages are kept
   as snapshots only; nothing is read into values and no links are followed.
3. **Writing an adapter:**
   * Copy the closest adapter. Set `name`, `version = "1.0.0"`, `description`, `page_rules`, `follows` and, if the
     site's URLs say so, `market_by_path`.
   * Declare each table with `spec({...}, signature=[...], required=[...])`, mapping **every** visible header to
     `D(role)`, `F(field)` or an ignore constant. Fields are listed in `model.FIELDS`; adding a new field means
     adding it there and to the `field` enum in `docs/contracts/collector-directory-observations-v1.schema.json`
     (a schema change: see below).
   * Register it in `adapters/__init__.py`, and add a preset in `presets.py` only if it is one of the
     sanctioned sources (presets install disabled).
   * Add synthetic fixture pages under `examples/directory-site/<host>/` (or `examples/captures/directory/` for a
     manual-only site). Every page starts with the `SYNTHETIC FIXTURE` banner and uses invented firms; never
     commit real third-party pages or datasets. Cover: multiple sizes, evaluation vs funded rows, an empty page,
     a JS shell, pagination and a changed layout.
   * Add tests in `tests/directory/test_adapters.py` and, if collection behaviour differs, in `test_pipeline.py`.

## When a site changes its layout

The adapter fails closed, so a redesign shows up as **"Page structure changed"** on the Research sources tab and
as `structure_changed: <url> (<detail>)` in the run summary, e.g. `table 0: unexpected column 'Platform'`.
Earlier values stay in the database as history; nothing is overwritten.

1. Save the page from your browser and import it as a manual capture, so you have the new layout locally.
2. Compare the headers in the detail message with the adapter's `spec`. If a column was renamed or added and
   carries the same meaning, map it; if its meaning is unclear, map it to an ignore constant with a reason.
3. Bump the adapter `version` (minor for new columns, major if the meaning of an existing column changed). A page
   version is read once per adapter version, so after a bump the next fetch that downloads the page (use `--force`,
   because an unchanged page otherwise answers 304 with no body) or the next capture reads it again; older readings
   remain as history.
4. Add the new layout as a synthetic fixture and a test, then run the checks in the README.

Never "fix" drift by reading cells by position, by loosening the signature to match anything, or by fetching a
different, unpublished endpoint.

## Identities, duplicates and conflicts

* Firm names are normalised only for case, accents, punctuation, `&`/`and` and a trailing legal suffix
  ("LLC", "Ltd"). Distinguishing words stay. Similar but different names ("Contoso" vs "Contoso Funding") become an
  **uncertain identity** review item; they are never merged automatically.
* A record is one publisher's view of one firm, programme, variant, account size, currency and phase. A size shown
  as `50K` (no currency) and `$50K` are different records: the currency is not assumed.
* A firm name is linked to a registered firm only by exact normalised name (shown as `exact_name`) or by an
  operator mapping (`collector directory review map`).
* **Duplicates**: one publisher showing the same value for the same record on two pages (a list and a profile).
* **Conflicts**: current values for the same firm, programme, variant, size, currency, phase and field that differ,
  across publishers or between two pages of one publisher. "Trailing" vs "trailing, end of day" is treated as less
  specific, not as a conflict. Ranges, bare numbers and amounts without a currency are `uncertain` and never take
  part in conflict detection.

### How an operator resolves a conflict

The collector never picks a winner. To resolve one:

1. Open the value on the Evidence tab (or `collector directory show-observation ID`). It shows each publisher's
   dated claim, the page, the snapshot hash and the history.
2. Read the firm's **own** rules page. If it is stored as a Build 29 snapshot, the Evidence tab shows dated
   excerpts from it next to the claim.
3. Record what you found: `review note --item KEY --note ...` (and `--dismiss` to take it off the queue), or, after
   checking the firm's stored page, `review verify --observation ID --official-snapshot SNAP --note ...`. A
   verification must point at a snapshot of the firm's own site; agreement between publishers is not verification.
4. Approving rules is a separate step (Build 31/32). Nothing here edits a rulebook or the FundedFlow app.

## Export contract

`collector directory export` writes `collector-directory-observations-v1`
(`docs/contracts/collector-directory-observations-v1.schema.json`), validated before it is saved. It is separate
from `collector-snapshot-v1`, which is unchanged and never contains publisher data. Build 31 does not consume the
directory format; mapping it is a separate, tested hand-off. A change to the schema needs a new version (v2) and a
regenerated fixture (`FFC_UPDATE_FIXTURES=1 uv run pytest tests/contract`), reviewed like any contract change.
