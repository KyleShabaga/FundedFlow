// Settings → Privacy & legal (NA-3): the privacy summary, the bundled documents, what was accepted and when,
// and the licence with the third-party notices (Build 26.78). Needs no journal: it reads only bundled text and the
// per-install acceptance record.
import { Disclosure, DocumentView, formatInstant, FormSection, InlineNotice, StatList } from "../../../design-system";
import { CURRENT_LEGAL_DOCUMENTS, LICENSE_SUMMARY, LICENSE_TEXT, PRIVACY_SUMMARY } from "../../../legal";
import { isCurrent, useLegalAcceptance } from "../hooks";
import { documentMeta, LegalDocumentDisclosure } from "./LegalDocuments";
import { ThirdPartyNotices } from "./ThirdPartyNotices";
import "./legal.css";

export function PrivacyLegalSection() {
  const acceptance = useLegalAcceptance();
  const record = acceptance.data;
  const accepted = !record ? "Not accepted"
    : !isCurrent(record) ? `Earlier versions, ${formatInstant(record.acceptedAt, { year: true })}`
    : record.saved ? formatInstant(record.acceptedAt, { year: true })
    : "This session only: it couldn't be saved, so FundedFlow will ask again when it next opens";
  return (
    <FormSection headingLevel={2} title="Privacy & legal" description="What FundedFlow does with your data, and the documents you accepted." className="legal-settings">
      <div className="ds-stack">
        {PRIVACY_SUMMARY.map(text => <p key={text} className="legal-settings-text">{text}</p>)}
      </div>
      {CURRENT_LEGAL_DOCUMENTS.some(doc => doc.draft) && (
        <InlineNotice tone="warning" live="off" title="Draft documents">
          The privacy notice and user agreement are drafts and haven't been reviewed by a lawyer. Final versions will replace them.
        </InlineNotice>
      )}
      <StatList bordered label="Accepted documents" items={[
        ...CURRENT_LEGAL_DOCUMENTS.map(doc => ({ label: doc.title, value: documentMeta(doc) })),
        { label: "Accepted on this computer", value: accepted },
      ]} />
      {CURRENT_LEGAL_DOCUMENTS.map(doc => <LegalDocumentDisclosure key={doc.id} doc={doc} headingLevel={3} />)}
      <Disclosure summary="Licence and third-party notices">
        <div className="ds-stack legal-settings-text">
          <h3 className="ds-title">Licence</h3>
          <p>{LICENSE_SUMMARY.notice}</p>
          {LICENSE_SUMMARY.terms.map(text => <p key={text}>{text}</p>)}
          <Disclosure summary="Read the MIT License">
            <DocumentView preformatted headingLevel={3} title="MIT License"
              sections={[{ heading: "Full license text", paragraphs: [LICENSE_TEXT] }]} />
          </Disclosure>
          <h3 className="ds-title">Third-party notices</h3>
          <ThirdPartyNotices />
        </div>
      </Disclosure>
    </FormSection>
  );
}
