# 16 First run: privacy and product notices

Card: [NA-3 — First-run privacy and product notices](https://app.notion.com/p/4001bd4b6bde814f90d6e115cc89c169)
(Final Push P0-12 and the engineering half of P0-13). Code: `apps/desktop/src/features/legal`, documents in
`apps/desktop/src/legal`, native record in `apps/desktop/src-tauri/src/legal.rs`.

> **Both documents remain complete editorial drafts (`0.2.1-draft`, dated 2026-10-22).** Document content was approved by the owner on 2026-10-22; no lawyer review or release approval is recorded. On 2026-10-22 the owner explicitly adopted the revised P0-13 criteria and authorized notice acknowledgment wording. See [recorded decisions and release criteria](../../privacy-product-verification.md).

## When it shows

Before any app content, whenever this install has no acceptance record that covers every current document at its
current version and digest: on first launch, and on the first launch after any document changes. It replaces the
whole window (no sidebar, header or routes), built from the design system's `GatePage`.

## Layout

`GatePage` (one column, max 720 px, 16 px gutters, so it fits an 800 px window):

1. Brand logo, then the `h1`: "Before you start", or "The privacy or product notice has changed" with a line naming
   the documents that changed.
2. While any document is a draft: a warning `InlineNotice` "Draft documents" saying so.
3. `h2` **Your privacy**: the plain-language summary (local unencrypted journal; no app sign-in, telemetry or update checker; installer download and deletion limits).
4. `h2` **Documents**: one `Disclosure` per document ("Read the privacy notice", "Read the license and product information"; screen
   readers also hear "(draft, version …)"), each opening a `DocumentView` (`h3` title, Draft badge, version and date,
   `h4` sections).
5. "Acknowledge these notices to continue, or close FundedFlow. This records that the notices were displayed; your software permissions come from the MIT License."
6. Actions, kept in view at the bottom of the card: **Close** (secondary), **Acknowledge and continue** (primary).

Focus moves to the `h1` on load; Tab order is the expanders, Close, Acknowledge.

## Behaviour

| Event | Result |
|---|---|
| First launch | Screen shows. The journal still opens in the background (that is not trading data), but nothing reads it. |
| Acknowledge | `record_legal_acceptance` writes `{ documents: [{ id, version, digest }], acceptedAt }`; the app opens. |
| Acknowledge, record can't be saved | The app opens for this session; an error toast says FundedFlow will ask again. Settings shows "This session only". |
| Close | The window closes (`core:window:allow-close`, the only permission added), which ends the app. No acknowledgment is written. The background runtime may create or migrate a database independently. If closing fails, an error notice asks the user to close the window. |
| A document's version or digest changes | Screen shows again on the next launch, naming the changed documents. |
| Journal fails to open | Screen still works; after acknowledgment the shell's recovery notice shows as before. |
| Journal erased, or restored from another install's archive | No change: the record isn't journal data. |
| Reinstall that keeps the app-data folder | Same record, so no prompt for the same versions. Removing the record causes a new prompt; packaged uninstall behavior requires verification. |
| Missing, unreadable or malformed record | Treated as not acknowledged: the screen shows. Never an error. |

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

## Acknowledgment revision

The owner authorized this flow on 2026-10-22. Both documents are `0.2.1-draft`; versions and digests changed, so earlier acceptance/acknowledgment records prompt again. The stable `user-agreement` ID, `legal-acceptance.json`, native command names and `acceptedAt` field are retained for compatibility and now represent acknowledgment. No extra license condition is created. Settings labels these as acknowledged documents.
