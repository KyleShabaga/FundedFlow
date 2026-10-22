// All active attempts (Build 21, from the Home ideas in docs/design/screens/09-home-merged-into-today.md): one card
// per active, usable attempt with its own Safe / Caution / Stop / Unknown (text + icon + colour), rulebook and
// setup. There is no combined status, no "all clear" and no summed headroom: every account is judged on its own.
//
// P0-D23: the same entries show as cards or as compact list rows. The view is a saved presentation preference only:
// both views render one component per account, in the same order with the same facts and actions, and switching
// never selects an account or changes the details below.
import { useState } from "react";
import { Link } from "react-router-dom";

import { Badge, Button, formatInstant, SegmentedControl, StatusIndicator, useToast } from "../../../design-system";
import { AccountStatus, accountLabel, RulebookSummary, SetupBadge, useAccountFacts } from "../../accounts/components/presentation";
import type { AccountViewModel } from "../../accounts/view-models/account";
import { useSetSetting, useSetting } from "../../settings/hooks/settings";
import { useTodayAccount } from "../hooks/today";

/** Settings key for the Active accounts layout: "cards" (the default) or "list". */
export const TODAY_ACCOUNTS_VIEW_SETTING = "today.accounts_view";
export type AccountsView = "cards" | "list";
const VIEWS = [{ value: "cards", label: "Cards" }, { value: "list", label: "List" }] as const;

/** The saved layout, Cards until a choice is read. A new choice applies at once and is kept for the session even if it can't be saved. */
function useAccountsView(): [AccountsView, (view: AccountsView) => void] {
  const saved = useSetting(TODAY_ACCOUNTS_VIEW_SETTING);
  const save = useSetSetting(TODAY_ACCOUNTS_VIEW_SETTING);
  const toast = useToast();
  const [chosen, setChosen] = useState<AccountsView | null>(null);
  const view: AccountsView = chosen ?? (saved.data?.value === "list" ? "list" : "cards");
  const choose = (next: AccountsView) => {
    setChosen(next);
    save.submit(next).catch(() => toast.show({ tone: "error", title: "The layout wasn't saved", description: "It applies until you close FundedFlow." }));
  };
  return [view, choose];
}

export function AccountsOverview({ accounts, selectedId, checkedAt, onShow, showing }: {
  accounts: readonly AccountViewModel[];
  selectedId: string | null;
  checkedAt: string;
  onShow: (account: AccountViewModel) => void;
  /** The account being switched to, while the choice is saved. */
  showing: string | null;
}) {
  const [view, setView] = useAccountsView();
  return (
    <section className="td-overview" aria-labelledby="td-overview-title">
      <div className="td-panel-head td-overview-head">
        <div className="td-overview-title">
          <h2 id="td-overview-title" className="ds-title">Active accounts</h2>
          <span className="ds-faint">Each account is estimated on its own; there is no combined status.</span>
        </div>
        <SegmentedControl<AccountsView> label="Active accounts layout" value={view} onValueChange={setView} options={[...VIEWS]} />
      </div>
      <ul className={view === "list" ? "td-rows" : "td-cards"}>
        {accounts.map(a => (
          <li key={a.id}><AccountEntry account={a} row={view === "list"} selected={a.id === selectedId} checkedAt={checkedAt} onShow={() => onShow(a)} busy={showing === a.id} /></li>
        ))}
      </ul>
    </section>
  );
}

/** One account as a card or a list row: the same elements in the same order, laid out by today.css. */
function AccountEntry({ account, row, selected, checkedAt, onShow, busy }: { account: AccountViewModel; row: boolean; selected: boolean; checkedAt: string; onShow: () => void; busy: boolean }) {
  const today = useTodayAccount(account, checkedAt);
  const facts = useAccountFacts(account);
  const h = today.headline;
  const snapshot = today.snapshot.data ?? null;
  const label = accountLabel(account);
  const titleId = `td-card-${account.id}`;
  return (
    <article className={`ds-card td-card${row ? " td-row" : ""}${selected ? " is-selected" : ""}`} aria-labelledby={titleId} aria-current={selected ? "true" : undefined}>
      <header className="td-card-head">
        <h3 id={titleId} className="td-card-title">{label}</h3>
        <AccountStatus account={account} />
      </header>
      <div className="td-card-estimate">
        <StatusIndicator status={h.status} label={h.label} detail={h.detail} />
        {h.lastRecorded && <p className="ds-faint td-card-line">{h.lastRecorded}</p>}
        <p className="ds-faint td-card-line">{snapshot ? `Last estimate ${formatInstant(snapshot.calculatedAt, { timeZone: account.timezone, zoneName: true })}` : "No estimate saved"}</p>
      </div>
      <p className="td-card-line td-card-setup"><RulebookSummary facts={facts} /> <SetupBadge items={facts.setup} />{facts.setup?.length === 0 && <Badge>Setup complete</Badge>}</p>
      {account.predecessorAccountId && <p className="ds-faint td-card-line td-card-note">New attempt after a reset: nothing carries over from the earlier attempt.</p>}
      <div className="td-card-foot">
        {selected
          ? <span className="ds-faint">Shown below</span>
          : <Button size="sm" onClick={onShow} loading={busy} aria-label={`Show ${label}`}>Show</Button>}
        <Link to={`/accounts/${encodeURIComponent(account.id)}`} aria-label={`Account: ${label}`}>Account</Link>
      </div>
    </article>
  );
}
