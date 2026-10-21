// Build 26.6: releasing an uncertain write lock only after the trader has reviewed what is stored.
// An uncertain write (the request was sent, no answer came back) locks its submission scope so it can't be
// sent twice. The lock is released here, in three explicit steps: Check result re-reads the affected records
// (never resending the write), the trader reviews them, then acknowledges. A failed re-read, or an original
// request that hasn't settled yet, keeps the lock. Acknowledging doesn't save anything; the trader may then
// choose to save again. This mirrors the import wizard's "I've checked the history".
import { type ReactNode, useState } from "react";

import { Button, InlineNotice, LoadingState } from "../../design-system";

export interface UncertainWrite {
  outcome: string;
  canAcknowledgeUncertainOutcome: boolean;
  checkUncertainOutcome: (readReviewed: () => Promise<unknown>) => Promise<void>;
  acknowledgeUncertainOutcome: (confirmation: { recordsReviewed: true }) => Promise<void>;
}

export interface UncertainOutcomeReviewProps {
  write: UncertainWrite;
  /** "the account", "the trade", "the status change". */
  what: string;
  /** The re-read records, shown after Check result. Render it from a query mounted with this component. */
  children: ReactNode;
  /** True when the records under review have loaded without an error. */
  reviewReady: boolean;
  /** Re-reads the records under review and rejects if that fails (a feature query's `refresh`). */
  readReviewed: () => Promise<unknown>;
  /** After the lock is released. */
  onAcknowledged?: () => void;
}

type Phase = "unchecked" | "checking" | "check-failed" | "reviewing" | "acknowledging";

export function UncertainOutcomeReview({ write, what, children, reviewReady, readReviewed, onAcknowledged }: UncertainOutcomeReviewProps) {
  const [phase, setPhase] = useState<Phase>("unchecked");
  const check = async () => {
    if (phase === "checking") return;
    setPhase("checking");
    try {
      await write.checkUncertainOutcome(readReviewed);
      setPhase("reviewing");
    } catch {
      setPhase("check-failed");
    }
  };
  const acknowledge = async () => {
    if (phase !== "reviewing" || !write.canAcknowledgeUncertainOutcome || !reviewReady) return;
    setPhase("acknowledging");
    try {
      await write.acknowledgeUncertainOutcome({ recordsReviewed: true });
      onAcknowledged?.();
    } catch {
      setPhase("check-failed");
    }
  };
  if (write.outcome !== "uncertain-outcome") return null;

  if (phase === "unchecked") {
    return (
      <InlineNotice tone="warning" title="Couldn't confirm it saved" live="assertive"
        actions={<Button size="sm" onClick={() => void check()}>Check result</Button>}>
        The request was sent but no answer came back. It may have saved. Saving stays paused until you check {what}; nothing is sent again.
      </InlineNotice>
    );
  }
  if (phase === "checking") return <LoadingState label={`Checking ${what}…`} layout="inline" />;
  if (phase === "check-failed") {
    return (
      <InlineNotice tone="error" title={`Couldn't check ${what}`} live="assertive"
        actions={<Button size="sm" onClick={() => void check()}>Check again</Button>}>
        The stored records couldn't be read, so saving stays paused. Nothing was sent again.
      </InlineNotice>
    );
  }
  const settled = write.canAcknowledgeUncertainOutcome;
  return (
    <InlineNotice tone="info" title={`Check ${what} below`} live="polite"
      actions={<Button size="sm" variant="primary" onClick={() => void acknowledge()} loading={phase === "acknowledging"}
        disabled={!settled || !reviewReady}
        disabledReason={!settled ? "The original request hasn't finished yet" : !reviewReady ? "The records are still loading" : undefined}>
        I've checked; allow saving again
      </Button>}>
      <div className="ds-stack">{children}</div>
      <p>{settled
        ? "If it's listed, it was saved and you don't need to save it again. If it isn't, nothing was saved; you can save it again yourself."
        : "The original request is still running. Wait for it to finish before allowing another save."}</p>
    </InlineNotice>
  );
}
