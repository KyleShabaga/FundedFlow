// The documents this build asks the user to accept (NA-3). Final text replaces the drafts here and only here.
import MIT_LICENSE from "../../../../LICENSE?raw";
import type { LegalDocument } from "./document";
import { privacyNotice } from "./privacy-notice";
import { userAgreement } from "./user-agreement";

export type { LegalDocument, LegalSection } from "./document";
export { documentText, sha256Hex } from "./document";

export const CURRENT_LEGAL_DOCUMENTS: readonly LegalDocument[] = [privacyNotice, userAgreement];

/** The plain-language privacy summary shown on the first-run screen and in Settings. */
export const PRIVACY_SUMMARY = [
  "Your desktop journal is local and unencrypted. The app has no sign-in, telemetry or update checker; the installer may download WebView2 from Microsoft.",
  "Settings provides exports, restore and deletion controls. Recovery copies, external backups and WebView storage have different deletion limits; read the notice before erasing data.",
] as const;

/** A summary of the repository's root LICENSE; the LICENSE file is the authority. */
export const LICENSE_TEXT = MIT_LICENSE;

export const LICENSE_SUMMARY = {
  notice: "Copyright (c) 2026 Kyle Shabaga",
  terms: [
    "FundedFlow is open source under the MIT License. You may use, copy, modify, distribute, sublicense and sell copies, provided you include the copyright and permission notice in all copies or substantial portions of the software.",
    "It is provided as is, without warranty, as a record-keeping tool that doesn't give financial, trading or investment advice.",
    "Third-party components (libraries, crates, npm packages and fonts) are licensed by their own authors under their own terms.",
  ],
} as const;

export type { NoticesPart, ThirdPartySummary } from "./third-party";
export { loadThirdPartyNotices, parseNotices, THIRD_PARTY_SUMMARY } from "./third-party";

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
