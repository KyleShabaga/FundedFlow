// One account attempt's overview (Build 18.5, NA-4): the reads behind the Accounts card and the detail page's Risk
// section, so both say the same thing. The account, its lineage, setup and assigned rulebook (Build 15/19), and the
// same saved calculation, freshness check and canonical records Today uses (Build 16/21); overviewModel turns them
// into words. Nothing is calculated here.
import { formatInstant, formatMoney } from "../../../design-system";
import { useRulebookVersion } from "../../references/hooks/references";
import { useTodayAccount } from "../../today/hooks/today";
import type { Loadable } from "../../today/view-models/today";
import { useAccountFacts } from "../components/presentation";
import { overviewModel, type OverviewRecords } from "../view-models/overview";
import type { AccountViewModel } from "../view-models/account";
import { useAccountLineage } from "./accounts";

function loadable<T>(data: T | undefined, error: unknown): Loadable<T> {
  if (data !== undefined) return { state: "ready", value: data };
  return error ? { state: "error" } : { state: "loading" };
}

/** `checkedAt` is Today's check instant: a saved calculation is only called current against it. */
export function useAccountOverview(account: AccountViewModel, activeId: string | null, checkedAt: string) {
  const facts = useAccountFacts(account);
  const today = useTodayAccount(account, checkedAt);
  const lineage = useAccountLineage(account.id);
  const versionId = facts.rulebook.kind === "assigned" ? facts.rulebook.assignment.rulebookVersionId : null;
  const version = useRulebookVersion(versionId);
  const inputs = today.facts.data?.inputs;
  const records: Loadable<OverviewRecords> = inputs
    ? { state: "ready", value: { trades: inputs.trades, observations: inputs.observations, phaseHistory: inputs.phaseHistory } }
    : today.facts.error ? { state: "error" } : { state: "loading" };
  const summary = facts.summary;
  const fmt = (amount: string | null) => formatMoney(amount, { signed: false, currency: account.currency, dp: 2 });
  const model = overviewModel({
    account,
    activeId,
    attempt: summary && lineage.data ? { number: summary.attemptNumber, of: lineage.data.length } : null,
    setup: facts.setup,
    rulebook: facts.rulebook,
    version: loadable(version.data, version.error),
    truth: today.truth,
    records,
    fmt,
    when: at => formatInstant(at, { timeZone: account.timezone, year: true, zoneName: true }),
  });
  return { model, facts, today };
}
