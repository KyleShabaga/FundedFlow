// The typed-phrase confirmation for restore and permanent deletion (Build 6
// plan: DestructiveActionDialog, Build 25). Built from Dialog and TextField.
// The action button stays disabled until the user has typed the exact phrase
// Rust asked for; the phrase is never filled in for them.
import { type FormEvent, type ReactNode, useId, useState } from "react";

import { Button, Dialog, TextField } from "../../../design-system";
import { describeProblem } from "../api/data-controls";

export interface DestructiveActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  /** What will be affected: counts, warnings, blockers. */
  children: ReactNode;
  /** The exact text Rust requires, shown and typed by the user. Null when the action is blocked. */
  phrase: string | null;
  confirmLabel: string;
  busyLabel: string;
  /** Runs once per press. Reject to stay open and show the problem. */
  onConfirm: (typed: string) => Promise<void>;
  /** Locks the dialog while another data control runs. */
  busy?: boolean;
  /** Extra footer content before Cancel (e.g. a Retry while the preview failed). */
  footerExtra?: ReactNode;
}

export function DestructiveActionDialog({ open, onOpenChange, title, description, children, phrase, confirmLabel, busyLabel, onConfirm, busy = false, footerExtra }: DestructiveActionDialogProps) {
  const formId = useId().replace(/:/g, "");
  const [typed, setTyped] = useState("");
  const [running, setRunning] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const locked = running || busy;
  const matches = phrase !== null && typed === phrase;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!matches || locked) return;
    setRunning(true);
    setProblem(null);
    try {
      await onConfirm(typed);
    } catch (error) {
      setProblem(describeProblem(error));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={next => !locked && onOpenChange(next)}
      dismissible={!locked}
      hideClose={locked}
      size="lg"
      title={title}
      description={description}
      footer={
        <>
          {footerExtra}
          <Button onClick={() => onOpenChange(false)} disabled={locked}>Cancel</Button>
          {phrase !== null && (
            <Button type="submit" form={formId} variant="danger" loading={running} disabled={!matches || locked}>
              {running ? busyLabel : confirmLabel}
            </Button>
          )}
        </>
      }
    >
      <form id={formId} onSubmit={event => void submit(event)} noValidate className="dc-dialog">
        {children}
        {phrase !== null && (
          <TextField
            label="Type the confirmation exactly"
            description={<>Type <code className="dc-phrase">{phrase}</code> to continue. It is case-sensitive.</>}
            value={typed}
            onChange={event => setTyped(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            disabled={locked}
            error={typed.length > 0 && !matches && typed.length >= phrase.length ? "This doesn't match yet." : undefined}
          />
        )}
        {problem && <p role="alert" className="ds-notice ds-notice-error">{problem}</p>}
      </form>
    </Dialog>
  );
}
