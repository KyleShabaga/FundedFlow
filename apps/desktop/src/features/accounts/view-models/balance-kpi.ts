// The Accounts "Current balance" KPI (NA-4). Only engine balances Today calls current are totalled, one total per
// currency through format.ts (bigint micro-units); currencies are never added together and nothing unknown counts
// as zero. Checkpoints and stale estimates stay on each account's card and detail page.
import { formatMoney, sumMoney, type MetricValue } from "../../../design-system";

/** A live account's balance for the KPI: still checking, not current (or none), or the current engine balance. */
export type CurrentBalance = undefined | null | { amount: string; currency: string };

/**
 * The Current balance KPI: one total per currency over live accounts whose balance is current, never added across
 * currencies; — when none is. The note says how many live accounts that covers, so excluded ones stay visible.
 */
export function currentBalanceKpi(balances: readonly CurrentBalance[]): { value: MetricValue; sub: string } {
  const total = balances.length;
  if (balances.some(b => b === undefined)) return { value: { kind: "text", text: null }, sub: "Checking estimates…" };
  const current = balances.filter((b): b is NonNullable<CurrentBalance> => !!b);
  const of = `${current.length} of ${total} live ${total === 1 ? "account" : "accounts"}`;
  if (current.length === 0) {
    // MetricCard shows an unavailable value's reason in place of the sub line, so the count goes in the reason.
    const none = total === 0 ? "No live accounts." : total === 1 ? "The live account has no current estimate." : `None of the ${total} live accounts has a current estimate.`;
    return { value: { kind: "unavailable", reason: total === 0 ? none : `${none} Calculate on Today; the table's Current balance shows each account's latest checkpoint or why it has none.` }, sub: `${of} · none current` };
  }
  const byCurrency = new Map<string, string[]>();
  for (const b of current) byCurrency.set(b.currency, [...(byCurrency.get(b.currency) ?? []), b.amount]);
  const totals = [...byCurrency].sort(([a], [b]) => a.localeCompare(b)).map(([currency, amounts]) => ({ currency, amount: sumMoney(amounts) }));
  if (totals.length === 1) return { value: { kind: "money", amount: totals[0]!.amount, currency: totals[0]!.currency, signed: false }, sub: `${of} · current estimates` };
  return {
    value: { kind: "text", text: totals.map(t => formatMoney(t.amount, { signed: false, currency: t.currency })).join(" · ") },
    sub: `${of} · each currency totalled on its own`,
  };
}

