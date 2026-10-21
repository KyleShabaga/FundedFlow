# P0 screen designs (Build 25.1)

Design source for the five P0 screen families that had no mockup: account rulebook, daily review, Settings and its
data controls, account detail, and Quick import with import history. Tracked on the Notion card
[P0 Design Reconciliation](https://app.notion.com/p/4001bd4b6bde814c8d02c13b11222728).

- **Live canvas:** "FundedFlow P0 Screens" on claude.ai (link in the pull request). Pages: Start here, one page per
  family, and Shared shell and patterns. Interactive boards have a dashed **Mockup state** bar to switch between
  states; that bar is review furniture, not product UI.
- **Static previews:** [`previews/`](previews/), one PNG per board in its default state plus `Board--state.png` for
  the important alternate states. These were rendered with the canvas runtime in headless Chromium at each board's
  frame width (1440 px pages, 1600 px state boards, 720 px narrow windows).
- **Source:** the `*.dc.html` files here are the canvas files, unchanged. They render only inside the design canvas:
  they load its runtime (`support.js`) and `../ff-app.css` (the shared mockup stylesheet; the canvas holds an
  identical copy at its root). `ff-p0.css` adds the P0 patterns. `canvas.json` is the canvas index (board sizes,
  pages, notes).

Every amount, count, name and time is an illustrative example. Unknown values are drawn as `—` or "Unknown",
never `$0.00` or Safe. Read the boards for structure, states and copy; never copy their markup or CSS into the
app: every pattern maps to a design-system component (see each spec's "P0 design" section and
[`../../p0-design-reconciliation.md`](../../p0-design-reconciliation.md)).

| Family | Boards | Spec |
|---|---|---|
| 1 Rulebook | `RulebookOverview`, `RulebookEditor`, `RulebookCompare`, `RulebookExplain`, `RulebookDialogs`, `NarrowRulebook` | [13](../../screens/13-rulebook.md#p0-design-build-251) |
| 2 Daily review | `DailyReview`, `DailyReviewStates`, `NarrowDailyReview` | [14](../../screens/14-daily-review.md#p0-design-build-251) |
| 3 Settings | `Settings`, `SettingsRestore`, `SettingsDelete`, `NarrowSettings` | [15](../../screens/15-settings-data-controls.md#p0-design-build-251) |
| 4 Account detail | `AccountDetail`, `AccountDialogs`, `NarrowAccount` | [02](../../screens/02-accounts.md#p0-design-account-detail-build-251) |
| 5 Import | `QuickImport`, `ImportHistory`, `ImportDetail`, `ImportFailures`, `NarrowImport` | [06](../../screens/06-import.md#p0-design-quick-import-and-history-build-251) |
| Shared | `P0Sidebar`, `P0Header` (shell as built on main, Oct 21 2026), `Patterns`, `Main` (screen map) | [components](../../components.md#p0-design-patterns-build-251) |
