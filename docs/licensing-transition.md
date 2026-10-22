# FundedFlow: transition to the MIT License

## Decision and scope

On 2026-10-22, Kyle Shabaga confirmed willingness to let others copy, modify and sell FundedFlow's code, then
authorized work on the MIT transition. This change replaces the custom proprietary license with the standard
[MIT License](../LICENSE). It does not declare earlier releases to have been MIT-licensed. The new license applies
to the original software and associated documentation distributed with it; recipients must retain the copyright
and permission notice in copies or substantial portions of the software.

Third-party dependencies, fonts, captured pages/PDFs and other externally authored content retain their own
terms. User journals, imported CSVs and screenshots are not licensed under MIT simply by being processed by
the app. Dependency allow-lists, collector source-permission checks and AGPL exclusions are unchanged.

## Initial transition implementation (historical)

- Root LICENSE contains the standard MIT text with Kyle's copyright. The collector carries an identical copy
  for its standalone Python distribution, declared through its package metadata.
- npm workspace manifests and lockfile entries, Rust metadata, Python metadata, source-entry headers and
  installer copyright wording identify MIT. Private/publish settings are unchanged.
- README, Settings and the generated third-party-notices introduction identify MIT. The Settings disclosure
  reads the root license directly, and the installer continues to ship LICENSE and THIRD_PARTY_NOTICES.txt.
- The user agreement's license section refers to MIT without adding use restrictions. Its version is
  `0.1.1-draft`, dated 2026-10-22, with a new digest. Existing acceptance records therefore require acceptance
  again. The privacy notice remains `0.1.0-draft`; acceptance storage and journal behavior are unchanged.
- CONTRIBUTING.md establishes MIT as the default license for intentional contributions and requires rights
  to submit them. Historical baseline descriptions remain marked as historical.
- Installer CI now also runs for changes limited to LICENSE or the shipped third-party notices.

## Ownership and dependency evidence

At the starting commit `92e79802593f97d907bdf8b403a088304e203676`, the repository identifies Kyle as copyright
holder. The fetched Git history records author names Kyle Shabaga and Claude. That is provenance evidence,
not independent verification of copyright ownership or every incorporated source. New third-party contributions
must be checked before inclusion; retained copyright notices must not be replaced with Kyle's.

The existing desktop notices inventory reports 232 Rust crates, 58 npm packages and three fonts. This transition
does not change dependency versions or broaden the accepted license list. The notices generator checks locked
production dependencies and retains their separate license texts. Its checks cover the desktop inventory,
not a legal audit of the Python collector, its downloaded content, or all development tooling.

## Privacy, product information and release status

The owner adopted revised P0-13 criteria on 2026-10-22: factual and packaged verification, passing relevant checks, explicit approval of document versions and release scope, recorded remaining risks, and optional independent review. This is policy approval, not lawyer review or release approval.

Both bundled documents are complete editorial drafts at `0.2.1-draft`, dated 2026-10-22. The owner authorized the title “License and product information” and acknowledgment flow. Stable document IDs, native command names and serialized `acceptedAt` remain for compatibility. Changes to versions and digests prompt existing installs again. See [verification and recorded owner decisions](privacy-product-verification.md) for storage/deletion evidence and remaining release checks. Content and release approval remain pending.

For a possible no-cost review, the University of Alberta's [Entrepreneurial Law Clinic](https://www.ualberta.ca/en/law/student-services/experiential-learning/entrepreneurial-law-clinic/index.html)
describes services for early-stage businesses in the greater Edmonton area that cannot afford legal services.
Eligibility, capacity and review scope need confirmation. A focused request can include LICENSE, README's
licensing section, the two bundled documents, the first-run specification and this note.

Reference license: [Open Source Initiative: MIT](https://opensource.org/license/mit).
