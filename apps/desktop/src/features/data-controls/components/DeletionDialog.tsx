// Permanent deletion of one trading account, or erasure of the entire local
// journal. These are separate flows with separate wording and phrases. The
// counts, linked attempts and blockers come from Rust's preview of the actual
// constrained deletion; nothing is estimated here. A blocked account cannot be
// confirmed at all, and archiving is offered instead.
import type { PermanentDeletionPreview, PermanentDeletionResult } from "@fundedflow/domain";
import { type ReactNode, useEffect, useState } from "react";

import { Button, Dialog, formatBytes, InlineNotice, LoadingState, StatList, useToast } from "../../../design-system";
import { useRuntime } from "../../../app/RuntimeProvider";
import * as api from "../api/data-controls";
import { useDataControlOperation } from "../hooks/data-controls";
import { DestructiveActionDialog } from "./DestructiveActionDialog";

export type DeletionTarget =
  | { kind: "account"; accountId: string; accountLabel: string; status: string; archived: boolean; attemptNumber?: number }
  | { kind: "journal" };

export interface DeletionDialogProps {
  target: DeletionTarget;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** After a committed deletion (completed or cleanup pending). */
  onDeleted?: (result: PermanentDeletionResult) => void;
  /** Offered when an account can't be deleted on its own. */
  onArchiveInstead?: () => void;
}

type Phase =
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "ready"; preview: PermanentDeletionPreview }
  | { kind: "cleanup-pending"; result: PermanentDeletionResult; message: string | null };

export function DeletionDialog(props: DeletionDialogProps) {
  return props.open ? <DeletionDialogBody {...props} /> : null;
}

function DeletionDialogBody({ target, open, onOpenChange, onDeleted, onArchiveInstead }: DeletionDialogProps) {
  const op = useDataControlOperation();
  // The runtime status carries the cleanup state; it stops polling once ready, so re-read it after each step.
  const runtime = useRuntime();
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const isAccount = target.kind === "account";
  const accountId = isAccount ? target.accountId : null;

  useEffect(() => {
    let live = true;
    setPhase({ kind: "loading" });
    // A preview is read-only, so it doesn't take the operation lock (React may run this effect twice).
    (accountId ? api.previewAccountDeletion(accountId) : api.previewJournalErasure())
      .then(preview => live && setPhase({ kind: "ready", preview }))
      .catch(error => live && setPhase({ kind: "failed", message: api.describeProblem(error) }));
    return () => { live = false; };
    // Re-run only on an explicit retry or a different target.
  }, [accountId, attempt]);

  const confirm = async (typed: string) => {
    if (phase.kind !== "ready") return;
    // Even a refused delete runs a cleanup pass first, which can change the cleanup state.
    const result = await op.run("delete", () => api.deletePermanently(phase.preview, typed)).finally(() => void runtime.check());
    await op.forgetJournal();
    onDeleted?.(result);
    if (result.state === "cleanup_pending") {
      setPhase({ kind: "cleanup-pending", result, message: null });
      return;
    }
    toast.show({ tone: "success", title: isAccount ? `${target.accountLabel} was permanently deleted` : "The local journal was erased" });
    onOpenChange(false);
  };

  const retryCleanup = () => {
    if (phase.kind !== "cleanup-pending") return;
    op.run("cleanup", api.retryCleanup)
      .finally(() => void runtime.check())
      .then(() => {
        toast.show({ tone: "success", title: "File cleanup finished" });
        onOpenChange(false);
      })
      .catch(error => setPhase({ ...phase, message: api.describeProblem(error) }));
  };

  const preview = phase.kind === "ready" ? phase.preview : null;
  const blocked = preview !== null && preview.blockers.length > 0;
  const phrase = preview && !blocked && phase.kind === "ready" ? preview.requiredConfirmation : null;

  const title = isAccount ? `Permanently delete ${target.accountLabel}?` : "Erase the entire local journal?";
  const description = isAccount
    ? "This removes one trading account and the records that belong only to it. It is not the same as marking it failed or archiving it, which keep its history."
    : "This removes every account, trade, note, review, rulebook, setting and screenshot in this journal and starts an empty one.";

  if (phase.kind === "cleanup-pending") {
    return (
      <DeletionShell open={open} onOpenChange={onOpenChange} title="Deleted, but some files are still on disk" busy={op.busy !== null}
        footer={<>
          <Button onClick={() => onOpenChange(false)} disabled={op.busy !== null}>Close</Button>
          <Button variant="primary" onClick={retryCleanup} loading={op.busy === "cleanup"} disabled={op.busy !== null}>Retry file cleanup</Button>
        </>}
      >
        <InlineNotice tone="warning" title="The deletion is saved; file cleanup didn't finish">
          The records are gone from the journal. Some screenshots or recovery copies couldn't be removed from disk yet. FundedFlow retries
          at the next start, or you can retry now.
        </InlineNotice>
        {phase.message && <p role="alert" className="ds-notice ds-notice-error">{phase.message}</p>}
      </DeletionShell>
    );
  }

  return (
    <DestructiveActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      phrase={phrase}
      confirmLabel={isAccount ? "Delete account permanently" : "Erase entire journal"}
      busyLabel={isAccount ? "Deleting…" : "Erasing…"}
      onConfirm={confirm}
      busy={op.busy !== null && op.busy !== "delete"}
      footerExtra={
        phase.kind === "failed" ? <Button onClick={() => setAttempt(n => n + 1)} disabled={op.busy !== null}>Check again</Button>
        : blocked && onArchiveInstead ? <Button onClick={onArchiveInstead}>Archive instead</Button> : null
      }
    >
      {isAccount && (
        <StatList label="Account to delete" bordered items={[
          { label: "Account", value: target.accountLabel },
          { label: "Account ID", value: <code className="dc-id">{target.accountId}</code> },
          ...(target.attemptNumber ? [{ label: "Attempt", value: `Attempt ${target.attemptNumber}` }] : []),
          { label: "Current status", value: `${target.status}${target.archived ? " · archived" : ""}` },
        ]} />
      )}
      {phase.kind === "loading" && <LoadingState label="Checking exactly what would be deleted…" />}
      {phase.kind === "failed" && <InlineNotice tone="error" title="The deletion preview couldn't be prepared">{phase.message} Nothing was deleted.</InlineNotice>}
      {preview && <PreviewDetails preview={preview} isAccount={isAccount} />}
    </DestructiveActionDialog>
  );
}

function PreviewDetails({ preview, isAccount }: { preview: PermanentDeletionPreview; isAccount: boolean }) {
  const rows = api.countRows(preview.affectedEntities);
  const attachmentBytes = preview.attachments.reduce((sum, a) => sum + a.byteSize, 0);
  return (
    <>
      {preview.blockers.length > 0 && (
        <InlineNotice tone="warning" title="This account can't be deleted on its own">
          <ul className="dc-list">
            {preview.blockers.map(code => <li key={code}>{api.blockerText(code)}</li>)}
          </ul>
          Nothing will be deleted. You can archive it to hide it from your lists while keeping its history, or erase the entire journal from Settings.
        </InlineNotice>
      )}
      {preview.linkedAccountIds.length > 0 && (
        <InlineNotice tone="info" title="Linked attempts">
          {preview.linkedAccountIds.length === 1 ? "1 other attempt is" : `${preview.linkedAccountIds.length} other attempts are`} linked
          to this account by a reset. {preview.blockers.length > 0 ? "They are not changed." : "They are kept and are not deleted."}
          <ul className="dc-list">{preview.linkedAccountIds.map(id => <li key={id}><code className="dc-id">{id}</code></li>)}</ul>
        </InlineNotice>
      )}
      <section aria-label={preview.blockers.length > 0 ? "Records owned by this account" : "What will be deleted"}>
        <h3 className="dc-subhead">{preview.blockers.length > 0 ? "Records owned by this account" : "What will be deleted"}</h3>
        {rows.length > 0
          ? <StatList bordered items={rows.map(r => ({ label: r.label, value: r.value.toLocaleString("en-US") }))} />
          : <p className="ds-faint">No records.</p>}
        {preview.attachments.length > 0 && (
          <p className="dc-note">{preview.attachments.length} screenshot or file{preview.attachments.length === 1 ? "" : "s"} ({formatBytes(attachmentBytes)}) removed from disk.</p>
        )}
        {!isAccount && preview.extraFiles.length > 0 && <ExtraFiles keys={preview.extraFiles} />}
        <MissingAttachmentsNotice warnings={preview.warnings}>
          Their files were already gone from disk, or no longer match what was saved. They are counted above and erased with the journal; nothing else needs to be done.
        </MissingAttachmentsNotice>
        {!isAccount && preview.localRecoveryCopies > 0 && (
          <p className="dc-note">{preview.localRecoveryCopies} local recovery cop{preview.localRecoveryCopies === 1 ? "y" : "ies"} kept by FundedFlow will also be removed.</p>
        )}
      </section>
      <InlineNotice tone="info" title="What stays">
        {isAccount
          ? "Other accounts and attempts, shared tags, strategies, firms and rulebooks shared with other accounts stay. "
          : ""}
        Archives or CSV files you exported yourself are not touched, wherever you saved them. This is not a forensic secure erase.
      </InlineNotice>
    </>
  );
}

/** Screenshots whose file was already gone or no longer matched when the preview was taken. */
export function MissingAttachmentsNotice({ warnings, children }: { warnings: readonly string[]; children: ReactNode }) {
  const names = api.missingAttachments(warnings);
  if (names.length === 0) return null;
  return (
    <InlineNotice tone="warning" title="Some screenshots are already missing or changed">
      {children}
      <ul className="dc-list">{names.map((name, i) => <li key={i}><code className="dc-id">{name}</code></li>)}</ul>
    </InlineNotice>
  );
}

/** Leftover files no record lists (a crash or failed removal), shown by name before the erase is confirmed. */
function ExtraFiles({ keys }: { keys: string[] }) {
  const SHOWN = 5;
  const names = keys.map(key => key.slice(key.lastIndexOf("/") + 1));
  const one = keys.length === 1;
  return (
    <div className="dc-note">
      <p>{keys.length} leftover file{one ? "" : "s"} that belong{one ? "s" : ""} to no record {one ? "is" : "are"} also removed with the journal,
        such as screenshots left behind by an interrupted save:</p>
      <ul className="dc-list">
        {names.slice(0, SHOWN).map((name, i) => <li key={keys[i]}><code className="dc-id">{name}</code></li>)}
        {names.length > SHOWN && <li>and {names.length - SHOWN} more</li>}
      </ul>
    </div>
  );
}

function DeletionShell({ open, onOpenChange, title, busy, footer, children }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; busy: boolean; footer: ReactNode; children: ReactNode }) {
  return (
    <Dialog open={open} onOpenChange={next => !busy && onOpenChange(next)} dismissible={!busy} title={title} footer={footer}>
      <div className="dc-dialog">{children}</div>
    </Dialog>
  );
}
