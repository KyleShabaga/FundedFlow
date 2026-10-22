# 16 First run: privacy notice and agreement

Card: [NA-3 — First-run privacy notice and agreement](https://app.notion.com/p/4001bd4b6bde814f90d6e115cc89c169)
(Final Push P0-12 and the engineering half of P0-13). Code: `apps/desktop/src/features/legal`, documents in
`apps/desktop/src/legal`, native record in `apps/desktop/src-tauri/src/legal.rs`.

> **The documents are complete editorial DRAFTS (version `0.2.0-draft`, dated 2026-10-22).** They are written only from verified facts about
> V1 and have not been reviewed by counsel. They block distribution until the owner records counsel sign-off (P0-13).

The MIT transition updates the license and the agreement’s license section (version `0.1.1-draft`, dated
2026-10-22). The privacy notice remains `0.1.0-draft`. The draft warning and release-review requirement
above remain in place; see [transition scope and remaining work](../../licensing-transition.md).

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

## Licence and third-party notices

Card: [Build 26.78 — Ship LICENSE and third-party notices](https://app.notion.com/p/4001bd4b6bde814ba508eec6d607e37d).
Settings only; the first-run screen doesn't show them (the installer has no licence page either). Settings →
Privacy & legal ends with a `Disclosure` **Licence and third-party notices**:

1. `h3` **Licence**: `LICENSE_SUMMARY` (copyright line and a plain-language paraphrase; the root `LICENSE` is the
   authority). The summary identifies MIT and its notice requirement. A nested **Read the MIT License** disclosure
   shows the complete root license with the existing preformatted DocumentView; the installer ships the same file.
2. `h3` **Third-party notices**: one sentence with the counts from `third-party-summary.json` ("FundedFlow includes N
   third-party components: R Rust crates, P npm packages and F fonts…") and where the installed file is.
3. A nested `Disclosure` **Read the third-party notices** (screen readers also hear "(N components)"). Its first open
   loads `THIRD_PARTY_NOTICES.txt` with a dynamic `?raw` import (its own chunk, so the main bundle doesn't grow) and
   shows `LoadingState`, then one `DocumentView` per part (`h3`: About this file, Rust crates, npm packages, Fonts,
   Licence texts) with an `h4` per component or licence text. `preformatted` keeps the licence texts' line breaks
   and wraps long lines, so an 800 px window has no sideways scroll. Text is never interpreted as markup. If the
   chunk fails to load, `ErrorState` says the same text is in the install folder and offers **Try again**.

The text comes from `npm run notices` (`scripts/third-party-notices.mjs`); `apps/desktop/src/legal/third-party.ts`
splits it into parts and sections by its underlined headings.

## Document revision 0.2.0-draft

The complete editorial drafts and revised summaries replace the original placeholders. See [verification and owner proposal](../../privacy-product-verification.md). P0-13 remains unchanged pending explicit owner decision. Versions and digests of both documents changed; existing installs must accept the current pair again. The UI still uses User agreement and Accept/Decline; a proposed acknowledgment flow is documented but not implemented. Draft status does not imply legal review or release approval.
