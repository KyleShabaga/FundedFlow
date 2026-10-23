// TASK-021: the account's trading day as Rust reports it (`list_account_freshness` `currentTradingDay`, in the
// account's zone and reset time, weekends rolled to Monday). The UI never derives it from the calendar day: while
// Rust hasn't answered, or can't, the day is unknown.
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { freshnessGateway } from "../../../lib/data/freshness";
import { useFeatureQuery } from "../../shared/hooks/use-feature-query";
import { readOperation } from "../../shared/operations";
import { featureKeys } from "../../shared/query-keys";
import { accountFreshnessKey } from "./freshness";

export type TradingDay = { kind: "loading" } | { kind: "unknown" } | { kind: "known"; day: string };

// The longest a timer waits; a later boundary is re-armed after it (as in ./freshness).
const MAX_WAIT_MS = 6 * 60 * 60 * 1000;

/**
 * Today's trading day for one account, from the shared freshness read. It re-reads at the row's
 * `nextTradingDayStart`, so an open window crosses the reset without a focus event.
 */
export function useTradingDay(accountId: string | null): TradingDay {
  const client = useQueryClient();
  const query = useFeatureQuery({ key: accountFreshnessKey, enabled: accountId !== null, read: signal => readOperation(() => freshnessGateway.list(new Date().toISOString()), rows => rows, signal) });
  const row = query.data?.find(r => r.accountId === accountId);
  const next = row ? Date.parse(row.nextTradingDayStart) : NaN;
  const readAt = query.observedAt ? Date.parse(query.observedAt) : NaN;
  useEffect(() => {
    // A read made at or after the boundary already has the new day.
    if (!Number.isFinite(next) || !(readAt < next)) return;
    const wait = Math.max(0, Math.min(next - Date.now(), MAX_WAIT_MS));
    const timer = setTimeout(() => { void client.invalidateQueries({ queryKey: accountFreshnessKey }); }, wait);
    return () => clearTimeout(timer);
  }, [next, readAt, client]);
  if (row) return { kind: "known", day: row.currentTradingDay };
  return query.isInitialLoading ? { kind: "loading" } : { kind: "unknown" };
}

/**
 * The trading day an instant belongs to (Rust, `list_account_freshness(asOf)`), for a reset dated in the past or
 * future. Keyed by account and instant, so an answer for an earlier instant never stands for the current one.
 */
export function useTradingDayAt(accountId: string, asOf: string | null): TradingDay {
  const query = useFeatureQuery({
    key: [...featureKeys.root, "account-trading-day", accountId, asOf],
    enabled: asOf !== null,
    read: signal => readOperation(() => freshnessGateway.list(asOf!), rows => rows.find(r => r.accountId === accountId)?.currentTradingDay ?? null, signal),
    isEmpty: () => false,
  });
  if (asOf === null) return { kind: "unknown" };
  if (query.data) return { kind: "known", day: query.data };
  return query.isInitialLoading ? { kind: "loading" } : { kind: "unknown" };
}
