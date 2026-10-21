// How import rows and batches are labelled. Every classification comes from the
// Rust preview (status, restores, duplicate, warnings); nothing is re-derived here.
import type { RowReport } from "@fundedflow/domain";

import { Badge, type Tone } from "../../../design-system";

export type RowKind = "new" | "restore" | "warning" | "duplicate" | "invalid" | "blank";

/** One label per row. A restored row is still a new row (restoreCount is part of newCount). */
export function rowKind(row: Pick<RowReport, "status" | "restores" | "warnings">): RowKind {
  if (row.status === "invalid") return "invalid";
  if (row.status === "duplicate") return "duplicate";
  if (row.status === "blank") return "blank";
  if (row.restores) return "restore";
  if (row.warnings.length > 0) return "warning";
  return "new";
}

const KIND: Record<RowKind, { label: string; tone: Tone }> = {
  new: { label: "New", tone: "profit" },
  restore: { label: "Restore", tone: "flow" },
  warning: { label: "Warning", tone: "warn" },
  duplicate: { label: "Duplicate", tone: "neutral" },
  invalid: { label: "Error", tone: "loss" },
  blank: { label: "Blank", tone: "neutral" },
};

export function RowBadge({ kind }: { kind: RowKind }) {
  return <Badge tone={KIND[kind].tone}>{KIND[kind].label}</Badge>;
}

/** Will this row be written if the trader imports? Only "new" rows are (including restores and warnings). */
export const willImport = (row: Pick<RowReport, "status">) => row.status === "new";

/** The row's reasons in the trader's words, from the backend's own text. */
export function rowDetails(row: RowReport): string[] {
  const out: string[] = [];
  for (const e of row.errors) out.push(e.field && e.field !== "row" ? `${e.field}: ${e.message}` : e.message);
  if (row.duplicate) {
    out.push(
      row.duplicate.of === "file"
        ? `Same trade as line ${row.duplicate.lineNumber ?? "earlier in this file"}; skipped.`
        : `Already saved in this account; skipped. ${row.duplicate.reason}`.trim(),
    );
  }
  if (row.restores) out.push(`Matches a trade you deleted. Importing restores that original trade instead of adding a copy. ${row.restores.reason}`.trim());
  for (const w of row.warnings) out.push(w.field && w.field !== "row" ? `${w.field}: ${w.message}` : w.message);
  return out;
}

export const FORMAT_LABELS: Record<"performance" | "generic", string> = {
  performance: "Performance export (paired fills)",
  generic: "Generic trade list",
};

export const DATE_ORDER_LABELS: Record<"auto" | "ymd" | "mdy" | "dmy", string> = {
  auto: "Detect from the file",
  ymd: "Year-month-day (2026-10-19)",
  mdy: "Month/day/year (10/19/2026)",
  dmy: "Day/month/year (19/10/2026)",
};

/** Bytes as KB or MB with one decimal, for file summaries. */
export function fileSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
}
