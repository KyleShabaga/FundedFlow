// CSV import flow: choose a file → inspect format and mapping → preview every
// row (parsed values, warnings, errors, duplicate status) → confirm → summary.
// The file is read locally and passed to the Rust backend over Tauri IPC; it is
// never uploaded. All file content is rendered as text (no HTML injection).

import { useId, useMemo, useState } from "react";

import { DataError, repository } from "../lib/data/api";
import {
  type ColumnMapping,
  type CsvPreview,
  type ImportBatch,
  type RowReport,
  MAX_CSV_BYTES,
  MAX_CSV_ROWS,
  csvFormats,
  dateFormats,
} from "../lib/data/schemas";

const formatLabels: Record<(typeof csvFormats)[number], string> = {
  auto: "Detect automatically",
  performance: "Performance export (buy/sell fill pairs)",
  generic: "Generic trades (side, entry, exit)",
};
const dateLabels: Record<(typeof dateFormats)[number], string> = {
  auto: "Detect (asks if ambiguous)",
  ymd: "YYYY-MM-DD HH:MM:SS",
  mdy: "M/D/YYYY HH:MM:SS (month first)",
  dmy: "D/M/YYYY HH:MM:SS (day first)",
};
const genericFields: (keyof ColumnMapping)[] = [
  "symbol", "side", "quantity", "entryTime", "entryPrice", "exitTime", "exitPrice", "fees", "realizedPnl", "brokerTradeId", "notes",
];
const statusFilters = ["all", "new", "warnings", "duplicate", "invalid", "blank"] as const;
type StatusFilter = (typeof statusFilters)[number];

const localTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
const basisText = (b: string | null) =>
  b === "sell_first" ? "short — sell filled first" : b === "buy_first" ? "long — buy filled first" : b === "same_time" ? "long — same time" : "";

function errorText(e: unknown) {
  if (e instanceof DataError) {
    return e.issues.length > 1 ? `${e.message}: ${e.issues.map((i) => `${i.field} — ${i.message}`).join("; ")}` : e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

function summary(p: CsvPreview) {
  return (
    `${p.rowCount} rows: ${p.newCount} ready to import, ${p.duplicateCount} duplicate, ` +
    `${p.invalidCount} invalid, ${p.blankCount} blank; ${p.warningCount} with warnings.`
  );
}

function Details({ r }: { r: RowReport }) {
  return (
    <ul className="ff-findings">
      {r.errors.map((i, k) => (
        <li key={`e${k}`} className="ff-finding-error">
          Error · {i.field}: {i.message}
        </li>
      ))}
      {r.duplicate && <li className="ff-finding-dup">Duplicate: {r.duplicate.reason}</li>}
      {r.warnings.map((i, k) => (
        <li key={`w${k}`} className="ff-finding-warn">
          Warning · {i.field}: {i.message}
        </li>
      ))}
      {r.status === "invalid" && r.raw.length > 0 && <li className="ff-raw">Original: {r.raw.join(" | ")}</li>}
    </ul>
  );
}

export function CsvImportSection({
  accountId,
  imports,
  onImported,
}: {
  accountId: string;
  imports: ImportBatch[];
  onImported: () => Promise<void>;
}) {
  const id = useId();
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [format, setFormat] = useState<(typeof csvFormats)[number]>("auto");
  const [dateFormat, setDateFormat] = useState<(typeof dateFormats)[number]>("auto");
  const [timezone, setTimezone] = useState(localTimezone);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  // Any change to the inputs makes an earlier preview stale.
  const reset = (message = "") => {
    setPreview(null);
    setStatus(message);
    setError("");
  };

  const request = () => ({
    accountId,
    fileName: file?.name ?? "",
    content: file?.content ?? "",
    timezone,
    format,
    dateFormat,
    columns: format !== "performance" ? mapping : null,
  });

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const pickFile = (f: File | undefined) => {
    setMapping(null);
    setFile(null);
    reset();
    if (!f) return;
    if (f.size > MAX_CSV_BYTES) {
      setError(`${f.name} is ${(f.size / 1024 / 1024).toFixed(1)} MB; the limit is 10 MB. Split the file and import the parts.`);
      return;
    }
    void run(async () => {
      setFile({ name: f.name, content: await f.text() });
      setStatus(`${f.name} loaded (${(f.size / 1024).toFixed(1)} KB). Choose Preview to check it before saving.`);
    });
  };

  const runPreview = () =>
    run(async () => {
      const p = await repository.imports.preview(request());
      setPreview(p);
      setFilter("all");
      setStatus(p.fileIssues.length ? `Cannot import yet: ${p.fileIssues.length} file problem(s).` : `Preview: ${summary(p)}`);
    });

  const runImport = () =>
    run(async () => {
      try {
        const b = await repository.imports.commit(request());
        reset(
          `Imported ${b.importedCount} of ${b.rowCount} rows from ${b.fileName}: ` +
            `${b.duplicateCount} duplicate and ${b.skippedCount - b.duplicateCount} blank skipped, ` +
            `${b.failedCount} invalid not imported, ${b.warningCount} with warnings.`,
        );
      } finally {
        await onImported();
      }
    });

  const editMapping = (field: keyof ColumnMapping, header: string) => {
    const base: ColumnMapping =
      mapping ??
      (Object.fromEntries(genericFields.map((f) => [f, preview?.mapping.find((m) => m.field === f)?.header ?? ""])) as ColumnMapping);
    setMapping({ ...base, [field]: header });
    reset("Mapping changed. Preview again before importing.");
  };

  const rows = useMemo(() => {
    const all = preview?.rows ?? [];
    if (filter === "all") return all;
    if (filter === "warnings") return all.filter((r) => r.warnings.length > 0);
    return all.filter((r) => r.status === filter);
  }, [preview, filter]);

  const canImport = !!preview && preview.fileIssues.length === 0 && preview.newCount > 0 && !busy;

  return (
    <fieldset aria-describedby={`${id}-limits`}>
      <legend>CSV import</legend>
      <p id={`${id}-limits`} className="ff-hint">
        Up to 10 MB and {MAX_CSV_ROWS.toLocaleString()} rows per file. The file is read on this computer and never
        uploaded. Nothing is saved until you confirm the import.
      </p>

      <div className="ff-row">
        <label>
          CSV file
          <input type="file" accept=".csv,text/csv" disabled={busy} onChange={(e) => pickFile(e.target.files?.[0])} />
        </label>
        <label>
          Format
          <select value={format} onChange={(e) => { setFormat(e.target.value as typeof format); reset(); }}>
            {csvFormats.map((f) => <option key={f} value={f}>{formatLabels[f]}</option>)}
          </select>
        </label>
        <label>
          Date format
          <select value={dateFormat} onChange={(e) => { setDateFormat(e.target.value as typeof dateFormat); reset(); }}>
            {dateFormats.map((f) => <option key={f} value={f}>{dateLabels[f]}</option>)}
          </select>
        </label>
        <label>
          Time zone of the file's times
          <input value={timezone} onChange={(e) => { setTimezone(e.target.value); reset(); }} />
        </label>
        <button type="button" onClick={() => void runPreview()} disabled={!file || busy}>
          Preview
        </button>
      </div>

      <div role="status" aria-live="polite" className="ff-status">{status}</div>
      {error && <div role="alert" className="ff-error">{error}</div>}

      {preview && (
        <>
          <p>
            <strong>Detected:</strong> {preview.formatReason}.{" "}
            {preview.dateFormat && <>Dates: {preview.dateFormatReason}.</>}
            {preview.filePreviouslyImported && " This exact file was imported into this account before."}
          </p>
          {preview.fileIssues.length > 0 && (
            <ul role="alert" className="ff-error">
              {preview.fileIssues.map((i) => <li key={i.field + i.message}>{i.field}: {i.message}</li>)}
            </ul>
          )}
          {preview.fileWarnings.length > 0 && (
            <ul className="ff-findings">
              {preview.fileWarnings.map((i) => <li key={i.field + i.message} className="ff-finding-warn">{i.message}</li>)}
            </ul>
          )}

          <details open={preview.format === "generic"}>
            <summary>Column mapping ({preview.mapping.filter((m) => m.header).length} of {preview.mapping.length} fields mapped)</summary>
            <table>
              <caption className="ff-visually-hidden">How CSV headers map to journal fields</caption>
              <thead><tr><th scope="col">Field</th><th scope="col">CSV column</th></tr></thead>
              <tbody>
                {preview.mapping.map((m) => (
                  <tr key={m.field}>
                    <td>{m.field}{m.required && " (required)"}</td>
                    <td>
                      {preview.format === "generic" ? (
                        <select
                          aria-label={`CSV column for ${m.field}`}
                          value={(mapping?.[m.field as keyof ColumnMapping] ?? m.header) || ""}
                          onChange={(e) => editMapping(m.field as keyof ColumnMapping, e.target.value)}
                        >
                          <option value="">— not mapped —</option>
                          {preview.headers.map((h, k) => <option key={k} value={h.trim()}>{h}</option>)}
                        </select>
                      ) : (
                        m.header ?? "— not in file —"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.ignoredHeaders.length > 0 && <p className="ff-hint">Kept but not mapped: {preview.ignoredHeaders.join(", ")}</p>}
          </details>

          <div className="ff-row">
            <label>
              Show
              <select value={filter} onChange={(e) => setFilter(e.target.value as StatusFilter)}>
                {statusFilters.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => void runImport()} disabled={!canImport} aria-describedby={`${id}-summary`}>
              Import {preview.newCount} valid new row{preview.newCount === 1 ? "" : "s"}
            </button>
            <span id={`${id}-summary`} className="ff-hint">{summary(preview)} Invalid and duplicate rows are not imported.</span>
          </div>

          <div className="ff-table-wrap">
            <table>
              <caption className="ff-visually-hidden">Row-by-row preview of {preview.rowCount} rows</caption>
              <thead>
                <tr>
                  <th scope="col">Line</th>
                  <th scope="col">Status</th>
                  <th scope="col">Trade</th>
                  <th scope="col">Entry</th>
                  <th scope="col">Exit</th>
                  <th scope="col">P&amp;L</th>
                  <th scope="col">Duration</th>
                  <th scope="col">Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const t = r.trade;
                  const entrySource = t?.entryBasis === "sell_first" ? t.soldAtSource : t?.boughtAtSource;
                  const exitSource = t?.entryBasis === "sell_first" ? t.boughtAtSource : t?.soldAtSource;
                  return (
                    <tr key={r.rowNumber} className={`ff-status-${r.status}`}>
                      <td>{r.lineNumber}</td>
                      <td>{r.status}{r.warnings.length > 0 && " ⚠"}</td>
                      <td>
                        {t ? (
                          <>
                            {t.symbol} · {t.side} {t.quantity}
                            {t.entryBasis && <div className="ff-hint">{basisText(t.entryBasis)}</div>}
                            {(t.buyFillId || t.sellFillId) && <div className="ff-hint">fills {t.buyFillId ?? "?"} / {t.sellFillId ?? "?"}</div>}
                            {t.brokerTradeId && <div className="ff-hint">ID {t.brokerTradeId}</div>}
                          </>
                        ) : "—"}
                      </td>
                      <td>{t ? <>{t.entryPrice}<div className="ff-hint">{entrySource ?? new Date(t.entryAt).toLocaleString()}</div></> : "—"}</td>
                      <td>{t?.exitPrice ? <>{t.exitPrice}<div className="ff-hint">{exitSource ?? (t.exitAt && new Date(t.exitAt).toLocaleString())}</div></> : "—"}</td>
                      <td>{t ? (t.realizedPnl ?? t.pnlStatus) : "—"}{t?.reportedPnl && t.reportedPnl !== t.realizedPnl && <div className="ff-hint">file: {t.reportedPnl}</div>}</td>
                      <td>{t?.duration ?? "—"}</td>
                      <td><Details r={r} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {preview.rowsOmitted > 0 && <p className="ff-hint">{preview.rowsOmitted} more new rows without findings are not listed.</p>}
          </div>
        </>
      )}

      <h3 className="ff-subhead">Import history</h3>
      {imports.length === 0 ? (
        <p className="ff-hint">No imports yet.</p>
      ) : (
        <ul>
          {imports.map((b) => (
            <li key={b.id}>
              {new Date(b.createdAt).toLocaleString()} · {b.fileName} ({b.sourceFormat}) · {b.status} · {b.importedCount} imported,{" "}
              {b.duplicateCount} duplicate, {b.failedCount} invalid, {b.warningCount} with warnings
              {b.errorSummary && ` · ${b.errorSummary}`}
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}
