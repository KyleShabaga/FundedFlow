// Import history for one account: every batch Rust recorded (committed or failed),
// and the preserved problem rows of a batch. Reads are scoped by account and batch id.
import type { ImportRowRecord } from "@fundedflow/domain";
import { Upload } from "lucide-react";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import {
  Badge,
  Button,
  type DataColumn,
  DataTable,
  Drawer,
  EmptyState,
  formatInstant,
  StateBoundary,
  StatList,
} from "../../../design-system";
import { useActiveAccount } from "../../accounts/active-account";
import { useAccounts } from "../../accounts/hooks/accounts";
import { retryRead, toAsyncState } from "../../shared/presentation";
import { useImportHistory, useImportProblemRows, useImportResult } from "../hooks/imports";
import type { ImportViewModel } from "../view-models/import";
import { ImportTargetPicker } from "./ImportTarget";
import { FORMAT_LABELS, fileSize } from "./presentation";
import "./imports.css";

const ROW_STATUS: Record<ImportRowRecord["status"], { label: string; tone: "profit" | "neutral" | "loss" }> = {
  imported: { label: "Imported", tone: "profit" },
  duplicate: { label: "Duplicate", tone: "neutral" },
  skipped: { label: "Skipped", tone: "neutral" },
  invalid: { label: "Error", tone: "loss" },
};

function BatchDetail({ accountId, batchId, timeZone, onClose }: { accountId: string; batchId: string; timeZone: string; onClose: () => void }) {
  const batch = useImportResult(accountId, batchId);
  const rows = useImportProblemRows(accountId, batchId);
  const columns: DataColumn<ImportRowRecord>[] = [
    { id: "line", header: "Line", align: "end", cell: r => r.lineNumber },
    { id: "status", header: "Status", cell: r => <Badge tone={ROW_STATUS[r.status].tone}>{ROW_STATUS[r.status].label}</Badge> },
    { id: "why", header: "Reason", cell: r => (
      <div className="imp-details">
        {[...r.errors, ...r.warnings].map((i, n) => <span key={n}>{i.field && i.field !== "row" ? `${i.field}: ${i.message}` : i.message}</span>)}
        {r.duplicateOfTradeId && <span>Same as a saved trade</span>}
      </div>
    ) },
    { id: "raw", header: "From the file", cell: r => <span className="imp-raw">{r.raw.join(" | ")}</span> },
  ];
  return (
    <Drawer open onOpenChange={o => !o && onClose()} title="Import details" width={720} description="What was saved, skipped or left out, with the original cells of each problem row.">
      <StateBoundary state={toAsyncState(batch)} label="import" onRetry={retryRead(batch.refresh)}>
        {b => (
          <div className="imp-drawer">
            <StatList bordered label="Import" items={[
              { label: "File", value: `${b.fileName} · ${fileSize(b.fileSize)}` },
              { label: "Format", value: FORMAT_LABELS[b.sourceFormat] },
              { label: "Result", value: b.status === "committed" ? "Completed" : "Didn't complete" },
              { label: "Finished", value: formatInstant(b.completedAt, { timeZone, year: true, zoneName: true }) },
              { label: "Rows in file", value: { kind: "count", value: b.rowCount } },
              { label: "Imported", value: { kind: "count", value: b.importedCount } },
              { label: "Skipped (duplicates and blank)", value: { kind: "count", value: b.skippedCount } },
              { label: "Duplicates", value: { kind: "count", value: b.duplicateCount } },
              { label: "Errors", value: { kind: "count", value: b.failedCount } },
              { label: "Rows with warnings", value: { kind: "count", value: b.warningCount } },
              { label: "Import reference", value: <span className="imp-fills">{b.id}</span> },
            ]} />
            {b.failureMessage && <p className="imp-fail">{b.failureMessage}</p>}
            <h3 className="ds-title">Problem rows</h3>
            <StateBoundary state={toAsyncState(rows)} label="problem rows" onRetry={retryRead(rows.refresh)}
              empty={{ "no-records": <EmptyState kind="no-records" size="compact" title="No problem rows" description="Every row was imported, or skipped as blank." /> }}>
              {list => <DataTable label="Problem rows" columns={columns} rows={list} getRowId={r => `${r.lineNumber}`} />}
            </StateBoundary>
          </div>
        )}
      </StateBoundary>
    </Drawer>
  );
}

export function ImportHistoryPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const accounts = useAccounts("all");
  const active = useActiveAccount();
  const requested = (location.state as { accountId?: string } | null)?.accountId ?? null;
  const [chosen, setChosen] = useState<string | null>(requested);
  const accountId = chosen ?? active.activeId;
  const account = accounts.data?.find(a => a.id === accountId);
  const history = useImportHistory(accountId);
  const [open, setOpen] = useState<string | null>(null);
  const tz = account?.timezone;

  const columns: DataColumn<ImportViewModel>[] = [
    { id: "when", header: "Finished", cell: b => formatInstant(b.completedAt, { timeZone: tz, year: true }) },
    { id: "file", header: "File", rowHeader: true, cell: b => <span className="imp-file-cell">{b.fileName}</span> },
    { id: "result", header: "Result", cell: b => (b.status === "committed" ? <Badge tone="profit">Completed</Badge> : <Badge tone="loss">Didn't complete</Badge>) },
    { id: "rows", header: "Rows", align: "end", cell: b => b.rowCount.toLocaleString("en-US") },
    { id: "imported", header: "Imported", align: "end", cell: b => b.importedCount.toLocaleString("en-US") },
    { id: "dup", header: "Duplicates", align: "end", cell: b => b.duplicateCount.toLocaleString("en-US") },
    { id: "err", header: "Errors", align: "end", cell: b => b.failedCount.toLocaleString("en-US") },
    { id: "warn", header: "Warnings", align: "end", cell: b => b.warningCount.toLocaleString("en-US") },
  ];

  return (
    <div className="imp-page">
      <div className="imp-head">
        <p className="imp-sub">Every import into an account, newest first, with the rows that weren't saved.</p>
        <Button variant="primary" icon={<Upload size={16} aria-hidden="true" />} onClick={() => navigate("/import", { state: { accountId } })}>Import CSV</Button>
      </div>
      <section className="ds-card imp-panel imp-history-target">
        <ImportTargetPicker accounts={accounts.data ?? []} value={accountId} onChange={id => { setChosen(id); setOpen(null); }} lineage={undefined}
          assessment={{ blocked: null, confirmations: [] }} confirmed={false} onConfirmedChange={() => {}} showConfirm={false} />
      </section>
      {accountId === null ? (
        <EmptyState kind="not-configured" title="Choose an account" description="Import history is kept per account." />
      ) : (
        <StateBoundary state={toAsyncState(history)} label="import history" onRetry={retryRead(history.refresh)}
          empty={{ "no-records": <div className="ds-card"><EmptyState kind="no-records" title="No imports yet" description="Imports into this account will be listed here." action={<Button onClick={() => navigate("/import", { state: { accountId } })}>Import a CSV</Button>} /></div> }}>
          {batches => (
            <DataTable label="Imports" columns={columns} rows={[...batches].sort((a, b) => (a.completedAt < b.completedAt ? 1 : -1))} getRowId={b => b.id} onRowClick={b => setOpen(b.id)} activeRowId={open} />
          )}
        </StateBoundary>
      )}
      {open && accountId && <BatchDetail accountId={accountId} batchId={open} timeZone={tz ?? "UTC"} onClose={() => setOpen(null)} />}
    </div>
  );
}
