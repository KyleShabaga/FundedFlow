import type { LegalDocument } from "./document";

export const userAgreement: LegalDocument = {
  "id": "user-agreement",
  "title": "License and product information (draft)",
  "version": "0.2.1-draft",
  "effectiveDate": "2026-10-22",
  "draft": true,
  "summary": "MIT supplies the software permissions. This document explains record-keeping limits, trading risks and backup responsibilities without adding license restrictions.",
  "sections": [
    {
      "heading": "About this draft",
      "paragraphs": [
        "Prepared 2026-10-22. This complete draft remains unreviewed by a lawyer and pending owner approval of its content and release scope. It provides product information, not an additional commercial license. The app records acknowledgment that these notices were displayed; this does not replace or limit the MIT License."
      ]
    },
    {
      "heading": "Software permissions",
      "paragraphs": [
        "FundedFlow is copyright (c) 2026 Kyle Shabaga and distributed under the MIT License. That license is the source of permission to use, copy, modify, merge, publish, distribute, sublicense and sell copies, subject to retaining its copyright and permission notice in all copies or substantial portions of the software. Read the full license in Settings or the installed LICENSE file.",
        "This document adds no field-of-use, redistribution, commercial-use or other restriction to MIT permissions. Third-party software and fonts retain their own licenses and notices in THIRD_PARTY_NOTICES.txt and Settings. Your journals, imported records and screenshots do not become MIT-licensed merely by being processed here."
      ]
    },
    {
      "heading": "Purpose and calculation limits",
      "paragraphs": [
        "FundedFlow is a record-keeping and review tool. It does not execute trades or provide financial, investment, tax or trading advice. Figures, insights, warnings and rule meters are informational and do not recommend a trade or guarantee compliance or profitability.",
        "Results depend on the records, mappings, timestamps, time zones, fees, balances, rules and assumptions supplied. Missing, duplicate, stale or incorrectly imported data and software errors can change calculations. Supported rule models cannot represent every broker or prop-firm condition. Source snapshots can become outdated."
      ]
    },
    {
      "heading": "Trading risks and verification",
      "paragraphs": [
        "Trading can cause substantial financial loss, including losses beyond a planned amount. A journal, risk meter or apparent rule pass does not prevent losses, liquidation, account closure, failed evaluations or denial of payouts.",
        "Before relying on a result, compare it with your broker statements and the applicable prop-firm contract and current official rules, including fees, drawdown methods, timing and payout conditions. Resolve discrepancies with those sources. You remain responsible for your trading decisions and records. These are practical cautions, not additional conditions on MIT permission."
      ]
    },
    {
      "heading": "Backups and data handling",
      "paragraphs": [
        "Keep independent backups of important records and verify that you can restore them before replacing or erasing a journal. CSV is not a complete journal backup. Read the privacy notice for unencrypted storage, recovery copies and deletion limits. Protect exported files and redact information before seeking public support. No hosted account or maintainer recovery service holds a copy of your journal."
      ]
    },
    {
      "heading": "Warranty and liability",
      "paragraphs": [
        "The MIT License supplies the standard AS IS warranty disclaimer, including merchantability, fitness for a particular purpose and noninfringement, and its limitation of author and copyright-holder liability. Read that license for the exact provisions. No accuracy, uninterrupted operation, loss prevention or recovery guarantee is made here.",
        "These provisions operate only to the extent permitted by applicable law. This notice does not exclude mandatory rights or liabilities that cannot lawfully be excluded, and does not promise protection from all liability. No jurisdiction, paid service, refund scheme or additional dispute process is established by this document."
      ]
    }
  ],
  "digest": "96894603aff89db92b60b307f85693756d0e540f03851c2d39568a441c68911a"
};
