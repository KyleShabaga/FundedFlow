// First-run privacy notice and agreement (NA-3). Shown before any app content when there is no acceptance
// record for the current document versions: on first launch, and on any launch after a version changes.
//
// It sits outside RuntimeGate and the app shell, and the record is a per-install file rather than journal
// data, so the screen never waits for the journal and Accept never needs it: a journal that is slow to open
// or fails to open can't trap the user here. Once accepted, the shell and its recovery notice work as before.
import { type ReactNode, useId, useState } from "react";

import { BrandLogo, Button, GatePage, InlineNotice, useToast } from "../../../design-system";
import { CURRENT_LEGAL_DOCUMENTS, PRIVACY_SUMMARY } from "../../../legal";
import { legalGateway } from "../../../lib/data/legal";
import { isCurrent, type KnownAcceptance, useAcceptLegal, useLegalAcceptance } from "../hooks";
import { LegalDocumentDisclosure } from "./LegalDocuments";

export function LegalGate({ children }: { children: ReactNode }) {
  const acceptance = useLegalAcceptance();
  if (acceptance.isPending) {
    return <div className="ds-surface ds-gate-page"><p role="status">Opening FundedFlow…</p></div>;
  }
  if (isCurrent(acceptance.data)) return <>{children}</>;
  // No record, an unreadable one, or one for older versions.
  return <FirstRunAgreement previous={acceptance.data ?? null} />;
}

function FirstRunAgreement({ previous }: { previous: KnownAcceptance | null }) {
  const accept = useAcceptLegal();
  const toast = useToast();
  const privacyId = useId();
  const documentsId = useId();
  const [declining, setDeclining] = useState(false);
  const [declineFailed, setDeclineFailed] = useState(false);
  const changed = previous === null ? [] : CURRENT_LEGAL_DOCUMENTS.filter(doc => !previous.documents.some(a => a.id === doc.id && a.version === doc.version && a.digest === doc.digest));
  const drafts = CURRENT_LEGAL_DOCUMENTS.some(doc => doc.draft);

  const onAccept = async () => {
    const result = await accept.mutateAsync();
    if (!result.saved) {
      toast.show({ tone: "error", title: "Your answer couldn't be saved", description: "You can use FundedFlow now. It will ask again the next time it opens." });
    }
  };
  const onDecline = async () => {
    setDeclining(true);
    setDeclineFailed(false);
    try {
      await legalGateway.quit();
    } catch {
      setDeclineFailed(true);
      setDeclining(false);
    }
  };
  const busy = accept.isPending || declining;

  return (
    <GatePage eyebrow={<BrandLogo />}
      title={previous === null ? "Before you start" : "The privacy or product notice has changed"}
      actions={<>
        <Button variant="secondary" onClick={() => void onDecline()} loading={declining} disabled={accept.isPending}>Close</Button>
        <Button variant="primary" onClick={() => void onAccept()} loading={accept.isPending} disabled={declining}>Acknowledge and continue</Button>
      </>}>
      {previous !== null && changed.length > 0 && (
        <p>Updated since your last acknowledgment: {changed.map(doc => `${doc.title} (version ${doc.version})`).join(", ")}.</p>
      )}
      {drafts && (
        <InlineNotice tone="warning" live="off" title="Draft documents">
          These documents are drafts and haven't been reviewed by a lawyer. Final versions will replace them, and FundedFlow will ask you to acknowledge them then.
        </InlineNotice>
      )}
      <section aria-labelledby={privacyId} className="ds-stack">
        <h2 id={privacyId} className="ds-title">Your privacy</h2>
        {PRIVACY_SUMMARY.map(text => <p key={text}>{text}</p>)}
      </section>
      <section aria-labelledby={documentsId} className="ds-stack">
        <h2 id={documentsId} className="ds-title">Documents</h2>
        {CURRENT_LEGAL_DOCUMENTS.map(doc => <LegalDocumentDisclosure key={doc.id} doc={doc} headingLevel={3} />)}
      </section>
      <p>Acknowledge these notices to continue, or close FundedFlow. This records that the notices were displayed; your software permissions come from the MIT License.</p>
      {declineFailed && (
        <InlineNotice tone="error" title="FundedFlow couldn't close itself">
          Close the window to exit. No acknowledgment has been recorded.
        </InlineNotice>
      )}
      {busy && <p role="status" className="ds-sr-only">{declining ? "Closing FundedFlow…" : "Saving your answer…"}</p>}
    </GatePage>
  );
}
