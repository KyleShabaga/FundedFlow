import type { LegalDocument } from "./document";

// DRAFT placeholder (NA-3). Not the user agreement: the final terms come from counsel (P0-13) and replace
// this text. Change it, bump `version`, and update `digest` from the value `legal.test.ts` prints.
export const userAgreement: LegalDocument = {
  id: "user-agreement",
  title: "User agreement (draft)",
  version: "0.1.0-draft",
  effectiveDate: "2026-10-21",
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
        "FundedFlow is proprietary software. Copyright (c) 2026 Kyle Shabaga. All rights reserved. The licence summary is in Settings, under Privacy & legal.",
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
  digest: "d3d42532fc413f21162cd5696be91ebafac51b3f4e3285f03826fe5163c2dec6",
};
