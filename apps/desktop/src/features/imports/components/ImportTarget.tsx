// The destination account attempt: chosen by local id, explained by name, firm,
// status, broker number and reset lineage. Archived attempts are refused; finished
// attempts and trades outside an attempt's reset window need explicit confirmation
// (from the native preview). Nothing is reassigned or split automatically.
import { statusLabels, type AttemptSummary, type CsvPreview } from "@fundedflow/domain";
import { useQueryClient } from "@tanstack/react-query";

import { Checkbox, formatInstant, InlineNotice, Select, StatList } from "../../../design-system";
import { ACCOUNT_TYPE_LABELS } from "../../accounts/components/presentation";
import { useAccount } from "../../accounts/hooks/accounts";
import { featureKeys } from "../../shared/query-keys";
import type { AccountViewModel } from "../../accounts/view-models/account";

export interface TargetAssessment {
  blocked: string | null;
  confirmations: string[];
}

export function assessTarget(account: AccountViewModel | undefined, native?: CsvPreview["targetAssessment"]): TargetAssessment {
  if (!account) return { blocked: "Choose the account these trades belong to.", confirmations: [] };
  if (account.archivedAt) return { blocked: `"${account.name}" is archived. Restore it first before importing.`, confirmations: [] };
  return native ?? { blocked: null, confirmations: [] };
}

export interface RecheckProblem {
  title: string;
  description: string;
  /** The account itself changed (archived, status, gone): the destination must be chosen again. */
  changed: boolean;
}

/**
 * Re-reads the destination just before a commit and checks it again: it may have been archived or changed since
 * the preview. Shared by the wizard and Quick Import so both refuse the same things.
 */
export function useDestinationRecheck(accountId: string | null) {
  const client = useQueryClient();
  const accountQuery = useAccount(accountId);
  return async (account: AccountViewModel, native: CsvPreview["targetAssessment"]): Promise<RecheckProblem | null> => {
    try {
      await accountQuery.refresh();
    } catch {
      return { title: "Couldn't check the account", description: "Nothing was imported. Try again when local data is available.", changed: false };
    }
    const latest = client.getQueryData<{ value: AccountViewModel }>(featureKeys.detail(account.id))?.value;
    const recheck = assessTarget(latest, native);
    if (!latest || recheck.blocked || latest.status !== account.status)
      return { title: "The account changed", description: "Nothing was imported. Check the destination and review again.", changed: true };
    return null;
  };
}

/** Other unarchived accounts using the same broker account number: easy to confuse with this attempt. */
export function sameNumberAccounts(account: AccountViewModel | undefined, accounts: readonly AccountViewModel[]): AccountViewModel[] {
  if (!account?.externalRef) return [];
  return accounts.filter(a => a.id !== account.id && a.externalRef === account.externalRef && (a.broker ?? "") === (account.broker ?? ""));
}

export const accountOptionLabel = (a: AccountViewModel) =>
  `${a.propFirm ? `${a.propFirm} · ` : ""}${a.name}${a.externalRef ? ` (${a.externalRef})` : ""}${a.status === "active" ? "" : ` · ${statusLabels[a.status]}`}${a.archivedAt ? " · Archived" : ""}`;

export function ImportTargetPicker({
  accounts,
  value,
  onChange,
  lineage,
  assessment,
  confirmed,
  onConfirmedChange,
  showConfirm,
  disabled,
}: {
  accounts: readonly AccountViewModel[];
  value: string | null;
  onChange: (id: string) => void;
  lineage: readonly AttemptSummary[] | undefined;
  assessment: TargetAssessment;
  confirmed: boolean;
  onConfirmedChange: (confirmed: boolean) => void;
  /** Confirmations come from the native assessment of the complete preview. */
  showConfirm: boolean;
  disabled?: boolean;
}) {
  const account = accounts.find(a => a.id === value);
  const attempt = lineage?.find(a => a.accountId === value);
  const previous = attempt && lineage ? lineage[attempt.attemptNumber - 2] : undefined;
  const next = attempt && lineage ? lineage[attempt.attemptNumber] : undefined;
  const twins = sameNumberAccounts(account, accounts);
  // Archived accounts stay visible so a reused number is explainable, but can't be chosen.
  const options = [...accounts]
    .sort((a, b) => Number(Boolean(a.archivedAt)) - Number(Boolean(b.archivedAt)) || accountOptionLabel(a).localeCompare(accountOptionLabel(b)))
    .map(a => ({ value: a.id, label: accountOptionLabel(a), disabled: a.archivedAt !== null }));

  return (
    <div className="imp-target">
      <Select label="Import into" required value={value ?? undefined} onValueChange={onChange} options={options} placeholder="Choose an account" disabled={disabled}
        description="The exact account attempt that will own these trades. Duplicates are checked within this attempt only." />
      {account && (
        <StatList
          label="Destination account"
          bordered
          items={[
            { label: "Account", value: account.propFirm ? `${account.propFirm} · ${account.name}` : account.name },
            { label: "Type", value: ACCOUNT_TYPE_LABELS[account.accountType] },
            { label: "Status", value: `${statusLabels[account.status]}${account.archivedAt ? " · Archived" : ""}` },
            { label: "Account number", value: account.externalRef ?? "Not set" },
            ...(attempt && lineage && lineage.length > 1
              ? [{ label: "Attempt", value: `${attempt.attemptNumber} of ${lineage.length}` }]
              : []),
            ...(previous?.resetToNext ? [{ label: "Started after", value: `${previous.name} reset ${formatInstant(previous.resetToNext.effectiveAt, { timeZone: account.timezone, year: true })}` }] : []),
            ...(attempt?.resetToNext && next ? [{ label: "Followed by", value: `${next.name} from ${formatInstant(attempt.resetToNext.effectiveAt, { timeZone: account.timezone, year: true })}` }] : []),
            { label: "Trading days", value: `${account.timezone}, day starts ${account.tradingDayResetTime}` },
          ]}
        />
      )}
      {twins.length > 0 && (
        <InlineNotice tone="warning" live="polite" title="Another account uses the same account number">
          {twins.map(t => accountOptionLabel(t)).join("; ")}. Check this is the attempt the trades belong to; FundedFlow never moves trades between attempts.
        </InlineNotice>
      )}
      {assessment.blocked && account && <InlineNotice tone="error" live="assertive">{assessment.blocked}</InlineNotice>}
      {!assessment.blocked && showConfirm && assessment.confirmations.length > 0 && (
        <InlineNotice tone="warning" live="polite" title="Check the destination before importing">
          <ul className="imp-list">{assessment.confirmations.map(c => <li key={c}>{c}</li>)}</ul>
          <Checkbox label="These trades belong to this attempt" checked={confirmed} onChange={e => onConfirmedChange(e.target.checked)} />
        </InlineNotice>
      )}
    </div>
  );
}
