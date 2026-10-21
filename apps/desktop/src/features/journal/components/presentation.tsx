// Shared Journal pieces (Build 20): result, source and P&L-status badges, review tags, the account gate and time
// formatting in the account's zone. Values are shown as stored; unknown is "—", never zero.
import type { ReviewTag } from "@fundedflow/domain";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { Badge, Button, EmptyState, ErrorState, LoadingState, MoneyCell, tradeResult, UNKNOWN } from "../../../design-system";
import { useActiveAccount } from "../../accounts/active-account";
import type { AccountViewModel } from "../../accounts/view-models/account";
import type { TradeViewModel } from "../../trades/view-models/trade";

/**
 * A trade's detail page. With `accountId` the page shows exactly that attempt's trade (Insights drill-downs across
 * attempts, archived ones included); without it, the active account's.
 */
export const tradePath = (id: string, accountId?: string) =>
  `/journal/trades/${encodeURIComponent(id)}${accountId ? `?account=${encodeURIComponent(accountId)}` : ""}`;

export const STATUS_NOTE: Record<TradeViewModel["pnlStatus"], string | null> = {
  calculated: null,
  reported: "Broker P&L",
  open: "Open",
  missing_instrument: "No instrument",
  currency_mismatch: "Currency mismatch",
};
export const STATUS_EXPLANATION: Record<TradeViewModel["pnlStatus"], string> = {
  calculated: "Calculated by FundedFlow from the prices, quantity and the instrument's point value.",
  reported: "The symbol's point value isn't known, so this is the P&L the broker or you reported (before fees).",
  open: "The trade has no exit yet, so it has no P&L.",
  missing_instrument: "The symbol's point value isn't known and no broker P&L was given, so the P&L is unknown.",
  currency_mismatch: "The instrument is quoted in another currency than the account, and amounts are never converted.",
};

export function ResultBadge({ trade }: { trade: TradeViewModel }) {
  const r = tradeResult(trade);
  return <Badge tone={r.tone}>{r.text}</Badge>;
}
export function SideBadge({ side }: { side: "long" | "short" }) {
  return <Badge tone={side === "short" ? "loss" : "profit"} variant="outline">{side === "long" ? "Long" : "Short"}</Badge>;
}
export function SourceBadge({ trade }: { trade: TradeViewModel }) {
  return trade.source === "csv_import" ? <Badge tone="flow">Imported</Badge> : <Badge>Manual</Badge>;
}
export function NetPnl({ trade }: { trade: TradeViewModel }) {
  const note = trade.pnlStatus === "open" ? null : STATUS_NOTE[trade.pnlStatus];
  return (
    <span className="jr-pnl" title={note ? STATUS_EXPLANATION[trade.pnlStatus] : undefined}>
      <MoneyCell value={trade.realizedPnl} currency={trade.currency} />
      {note && <Badge tone={trade.pnlStatus === "reported" ? "flow" : "warn"}>{note}</Badge>}
    </span>
  );
}
export function TagList({ tags, limit = 3 }: { tags: readonly ReviewTag[]; limit?: number }) {
  if (tags.length === 0) return <span className="ds-faint">{UNKNOWN}</span>;
  const shown = tags.slice(0, limit);
  return (
    <span className="jr-tags">
      {shown.map(t => <Badge key={t.tagId} tone={t.kind === "mistake" ? "warn" : t.kind === "setup" ? "flow" : "neutral"} variant="outline">{t.label}</Badge>)}
      {tags.length > limit && <span className="ds-faint">+{tags.length - limit}</span>}
    </span>
  );
}

/** "16:12:05" in the account's zone. */
export function clock(instant: string | null, timeZone: string): string {
  if (!instant) return UNKNOWN;
  const ms = Date.parse(instant);
  if (Number.isNaN(ms)) return UNKNOWN;
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(ms));
}
/** "Mon, Oct 19, 2026" from a trading day (calendar arithmetic only). */
export function longDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(new Date(Date.UTC(y, m - 1, d)));
}
export function zoneLabel(timeZone: string): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(new Date()).find(p => p.type === "timeZoneName");
    return part ? `${timeZone} (${part.value})` : timeZone;
  } catch {
    return timeZone;
  }
}

/** Renders `children` for the selected account, or the right state when none can be used. Never guesses an account. */
export function JournalAccountGate({ children }: { children: (account: AccountViewModel) => ReactNode }) {
  const { state } = useActiveAccount();
  const navigate = useNavigate();
  const toAccounts = <Button variant="primary" onClick={() => navigate("/accounts")}>Go to Accounts</Button>;
  switch (state.kind) {
    case "loading":
      return <LoadingState label="Loading accounts" layout="table" rows={4} />;
    case "error":
      return <ErrorState scope="route" title="Accounts couldn't be loaded" message="The journal needs to know which account to show. Use the recovery controls, then try again." />;
    case "no-accounts":
      return (
        <div className="ds-card">
          <EmptyState kind="not-configured" title="Add an account to start journaling"
            description="Every trade belongs to an account. Add the one you trade; you can enter trades by hand or import a CSV afterwards."
            action={toAccounts} />
        </div>
      );
    case "unset":
    case "unavailable":
      return (
        <div className="ds-card">
          <EmptyState kind="not-configured"
            title={state.kind === "unset" ? "Choose an account" : "The selected account isn't available"}
            description={state.kind === "unset" ? "Pick the account to journal in the account selector at the top of the window." : "It was archived or no longer exists. Choose another account at the top of the window; nothing was changed."}
            action={toAccounts} />
        </div>
      );
    case "selected":
      return <>{children(state.account)}</>;
  }
}
