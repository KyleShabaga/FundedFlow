import { deletedTradeSchema, tradeChangeOptionsSchema, tradeDetailSchema, tradeInputSchema,
  type ImportSource, type TradeChangeOptions, type TradeCorrection, type TradeInput } from "@fundedflow/domain";
import { z } from "zod";
import { repository } from "../../../lib/data/api";
import { periodSchema, recordId, type Period } from "../../shared/contracts";
import { FeatureDataError, validateInput } from "../../shared/errors";
import { readOperation, requireAccount, writeOperation } from "../../shared/operations";
import { readAccount } from "../../accounts/api/accounts";
import { toTradeViewModel, tradeRecordSchema, type TradeViewModel } from "../view-models/trade";

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

/* ---------- Build 20: detail, corrections, delete and restore ---------- */

export interface TradeRecordView {
  trade: TradeViewModel;
  importSource: ImportSource | null;
  corrections: TradeCorrection[];
  previousTradeId: string | null;
  nextTradeId: string | null;
  position: number;
  total: number;
}
export async function readTradeRecord(accountId: string, id: string, signal?: AbortSignal) {
  validateInput(recordId, accountId);
  validateInput(recordId, id);
  const account = (await readAccount(accountId, signal)).value;
  return readOperation(() => repository.trades.detail(accountId, id), value => {
    const detail = tradeDetailSchema.parse(value);
    requireAccount(detail.trade.accountId, accountId);
    requireAccount(detail.trade.id, id);
    return { ...detail, trade: toTradeViewModel(detail.trade, account) } satisfies TradeRecordView;
  }, signal);
}
/** A correction of a manual or imported trade, refused when the trade changed since `expectedUpdatedAt`. */
export async function correctTrade(accountId: string, id: string, input: TradeInput, options: TradeChangeOptions, assertReady?: () => void) {
  validateInput(recordId, id);
  const parsed = validateInput(tradeInputSchema, input);
  if (parsed.accountId !== accountId) throw new FeatureDataError("validation");
  const opts = validateInput(tradeChangeOptionsSchema, options);
  const account = (await readAccount(accountId)).value;
  return writeOperation(() => repository.trades.update(id, parsed, opts), value => { requireAccount(value.id, id); return toTradeViewModel(value, account); }, assertReady);
}
export async function deleteTrade(accountId: string, id: string, reason: string | null, assertReady?: () => void) {
  await requireTrade(accountId, id);
  return writeOperation(() => repository.trades.remove(id, reason), () => undefined, assertReady);
}
export async function restoreTrade(accountId: string, id: string, assertReady?: () => void) {
  validateInput(recordId, accountId);
  validateInput(recordId, id);
  const account = (await readAccount(accountId)).value;
  return writeOperation(() => repository.trades.restore(accountId, id, null), value => { requireAccount(value.accountId, accountId); return toTradeViewModel(value, account); }, assertReady);
}
export async function readDeletedTrades(accountId: string, signal?: AbortSignal) {
  validateInput(recordId, accountId);
  const account = (await readAccount(accountId, signal)).value;
  return readOperation(() => repository.trades.listDeleted(accountId), values => values.map(value => {
    const parsed = deletedTradeSchema.parse(value);
    return { trade: toTradeViewModel(parsed.trade, account), deletedAt: parsed.deletedAt };
  }), signal);
}
