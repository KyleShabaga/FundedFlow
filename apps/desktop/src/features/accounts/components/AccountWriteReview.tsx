// Build 26.6: what an uncertain account write is checked against. A create is checked against the refreshed
// list of every account (archived included); an edit, status change or reset against the account as stored
// now. The queries mount with this component, so Check result re-reads them and a failed read keeps the lock.
import { statusLabels } from "@fundedflow/domain";

import { StatList } from "../../../design-system";
import { UncertainOutcomeReview, type UncertainWrite } from "../../shared/UncertainOutcomeReview";
import { useAccount, useAccounts } from "../hooks/accounts";
import { accountLabel } from "./presentation";

export function AccountWriteReview({ write, created, accountId, onAcknowledged }: {
  write: UncertainWrite;
  /** For a create: the name that was entered. */
  created?: string;
  /** For a write to an existing account. */
  accountId?: string;
  onAcknowledged?: () => void;
}) {
  const all = useAccounts("all");
  const one = useAccount(accountId ?? null);
  if (created !== undefined) {
    const wanted = created.trim().toLowerCase();
    const matches = (all.data ?? []).filter(a => a.name.trim().toLowerCase() === wanted);
    return (
      <UncertainOutcomeReview write={write} what="your accounts" reviewReady={all.data !== undefined && !all.error} readReviewed={all.refresh} onAcknowledged={onAcknowledged}>
        {matches.length
          ? <StatList label="Accounts with this name" items={matches.map(a => ({ label: accountLabel(a), value: `${statusLabels[a.status]}${a.archivedAt ? " · archived" : ""}` }))} />
          : <p>No account named “{created.trim()}” is in your journal.</p>}
      </UncertainOutcomeReview>
    );
  }
  const a = one.data;
  return (
    <UncertainOutcomeReview write={write} what="the account" reviewReady={a !== undefined && !one.error} readReviewed={one.refresh} onAcknowledged={onAcknowledged}>
      {a && <StatList label="The account as saved now" items={[
        { label: "Account", value: accountLabel(a) },
        { label: "Status", value: `${statusLabels[a.status]}${a.archivedAt ? " · archived" : ""}` },
        { label: "Starting balance", value: `${a.startingBalance} ${a.currency}` },
        { label: "Time zone", value: a.timezone },
        { label: "Next attempt", value: a.successorAccountId ? "Started" : "None" },
      ]} />}
    </UncertainOutcomeReview>
  );
}
