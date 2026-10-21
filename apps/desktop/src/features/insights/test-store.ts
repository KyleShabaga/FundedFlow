// TEST ONLY. The Build 23 dataset read over the Journal test store's in-memory accounts, trades and reviews, following
// src-tauri/src/store/insights.rs closely enough for UI journeys: exactly the requested accounts (archived included),
// active trades only, deleted trades counted, review strategy/tags/R as recorded. Real SQL, planned-risk derivation and
// trading days are tested in Rust (store/insights_tests.rs); the metrics by the parity fixture.
import { RepositoryError, type Account, type InsightsDataset, type InsightsQuery, type Trade, type TradeReview } from "@fundedflow/domain";

export interface InsightsFakeSource {
  account: (id: string) => Account | undefined;
  trades: () => { trade: Trade; deletedAt: string | null }[];
  review: (tradeId: string) => TradeReview | undefined;
  /** The user's stated cause for an account's current status. */
  cause?: (accountId: string) => string | null;
}

const ROOTS = ["MNQ", "MES", "ES", "NQ", "CL", "GC"];
const root = (symbol: string) => ROOTS.find(r => new RegExp(`^/?${r}([FGHJKMNQUVXZ]\\d{1,4})?$`, "i").test(symbol)) ?? null;

export function createInsightsFake(source: InsightsFakeSource, generatedAt = "2026-10-20T15:00:00.000Z") {
  const calls: InsightsQuery[] = [];
  let failing = false;
  const chainRoot = (a: Account): { root: string; n: number } => {
    let at = a; let n = 1;
    while (at.predecessorAccountId) { const prev = source.account(at.predecessorAccountId); if (!prev) break; at = prev; n += 1; }
    return { root: at.id, n };
  };
  const repository = {
    dataset: async (query: InsightsQuery): Promise<InsightsDataset> => {
      calls.push(structuredClone(query));
      if (failing) throw new RepositoryError({ kind: "database", message: "insights read failed" });
      const ids = [...new Set(query.accountIds)];
      const accounts = ids.map(id => {
        const a = source.account(id);
        if (!a) throw new RepositoryError({ kind: "notFound", message: `account '${id}' was not found` });
        const { root: lineageRootId, n } = chainRoot(a);
        return {
          id: a.id, name: a.name, broker: a.broker, propFirm: a.propFirm, externalRef: a.externalRef, accountType: a.accountType, status: a.status,
          archivedAt: a.archivedAt, currency: a.currency, timezone: a.timezone, tradingDayResetTime: a.tradingDayResetTime, createdAt: a.createdAt,
          lineageRootId, attemptNumber: n, predecessorAccountId: a.predecessorAccountId, successorAccountId: a.successorAccountId,
          statusEvent: { status: a.status, effectiveAt: a.updatedAt, cause: source.cause?.(a.id) ?? null, note: null },
          deletedTradeCount: source.trades().filter(r => r.trade.accountId === a.id && r.deletedAt).length,
          committedImportCount: 0, failedImportCount: 0, lastImportAt: null,
        };
      });
      const trades = source.trades().filter(r => !r.deletedAt && ids.includes(r.trade.accountId)).map(({ trade: t }) => {
        const r = source.review(t.id);
        return {
          id: t.id, accountId: t.accountId, source: t.source, importBatchId: t.importBatchId, symbol: t.symbol, symbolRoot: root(t.symbol), side: t.side,
          quantity: t.quantity, entryAt: t.entryAt, exitAt: t.exitAt, tradingDay: t.tradingDay, fees: t.fees, grossPnl: t.grossPnl, realizedPnl: t.realizedPnl,
          reportedPnl: t.reportedPnl, pnlStatus: t.pnlStatus, updatedAt: t.updatedAt,
          review: r ? { reviewed: r.reviewedAt !== null, strategyId: r.strategy?.id ?? null, strategyName: r.strategy?.label ?? null,
            tags: r.tags, plannedRisk: r.plannedRisk, plannedRiskSource: r.plannedRiskSource, rMultiple: r.rMultiple } : null,
        };
      }).sort((a, b) => (a.tradingDay + (a.exitAt ?? a.entryAt) + a.id < b.tradingDay + (b.exitAt ?? b.entryAt) + b.id ? -1 : 1));
      return { contractVersion: 1, generatedAt, accounts, trades };
    },
  };
  return { repository, calls, fail: (on = true) => { failing = on; } };
}
