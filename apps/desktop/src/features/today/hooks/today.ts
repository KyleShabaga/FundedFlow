// Today's reads for one account attempt (Build 21). Everything is keyed by the account id through the existing
// Build 14/19 hooks, so a switch never shows another attempt's values: the latest saved calculation, its
// unchanged-inputs check, the canonical inputs read *now* (Rust trading day, records and the assignment in force),
// checkpoints and comparisons. No calculation runs here; a saved estimate is only ever checked.
import { defaultEnginePolicy, type RiskInputsQuery } from "@fundedflow/domain";
import { useEffect, useState } from "react";

import type { AccountViewModel } from "../../accounts/view-models/account";
import { useObservations, useReconciliations } from "../../evidence/hooks/evidence";
import { useLatestSnapshot } from "../../insights/hooks/insights";
import { useCalculationFreshness, useCalculationInputs } from "../../rulebooks/hooks/rulebooks";
import { getCapability } from "../../shared/capabilities";
import { deriveRiskTruth, headline, type Loadable } from "../view-models/today";

/**
 * Reading the records as of now needs a coverage statement; Today states nothing beyond what Rust checks itself
 * (baseline and end-of-day history are demoted natively when absent). It is never used to calculate.
 */
export const TODAY_FACTS_COVERAGE: RiskInputsQuery["coverage"] = Object.freeze({
  baseline: "available", eodHistory: "available", closedTrades: "incomplete", fees: "incomplete", ledger: "incomplete",
  openPositions: "unsupported", intradayHistory: "unsupported",
  sourceReference: "Today freshness check: no completeness stated",
});

const minute = (ms = Date.now()) => new Date(Math.floor(ms / 60_000) * 60_000).toISOString();

/**
 * The instant Today checks against ("now", to the minute). It moves only when the trader asks or comes back to the
 * window a minute or more later, never on a timer, so a figure is never refreshed behind the trader's back.
 */
export function useCheckTime() {
  const [checkedAt, setCheckedAt] = useState(() => minute());
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") setCheckedAt(prev => (minute() === prev ? prev : minute()));
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
  return { checkedAt, recheck: () => setCheckedAt(minute()) };
}

function loadable<T>(query: { data: T | undefined; error: unknown; isRuntimePending?: boolean }): Loadable<T> {
  if (query.data !== undefined) return query.error ? { state: "error" } : { state: "ready", value: query.data };
  return query.error ? { state: "error" } : { state: "loading" };
}

export function useTodayAccount(account: AccountViewModel, checkedAt: string) {
  const snapshot = useLatestSnapshot(account.id);
  const freshness = useCalculationFreshness(account.id, snapshot.data ?? null);
  const facts = useCalculationInputs(account.id, checkedAt, TODAY_FACTS_COVERAGE, defaultEnginePolicy);
  const observations = useObservations(account.id);
  const reconciliations = useReconciliations(account.id);
  const truth = deriveRiskTruth({
    account,
    snapshot: loadable(snapshot),
    // No snapshot means nothing to check; the truth is "none" before freshness is consulted.
    freshness: snapshot.data ? loadable(freshness) : { state: "loading" },
    facts: loadable({ data: facts.data?.inputs, error: facts.error }),
  });
  return { snapshot, freshness, facts, observations, reconciliations, truth, headline: headline(truth) };
}
export type TodayAccount = ReturnType<typeof useTodayAccount>;

/** Daily session review is Build 22; until then Today says so instead of linking to a screen that doesn't exist. */
export const useReviewCapability = () => getCapability("structured-reviews");
