// Account freshness (P0-D06): how recent an account's records are under the chosen policy. It is about data recency,
// never a live connection, correct balances, account safety or rule compliance. Inputs are stored instants from Rust
// (`list_account_freshness`); this compares elapsed instants only, and the trading-day boundaries come from Rust.
//
// Policy, as decided in triage (docs/design/screens/02-accounts.md#account-freshness-p0-d06):
// - Required: records updated (newest committed import or manually entered trade). The last trade's own time never
//   counts (no trades can be inactivity), nor does re-rendering or recalculating.
// - The newest import attempt failing after the last update needs attention.
// - A confirmed firm checkpoint is optional unless the policy requires it; a required one that is missing or too old
//   needs attention.
// - No records at all, inputs that can't be read and finished attempts are unknown (neutral). Missing is never fresh.
// - Paused attempts use the live policy. The worst required signal wins.
import { z } from "zod";

import type { AccountFreshnessInputs } from "../../lib/data/freshness";
import type { AccountViewModel } from "./view-models/account";

export const FRESHNESS_POLICY_SETTING = "freshness.policy";

const DAY_MS = 86_400_000;
export const LIMITS = { tradingDays: { min: 1, max: 9 }, days: { min: 1, max: 30 }, checkpointDays: { min: 1, max: 90 } } as const;

const recordsRule = z.discriminatedUnion("unit", [
  z.object({ unit: z.literal("trading_days"), count: z.number().int().min(LIMITS.tradingDays.min).max(LIMITS.tradingDays.max) }),
  z.object({ unit: z.literal("days"), count: z.number().int().min(LIMITS.days.min).max(LIMITS.days.max) }),
]);
const checkpointRule = z.discriminatedUnion("required", [
  z.object({ required: z.literal(false) }),
  z.object({ required: z.literal(true), maxDays: z.number().int().min(LIMITS.checkpointDays.min).max(LIMITS.checkpointDays.max) }),
]);
export const freshnessRulesSchema = z.object({ records: recordsRule, checkpoint: checkpointRule });
export type FreshnessRules = z.infer<typeof freshnessRulesSchema>;

export const PRESETS = {
  default: { records: { unit: "trading_days", count: 1 }, checkpoint: { required: false } },
  three_days: { records: { unit: "days", count: 3 }, checkpoint: { required: false } },
  with_checkpoint: { records: { unit: "days", count: 3 }, checkpoint: { required: true, maxDays: 7 } },
} as const satisfies Record<string, FreshnessRules>;
export type PresetName = keyof typeof PRESETS;

export const freshnessPolicySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.enum(["default", "three_days", "with_checkpoint"]) }),
  z.object({ mode: z.literal("custom"), rules: freshnessRulesSchema }),
]);
export type FreshnessPolicyPreference = z.infer<typeof freshnessPolicySchema>;

export interface ResolvedPolicy {
  mode: PresetName | "custom";
  rules: FreshnessRules;
  /** The saved preference couldn't be used, so the default applies. */
  fallback: boolean;
}

/** No saved preference, or one this build can't read, means the default policy (said so when it's a fallback). */
export function resolvePolicy(stored: unknown): ResolvedPolicy {
  if (stored === null || stored === undefined) return { mode: "default", rules: PRESETS.default, fallback: false };
  const parsed = freshnessPolicySchema.safeParse(stored);
  if (!parsed.success) return { mode: "default", rules: PRESETS.default, fallback: true };
  return parsed.data.mode === "custom"
    ? { mode: "custom", rules: parsed.data.rules, fallback: false }
    : { mode: parsed.data.mode, rules: PRESETS[parsed.data.mode], fallback: false };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "updated since the previous trading day began", "updated in the last 3 days". */
export function recordsRuleText(rules: FreshnessRules): string {
  const r = rules.records;
  if (r.unit === "trading_days") return r.count === 1 ? "records updated since the previous trading day began" : `records updated within the last ${plural(r.count, "trading day")}`;
  return `records updated in the last ${plural(r.count, "day")}`;
}
/** One sentence of what green means under `rules`. */
export function policyText(rules: FreshnessRules): string {
  const base = recordsRuleText(rules);
  return rules.checkpoint.required ? `${base}, and a firm checkpoint you confirmed in the last ${plural(rules.checkpoint.maxDays, "day")}` : base;
}

export type FreshnessStatus = "fresh" | "attention" | "unknown";
export type FreshnessReason =
  | { kind: "fresh" }
  | { kind: "records-stale" }
  | { kind: "import-failed"; at: string }
  | { kind: "no-checkpoint" }
  | { kind: "checkpoint-stale"; at: string }
  | { kind: "no-records" }
  | { kind: "finished" }
  | { kind: "unavailable" };

export interface AccountFreshness {
  status: FreshnessStatus;
  /** Every reason that applies, most important first; one `fresh` when nothing needs attention. */
  reasons: FreshnessReason[];
  /** The newest record update (import or manual entry), when there is one. */
  lastUpdateAt: string | null;
  lastCheckpointAt: string | null;
  /** The next instant at which this result can change with nothing new recorded (a threshold passing), if any. */
  nextChangeAt: string | null;
}

const isFinished = (status: AccountViewModel["status"]) => status === "passed" || status === "failed" || status === "closed";
const newest = (...values: (string | null)[]) => values.reduce<string | null>((a, b) => (b !== null && (a === null || Date.parse(b) > Date.parse(a)) ? b : a), null);

export function evaluateFreshness(
  account: Pick<AccountViewModel, "status">,
  inputs: AccountFreshnessInputs | undefined,
  rules: FreshnessRules,
  now: number,
): AccountFreshness {
  const blank = { lastUpdateAt: null, lastCheckpointAt: null, nextChangeAt: null };
  if (isFinished(account.status)) return { status: "unknown", reasons: [{ kind: "finished" }], ...blank, lastUpdateAt: inputs ? newest(inputs.lastCommittedImportAt, inputs.lastManualTradeAt) : null };
  if (!inputs) return { status: "unknown", reasons: [{ kind: "unavailable" }], ...blank };

  const lastUpdateAt = newest(inputs.lastCommittedImportAt, inputs.lastManualTradeAt);
  const lastCheckpointAt = inputs.lastConfirmedCheckpointAt;
  if (lastUpdateAt === null) return { status: "unknown", reasons: [{ kind: "no-records" }], ...blank, lastCheckpointAt };

  const changes: number[] = [];
  const attention: FreshnessReason[] = [];
  const updated = Date.parse(lastUpdateAt);

  // Records: a trading-day rule compares with the start Rust gave for that trading day; a day rule is elapsed time.
  let recordsFresh: boolean;
  if (rules.records.unit === "trading_days") {
    const boundary = inputs.tradingDayStarts[rules.records.count];
    // Without the boundary nothing can be said: never fresh by default.
    if (boundary === undefined) return { status: "unknown", reasons: [{ kind: "unavailable" }], lastUpdateAt, lastCheckpointAt, nextChangeAt: null };
    recordsFresh = updated >= Date.parse(boundary);
    if (recordsFresh) changes.push(Date.parse(inputs.nextTradingDayStart));
  } else {
    const until = updated + rules.records.count * DAY_MS;
    recordsFresh = now < until;
    if (recordsFresh) changes.push(until);
  }
  if (inputs.lastFailedImportAt !== null && Date.parse(inputs.lastFailedImportAt) > updated) attention.push({ kind: "import-failed", at: inputs.lastFailedImportAt });
  if (!recordsFresh) attention.push({ kind: "records-stale" });

  if (rules.checkpoint.required) {
    if (lastCheckpointAt === null) attention.push({ kind: "no-checkpoint" });
    else {
      const until = Date.parse(lastCheckpointAt) + rules.checkpoint.maxDays * DAY_MS;
      if (now >= until) attention.push({ kind: "checkpoint-stale", at: lastCheckpointAt });
      else changes.push(until);
    }
  }

  const next = changes.filter(t => t > now);
  const nextChangeAt = attention.length === 0 && next.length > 0 ? new Date(Math.min(...next)).toISOString() : null;
  return attention.length > 0
    ? { status: "attention", reasons: attention, lastUpdateAt, lastCheckpointAt, nextChangeAt: null }
    : { status: "fresh", reasons: [{ kind: "fresh" }], lastUpdateAt, lastCheckpointAt, nextChangeAt };
}

export const STATUS_WORD: Record<FreshnessStatus, string> = { fresh: "Fresh", attention: "Needs attention", unknown: "Unknown" };

/** A short reason for a list row; times through `at` (the display time zone). */
export function reasonText(reason: FreshnessReason, f: AccountFreshness, at: (instant: string) => string): string {
  switch (reason.kind) {
    case "fresh": return `updated ${at(f.lastUpdateAt!)}`;
    case "records-stale": return `last update ${at(f.lastUpdateAt!)}`;
    case "import-failed": return `last import failed ${at(reason.at)}`;
    case "no-checkpoint": return "no firm checkpoint confirmed";
    case "checkpoint-stale": return `firm checkpoint ${at(reason.at)}`;
    case "no-records": return "no records yet";
    case "finished": return "finished attempt, no new data expected";
    case "unavailable": return "couldn't check";
  }
}

/** "Fresh · updated Oct 21, 16:58 GMT-6", "Needs attention · last import failed …; last update …". */
export function freshnessLine(f: AccountFreshness, at: (instant: string) => string): string {
  return `${STATUS_WORD[f.status]} · ${f.reasons.map(r => reasonText(r, f, at)).join("; ")}`;
}
