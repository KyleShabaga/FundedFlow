// Restore = replace the whole journal from a validated archive (Build 24
// never merges). Steps: Rust inspects the chosen file without touching the
// live journal; the user reviews the preview and types the phrase; Rust stages
// it with a safety copy and closes the journal; the runtime retry installs it.
// Success is claimed only once the runtime is Ready again on the restored data.
import type { ArchiveRestorePreview } from "@fundedflow/domain";
import { useEffect, useRef, useState } from "react";

import { Button, Dialog, formatBytes, formatInstant, InlineNotice, LoadingState, StatList, useToast } from "../../../design-system";
import * as api from "../api/data-controls";
import { useDataControlOperation } from "../hooks/data-controls";
import { DestructiveActionDialog } from "./DestructiveActionDialog";

export interface RestoreArchiveDialogProps {
  /** Local path from the file chooser. Only its file name is shown. */
  source: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Latest schema this app reads, from the runtime status. */
  supportedSchema: number | null;
}

type Phase =
  | { kind: "inspecting" }
  | { kind: "rejected"; message: string }
  | { kind: "ready"; preview: ArchiveRestorePreview }
  | { kind: "installing"; retried: boolean }
  | { kind: "installed" }
  | { kind: "install-failed" };

export function RestoreArchiveDialog(props: RestoreArchiveDialogProps) {
  return props.open ? <RestoreArchiveBody {...props} /> : null;
}

function RestoreArchiveBody({ source, open, onOpenChange, supportedSchema }: RestoreArchiveDialogProps) {
  const op = useDataControlOperation();
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>({ kind: "inspecting" });
  const [attempt, setAttempt] = useState(0);
  const name = api.fileName(source);

  useEffect(() => {
    let live = true;
    setPhase({ kind: "inspecting" });
    // Inspection is read-only for the live journal, so it doesn't take the operation lock.
    api.inspectArchive(source)
      .then(preview => live && setPhase({ kind: "ready", preview }))
      .catch(error => live && setPhase({ kind: "rejected", message: api.describeProblem(error) }));
    return () => { live = false; };
  }, [source, attempt]);

  // Installing ends when the runtime settles: Ready on the restored journal, or a recovery failure.
  const settled = useRef(false);
  useEffect(() => {
    // Before the retry finishes the runtime may still report the old Ready state.
    if (phase.kind !== "installing" || !phase.retried || settled.current) return;
    if (op.runtimeKind === "ready") {
      settled.current = true;
      void op.forgetJournal().then(() => {
        setPhase({ kind: "installed" });
        toast.show({ tone: "success", title: "Journal restored", description: `Restored from ${name}.` });
      });
    } else if (op.runtimeKind === "unavailable" || op.runtimeKind === "unsupported-schema") {
      settled.current = true;
      setPhase({ kind: "install-failed" });
    }
  }, [phase, op.runtimeKind, op, name, toast]);

  const confirm = async () => {
    if (phase.kind !== "ready") return;
    await op.run("restore", () => api.restoreArchive(source, phase.preview.previewToken));
    // Staged with a safety copy; the journal is now closed. The runtime retry installs it.
    settled.current = false;
    setPhase({ kind: "installing", retried: false });
    try {
      await op.retryRuntime();
    } finally {
      setPhase({ kind: "installing", retried: true });
    }
  };

  if (phase.kind === "installing" || phase.kind === "installed" || phase.kind === "install-failed") {
    const done = phase.kind !== "installing";
    return (
      <Dialog open={open} onOpenChange={next => done && onOpenChange(next)} dismissible={done} hideClose={!done}
        title={phase.kind === "installed" ? "Journal restored" : phase.kind === "installing" ? "Installing the restored journal…" : "The restore didn't finish installing"}
        footer={done ? <Button variant="primary" onClick={() => onOpenChange(false)}>Close</Button> : null}
      >
        <div className="dc-dialog">
          {phase.kind === "installing" && <LoadingState label="Closing the journal and installing the archive" layout="inline" />}
          {phase.kind === "installing" && <p>FundedFlow closed the current journal, kept a safety copy and is opening the restored one. Don't close the app.</p>}
          {phase.kind === "installed" && (
            <InlineNotice tone="success" title={`The journal now matches ${name}`}>
              Your previous journal was saved as a local safety copy before it was replaced. Check your accounts and trades.
            </InlineNotice>
          )}
          {phase.kind === "install-failed" && (
            <InlineNotice tone="error" title="The journal isn't open">
              FundedFlow keeps the previous journal and its safety copy and will finish or roll back the restore before opening any data.
              Use Retry in the recovery banner after closing other FundedFlow windows or freeing disk space.
            </InlineNotice>
          )}
        </div>
      </Dialog>
    );
  }

  const preview = phase.kind === "ready" ? phase.preview : null;
  return (
    <DestructiveActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Replace the journal with this archive?"
      description="Restoring replaces everything in this journal with the archive's contents. Nothing is merged. The current journal is kept as a local safety copy first."
      phrase={preview ? api.RESTORE_PHRASE : null}
      confirmLabel="Replace entire journal"
      busyLabel="Preparing restore…"
      onConfirm={confirm}
      busy={op.busy !== null && op.busy !== "restore"}
      footerExtra={phase.kind === "rejected" ? <Button onClick={() => setAttempt(n => n + 1)}>Check again</Button> : null}
    >
      <StatList label="Archive" bordered items={[{ label: "File", value: name }]} />
      {phase.kind === "inspecting" && <LoadingState label="Checking the archive's version, checksums and contents…" />}
      {phase.kind === "rejected" && (
        <InlineNotice tone="error" title="This archive can't be restored">
          {phase.message} Your current journal wasn't changed.
        </InlineNotice>
      )}
      {preview && <RestorePreviewDetails preview={preview} supportedSchema={supportedSchema} />}
    </DestructiveActionDialog>
  );
}

function RestorePreviewDetails({ preview, supportedSchema }: { preview: ArchiveRestorePreview; supportedSchema: number | null }) {
  const m = preview.manifest;
  const incoming = api.countRows(m.entities);
  const current = api.countRows(preview.replacedEntities);
  const attachmentBytes = m.attachments.reduce((sum, a) => sum + a.byteSize, 0);
  const older = supportedSchema !== null && m.schemaVersion < supportedSchema;
  const n = (key: string) => m.entities[key] ?? 0;
  return (
    <>
      <InlineNotice tone="success" title="Checksums, version and contents verified">
        Every file in the archive matched its SHA-256 checksum and the journal inside it passed FundedFlow's checks.
      </InlineNotice>
      <StatList label="Archive details" bordered items={[
        { label: "Created", value: formatInstant(m.createdAt, { year: true, zoneName: true }) },
        { label: "Made by", value: `FundedFlow ${m.producerVersion}` },
        { label: "Format", value: `FundedFlow journal, format ${m.formatVersion}` },
        { label: "Journal version", value: older ? `${m.schemaVersion} (upgraded to ${supportedSchema} when installed)` : String(m.schemaVersion) },
        { label: "Protection", value: "Not encrypted (plain ZIP)" },
        { label: "Screenshots and files", value: `${m.attachments.length} (${formatBytes(attachmentBytes)})` },
        { label: "Free space needed", value: formatBytes(preview.requiredFreeBytes) },
        { label: "Archive SHA-256", value: <code className="dc-id">{preview.archiveSha256}</code> },
      ]} />
      <div className="dc-compare">
        <section aria-label="In the archive">
          <h4 className="dc-subhead">In the archive</h4>
          {incoming.length ? <StatList bordered items={incoming.map(r => ({ label: r.label, value: r.value.toLocaleString("en-US") }))} /> : <p className="ds-faint">An empty journal.</p>}
        </section>
        <section aria-label="Replaced in this journal">
          <h4 className="dc-subhead">Replaced in this journal</h4>
          {current.length ? <StatList bordered items={current.map(r => ({ label: r.label, value: r.value.toLocaleString("en-US") }))} /> : <p className="ds-faint">This journal is empty.</p>}
        </section>
      </div>
      <InlineNotice tone="info" title="Accounts come back exactly as they were archived">
        {m.accountIds.length} account{m.accountIds.length === 1 ? "" : "s"}, including archived, failed and passed attempts
        {n("account_attempt_links") > 0 ? `, with ${n("account_attempt_links")} reset link${n("account_attempt_links") === 1 ? "" : "s"} between attempts` : ""}.
        Their status, archive state and provider account numbers are restored as saved; nothing is reactivated, and any newer attempt you
        created after this archive was made will be gone.
      </InlineNotice>
      <InlineNotice tone="warning" title="Before you replace">
        <ul className="dc-list">
          <li>Everything in the current journal is replaced, including accounts, trades, notes, reviews and screenshots added since this archive was made.</li>
          <li>Close other FundedFlow windows and any tools that open the journal file.</li>
          <li>Hashes check for damage, not who made the file. Only restore archives you trust.</li>
        </ul>
      </InlineNotice>
    </>
  );
}
