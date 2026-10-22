// Import wizard state: what the trader has chosen, and which preview belongs to
// which exact request. A preview is only ever shown or committed for the request
// it was made from; changing the account, file, time zone, format, date order or
// mapping makes it stale. Nothing here parses CSV, detects duplicates or does
// arithmetic: the Rust preview is the only authority.
import { MAX_CSV_BYTES, utf8ByteLength, type ColumnMapping, type CsvImportRequest, type csvFormats, type dateFormats } from "@fundedflow/domain";

export type CsvFormatChoice = (typeof csvFormats)[number];
export type DateFormatChoice = (typeof dateFormats)[number];

/** A file read on this computer. The text lives only in memory for this wizard session. */
export interface LoadedFile {
  name: string;
  /** Bytes on disk (UTF-8), the unit of the 10 MiB limit. */
  size: number;
  content: string;
  /** Increments for every pick, so choosing the same file again still starts a fresh preview. */
  version: number;
}

export type FileProblem =
  | { kind: "not-csv"; name: string }
  | { kind: "too-large"; name: string; size: number }
  | { kind: "empty"; name: string }
  | { kind: "unreadable"; name: string }
  /** Several files dropped at once: one CSV per import. */
  | { kind: "several"; count: number };

export interface WizardState {
  step: 0 | 1 | 2 | 3;
  accountId: string | null;
  file: LoadedFile | null;
  fileProblem: FileProblem | null;
  /** IANA zone for timestamps in the file that carry no offset. */
  timezone: string;
  format: CsvFormatChoice;
  dateFormat: DateFormatChoice;
  /** Explicit generic mapping; null lets the backend match headers by name. */
  columns: ColumnMapping | null;
  /** The trader confirmed the destination warnings for this exact request key. */
  confirmedTargetFor: string | null;
}

export type WizardAction =
  | { type: "step"; step: WizardState["step"] }
  | { type: "account"; accountId: string | null }
  | { type: "file"; file: LoadedFile }
  | { type: "file-problem"; problem: FileProblem }
  | { type: "clear-file" }
  | { type: "timezone"; timezone: string }
  | { type: "format"; format: CsvFormatChoice }
  | { type: "date-format"; dateFormat: DateFormatChoice }
  | { type: "columns"; columns: ColumnMapping | null }
  | { type: "confirm-target"; key: string | null }
  | { type: "reset"; keep: Pick<WizardState, "accountId" | "timezone"> };

export function initialWizardState(accountId: string | null, timezone: string): WizardState {
  return { step: 0, accountId, file: null, fileProblem: null, timezone, format: "auto", dateFormat: "auto", columns: null, confirmedTargetFor: null };
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "step":
      return { ...state, step: action.step };
    case "account":
      // Another account means another duplicate scope and day boundary: start the review again.
      return action.accountId === state.accountId ? state : { ...state, accountId: action.accountId, confirmedTargetFor: null, step: 0 };
    case "file":
      // A new file never inherits the previous file's mapping or format choices.
      return { ...state, file: action.file, fileProblem: null, format: "auto", dateFormat: "auto", columns: null, confirmedTargetFor: null, step: 0 };
    case "file-problem":
      return { ...state, file: null, fileProblem: action.problem, columns: null, confirmedTargetFor: null, step: 0 };
    case "clear-file":
      return { ...state, file: null, fileProblem: null, columns: null, confirmedTargetFor: null, step: 0 };
    case "timezone":
      return action.timezone === state.timezone ? state : { ...state, timezone: action.timezone, confirmedTargetFor: null };
    case "format":
      return { ...state, format: action.format, columns: action.format === "performance" ? null : state.columns, confirmedTargetFor: null };
    case "date-format":
      return { ...state, dateFormat: action.dateFormat, confirmedTargetFor: null };
    case "columns":
      return { ...state, columns: action.columns, confirmedTargetFor: null };
    case "confirm-target":
      return { ...state, confirmedTargetFor: action.key };
    case "reset":
      return initialWizardState(action.keep.accountId, action.keep.timezone);
  }
}

/** The exact native request for the current choices, or null until an account and file are chosen. */
export function buildRequest(state: WizardState): CsvImportRequest | null {
  if (!state.accountId || !state.file) return null;
  return {
    accountId: state.accountId,
    fileName: state.file.name,
    content: state.file.content,
    timezone: state.timezone.trim(),
    format: state.format,
    dateFormat: state.dateFormat,
    columns: state.format === "performance" ? null : state.columns,
  };
}

/** Identifies a request without its content: the file version stands in for the bytes. */
export function requestKey(state: WizardState): string | null {
  if (!state.accountId || !state.file) return null;
  return JSON.stringify([state.accountId, state.file.version, state.file.name, state.timezone.trim(), state.format, state.dateFormat, state.format === "performance" ? null : state.columns]);
}

const CSV_TYPES = new Set(["text/csv", "application/csv", "application/vnd.ms-excel", "text/plain", ""]);

/** A UTF-8 byte order mark: the decoder removes it, so it is not part of the submitted text (P0-04). */
const UTF8_BOM_BYTES = 3;

/**
 * Reads a chosen file as strict UTF-8; anything else (UTF-16, legacy code pages, invalid bytes) is refused as
 * unreadable rather than guessed. The cap applies to the text that is submitted, measured in UTF-8 bytes as native
 * code measures it: the decoder drops a leading BOM, so a file may be up to 3 bytes larger than the cap if it has one.
 */
export async function readCsvFile(file: File, version: number): Promise<LoadedFile | FileProblem> {
  const isCsvName = /\.csv$/i.test(file.name);
  if (!isCsvName || !CSV_TYPES.has(file.type)) return { kind: "not-csv", name: file.name };
  // Too large even without a BOM: refuse before reading it into memory.
  if (file.size > MAX_CSV_BYTES + UTF8_BOM_BYTES) return { kind: "too-large", name: file.name, size: file.size };
  if (file.size === 0) return { kind: "empty", name: file.name };
  try {
    const bytes = await file.arrayBuffer();
    const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    // Strict decoding is lossless, so this is the file's size less any BOM.
    const submitted = utf8ByteLength(content) ?? Infinity;
    if (submitted > MAX_CSV_BYTES) return { kind: "too-large", name: file.name, size: submitted };
    if (content.trim() === "") return { kind: "empty", name: file.name };
    return { name: file.name, size: file.size, content, version };
  } catch {
    return { kind: "unreadable", name: file.name };
  }
}

export function fileProblemText(problem: FileProblem): string {
  switch (problem.kind) {
    case "not-csv":
      return `${problem.name} isn't a CSV file. Export the trades as .csv and choose that file.`;
    case "too-large":
      return `${problem.name} is ${(problem.size / 1024 / 1024).toFixed(1)} MB; the limit is 10 MB. Split the file and import the parts.`;
    case "empty":
      return `${problem.name} is empty. Choose the exported file with your trades.`;
    case "unreadable":
      return `${problem.name} couldn't be read as text (UTF-8). Export it again as CSV (UTF-8) and choose it again.`;
    case "several":
      return `${problem.count} files were dropped. Import one CSV at a time: drop or choose a single file.`;
  }
}

/** Generic mapping fields in the order the form shows them, with the backend's required flags. */
export const GENERIC_FIELDS: { field: keyof ColumnMapping; label: string; required: boolean }[] = [
  { field: "symbol", label: "Symbol", required: true },
  { field: "side", label: "Side (buy/sell or long/short)", required: true },
  { field: "quantity", label: "Quantity", required: true },
  { field: "entryTime", label: "Entry time", required: true },
  { field: "entryPrice", label: "Entry price", required: true },
  { field: "exitTime", label: "Exit time", required: false },
  { field: "exitPrice", label: "Exit price", required: false },
  { field: "fees", label: "Fees", required: false },
  { field: "realizedPnl", label: "P&L in the file", required: false },
  { field: "brokerTradeId", label: "Broker trade ID", required: false },
  { field: "notes", label: "Notes", required: false },
];

/** The mapping the backend used, as an editable ColumnMapping (headers by name). */
export function mappingFromPreview(mapping: { field: string; header: string | null }[]): ColumnMapping {
  const byField = new Map(mapping.map(m => [m.field, m.header]));
  const value = (f: keyof ColumnMapping) => byField.get(f) ?? null;
  return {
    symbol: value("symbol") ?? "",
    side: value("side") ?? "",
    quantity: value("quantity") ?? "",
    entryTime: value("entryTime") ?? "",
    entryPrice: value("entryPrice") ?? "",
    exitTime: value("exitTime"),
    exitPrice: value("exitPrice"),
    fees: value("fees"),
    realizedPnl: value("realizedPnl"),
    brokerTradeId: value("brokerTradeId"),
    notes: value("notes"),
  };
}
