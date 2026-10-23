// Build 25: the Settings data controls over the Build 24 native commands.
// Rust owns archive format, validation, restore installation and deletion; this
// module only passes the user's choices through `repository.dataControls`,
// remembers the last user-initiated export (never its path) and turns stable
// error codes into plain sentences.
import type {
  ArchiveRestorePreview,
  ArchiveRestoreResult,
  DataControlError,
  DataExportResult,
  PermanentDeletionPreview,
  PermanentDeletionResult,
} from "@fundedflow/domain";
import { z } from "zod";

import { repository } from "../../../lib/data/api";
import { DataControlFailure } from "../../../lib/data/data-controls";

export const RESTORE_PHRASE = "REPLACE ENTIRE JOURNAL";
export const ERASE_PHRASE = "ERASE ENTIRE JOURNAL";
export const accountDeletePhrase = (accountId: string) => `DELETE ACCOUNT ${accountId}`;

export type ExportKind = "archive" | "csv";
export const LAST_EXPORT_SETTING = "data_controls.last_export";

/** What is remembered about the last export: no path, no file name. */
export const lastExportSchema = z.object({
  kind: z.enum(["archive", "csv"]),
  scope: z.enum(["journal", "all-accounts", "account"]),
  accountName: z.string().nullable(),
  completedAt: z.string(),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export type LastExport = z.infer<typeof lastExportSchema>;

const CODE_COPY: Record<DataControlError["code"], string> = {
  invalid_archive: "This file isn't a complete FundedFlow archive. It may be damaged or cut short.",
  unsupported_version: "This archive comes from a FundedFlow version this app can't read safely. Update FundedFlow, then try again.",
  integrity: "The archive's contents don't match its checksums or references. It may have been changed or damaged.",
  unsafe_path: "The archive contains an unsafe file path, so it was rejected.",
  limit_exceeded: "This is larger than the supported archive limits.",
  missing_attachment: "A screenshot or file the journal refers to is missing, so the export or restore was stopped.",
  insufficient_space: "There isn't enough free disk space to do this safely. Free some space and try again.",
  io: "The file couldn't be read or written. Check the location and try again.",
  database: "The local journal couldn't complete the operation. Nothing was replaced.",
  confirmation_required: "The confirmation text didn't match exactly.",
  stale_preview: "Your data changed after this preview. Check it again before confirming.",
  linked_attempts: "This account is linked to other attempts, so it can't be deleted on its own.",
  unsupported_ownership: "Some of this account's history is shared or can't be separated safely, so it can't be deleted on its own.",
  busy: "Another FundedFlow window or process is using this journal. Close it and try again.",
  recovery_required: "An earlier restore or deletion needs to finish first. Use Retry in the app's recovery banner.",
  unrecognized_file: "A file in FundedFlow's attachments folder wasn't created by FundedFlow and belongs to no record, so nothing was changed. Move it out of that folder, then try again.",
};

/** A failed native data control, kept with its stable code and native limit detail. Nothing in it is a path or a row. */
export class DataControlProblem extends Error {
  constructor(
    readonly code: DataControlError["code"] | "dialog" | "unexpected",
    readonly detail?: string,
  ) {
    const copy = code === "dialog" ? "The file chooser couldn't open." : code === "unexpected" ? "The operation couldn't be completed." : CODE_COPY[code];
    super(detail ? `${copy} Over the limit: ${detail}.` : copy);
    this.name = "DataControlProblem";
  }
}

/** Prefix of a native preview warning naming one missing or changed attachment (`archive::MISSING_ATTACHMENT`). */
export const MISSING_ATTACHMENT = "Missing or changed attachment: ";
/** The attachment names in prefixed preview warnings. The dialogs show only these: the fixed native warnings repeat their own copy. */
export const missingAttachments = (warnings: readonly string[]): string[] =>
  warnings.filter(w => w.startsWith(MISSING_ATTACHMENT)).map(w => w.slice(MISSING_ATTACHMENT.length));

export function describeProblem(error: unknown): string {
  return error instanceof DataControlProblem ? error.message : new DataControlProblem("unexpected").message;
}

async function native<T>(task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    if (error instanceof DataControlFailure) throw new DataControlProblem(error.error.code, error.error.detail);
    throw new DataControlProblem("unexpected");
  }
}

export const exportArchive = (destination: string): Promise<DataExportResult> =>
  native(() => repository.dataControls.exportArchive({ destination, acknowledgePlaintext: true }));
export const exportCsv = (destination: string, accountId: string | null): Promise<DataExportResult> =>
  native(() => repository.dataControls.exportCsv({ destination, accountId, acknowledgePlaintext: true }));
export const inspectArchive = (source: string): Promise<ArchiveRestorePreview> =>
  native(() => repository.dataControls.inspectArchive({ source }));
export const restoreArchive = (source: string, previewToken: string): Promise<ArchiveRestoreResult> =>
  native(() => repository.dataControls.restoreArchive({ source, previewToken, confirmation: RESTORE_PHRASE }));
export const previewAccountDeletion = (accountId: string): Promise<PermanentDeletionPreview> =>
  native(() => repository.dataControls.previewDeletion({ scope: { kind: "account", accountId } }));
export const previewJournalErasure = (): Promise<PermanentDeletionPreview> =>
  native(() => repository.dataControls.previewDeletion({ scope: { kind: "journal" } }));
export const deletePermanently = (preview: PermanentDeletionPreview, confirmation: string): Promise<PermanentDeletionResult> =>
  native(() => repository.dataControls.deletePermanently({ scope: preview.scope, previewToken: preview.previewToken, confirmation }));
export const retryCleanup = (): Promise<void> => native(() => repository.dataControls.retryCleanup());

/* ---------- Native file chooser ---------- */

export interface FilePicker {
  save(kind: ExportKind, suggestedName: string): Promise<string | null>;
  open(): Promise<string | null>;
}

const FILTERS = {
  archive: [{ name: "FundedFlow archive", extensions: ["zip"] }],
  csv: [{ name: "CSV", extensions: ["csv"] }],
};

/** The Tauri dialog plugin. Cancel resolves to null; a chooser that can't open is a "dialog" problem. */
export const tauriFilePicker: FilePicker = {
  async save(kind, suggestedName) {
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      return (await save({ defaultPath: suggestedName, filters: FILTERS[kind] })) ?? null;
    } catch {
      throw new DataControlProblem("dialog");
    }
  },
  async open() {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({ multiple: false, directory: false, filters: FILTERS.archive });
      return typeof picked === "string" ? picked : null;
    } catch {
      throw new DataControlProblem("dialog");
    }
  },
};

/** The last segment of a local path, so completion messages never show the whole folder path. */
export function fileName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** "fundedflow-2026-10-21.ffj.zip" / "fundedflow-trades-2026-10-21.csv", from the local date. */
export function suggestedName(kind: ExportKind, now = new Date()): string {
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return kind === "archive" ? `fundedflow-${day}.ffj.zip` : `fundedflow-trades-${day}.csv`;
}

/* ---------- Count labels ---------- */

const ENTITY_LABELS: Record<string, string> = {
  accounts: "Accounts",
  account_attempt_links: "Reset links between attempts",
  account_archive_events: "Archive history entries",
  account_status_events: "Status history entries",
  account_phase_events: "Phase history entries",
  trades: "Trades",
  trade_round_trips: "Round-trip fills",
  import_batches: "CSV imports",
  import_rows: "Imported CSV rows",
  journal_entries: "Notes",
  trade_reviews: "Trade reviews",
  trade_corrections: "Trade corrections",
  daily_reviews: "Daily reviews",
  attachments: "Screenshots and files",
  rulebooks: "Rulebooks",
  rulebook_versions: "Rulebook versions",
  account_ledger_entries: "Ledger entries",
  account_snapshots: "Balance snapshots",
  tags: "Tags",
  strategies: "Strategies",
};

/** Named counts first (in a fixed order), then everything else as one "Other records" line. Zero rows are left out. */
export function countRows(counts: Record<string, number>): { label: string; value: number }[] {
  const rows: { label: string; value: number }[] = [];
  for (const [key, label] of Object.entries(ENTITY_LABELS)) {
    const value = counts[key] ?? 0;
    if (value > 0) rows.push({ label, value });
  }
  const other = Object.entries(counts).reduce((sum, [key, value]) => (key in ENTITY_LABELS ? sum : sum + value), 0);
  if (other > 0) rows.push({ label: "Other records", value: other });
  return rows;
}

const BLOCKER_COPY: Record<string, string> = {
  linked_attempts: "It is linked to an earlier or later attempt through a reset. Deleting it alone would break that history.",
  immutable_phase_history: "It has phase history, which FundedFlow keeps permanently for now.",
  immutable_shared_rulebook_history: "Its rulebook history is recorded on a rulebook it shares with other accounts.",
  attachment_owner_conflict: "A screenshot or file is linked between this account and another one.",
  unsupported_audit_or_sync_ownership: "The journal has audit or sync records that can't be divided by account yet.",
  immutable_or_shared_provenance: "Some of its records are shared with, or referenced by, other data.",
};
export const blockerText = (code: string) => BLOCKER_COPY[code] ?? "Some of its history can't be separated safely.";
