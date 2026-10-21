import type { AccountFilter } from "@fundedflow/domain";
import type { TradeFilters } from "../trades/api/trades";
import type { JournalFilters } from "../journal/api/journal";
import type { SnapshotFilters } from "../insights/api/snapshots";

const root = ["fundedflow", "features"] as const;
const account = (id: string | null) => [...root, "account", id] as const;
export const featureKeys = {
  root, accounts: [...root, "accounts"] as const,
  accountList: (filter: AccountFilter = "live") => [...root, "accounts", "list", filter] as const,
  account, detail: (id: string | null) => [...account(id), "detail"] as const,
  history: (id: string | null) => [...account(id), "history"] as const,
  lineageRoot: [...root, "lineage"] as const,
  lineage: (id: string | null) => [...root, "lineage", id] as const,
  deletion: (id: string | null) => [...account(id), "deletion-preview"] as const,
  tradeDetail: (id: string | null, tradeId: string | null) => [...account(id), "trades", "detail", tradeId] as const,
  tradesRoot: (id: string | null) => [...account(id), "trades"] as const,
  trades: (id: string | null, filters: TradeFilters = {}) => [...account(id), "trades", { from: filters.from ?? null, to: filters.to ?? null, symbol: filters.symbol ?? null, side: filters.side ?? null }] as const,
  journalDetail: (id: string | null, entryId: string | null) => [...account(id), "journal", "detail", entryId] as const,
  journalRoot: (id: string | null) => [...account(id), "journal"] as const,
  journal: (id: string | null, filters: JournalFilters = {}) => [...account(id), "journal", { from: filters.from ?? null, to: filters.to ?? null, tradeId: filters.tradeId ?? null, tag: filters.tag ?? null }] as const,
  imports: (id: string | null) => [...account(id), "imports"] as const,
  importResult: (id: string | null, batchId: string | null) => [...account(id), "imports", "batch", batchId] as const,
  importRows: (id: string | null, batchId: string | null) => [...account(id), "imports", "batch", batchId, "rows"] as const,
  snapshotsRoot: (id: string | null) => [...account(id), "snapshots"] as const,
  snapshots: (id: string | null, filters: SnapshotFilters = {}) => [...account(id), "snapshots", { from: filters.from ?? null, to: filters.to ?? null, endOfDayOnly: filters.endOfDayOnly ?? false }] as const,
  latestSnapshot: (id: string | null) => [...account(id), "snapshots", "latest"] as const,
  ledger: (id: string | null) => [...account(id), "ledger"] as const,
  ledgerBalance: (id: string | null) => [...account(id), "ledger-balance"] as const,
  settings: [...root, "settings"] as const,
  setting: (key: string | null) => [...root, "settings", key] as const,
  catalogue: [...root, "catalogue"] as const,
  accountLink: (id: string | null) => [...account(id), "catalogue-link"] as const,
  phaseEvents: (id: string | null) => [...account(id), "phase-events"] as const,
  offers: (id: string | null) => [...account(id), "offer-selections"] as const,
  rulebooks: (id: string | null) => [...root, "rulebooks", id] as const,
  rulebookVersions: (id: string | null) => [...root, "rulebook-versions", id] as const,
  rulebookVersion: (id: string | null) => [...root, "rulebook-version", id] as const,
  assignments: (id: string | null) => [...account(id), "rulebook-assignments"] as const,
  rulebookEvents: (id: string | null) => [...account(id), "rulebook-events"] as const,
  rulebookRoots: [[...root, "rulebooks"], [...root, "rulebook-versions"], [...root, "rulebook-version"], [...root, "applicable-rulebook"]] as const,
  capability: (name: string) => [...root, "capability", name] as const,
};
