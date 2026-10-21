// Build 26.6: what an uncertain manual trade or correction is checked against: the account's trades as
// stored now (for a new trade, those with the entered symbol; for a correction, that trade). Trade writes
// share one lock per account, so releasing it after review matters for every later trade write.
import { formatInstant, StatList } from "../../../design-system";
import type { AccountViewModel } from "../../accounts/view-models/account";
import { UncertainOutcomeReview, type UncertainWrite } from "../../shared/UncertainOutcomeReview";
import { useTrades } from "../../trades/hooks/trades";

export function TradeWriteReview({ write, account, symbol, tradeId }: {
  write: UncertainWrite;
  account: AccountViewModel;
  /** For a new trade: the entered symbol. */
  symbol?: string;
  /** For a correction: the trade corrected. */
  tradeId?: string;
}) {
  const trades = useTrades(account.id);
  const wanted = (symbol ?? "").trim().toUpperCase();
  const rows = (trades.data ?? []).filter(t => (tradeId ? t.id === tradeId : t.symbol.toUpperCase() === wanted));
  return (
    <UncertainOutcomeReview write={write} what={tradeId ? "the trade" : "this account's trades"} reviewReady={trades.data !== undefined && !trades.error} readReviewed={trades.refresh}>
      {rows.length
        ? <StatList label={tradeId ? "The trade as saved now" : `Saved ${wanted} trades`} items={rows.map(t => ({
          label: `${t.symbol} ${t.side} ${t.quantity}`,
          value: `entry ${formatInstant(t.entryAt, { timeZone: account.timezone })} · fees ${t.fees}`,
        }))} />
        : <p>{tradeId ? "This trade isn't in the journal any more." : `No ${wanted || "matching"} trade is saved in this account.`}</p>}
    </UncertainOutcomeReview>
  );
}
