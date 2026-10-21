import { snapshotSchema } from "@fundedflow/domain";
import { z } from "zod";
import { accountRecordSchema } from "../../accounts/view-models/account";
import { currency, instant, moneyText, recordId, tradingDay } from "../../shared/contracts";

export const snapshotViewModelSchema = snapshotSchema.extend({
  id: recordId, accountId: recordId, currency: currency.nullable(), accountCurrency: currency, currencyBasis: z.literal("not-stored-in-snapshot"), tradingDay, calculatedAt: instant, dataAsOf: instant.nullable(),
  engineVersion: z.string().min(1), inputsHash: z.string().min(1), balance: moneyText.nullable(), realizedDayPnl: moneyText.nullable(),
  unrealizedPnl: moneyText.nullable(), dailyLossLimit: moneyText.nullable(), dailyLossRemaining: moneyText.nullable(),
  highWaterMark: moneyText.nullable(), drawdownFloor: moneyText.nullable(), drawdownHeadroom: moneyText.nullable(), profitTarget: moneyText.nullable(),
  provenance: z.literal("persisted-snapshot-not-live"),
});
export type SnapshotViewModel = z.infer<typeof snapshotViewModelSchema>;
export function toSnapshotViewModel(input: unknown, accountInput: unknown): SnapshotViewModel {
  const account = accountRecordSchema.parse(accountInput);
  const snapshot = snapshotSchema.parse(input);
  if (snapshot.accountId !== account.id) throw new Error("Account identity mismatch");
  return snapshotViewModelSchema.parse({ ...snapshot, currency: null, accountCurrency: account.currency, currencyBasis: "not-stored-in-snapshot", provenance: "persisted-snapshot-not-live" });
}
