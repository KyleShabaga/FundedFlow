// What every rulebook screen needs about one account attempt: the account, its assignments, the
// version in force on today's trading day (Rust's; unknown while it can't be read) and catalogue
// names. All reads are keyed by the account id, so switching account never shows another attempt's rulebook.
import { useAccount } from "../../accounts/hooks/accounts";
import { useTradingDay } from "../../accounts/hooks/trading-day";
import { currentAssignment } from "../../accounts/setup";
import { useAccountRulebookAssignments, useCatalogue, useRulebooks, useRulebookVersion } from "../../references/hooks/references";
import { catalogueNames } from "../view-models/versions";

export function useAccountRulebookContext(accountId: string | null) {
  const account = useAccount(accountId);
  const assignments = useAccountRulebookAssignments(accountId);
  const rulebooks = useRulebooks(accountId);
  const catalogue = useCatalogue();
  const timeZone = account.data?.timezone ?? "UTC";
  const tradingDay = useTradingDay(accountId);
  const current = assignments.data && tradingDay.kind === "known" ? currentAssignment(assignments.data, tradingDay.day) : null;
  const currentVersion = useRulebookVersion(current?.rulebookVersionId ?? null);
  const own = (rulebooks.data ?? []).filter(r => r.ownerAccountId === accountId && r.recordStatus === "active");
  return {
    account,
    assignments,
    rulebooks,
    /** Today's trading day from Rust; `current` is null until it is known. */
    tradingDay,
    current,
    currentVersion,
    /** The account's own (private) rulebook. Build 19 creates at most one per account. */
    privateRulebook: own[0] ?? null,
    names: catalogueNames(catalogue.data),
    catalogueUnavailable: catalogue.error !== null,
    timeZone,
  };
}
export type AccountRulebookContext = ReturnType<typeof useAccountRulebookContext>;
