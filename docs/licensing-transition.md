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

## Implementation

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

## Privacy, product terms and release status

The bundled privacy notice and user agreement remain visibly marked drafts, with no claim of lawyer review.
MIT permission to use the software is distinct from the unfinished privacy/product documents. The existing
[first-run specification](design/screens/16-first-run.md) records counsel sign-off as a distribution gate. This
transition does not record that sign-off, waive the gate, approve distribution, or create a release.

Remaining work before a release decision:

1. Verify privacy wording against the packaged app and installer, including external downloads, logs, temporary
   files, migration/recovery copies, attachments and the precise limits of deletion. Resolve any open remediation
   affecting those claims before finalizing them.
2. Add the owner's chosen contact route. Explain that users should not attach private trading data to public
   GitHub issues. Review the separate handling of information voluntarily sent for support.
3. Finish the product information about calculation limits, broker/prop-firm verification and backups. Keep
   it consistent with MIT permissions and avoid claims that disclaimers eliminate all liability.
4. Seek an affordable/free review where available, or have the owner explicitly decide and record revised
   release criteria and remaining risk. Owner approval must not be described as counsel review. No such change
   to the existing gate is inferred from approving this license migration.
5. Replace finalized document text, versions, dates and digests together; update the draft-only test assertions
   when the document status is actually finalized, then verify first-run and Settings in the packaged build.

For a possible no-cost review, the University of Alberta's [Entrepreneurial Law Clinic](https://www.ualberta.ca/en/law/student-services/experiential-learning/entrepreneurial-law-clinic/index.html)
describes services for early-stage businesses in the greater Edmonton area that cannot afford legal services.
Eligibility, capacity and review scope need confirmation. A focused request can include LICENSE, README's
licensing section, the two bundled documents, the first-run specification and this note.

Reference license: [Open Source Initiative: MIT](https://opensource.org/license/mit).

## Completed document drafting follow-up (2026-10-22)

Both bundled documents are now complete editorial drafts at `0.2.0-draft`, dated 2026-10-22, with recomputed digests. Earlier version references above describe the initial MIT transition. See [verification and proposed owner decision](privacy-product-verification.md) for actual storage/deletion limits, evidence, acceptance assessment and a concrete proposed P0-13 revision. That proposal is unapproved; the original release gate remains effective. Acceptance mechanics remain unchanged and both changed documents prompt existing installs again.
