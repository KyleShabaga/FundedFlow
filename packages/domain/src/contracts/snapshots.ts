// Account snapshots: persisted risk figures for one account and trading day.
// Shapes match apps/desktop/src-tauri/src/store/snapshots.rs. The repository
// stores what the rule engine (Build 16) computed; it calculates nothing and
// never fills a missing figure with zero (absent is null).

import { z } from "zod";

import { decimal } from "./fields.js";

export const snapshotDataSources = ["csv_import", "manual", "mixed", "none"] as const;
export const drawdownModes = ["static", "eod_trailing", "intraday_trailing"] as const;
export const snapshotStatuses = ["safe", "caution", "stop", "unknown", "needs_setup"] as const;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a trading day as YYYY-MM-DD");
const money = decimal;
const optionalMoney = decimal.nullish();

export const snapshotInputSchema = z
  .strictObject({
    accountId: z.string().min(1),
    rulebookVersionId: z.string().min(1).nullish(),
    tradingDay: day,
    isEndOfDay: z.boolean(),
    dataAsOf: z.iso.datetime({ offset: true }).nullish(),
    dataSource: z.enum(snapshotDataSources),
    engineVersion: z.string().trim().min(1),
    inputsHash: z.string().trim().min(1),
    feesIncluded: z.boolean(),
    unrealizedIncluded: z.boolean(),
    balance: money,
    realizedDayPnl: money,
    unrealizedPnl: optionalMoney,
    dailyLossLimit: optionalMoney,
    dailyLossRemaining: optionalMoney,
    drawdownMode: z.enum(drawdownModes).nullish(),
    highWaterMark: optionalMoney,
    drawdownFloor: optionalMoney,
    drawdownHeadroom: optionalMoney,
    drawdownLocked: z.boolean(),
    profitTarget: optionalMoney,
    tradingDaysCompleted: z.int().min(0),
    tradingDaysRequired: z.int().min(0).nullish(),
    status: z.enum(snapshotStatuses),
    statusReasons: z.array(z.string()),
    /** Inputs, formula steps, rule ids and contributing trade ids. */
    explanation: z.record(z.string(), z.unknown()).refine((o) => Object.keys(o).length > 0, "Explain the figures"),
  })
  .refine((s) => s.status !== "unknown" || s.statusReasons.length > 0, {
    path: ["statusReasons"],
    message: "An unknown status must say why",
  });
export type SnapshotInput = z.input<typeof snapshotInputSchema>;

const nullableMoney = z.string().nullable();

export const snapshotSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  rulebookVersionId: z.string().nullable(),
  tradingDay: z.string(),
  isEndOfDay: z.boolean(),
  dataAsOf: z.string().nullable(),
  dataSource: z.enum(snapshotDataSources),
  calculatedAt: z.string(),
  engineVersion: z.string(),
  inputsHash: z.string(),
  feesIncluded: z.boolean(),
  unrealizedIncluded: z.boolean(),
  balance: z.string(),
  realizedDayPnl: z.string(),
  unrealizedPnl: nullableMoney,
  dailyLossLimit: nullableMoney,
  dailyLossRemaining: nullableMoney,
  drawdownMode: z.enum(drawdownModes).nullable(),
  highWaterMark: nullableMoney,
  drawdownFloor: nullableMoney,
  drawdownHeadroom: nullableMoney,
  drawdownLocked: z.boolean(),
  profitTarget: nullableMoney,
  tradingDaysCompleted: z.number().int(),
  tradingDaysRequired: z.number().int().nullable(),
  status: z.enum(snapshotStatuses),
  statusReasons: z.array(z.string()),
  explanation: z.record(z.string(), z.unknown()),
});
export type Snapshot = z.infer<typeof snapshotSchema>;

export interface SnapshotQuery {
  /** Inclusive trading days (YYYY-MM-DD). */
  from?: string;
  to?: string;
  endOfDayOnly?: boolean;
}
