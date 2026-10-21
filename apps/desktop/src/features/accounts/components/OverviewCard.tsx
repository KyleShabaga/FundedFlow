// One account attempt's overview card on the Accounts page (Build 18.5). Reads only existing hooks: the account,
// its lineage, setup and assigned rulebook (Build 15/19), and the same saved calculation, freshness check and
// canonical records Today uses (Build 16/21). overviewModel turns them into words; AccountOverviewCard lays them out.
import { Ellipsis, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { AccountOverviewCard, Badge, Button, DropdownMenu, formatInstant, formatMoney, IconButton, ProgressMeter } from "../../../design-system";
import { useRulebookVersion } from "../../references/hooks/references";
import { useTodayAccount } from "../../today/hooks/today";
import type { Loadable } from "../../today/view-models/today";
import { useAccountLineage } from "../hooks/accounts";
import { overviewModel, type OverviewRecords } from "../view-models/overview";
import type { AccountViewModel } from "../view-models/account";
import { accountMenu, type AccountDialog } from "./AccountActions";
import { useAccountFacts } from "./presentation";

function loadable<T>(data: T | undefined, error: unknown): Loadable<T> {
  if (data !== undefined) return { state: "ready", value: data };
  return error ? { state: "error" } : { state: "loading" };
}

export function OverviewCard({ account, activeId, checkedAt, dialogs }: {
  account: AccountViewModel;
  activeId: string | null;
  /** Today's check instant: a saved calculation is only called current against it. */
  checkedAt: string;
  dialogs: { open: (d: AccountDialog) => void; activate: (a: AccountViewModel) => void; activeId: string | null };
}) {
  const navigate = useNavigate();
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

  const titleId = `acct-card-${account.id}`;
  const open = () => navigate(`/accounts/${encodeURIComponent(account.id)}`);
  const archived = account.archivedAt !== null;
  const menu = [
    ...(!archived ? [{ label: "Quick import into this attempt", icon: <Zap size={16} aria-hidden="true" />, onSelect: () => navigate("/import/quick", { state: { accountId: account.id } }) }, { type: "separator" as const }] : []),
    ...accountMenu(account, { ...dialogs, onOpen: open, onRulebook: () => navigate(`/accounts/${encodeURIComponent(account.id)}/rulebook`), tradeCount: summary?.tradeCount ?? null, attemptNumber: summary?.attemptNumber }).slice(1),
  ];
  const { identity, status } = model;
  const activity = model.lastTraded.kind === "at" ? `Last traded ${model.lastTraded.text}`
    : model.lastTraded.kind === "none" ? "No imported trades"
    : model.lastTraded.kind === "checking" ? "Last traded: checking…"
    : "Last traded: unknown";

  return (
    <AccountOverviewCard
      titleId={titleId}
      mark={identity.mark}
      eyebrow={identity.eyebrow}
      title={identity.title}
      reference={identity.reference}
      meta={[identity.type, identity.phase, identity.attempt].filter(Boolean).join(" · ")}
      badges={
        <>
          <Badge tone={status.lifecycle.tone}>{status.lifecycle.label}</Badge>
          {status.archived && <Badge>Archived</Badge>}
          {status.setup === "needs" && <Badge tone="warn">Needs setup</Badge>}
          {status.active && <Badge tone="flow">Active in FundedFlow</Badge>}
        </>
      }
      primary={model.headroom}
      figures={[model.balance, model.floor]}
      meters={model.meters.length ? model.meters.map(m => <ProgressMeter key={m.label} {...m} />) : undefined}
      rules={model.rules.map(r => ({ label: r.label, value: r.value, muted: r.muted }))}
      activity={activity}
      tint={model.tint}
      selected={status.active}
      actions={
        <>
          <Button size="sm" onClick={open} aria-label={`View details of ${account.name}${identity.attempt ? `, ${identity.attempt.toLowerCase()}` : ""}`}>View details</Button>
          <DropdownMenu label={`More actions for ${account.name}`} items={menu}
            trigger={<IconButton size="sm" variant="ghost" label={`More actions for ${account.name}`} icon={<Ellipsis size={16} aria-hidden="true" />} />} />
        </>
      }
    />
  );
}
