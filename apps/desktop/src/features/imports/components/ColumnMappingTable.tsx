// Step 2's column matches (P0-D09): each FundedFlow field, the CSV column beside it, and the status Rust gave that
// mapping. The status and its reason come from the preview only; this component never judges a mapping itself.
import type { ColumnMapping, MappedField, MappingStatus } from "@fundedflow/domain";

import { Select, StatusIndicator, type StatusKind } from "../../../design-system";
import { GENERIC_FIELDS } from "../wizard-state";

/** Status text for each Rust mapping status. The icon shape differs per kind, so it reads without colour. */
export const MAPPING_STATUS: Record<MappingStatus, { kind: StatusKind; label: string }> = {
  matched: { kind: "success", label: "Matched" },
  review: { kind: "caution", label: "Needs review" },
  error: { kind: "danger", label: "Action required" },
  notMapped: { kind: "neutral", label: "Not mapped" },
};

const PERFORMANCE_LABELS: Record<string, string> = {
  symbol: "Symbol",
  quantity: "Quantity",
  buyPrice: "Buy price",
  sellPrice: "Sell price",
  boughtTimestamp: "Buy time",
  soldTimestamp: "Sell time",
  buyFillId: "Buy fill ID",
  sellFillId: "Sell fill ID",
  realizedPnl: "P&L in the file",
  duration: "Duration",
  priceFormat: "Price format",
  priceFormatType: "Price format type",
  tickSize: "Tick size",
};

const NONE = "__none";

export function mappingFieldLabel(field: string, format: "generic" | "performance") {
  return (format === "generic" ? GENERIC_FIELDS.find(f => f.field === field)?.label : PERFORMANCE_LABELS[field]) ?? field;
}

export interface ColumnMappingTableProps {
  format: "generic" | "performance";
  /** Rust's mapping for the last checked request, in its field order. */
  mapping: MappedField[];
  /** Editable generic mapping. Omit for a recognized export, whose columns are fixed. */
  edit?: { headers: string[]; columns: ColumnMapping; onChange: (columns: ColumnMapping) => void; disabled?: boolean };
  /**
   * The mapping shown is not the one Rust last checked: "pending" while it checks again, "stale" when it hasn't.
   * Statuses are hidden then, so an earlier Matched can't stand for a changed mapping.
   */
  unchecked?: "pending" | "stale";
}

export function ColumnMappingTable({ format, mapping, edit, unchecked }: ColumnMappingTableProps) {
  const headers = edit ? [...new Set(edit.headers.filter(h => h.trim()))] : [];
  const counts = mapping.reduce<Record<MappingStatus, number>>((n, m) => ({ ...n, [m.status]: n[m.status] + 1 }), { matched: 0, review: 0, error: 0, notMapped: 0 });
  const summary = unchecked === "pending" ? "Checking the columns" : unchecked ? "" : [
    `${counts.matched} matched`,
    counts.review ? `${counts.review} need review` : "",
    counts.error ? `${counts.error} need action` : "",
    counts.notMapped ? `${counts.notMapped} not mapped` : "",
  ].filter(Boolean).join(", ");
  return (
    <div className="imp-map">
      <table className="imp-map-table">
        <caption className="ds-sr-only">Column matches</caption>
        <colgroup>
          <col className="imp-map-col-field" />
          <col className="imp-map-col-csv" />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">FundedFlow field</th>
            <th scope="col">CSV column</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {mapping.map(m => {
            const label = mappingFieldLabel(m.field, format);
            const status = MAPPING_STATUS[m.status];
            const value = edit?.columns[m.field as keyof ColumnMapping];
            return (
              <tr key={m.field} className={unchecked ? undefined : `is-${m.status}`}>
                <th scope="row">
                  <span className="imp-map-label">{label}</span>
                  {m.required ? <span className="imp-map-need"> Required</span> : <span className="imp-map-need is-optional"> Optional</span>}
                </th>
                <td>
                  {edit ? (
                    <Select
                      label={label}
                      hideLabel
                      required={m.required}
                      size="sm"
                      disabled={edit.disabled}
                      value={value || (m.required ? undefined : NONE)}
                      placeholder="Choose the column"
                      onValueChange={v => edit.onChange({ ...edit.columns, [m.field]: v === NONE ? null : v } as ColumnMapping)}
                      options={[...(m.required ? [] : [{ value: NONE, label: "Not in file" }]), ...headers.map(h => ({ value: h, label: h }))]}
                    />
                  ) : m.header ? <span className="imp-map-header">{m.header}</span> : <span className="ds-faint">Not in file</span>}
                </td>
                <td>
                  {unchecked ? (
                    <StatusIndicator variant="inline" status="unknown" label={unchecked === "pending" ? "Checking…" : "Not checked"} />
                  ) : (
                    <div className="imp-map-status">
                      <StatusIndicator variant="inline" status={status.kind} label={status.label} />
                      <span className="imp-map-reason">{m.reason}</span>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {/* Announces each new check of the columns, so a changed status is heard without moving focus. */}
      <p className="ds-sr-only" role="status">{summary}</p>
    </div>
  );
}
