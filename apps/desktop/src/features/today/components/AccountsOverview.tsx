// All active attempts (Build 21, from the Home ideas in docs/design/screens/09-home-merged-into-today.md): one card
// per active, usable attempt with its own Safe / Caution / Stop / Unknown (text + icon + colour), rulebook and
// setup. There is no combined status, no "all clear" and no summed headroom: every account is judged on its own.
import { Link } from "react-router-dom";

import { Badge, Button, formatInstant, StatusIndicator } from "../../../design-system";
import { AccountStatus, accountLabel, RulebookSummary, SetupBadge, useAccountFacts } from "../../accounts/components/presentation";
import type { AccountViewModel } from "../../accounts/view-models/account";
import { useTodayAccount } from "../hooks/today";

export function AccountsOverview({ accounts, selectedId, checkedAt, onShow, showing }: {
  accounts: readonly AccountViewModel[];
  selectedId: string | null;
  checkedAt: string;
  onShow: (account: AccountViewModel) => void;
  /** The account being switched to, while the choice is saved. */
  showing: string | null;
}) {
  return (
    <section className="td-overview" aria-labelledby="td-overview-title">
      <div className="td-panel-head">
        <h2 id="td-overview-title" className="ds-title">Active accounts</h2>
        <span className="ds-faint">Each account is estimated on its own; there is no combined status.</span>
      </div>
      <ul className="td-cards">
        {accounts.map(a => (
          <li key={a.id}><AccountRiskCard account={a} selected={a.id === selectedId} checkedAt={checkedAt} onShow={() => onShow(a)} busy={showing === a.id} /></li>
        ))}
      </ul>
    </section>
  );
}

function AccountRiskCard({ account, selected, checkedAt, onShow, busy }: { account: AccountViewModel; selected: boolean; checkedAt: string; onShow: () => void; busy: boolean }) {
  const today = useTodayAccount(account, checkedAt);
  const facts = useAccountFacts(account);
  const h = today.headline;
  const snapshot = today.snapshot.data ?? null;
  const titleId = `td-card-${account.id}`;
  return (
    <article className={`ds-card td-card${selected ? " is-selected" : ""}`} aria-labelledby={titleId} aria-current={selected ? "true" : undefined}>
      <header className="td-card-head">
        <h3 id={titleId} className="td-card-title">{accountLabel(account)}</h3>
        <AccountStatus account={account} />
      </header>
      <StatusIndicator status={h.status} label={h.label} detail={h.detail} />
      {h.lastRecorded && <p className="ds-faint td-card-line">{h.lastRecorded}</p>}
      <p className="td-card-line"><RulebookSummary facts={facts} /> <SetupBadge items={facts.setup} />{facts.setup?.length === 0 && <Badge>Setup complete</Badge>}</p>
      <p className="ds-faint td-card-line">{snapshot ? `Last estimate ${formatInstant(snapshot.calculatedAt, { timeZone: account.timezone, zoneName: true })}` : "No estimate saved"}</p>
      {account.predecessorAccountId && <p className="ds-faint td-card-line">New attempt after a reset: nothing carries over from the earlier attempt.</p>}
      <div className="td-card-foot">
        {selected
          ? <span className="ds-faint">Shown below</span>
          : <Button size="sm" onClick={onShow} loading={busy} aria-label={`Show ${accountLabel(account)}`}>Show</Button>}
        <Link to={`/accounts/${encodeURIComponent(account.id)}`}>Account</Link>
      </div>
    </article>
  );
}
