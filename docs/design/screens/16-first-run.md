# 16 First run: privacy notice and agreement

Card: [NA-3 — First-run privacy notice and agreement](https://app.notion.com/p/4001bd4b6bde814f90d6e115cc89c169)
(Final Push P0-12 and the engineering half of P0-13). Code: `apps/desktop/src/features/legal`, documents in
`apps/desktop/src/legal`, native record in `apps/desktop/src-tauri/src/legal.rs`.

> **The documents are DRAFT placeholders (version `0.1.0-draft`).** They are written only from verified facts about
> V1 and have not been reviewed by counsel. They block distribution until the owner records counsel sign-off (P0-13).

## When it shows

Before any app content, whenever this install has no acceptance record that covers every current document at its
current version and digest: on first launch, and on the first launch after any document changes. It replaces the
whole window (no sidebar, header or routes), built from the design system's `GatePage`.

## Layout

`GatePage` (one column, max 720 px, 16 px gutters, so it fits an 800 px window):

1. Brand logo, then the `h1`: "Before you start", or "The privacy notice or agreement has changed" with a line naming
   the documents that changed.
2. While any document is a draft: a warning `InlineNotice` "Draft documents" saying so.
3. `h2` **Your privacy**: the plain-language summary (local only; no account, telemetry or internet connection; export,
   restore and delete in Settings).
4. `h2` **Documents**: one `Disclosure` per document ("Read the privacy notice", "Read the user agreement"; screen
   readers also hear "(draft, version …)"), each opening a `DocumentView` (`h3` title, Draft badge, version and date,
   `h4` sections).
5. "Accept to continue. Decline closes FundedFlow; no trading data is created."
6. Actions, kept in view at the bottom of the card: **Decline and close** (secondary), **Accept and continue** (primary).

Focus moves to the `h1` on load; Tab order is the expanders, Decline, Accept.

## Behaviour

| Event | Result |
|---|---|
| First launch | Screen shows. The journal still opens in the background (that is not trading data), but nothing reads it. |
| Accept | `record_legal_acceptance` writes `{ documents: [{ id, version, digest }], acceptedAt }`; the app opens. |
| Accept, record can't be saved | The app opens for this session; an error toast says FundedFlow will ask again. Settings shows "This session only". |
| Decline | The window closes (`core:window:allow-close`, the only permission added), which ends the app. Nothing is written. If closing fails, an error notice asks the user to close the window. |
| A document's version or digest changes | Screen shows again on the next launch, naming the changed documents. |
| Journal fails to open | Screen still works; after Accept the shell's recovery notice shows as before. |
| Journal erased, or restored from another install's archive | No change: the record isn't journal data. |
| Reinstall that keeps the app-data folder | Same record, so no prompt for the same versions. Uninstalling with "delete app data" removes it, and the screen shows again. |
| Missing, unreadable or malformed record | Treated as not accepted: the screen shows. Never an error. |

## Storage choice

The record is a per-install file, `legal-acceptance.json`, in Tauri's app config directory
(`%APPDATA%\com.fundedflow.desktop\` on Windows: the same folder as the journal, but a separate file). Developer test
journals (`npm run dev:test-journal`) keep their own record in the test journal's folder.

- Acceptance belongs to the install, not the journal (the card's recommendation): erasing or restoring a journal
  doesn't ask again, and an archive from another install doesn't carry someone else's acceptance.
- The screen never depends on the journal: it is read before the first render (`main.tsx`) and sits outside
  `RuntimeGate`, so a journal that is slow or failing to open can't trap the user here.
- The data controls never touch it (they reset only `featureKeys.root` and journal files).

The alternative, the journal `settings` table, would have needed the journal open before the screen could decide
anything, and would have prompted again after every erase or restore.

## Documents

`apps/desktop/src/legal/index.ts` exports `CURRENT_LEGAL_DOCUMENTS`, the one place final text swaps in. Each document
has `id`, `version`, `effectiveDate`, `draft` and `digest` (SHA-256 of `documentText(doc)`); `legal.test.ts` fails
with the new digest when the text changes. To ship final text: replace the sections, set `draft: false`, bump
`version`, update `effectiveDate`, and paste the digest the test prints.
