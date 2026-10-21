import { accountSchema, accountHistorySchema, attemptSummarySchema, isRiskEligible } from "@fundedflow/domain";
import { z } from "zod";
import { currency, instant, moneyText, recordId, timeZone, tradingDay } from "../../shared/contracts";

export const accountRecordSchema = accountSchema.extend({
  id: recordId, currency, timezone: timeZone, startingBalance: moneyText,
  createdAt: instant, updatedAt: instant, archivedAt: instant.nullable(),
  predecessorAccountId: recordId.nullable(), successorAccountId: recordId.nullable(),
});
export const accountViewModelSchema = accountRecordSchema.extend({
  riskEligible: z.boolean(), provenance: z.literal("stored-account"),
});
export type AccountViewModel = z.infer<typeof accountViewModelSchema>;
export function toAccountViewModel(input: unknown): AccountViewModel {
  const account = accountRecordSchema.parse(input);
  return accountViewModelSchema.parse({ ...account, riskEligible: isRiskEligible(account), provenance: "stored-account" });
}
export const historyViewModelSchema = accountHistorySchema.extend({
  accountId: recordId,
  statusEvents: z.array(accountHistorySchema.shape.statusEvents.element.extend({ effectiveAt: instant, recordedAt: instant })),
  archiveEvents: z.array(accountHistorySchema.shape.archiveEvents.element.extend({ occurredAt: instant })),
  /** Native history payloads expose no event IDs. Do not invent persisted identities from array positions. */
  eventIdentity: z.literal("not-exposed-by-backend"),
});
export const lineageSchema = z.array(attemptSummarySchema.extend({
  accountId: recordId, startingBalance: moneyText, netPnl: moneyText.nullable(),
  archivedAt: instant.nullable(), createdAt: instant,
  firstTradingDay: tradingDay.nullable(), lastTradingDay: tradingDay.nullable(),
}));
