# Build 18.5 — Desktop UI/UX fixes: evidence

Source: [Build 18.5 card](https://app.notion.com/p/4001bd4b6bde813ba2d3fbc6b83eb0c5). Branch
`feat/build-18-5-desktop-ux-fixes`, from `main` at `fa6aca8`, with `main` at `2a65c18` (Build 18 exact import
attempts, #52) merged in. **Not Done:** a person must still drag a CSV from Explorer into the packaged app and the
product owner must sign off the UX (see "Outstanding").

## What changed

| Workstream | Change |
|---|---|
| A. CSV drop | `FileDropzone` reacts only to file drags, accepts with `dropEffect = copy`, highlights while over and clears on leave, drop elsewhere, `dragend` or when `dragover` stops (a cancelled OS drag sends no `dragleave` in WebView2). Several files are refused with a message instead of silently keeping the first. A chosen file has "Choose another…" (picker) and Remove; the same file can be chosen again. `useWindowFileDropGuard` stops a stray drop opening the file. One read path (`useCsvFileChoice`) for drop and Browse: newest pick wins, a new file drops the old preview, mapping, date order, confirmation and any check in flight. |
| B. Quick import | `/import/quick` from the header Import CSV menu, Accounts "Import trades" menu, each card's menu and the wizard head. Exact attempt + one CSV → automatic read-only Rust preview (auto format, auto dates, account zone) → compact summary with View all rows → explicit "Confirm import of n trades" via the wizard's commit hook and the preview's `targetAcknowledgement`. File issues or a generic CSV → "Continue in full wizard" with attempt, file and zone kept in memory and no confirmation carried. Full wizard unchanged apart from the shared file path and a "Quick import" link. |
| C. Sidebar toggle | 32 px round toggle centred on the sidebar's right border beside the logo in both widths (`AppFrame` `sidebarEdge`, outside the scroll area, first in tab order), tooltip and `aria-label` "Collapse sidebar"/"Expand sidebar", `aria-expanded`, `aria-keyshortcuts`, 44 px hit area. Persistence, Ctrl+B and narrow-window rail unchanged. |
| D. Spacing | Accounts: KPI row and footnote touched the list (no gap inside `StateBoundary`); cards had no search/filter; card footers didn't align. Import: two file-size wordings ("225 B" vs "0.2 KB"); awkward single-trade copy; "Date order: Not needed" for an ambiguous file. Drop zone: long names wrapped mid-word (now ellipsis + full name in title). Sidebar: toggle floated under the logo, collapsed mark crowded by the toggle. |
| E. Account cards | `AccountOverviewCard` (design system) + `OverviewCard`/`overviewModel` (feature). Mapping table in [02-accounts.md](design/screens/02-accounts.md#build-185-account-overview-cards). |

## Acceptance criteria

| Criterion | Status | Evidence |
|---|---|---|
| Drop CSV works on packaged Windows Tauri, Browse fallback, same canonical preview | **Partly verified** | Release build (isolated identifier `com.fundedflow.desktop.qa`), drags injected through WebView2's DevTools input pipeline (`Input.dispatchDragEvent` with real file paths): drop → Rust preview → import; repeated drop → duplicates; two files, `.txt`, empty file → messages; cancelled drag clears; stray drop doesn't navigate; Unicode name kept. Browse/drop request parity: `quick-import.test.tsx`. **Not verified: a physical Explorer → window drag (OS OLE path that `dragDropEnabled: false` governs).** |
| Quick Import and Full Wizard both work; preview never writes; ambiguous files hand off; uncertain commits never re-run | Verified (automated + native) | `quick-import.test.tsx` (15), `import-wizard.test.tsx`; native: Quick import committed with the preview token; ambiguous dates → wizard with file kept. |
| Sidebar toggle anchored on the edge beside the logo, both states, no clipping, accessible | Verified (native, emulated sizes) | Toggle centre 247 px vs border 248 px (expanded), 71 vs 72 (collapsed), level with the mark, never over it, at 760/800/1024/1280 px and 1.25/1.5 device scale; keyboard Enter toggles, focus ring visible, preference persisted. `AppShell.test.tsx`. |
| Spacing audit with before/after | Verified for targeted pages | Before = unmodified `main` release build, after = this branch, same synthetic data. No horizontal page overflow and no clipped badges/values/buttons on Quick import and Accounts cards at any size above. |
| Account cards show identity, activity, conditional rules with sources and Unknown/N/A distinctions; View Details opens that attempt | Verified | `overview-model.test.ts` (nine card examples), `overview-cards.test.tsx` (real engine snapshot through the page), native cards with a current estimate, a not-current estimate, checkpoints, failed + reset attempts sharing a number, archived, personal. |
| Tests cover drop/reselect/quick-to-wizard/confirmation, switching, conditional rules, unknown/stale, archive/reset, overflow, keyboard | Verified | See results. Overflow is measured natively, not in jsdom. |
| PO receives before/after, walkthrough, files, tests, known issues; not Done on browser screenshots | Provided in the PR | — |

## Check results (merged head)

- `npm run typecheck`: pass. `npm test`: domain 496/496, desktop 620/620 (49 files).
- `npm run build`, `npm run check`: pass (the existing chunk-size warning remains).
- `cargo test`: 303 passed, 2 ignored. `cargo clippy --all-targets -- -D warnings`: clean. Before merging `main`, one
  test (`schema18_archive_restores…`) failed at the branch base; `main`'s #52 fixed it.
- Prop-firm collector (Python): not run; nothing under `tools/prop-firm-collector` changed.

## Outstanding

- **Physical drag from Explorer** into the packaged app (100%, 125%, 150% Windows display scaling). Device scale was
  emulated in WebView2, not set in Windows; changing display settings was out of bounds for this session.
- **Light theme in the app:** the app root is fixed to `data-theme="dark"` (V1 ships dark). Light was checked by
  switching the root to the design system's light tokens.
- **Product-owner UX signoff.**

## Dependencies and gaps (new Triage candidates)

- No stored, validated per-account import preferences (mapping, date order). Quick import uses Rust detection and
  the account's zone only; generic CSVs always go to the wizard.
- Each card reads its attempt's canonical risk inputs (`get_account_risk_inputs`); an account summary command would
  scale better beyond tens of accounts.
- The Accounts "Current balance" KPI still says "Needs balance checkpoints" when checkpoints exist; it predates
  Build 15.5 and was left as is (cross-currency totals are not defined).
- The status filter scrolls inside its pill below ~900 px (existing `SegmentedControl` behaviour).
