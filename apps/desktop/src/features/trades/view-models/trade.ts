import { tradeSchema } from "@fundedflow/domain";
import { z } from "zod";
import { accountRecordSchema } from "../../accounts/view-models/account";
import { currency, decimalText, instant, moneyText, recordId, timeZone, tradingDay } from "../../shared/contracts";

export const tradeRecordSchema = tradeSchema.extend({
  id: recordId, accountId: recordId, entryAt: instant, exitAt: instant.nullable(),
  createdAt: instant, updatedAt: instant, tradingDay,
  quantity: decimalText.refine(value => value !== "0" && !value.startsWith("-")),
  entryPrice: decimalText, exitPrice: decimalText.nullable(), fees: moneyText, feesRecorded: z.boolean(),
  reportedPnl: moneyText.nullable(), grossPnl: moneyText.nullable(), realizedPnl: moneyText.nullable(),
  roundTrip: tradeSchema.shape.roundTrip.unwrap().extend({
    boughtAt: instant, soldAt: instant, buyPrice: decimalText, sellPrice: decimalText,
  }).nullable(),
});
export const tradeViewModelSchema = tradeRecordSchema.extend({
  currency, timeZone,
  calculationBasis: z.object({ authority: z.literal("rust-stored"), version: z.null(), net: z.literal("after-fees"), gross: z.literal("before-fees") }),
});
export type TradeViewModel = z.infer<typeof tradeViewModelSchema>;
/**
 * TASK-042 (R-NET): a closed trade whose fees were not recorded has an unknown net P&L. Rust stores gross − 0
 * (unchanged); per-trade views show `—` with a "Fees not recorded" badge. Totals keep the stored value and say how
 * many such trades they include (counted before fees).
 */
export const feesUnknown = (t: Pick<TradeViewModel, "feesRecorded" | "pnlStatus">) => !t.feesRecorded && t.pnlStatus !== "open";
/** The net P&L a per-trade view shows: the stored value, or unknown when fees were not recorded. */
export const shownNetPnl = (t: Pick<TradeViewModel, "feesRecorded" | "pnlStatus" | "realizedPnl">) => (feesUnknown(t) ? null : t.realizedPnl);
export function toTradeViewModel(input: unknown, accountInput: unknown): TradeViewModel {
  const record = tradeRecordSchema.parse(input);
  const account = accountRecordSchema.parse(accountInput);
  if (record.accountId !== account.id) throw new Error("Account identity mismatch");
  return tradeViewModelSchema.parse({ ...record, currency: account.currency, timeZone: account.timezone,
    calculationBasis: { authority: "rust-stored", version: null, net: "after-fees", gross: "before-fees" } });
}
