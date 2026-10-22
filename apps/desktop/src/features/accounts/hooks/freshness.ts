// P0-D06: one read of every account's freshness inputs, evaluated under the saved policy. It re-reads after any
// successful write in the app (an import, a trade, a checkpoint), when the window regains focus or becomes visible,
// and when a threshold passes; a policy change re-evaluates without reading. Nothing here writes.
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { freshnessGateway } from "../../../lib/data/freshness";
import { featureKeys } from "../../shared/query-keys";
import { useFeatureQuery } from "../../shared/hooks/use-feature-query";
import { readOperation } from "../../shared/operations";
import { useSetSetting, useSetting } from "../../settings/hooks/settings";
import { evaluateFreshness, FRESHNESS_POLICY_SETTING, freshnessPolicySchema, resolvePolicy, type AccountFreshness, type FreshnessPolicyPreference } from "../freshness";
import type { AccountViewModel } from "../view-models/account";

export const accountFreshnessKey = [...featureKeys.root, "account-freshness"] as const;
// The longest a timer waits; a later threshold is re-armed after it (browsers cap timers near 24.8 days).
const MAX_WAIT_MS = 6 * 60 * 60 * 1000;

export function useFreshnessPolicy() {
  const setting = useSetting(FRESHNESS_POLICY_SETTING);
  const save = useSetSetting(FRESHNESS_POLICY_SETTING);
  const loaded = setting.data !== undefined;
  const readFailed = !loaded && setting.error !== null && !setting.isRuntimePending;
  return {
    /** The default until the preference is read; a preference that can't be read is a fallback to the default. */
    policy: readFailed ? { ...resolvePolicy(null), fallback: true } : resolvePolicy(loaded ? setting.data?.value ?? null : null),
    /** The preference has been read (or can't be): dots may show. */
    ready: loaded || readFailed,
    save: (preference: FreshnessPolicyPreference) => save.submit(freshnessPolicySchema.parse(preference)),
    isSaving: save.isPending,
    saveError: save.error,
  };
}

export function useAccountFreshness(accounts: readonly AccountViewModel[] | undefined) {
  const client = useQueryClient();
  const query = useFeatureQuery({ key: accountFreshnessKey, read: signal => readOperation(() => freshnessGateway.list(new Date().toISOString()), rows => rows, signal) });
  const { policy, ready } = useFreshnessPolicy();
  const [now, setNow] = useState(() => Date.now());

  // Any successful write may have changed an input; re-read (one query for every account).
  useEffect(() => client.getMutationCache().subscribe(event => {
    if (event.type === "updated" && event.mutation.state.status === "success") void client.invalidateQueries({ queryKey: accountFreshnessKey });
  }), [client]);
  useEffect(() => {
    const refresh = () => { setNow(Date.now()); void client.invalidateQueries({ queryKey: accountFreshnessKey }); };
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [client]);

  const inputs = query.data;
  const byId = useMemo(() => {
    const map = new Map<string, AccountFreshness>();
    if (!accounts || !ready) return map;
    const rows = new Map((inputs ?? []).map(r => [r.accountId, r]));
    for (const a of accounts) map.set(a.id, evaluateFreshness(a, inputs ? rows.get(a.id) : undefined, policy.rules, now));
    return map;
  }, [accounts, inputs, policy.rules, ready, now]);

  // When the earliest threshold passes, re-read: a trading-day boundary needs Rust's new starts.
  const next = Math.min(...[...byId.values()].map(f => (f.nextChangeAt ? Date.parse(f.nextChangeAt) : Infinity)));
  useEffect(() => {
    if (!Number.isFinite(next)) return;
    const wait = Math.max(0, Math.min(next - Date.now(), MAX_WAIT_MS)) + 1_000;
    const timer = setTimeout(() => { setNow(Date.now()); void client.invalidateQueries({ queryKey: accountFreshnessKey }); }, wait);
    return () => clearTimeout(timer);
  }, [next, client]);

  return {
    /** undefined while loading (no dot yet); a row is unknown when its inputs couldn't be read. */
    get: (id: string): AccountFreshness | undefined => (query.data === undefined && query.error === null) || !ready ? undefined : byId.get(id),
    policy,
  };
}
