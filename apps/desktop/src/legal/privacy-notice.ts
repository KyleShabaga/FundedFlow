import type { LegalDocument } from "./document";

// DRAFT placeholder (NA-3). Written only from verified facts about FundedFlow V1; not reviewed by counsel.
// The final notice (P0-13) replaces this text: change it, bump `version`, and update `digest` from the
// value `legal.test.ts` prints.
export const privacyNotice: LegalDocument = {
  id: "privacy-notice",
  title: "Privacy notice (draft)",
  version: "0.1.0-draft",
  effectiveDate: "2026-10-21",
  draft: true,
  summary: "Your journal stays on this computer. FundedFlow has no account, sends no telemetry and makes no network connections, so nothing you enter is uploaded.",
  sections: [
    {
      heading: "About this draft",
      paragraphs: [
        "This is a draft placeholder. It describes how this version of FundedFlow handles your data, but it has not been reviewed by a lawyer and is not the final privacy notice. The final notice will replace it, and FundedFlow will ask you to accept it then.",
      ],
    },
    {
      heading: "What FundedFlow stores",
      paragraphs: [
        "The accounts, trades, imported CSV rows, journal entries, reviews, rulebooks, screenshots and settings you enter or import.",
        "They are saved in one journal file in your Windows user's app-data folder: %APPDATA%\\com.fundedflow.desktop\\fundedflow.db. Trade screenshots are saved as files in the attachments folder beside it. Your answer to this screen is saved in the same app-data folder, in legal-acceptance.json.",
      ],
    },
    {
      heading: "What leaves this computer",
      paragraphs: [
        "Nothing. FundedFlow has no account or sign-in, collects no analytics, telemetry or crash reports, has no AI features and makes no network connections.",
        "FundedFlow does not check for updates. You install new versions yourself.",
        "The installer may download Microsoft Edge WebView2 from Microsoft if this computer doesn't already have it. That download is made by the installer, not by FundedFlow.",
      ],
    },
    {
      heading: "Backups",
      paragraphs: [
        "Before FundedFlow upgrades your journal to a newer format, it saves a copy of the journal in the same folder. That copy is not a substitute for exporting a full backup.",
        "Full backups (.ffj.zip) and trade CSVs are saved only where you choose, when you choose.",
        "Your journal, the pre-upgrade copy and exported files are not encrypted. Anyone who can open these files can read your trades, notes and screenshots.",
      ],
    },
    {
      heading: "Exporting, restoring and deleting",
      paragraphs: [
        "In Settings you can export a full backup or a trade CSV, restore a full backup, permanently delete one trading account, or erase the entire journal.",
      ],
    },
    {
      heading: "Contact",
      paragraphs: [
        "Contact details will be added in the final notice.",
      ],
    },
  ],
  digest: "d0c0ac9a823b609c6ab637428e8ba416f97955d1674d64ebb82274e721377e0a",
};
