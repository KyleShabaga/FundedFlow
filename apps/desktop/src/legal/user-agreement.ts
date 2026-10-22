import type { LegalDocument } from "./document";

// DRAFT placeholder (NA-3). Not the user agreement: the final terms come from counsel (P0-13) and replace
// this text. Change it, bump `version`, and update `digest` from the value `legal.test.ts` prints.
export const userAgreement: LegalDocument = {
  id: "user-agreement",
  title: "User agreement (draft)",
  version: "0.1.1-draft",
  effectiveDate: "2026-10-22",
  draft: true,
  summary: "A placeholder for the user agreement, which is still being prepared. FundedFlow records your trades; it doesn't give financial advice.",
  sections: [
    {
      heading: "About this draft",
      paragraphs: [
        "This is a draft placeholder for the FundedFlow user agreement. The final terms are still being prepared and have not been reviewed by a lawyer. When they are ready they will replace this text, and FundedFlow will ask you to accept them.",
      ],
    },
    {
      heading: "Licence",
      paragraphs: [
        "FundedFlow is open source under the MIT License. Copyright (c) 2026 Kyle Shabaga. The full MIT License, including its permissions, notice requirement and warranty and liability provisions, is available in Settings, under Privacy & legal, and in the installed LICENSE file. This draft does not add restrictions to the permissions granted by the MIT License. Third-party components retain their own licences and notices.",
      ],
    },
    {
      heading: "Not financial advice (placeholder)",
      paragraphs: [
        "FundedFlow records and summarises the trades and rules you enter. It does not give financial, investment or trading advice, and its figures, rule meters and insights are not recommendations.",
      ],
    },
    {
      heading: "Risk notice (placeholder)",
      paragraphs: [
        "Trading carries a risk of loss. Check figures against your broker's and prop firm's own statements; a journal can be incomplete or out of date.",
      ],
    },
  ],
  digest: "77da15c530c2f0da74b7b1920b1659d6c1427633d7eccd9d141caba59c7de530",
};
