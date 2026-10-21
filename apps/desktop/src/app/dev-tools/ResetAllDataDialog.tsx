// Build 26.9: Reset All Data. Previews the existing reset tool on the isolated test journal, asks for a
// typed RESET, then hands the reset to an external helper and lets FundedFlow close: the tool never
// runs against an open journal and keeps its own running-app refusal and backup.
import type { UseQueryResult } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { Button, Dialog, InlineNotice, StatList, TextField } from "../../design-system";
import { devTools, type DevToolsStatus, type ResetHandoff, type ResetPreview } from "./api";
import { TargetDirectory, TestJournalRequired } from "./TargetDirectory";

function errorText(e: unknown) {
  return e instanceof Error ? e.message : "Reset All Data failed.";
}

export function ResetAllDataDialog({ open, onOpenChange, status }: { open: boolean; onOpenChange: (open: boolean) => void; status: UseQueryResult<DevToolsStatus> }) {
  const [preview, setPreview] = useState<ResetPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<ResetHandoff | null>(null);
  const isolated = status.data?.isolated === true;

  // Preview first, every time the dialog opens: nothing is changed by it.
  useEffect(() => {
    if (!open || !isolated) return;
    let live = true;
    setPreview(null);
    setPreviewError(null);
    devTools.previewReset().then(p => live && setPreview(p), e => live && setPreviewError(errorText(e)));
    return () => { live = false; };
  }, [open, isolated]);

  const change = (next: boolean) => {
    if (busy || handoff) return;
    if (!next) {
      setTyped("");
      setError(null);
    }
    onOpenChange(next);
  };

  const reset = async () => {
    if (busy || typed !== "RESET" || !preview) return;
    setBusy(true);
    setError(null);
    try {
      setHandoff(await devTools.handOffReset(typed));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmed = typed === "RESET";
  const footer = handoff ? null : (
    <>
      <Button data-cancel onClick={() => change(false)} disabled={busy} autoFocus>Cancel</Button>
      <Button variant="danger" onClick={() => void reset()} loading={busy} disabled={!confirmed || !preview}
        disabledReason={!preview ? "Waiting for the preview" : !confirmed ? "Type RESET to confirm" : undefined}>
        {busy ? "Handing off…" : "Reset"}
      </Button>
    </>
  );
  const c = preview?.counts;

  return (
    <Dialog open={open} onOpenChange={change} title="Reset All Data" size="md" dismissible={!busy && !handoff} hideClose={busy || !!handoff}
      description="Developer tool: resets the entire test journal with the existing reset tool." footer={footer}>
      <div className="dev-dialog-stack">
        {status.data && <TargetDirectory status={status.data} />}
        {status.data && !isolated && <TestJournalRequired status={status.data} />}
        {handoff ? (
          <InlineNotice tone="info" title="FundedFlow is closing to finish the reset" live="assertive">
            <p>The journal is closed. Once FundedFlow has quit, the reset tool moves the test journal to a backup beside it.</p>
            <p>Reopen with <code>{handoff.reopen}</code>: the result and the backup location show when it starts. The helper log is at <code>{handoff.log}</code>.</p>
          </InlineNotice>
        ) : isolated && (
          <>
            <InlineNotice tone="warning" title="This erases the whole test journal">
              <p>{preview?.scope ?? "All local journal data in this directory."} Not only the fake data: everything in this test journal.</p>
            </InlineNotice>
            {previewError && <InlineNotice tone="error" title="The reset tool refused the preview">{previewError}</InlineNotice>}
            {!preview && !previewError && <p role="status">Previewing with the reset tool…</p>}
            {preview && !c && <p>Record counts are unavailable because the journal is not open. The reset still covers everything in the directory.</p>}
            {c && (
              <StatList label="What will be erased" bordered items={[
                { label: "Accounts", value: `${c.accounts}${c.archivedAccounts ? ` (${c.archivedAccounts} archived)` : ""}` },
                { label: "Trades", value: String(c.trades) },
                { label: "Import batches", value: String(c.importBatches) },
                { label: "Journal entries", value: String(c.journalEntries) },
                { label: "Trade and daily reviews", value: String(c.tradeReviews + c.dailyReviews) },
                { label: "Account rulebooks", value: String(c.rulebooks) },
                { label: "Balance observations and calculations", value: String(c.observations + c.snapshots) },
              ]} />
            )}
            {preview && (
              <div className="dev-recovery">
                <p><strong>Backup and recovery.</strong> Nothing is deleted: the whole directory (database, WAL/SHM files, attachments) is moved to <code>{preview.backupPattern}</code>. To undo, close FundedFlow, move the new directory aside and rename the backup back to <code>{preview.dataDir}</code>.</p>
                <p><strong>What happens next.</strong> FundedFlow closes its journal and quits; the reset runs only after no FundedFlow process is left. Command-line equivalent: <code>{preview.cli}</code></p>
              </div>
            )}
            <TextField label="Type RESET to confirm" value={typed} onChange={e => setTyped(e.target.value)} disabled={busy || !preview}
              autoComplete="off" spellCheck={false} description="Uppercase, exactly as shown." />
            {error && <InlineNotice tone="error" title="Nothing was reset">{error}</InlineNotice>}
          </>
        )}
      </div>
    </Dialog>
  );
}
