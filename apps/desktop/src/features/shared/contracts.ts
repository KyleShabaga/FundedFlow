import { canonicalDecimal, microsToDecimal, toMicros } from "@fundedflow/domain";
import { z } from "zod";

export const recordId = z.string().min(1);
export const instant = z.iso.datetime({ offset: true });
export const tradingDay = z.iso.date();
export const currency = z.string().regex(/^[A-Z]{3}$/);
export const timeZone = z.string().refine(value => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}, "Use a supported IANA time zone");
export const decimalText = z.string().refine(value => canonicalDecimal(value) === value, "Use canonical decimal text");
/** Persisted money is exact i64 micro-units. Never round an invalid response into a valid amount. */
export const moneyText = decimalText.refine(value => {
  const micros = toMicros(value);
  return micros !== null && microsToDecimal(micros) === value;
}, "Money must be exact within i64 micro-units");
export const periodSchema = z.object({ from: tradingDay.optional(), to: tradingDay.optional() }).refine(
  period => !period.from || !period.to || period.from <= period.to,
  { path: ["to"], message: "End must not precede start" },
);
export type Period = z.infer<typeof periodSchema>;
export interface ReadReceipt<T> {
  value: T;
  /** Client observation time, never a backend calculation or freshness guarantee. */
  receivedAt: string;
  source: "local-repository";
}
export function receipt<T>(value: T): ReadReceipt<T> {
  return { value, receivedAt: new Date().toISOString(), source: "local-repository" };
}
