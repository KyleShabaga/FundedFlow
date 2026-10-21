// TEST ONLY. The Build 26 cross-feature store: one in-memory journal behind every route, composed from the
// feature-owned fakes instead of rewriting them. Accounts, settings, rulebooks, snapshots and evidence come from
// the Today store (Build 19/21); trades, reviews, library, daily reviews and Insights from the Journal store
// (Build 20/22/23) over the same accounts; imports replay the Build 17 Rust golden fixture. Data controls follow
// the Build 24 rules closely enough for UI safety journeys (exact phrases, preview tokens that go stale when data
// changes, link blockers, actual removal) and every output is parsed by the portable DTO schemas.
//
// Fakes prove frontend behaviour only. Archive integrity, transactional deletion, restart persistence and the
// stored calculations are covered by the Rust tests and parity fixtures.
import {
  archiveRestorePreviewSchema,
  archiveRestoreResultSchema,
  dataExportResultSchema,
  permanentDeletionPreviewSchema,
  permanentDeletionResultSchema,
  type Account,
  type ArchiveRestorePreview,
  type CsvImportRequest,
  type ImportBatch,
  type PermanentDeletionPreview,
  type PermanentDeletionPreviewRequest,
  type PermanentDeletionRequest,
  type Trade,
} from "@fundedflow/domain";

import { DataControlFailure } from "../lib/data/data-controls";
import { ACTIVE_ACCOUNT_SETTING } from "../features/accounts/active-account";
import { makeAccount } from "../features/accounts/test-store";
import { createImports, golden } from "../features/imports/test-store";
import { createJournalStore, trade as makeTrade } from "../features/journal/test-store";
import { createTodayStore } from "../features/today/test-store";

export { makeAccount, makeTrade };

const ZERO = "0".repeat(64);
const SHA = "a".repeat(64);

export interface AppStoreSeed {
  accounts?: Account[];
  trades?: Trade[];
  /** Stored active account; `null` leaves the setting unset. Defaults to the first account. */
  activeId?: string | null;
  /** The Journal/daily-review "current trading day". */
  currentDay?: string;
}

/** A pending read or write the test resolves explicitly (late responses, double submits, uncertain commits). */
export interface Hold {
  readonly path: string;
  readonly calls: unknown[][];
  /**
   * Lets every held call continue; later calls pass straight through. Resolves once the held calls have
   * finished (wrap in `act` so React has processed the late answers before asserting).
   */
  release(): Promise<void>;
  /** Fails every held call with `error` instead (a failed or uncertain write). */
  fail(error: unknown): Promise<void>;
}

export function createAppStore(seed: AppStoreSeed = {}) {
  const accounts = seed.accounts ?? [];
  const today = createTodayStore(accounts);
  const journal = createJournalStore(accounts, seed.trades ?? [], null, seed.currentDay ?? "2026-10-20", today);
  const activeId = seed.activeId === undefined ? accounts[0]?.id ?? null : seed.activeId;
  if (activeId) today.settings.set(ACTIVE_ACCOUNT_SETTING, activeId);

  // Today's engine inputs read the Journal store's live trades, so an import or edit is visible to risk too.
  const liveTrades = (accountId: string) => [...journal.all.values()].filter(r => !r.deletedAt && r.trade.accountId === accountId).map(r => r.trade);
  Object.defineProperty(today.trades, "get", { value: (accountId: string) => liveTrades(accountId) });

  /* ---------- Imports: Rust golden previews; a commit adds the preview's new trades ---------- */
  const imports = createImports();
  const commit = imports.repository.commit.getMockImplementation()!;
  imports.repository.commit.mockImplementation(async (req: CsvImportRequest): Promise<ImportBatch> => {
    const batch = await commit(req);
    const c = golden.cases.find(x => x.request.content === req.content)!;
    c.expected.preview.rows.filter(r => r.status === "new" && r.trade).forEach((r, i) => {
      const t = r.trade!;
      const id = `${batch.id}-t${i + 1}`;
      journal.all.set(id, { trade: makeTrade({ id, accountId: req.accountId, source: "csv_import", importBatchId: batch.id, symbol: t.symbol, side: t.side as Trade["side"],
        quantity: t.quantity, entryAt: t.entryAt, entryPrice: t.entryPrice, exitAt: t.exitAt, exitPrice: t.exitPrice, fees: t.fees, tradingDay: t.tradingDay,
        reportedPnl: t.reportedPnl, grossPnl: null, realizedPnl: t.realizedPnl, pnlStatus: t.pnlStatus as Trade["pnlStatus"] }), deletedAt: null });
    });
    version++;
    return batch;
  });

  /* ---------- Data controls ---------- */
  /** Bumped by every data change the fake knows about; a preview token names the version it saw. */
  let version = 0;
  const dataControlCalls: { method: string; request: unknown }[] = [];
  const fail = (code: ConstructorParameters<typeof DataControlFailure>[0]["code"]) => new DataControlFailure({ code, message: `native ${code}` });
  const tokenFor = (scope: PermanentDeletionPreview["scope"]) => `${scope.kind === "journal" ? "journal" : scope.accountId}@${version}`;
  const accountTrades = (accountId: string) => [...journal.all.values()].filter(r => r.trade.accountId === accountId).length;
  let cleanupPending = false;
  /** Set by a test: the archive inspect answers (a preview or a failure), keyed by source path. */
  const archives = new Map<string, ArchiveRestorePreview | DataControlFailure>();
  /** What a restore installs once the runtime retry runs (the "archive contents"). */
  let staged: { accounts: Account[]; trades: Trade[] } | null = null;

  function previewDeletion(request: PermanentDeletionPreviewRequest): PermanentDeletionPreview {
    const { scope } = request;
    if (scope.kind === "journal") {
      return permanentDeletionPreviewSchema.parse({
        scope, accountName: null, affectedEntities: { accounts: today.accounts.size, trades: journal.all.size }, attachments: [], linkedAccountIds: [], blockers: [],
        previewToken: tokenFor(scope), requiredConfirmation: "ERASE ENTIRE JOURNAL", localRecoveryCopies: 0,
        warnings: ["External/user-exported backups remain untouched; this is not a forensic secure-erase guarantee."],
      });
    }
    const account = today.accounts.get(scope.accountId);
    if (!account) throw fail("stale_preview");
    const linked = [account.predecessorAccountId, account.successorAccountId].filter((id): id is string => id !== null);
    return permanentDeletionPreviewSchema.parse({
      scope, accountName: account.name, affectedEntities: { accounts: 1, trades: accountTrades(account.id) }, attachments: [], linkedAccountIds: linked,
      blockers: [...(linked.length ? ["linked_attempts"] : []), ...(blocked.get(account.id) ?? [])],
      previewToken: tokenFor(scope), requiredConfirmation: `DELETE ACCOUNT ${account.id}`, localRecoveryCopies: 0,
      warnings: ["External/user-exported backups remain untouched; this is not a forensic secure-erase guarantee."],
    });
  }
  /** Extra native blockers by account (shared rulebook history, attachment ownership). */
  const blocked = new Map<string, string[]>();
  let deletionOutcome: "completed" | "cleanup_pending" = "completed";

  function erase(accountIds: string[]) {
    for (const id of accountIds) {
      today.accounts.delete(id);
      for (const [tid, row] of journal.all) if (row.trade.accountId === id) journal.all.delete(tid);
      imports.batches.splice(0, imports.batches.length, ...imports.batches.filter(b => b.accountId !== id));
    }
    version++;
  }

  const dataControls = {
    exportArchive: async (request: unknown) => {
      dataControlCalls.push({ method: "exportArchive", request });
      return dataExportResultSchema.parse({ operationId: "op-export", state: "completed", bytes: 4096, sha256: SHA, plaintext: true });
    },
    exportCsv: async (request: unknown) => {
      dataControlCalls.push({ method: "exportCsv", request });
      return dataExportResultSchema.parse({ operationId: "op-csv", state: "completed", bytes: 512, sha256: SHA, plaintext: true });
    },
    inspectArchive: async (request: { source: string }) => {
      dataControlCalls.push({ method: "inspectArchive", request });
      const found = archives.get(request.source);
      if (!found) throw fail("invalid_archive");
      if (found instanceof DataControlFailure) throw found;
      return archiveRestorePreviewSchema.parse({ ...found, previewToken: `restore@${version}`, replacedEntities: { accounts: today.accounts.size, trades: journal.all.size } });
    },
    restoreArchive: async (request: { source: string; previewToken: string; confirmation: string }) => {
      dataControlCalls.push({ method: "restoreArchive", request });
      if (request.confirmation !== "REPLACE ENTIRE JOURNAL") throw fail("confirmation_required");
      if (request.previewToken !== `restore@${version}`) throw fail("stale_preview");
      return archiveRestoreResultSchema.parse({ operationId: "op-restore", state: "restart_required", safetyBackupId: "safety-1" });
    },
    previewDeletion: async (request: PermanentDeletionPreviewRequest) => {
      dataControlCalls.push({ method: "previewDeletion", request });
      return previewDeletion(request);
    },
    deletePermanently: async (request: PermanentDeletionRequest) => {
      dataControlCalls.push({ method: "deletePermanently", request });
      const current = previewDeletion({ scope: request.scope });
      if (request.confirmation !== current.requiredConfirmation) throw fail("confirmation_required");
      if (request.previewToken !== current.previewToken) throw fail("stale_preview");
      if (current.blockers.includes("linked_attempts")) throw fail("linked_attempts");
      if (current.blockers.length) throw fail("unsupported_ownership");
      erase(request.scope.kind === "journal" ? [...today.accounts.keys()] : [request.scope.accountId]);
      if (request.scope.kind === "journal") today.settings.clear();
      cleanupPending = deletionOutcome === "cleanup_pending";
      return permanentDeletionResultSchema.parse({ operationId: "op-delete", state: deletionOutcome, affectedEntities: current.affectedEntities });
    },
    retryCleanup: async () => {
      dataControlCalls.push({ method: "retryCleanup", request: null });
      cleanupPending = false;
    },
  };

  /** Installs the staged archive, as the native runtime does on its retry after `restart_required`. */
  function installStaged() {
    if (!staged) return;
    erase([...today.accounts.keys()]);
    for (const a of staged.accounts) today.accounts.set(a.id, structuredClone(a));
    for (const t of staged.trades) journal.all.set(t.id, { trade: structuredClone(t), deletedAt: null });
    staged = null;
  }

  const repository: Record<string, Record<string, (...args: never[]) => unknown>> = {
    ...journal.repository,
    imports: { ...imports.repository, list: imports.repository.list },
    dataControls,
  } as never;

  /* ---------- Holds: pending calls resolved by the test ---------- */
  const holds: { path: string; when: (args: unknown[]) => boolean; gate: Promise<void>; done: Promise<unknown>[]; hold: Hold }[] = [];
  for (const [ns, methods] of Object.entries(repository)) {
    if (!methods || typeof methods !== "object") continue;
    const wrapped: Record<string, unknown> = {};
    for (const [name, fn] of Object.entries(methods)) {
      if (typeof fn !== "function") { wrapped[name] = fn; continue; }
      const path = `${ns}.${name}`;
      wrapped[name] = async (...args: unknown[]) => {
        const entry = holds.find(h => h.path === path && h.when(args));
        if (!entry) return (fn as (...a: unknown[]) => unknown)(...args);
        entry.hold.calls.push(structuredClone(args));
        const result = entry.gate.then(() => (fn as (...a: unknown[]) => unknown)(...args));
        entry.done.push(result.catch(() => {}));
        return result;
      };
    }
    repository[ns] = wrapped as never;
  }
  /** Holds calls to `path` ("accounts.list", "trades.list"…) matching `when` until released or failed. */
  function hold(path: string, when: (args: unknown[]) => boolean = () => true): Hold {
    let open!: () => void;
    let reject!: (error: unknown) => void;
    const gate = new Promise<void>((yes, no) => { open = yes; reject = no; });
    gate.catch(() => {});
    const settle = (finish: () => void) => {
      if (holds.includes(entry)) holds.splice(holds.indexOf(entry), 1);
      finish();
      return Promise.all(entry.done).then(() => {});
    };
    const entry = {
      path, when, gate, done: [] as Promise<unknown>[],
      hold: {
        path, calls: [] as unknown[][],
        release: () => settle(open),
        fail: (error: unknown) => settle(() => reject(error)),
      },
    };
    holds.push(entry);
    return entry.hold;
  }

  return {
    repository: repository as never,
    today, journal, imports, dataControlCalls, archives, blocked, hold,
    accounts: today.accounts,
    settings: today.settings,
    trades: journal.all,
    get version() { return version; },
    /** Marks data as changed outside the current preview (another window, a background write). */
    touch: () => { version++; },
    setDeletionOutcome: (state: "completed" | "cleanup_pending") => { deletionOutcome = state; },
    get cleanupPending() { return cleanupPending; },
    stageRestore: (contents: { accounts: Account[]; trades: Trade[] }) => { staged = structuredClone(contents); },
    installStaged,
  };
}

export type AppStore = ReturnType<typeof createAppStore>;

/** A valid archive preview body in the Build 24 wire shape; tokens and replaced counts come from the store. */
export function archivePreview(over: { accountIds?: string[]; entities?: Record<string, number>; schemaVersion?: number } = {}): ArchiveRestorePreview {
  return {
    state: "validated", archiveSha256: ZERO, previewToken: "set-by-store", requiredConfirmation: "REPLACE ENTIRE JOURNAL", requiredFreeBytes: 1_048_576,
    replacedEntities: {}, warnings: [],
    manifest: {
      format: "fundedflow-journal", formatVersion: 1, schemaVersion: over.schemaVersion ?? 18, producerVersion: "0.1.0", createdAt: "2026-10-20T00:00:00.000Z",
      exportId: "export-1", protection: "plaintext", accountIds: over.accountIds ?? ["acct-old"], attachments: [],
      entities: over.entities ?? { accounts: 1, trades: 1 },
      financialEncoding: "sqlite-i64-micros-and-exact-decimal-text;JSON-integers-as-text",
      timeEncoding: "stored-UTC-instants;account-IANA-zone-and-reset;stored-trading-day",
      entries: [{ path: "journal.sqlite", bytes: 0, sha256: ZERO }], maxEntryBytes: 67108864, maxTotalBytes: 268435456, maxEntries: 4096,
    },
  };
}
