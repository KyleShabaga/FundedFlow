import { tradeInputSchema, type TradeInput } from "@fundedflow/domain";
import { z } from "zod";
import { repository } from "../../../lib/data/api";
import { periodSchema, recordId, type Period } from "../../shared/contracts";
import { FeatureDataError, validateInput } from "../../shared/errors";
import { readOperation, requireAccount, writeOperation } from "../../shared/operations";
import { readAccount } from "../../accounts/api/accounts";
import { toTradeViewModel, tradeRecordSchema } from "../view-models/trade";

export const tradeFilterSchema = periodSchema.and(z.object({ symbol: z.string().min(1).optional(), side: z.enum(["long", "short"]).optional() }));
export type TradeFilters = Period & { symbol?: string; side?: "long" | "short" };
export async function readTrades(accountId: string, filters: TradeFilters = {}, signal?: AbortSignal) {
  validateInput(recordId, accountId);
  const parsed = validateInput(tradeFilterSchema, filters);
  const account = (await readAccount(accountId, signal)).value;
  return readOperation(() => repository.trades.list(accountId), values => values.map(value => toTradeViewModel(value, account)).filter(value =>
    (!parsed.from || value.tradingDay >= parsed.from) && (!parsed.to || value.tradingDay <= parsed.to) &&
    (!parsed.symbol || value.symbol === parsed.symbol) && (!parsed.side || value.side === parsed.side)), signal);
}
export async function requireTrade(accountId: string, id: string) {
  validateInput(recordId, id);
  const result = await readOperation(() => repository.trades.list(accountId), values => z.array(tradeRecordSchema).parse(values));
  const record = result.value.find(value => value.id === id);
  if (!record) throw new FeatureDataError("not-found");
  requireAccount(record.accountId, accountId);
}
export async function saveTrade(accountId: string, input: TradeInput, id?: string, assertReady?: () => void) {
  const parsed = validateInput(tradeInputSchema, input);
  if (parsed.accountId !== accountId) throw new FeatureDataError("validation");
  const account = (await readAccount(accountId)).value;
  if (id) await requireTrade(accountId, id);
  return writeOperation(() => id ? repository.trades.update(id, parsed) : repository.trades.create(parsed), value => { if (id) requireAccount(value.id, id); return toTradeViewModel(value, account); }, assertReady);
}
export async function removeTrade(accountId: string, id: string, assertReady?: () => void) {
  await requireTrade(accountId, id);
  return writeOperation(() => repository.trades.remove(id), () => undefined, assertReady);
}
export async function readTrade(accountId: string, id: string, signal?: AbortSignal) {
  validateInput(recordId, id);
  const result = await readTrades(accountId, {}, signal);
  const value = result.value.find(trade => trade.id === id);
  if (!value) throw new FeatureDataError("not-found");
  return { ...result, value };
}
