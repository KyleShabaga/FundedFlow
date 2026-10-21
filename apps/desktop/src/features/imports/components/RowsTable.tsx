// Every listed row of a preview with a segmented filter, used by the wizard's review step and Quick Import's
// "View all rows and issues". Statuses, reasons and P&L come from the Rust preview as returned.
import type { RowReport } from "@fundedflow/domain";
import { useState } from "react";

import { type DataColumn, DataTable, EmptyState, formatInstant, MoneyCell, SegmentedControl } from "../../../design-system";
import type { useCsvPreview } from "../hooks/imports";
import { RowBadge, rowDetails, rowKind, willImport } from "./presentation";

type RowFilter = "all" | "import" | "restore" | "duplicate" | "invalid" | "warning";
export type Preview = NonNullable<ReturnType<typeof useCsvPreview>["data"]>;

export function RowsTable({ preview, timeZone }: { preview: Preview; timeZone: string }) {
  const p = preview.preview;
  const [filter, setFilter] = useState<RowFilter>("all");
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const listed = p.rows.filter(r => r.status !== "blank");
  const matches = (r: RowReport): boolean => {
    const kind = rowKind(r);
    switch (filter) {
      case "all": return true;
      case "import": return willImport(r);
      case "restore": return kind === "restore";
      case "duplicate": return r.status === "duplicate";
      case "invalid": return r.status === "invalid";
      case "warning": return r.warnings.length > 0;
    }
  };
  const rows = listed.filter(matches);
  const columns: DataColumn<RowReport>[] = [
    { id: "line", header: "Line", align: "end", cell: r => r.lineNumber },
    { id: "status", header: "Status", cell: r => <RowBadge kind={rowKind(r)} /> },
    { id: "symbol", header: "Symbol", rowHeader: true, cell: r => <span className="ds-sym">{r.trade?.symbol ?? "—"}</span> },
    { id: "side", header: "Side", cell: r => (r.trade ? (r.trade.side === "long" ? "Long" : "Short") : "—") },
    { id: "qty", header: "Qty", align: "end", cell: r => r.trade?.quantity ?? "—" },
    { id: "opened", header: "Opened", cell: r => (r.trade ? formatInstant(r.trade.entryAt, { timeZone }) : "—") },
    { id: "entry", header: "Entry", align: "end", cell: r => r.trade?.entryPrice ?? "—" },
    { id: "exit", header: "Exit", align: "end", cell: r => r.trade?.exitPrice ?? "—" },
    { id: "file", header: "File P&L", align: "end", cell: r => <MoneyCell value={r.trade?.reportedPnl ?? null} currency={preview.currency} /> },
    { id: "net", header: "Net P&L", align: "end", cell: r => <MoneyCell value={r.trade?.realizedPnl ?? null} currency={preview.currency} /> },
    { id: "fees", header: "Fees", align: "end", cell: r => <MoneyCell value={r.trade?.fees ?? null} signed={false} currency={preview.currency} /> },
    { id: "fills", header: "Fill IDs", cell: r => (r.trade && (r.trade.buyFillId || r.trade.sellFillId) ? <span className="imp-fills">{r.trade.buyFillId ?? "—"} / {r.trade.sellFillId ?? "—"}</span> : "—") },
    {
      id: "details", header: "Details",
      cell: r => {
        const details = rowDetails(r);
        return (
          <div className="imp-details">
            {details.map((d, i) => <span key={i}>{d}</span>)}
            {!r.trade && r.raw.length > 0 && <span className="ds-faint">From the file: {r.raw.join(" | ")}</span>}
          </div>
        );
      },
    },
  ];
  const options: { value: RowFilter; label: string; count: number }[] = [
    { value: "all", label: "All", count: p.rowCount - p.blankCount },
    { value: "import", label: "Will import", count: p.newCount },
    { value: "restore", label: "Restores", count: p.restoreCount },
    { value: "duplicate", label: "Duplicates", count: p.duplicateCount },
    { value: "invalid", label: "Errors", count: p.invalidCount },
    { value: "warning", label: "Warnings", count: p.warningCount },
  ];
  return (
    <DataTable
      label="Rows in the file"
      columns={columns}
      rows={rows.slice((page - 1) * pageSize, page * pageSize)}
      getRowId={r => String(r.lineNumber)}
      isRowMuted={r => !willImport(r)}
      toolbar={<SegmentedControl<RowFilter> label="Show rows" value={filter} onValueChange={f => { setFilter(f); setPage(1); }} options={options} />}
      actions={<span className="ds-faint">Original cells are kept with each imported trade</span>}
      fallback={rows.length === 0 ? <EmptyState kind="no-matches" size="compact" description="No listed rows of this kind." /> : undefined}
      pagination={{ page, pageSize, total: rows.length, onPageChange: setPage }}
      footer={p.rowsOmitted > 0 ? `${p.rowsOmitted.toLocaleString("en-US")} more new rows aren't listed; they're counted above and will be imported` : undefined}
    />
  );
}

