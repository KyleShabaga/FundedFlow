// The documents this build asks the user to accept (NA-3). Final text replaces the drafts here and only here.
import type { LegalDocument } from "./document";
import { privacyNotice } from "./privacy-notice";
import { userAgreement } from "./user-agreement";

export type { LegalDocument, LegalSection } from "./document";
export { documentText, sha256Hex } from "./document";

export const CURRENT_LEGAL_DOCUMENTS: readonly LegalDocument[] = [privacyNotice, userAgreement];

/** The plain-language privacy summary shown on the first-run screen and in Settings. */
export const PRIVACY_SUMMARY = [
  "FundedFlow keeps your journal only on this computer. Nothing is uploaded: there's no account, no telemetry and no internet connection.",
  "You can export a full backup, restore one, or permanently delete your data at any time in Settings.",
] as const;

/** A summary of the repository's root LICENSE; the LICENSE file is the authority. */
export const LICENSE_SUMMARY = {
  notice: "Copyright (c) 2026 Kyle Shabaga. All rights reserved.",
  terms: [
    "FundedFlow is proprietary, source-available software. It is not open source: any use the licence doesn't permit needs the copyright holder's written permission.",
    "It is provided as is, without warranty, as a record-keeping tool that doesn't give financial, trading or investment advice.",
    "Third-party components (libraries, crates, npm packages and fonts) are licensed by their own authors under their own terms.",
  ],
  /** Third-party licence texts aren't bundled yet (tracked on the roadmap board from the NA-2 installer work). */
  thirdPartyNotices: null as string | null,
} as const;

export interface AcceptedDocument {
  id: string;
  version: string;
  digest: string;
}

/** What the acceptance record stores for each current document. */
export const currentAcceptance = (documents: readonly LegalDocument[] = CURRENT_LEGAL_DOCUMENTS): AcceptedDocument[] =>
  documents.map(({ id, version, digest }) => ({ id, version, digest }));

/** True when the record covers every current document at its current version and digest. */
export function coversCurrent(accepted: readonly AcceptedDocument[] | null | undefined, documents: readonly LegalDocument[] = CURRENT_LEGAL_DOCUMENTS): boolean {
  if (!accepted) return false;
  return documents.every(doc => accepted.some(a => a.id === doc.id && a.version === doc.version && a.digest === doc.digest));
}
