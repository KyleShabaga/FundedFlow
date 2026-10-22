// The Accounts page: every account with its status, setup and rulebook, and the
// place to add, open, edit, archive and select accounts. It shows only values the
// backend supplies: each attempt's balance as its card states it (current engine
// estimate, else the latest checkpoint, else why there is none; never the starting
// balance), Rust's known net P&L per attempt, and rulebook assignment. The Current balance KPI totals,
// per currency, only the engine balances Today calls current (NA-4); cards show
// headroom and meters from the same model.
import { accountFilterLabels, filterAccounts, type AccountFilter } from "@fundedflow/domain";
import { ChevronDown, Ellipsis, Plus, Upload, Workflow, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  Button,
  type DataColumn,
  DataTable,
  DropdownMenu,
  EmptyState,
  formatInstant,
  IconButton,
  LoadingState,
  MetricCard,
  MetricValueView,
  MoneyCell,
  SearchField,
  SegmentedControl,
  type SortState,
  StateBoundary,
} from "../../../design-system";
import { retryRead, toAsyncState } from "../../shared/presentation";
import { useActiveAccount } from "../active-account";
import { useCheckTime, useTodayAccount } from "../../today/hooks/today";
import { useAccounts } from "../hooks/accounts";
import { useAccountBalance } from "../hooks/overview";
import type { AccountViewModel } from "../view-models/account";
import { currentBalanceKpi, type CurrentBalance } from "../view-models/balance-kpi";
import { accountMenu, useAccountDialogs } from "./AccountActions";
import { OverviewCard } from "./OverviewCard";
import { ACCOUNT_TYPE_LABELS, AccountMark, AccountStatus, LastImport, RulebookSummary, SetupBadge, useAccountFacts } from "./presentation";
import "./accounts.css";

const FILTERS: AccountFilter[] = ["live", "all", "active", "paused", "passed", "failed", "closed", "archived"];

/* ---------- Cells that read per-account facts (cached per account by Build 14) ---------- */

function NetPnlCell({ account }: { account: AccountViewModel }) {
  const { summary } = useAccountFacts(account);
  if (!summary) return <span className="ds-faint">—</span>;
  return (
    <span className="acct-pnl" title={summary.tradesWithUnknownPnl ? `${summary.tradesWithUnknownPnl} trades without P&L are not included` : undefined}>
      <MoneyCell value={summary.netPnl} currency={account.currency} />
      {summary.tradesWithUnknownPnl > 0 && <span className="acct-cell-note">{summary.tradesWithUnknownPnl} unknown</span>}
    </span>
  );
}
/**
 * The attempt's balance as its card states it. The short lines say where the value comes from and when (or why there
 * is none), and any trades a checkpoint leaves out; the full label and note are in the tooltip and read aloud.
 */
function BalanceCell({ account, checkedAt }: { account: AccountViewModel; checkedAt: string }) {
  const figure = useAccountBalance(account, checkedAt);
  const short = figure.value.kind === "unavailable" ? figure.value.reason
    : figure.provenance ? [figure.provenance.label, figure.at && formatInstant(figure.at, { timeZone: account.timezone })].filter(Boolean).join(" · ")
    : figure.note;
  const detail = [figure.label, figure.provenance?.label, figure.note].filter(Boolean).join(" · ");
  return (
    <span className="acct-balance" title={detail}>
      <MetricValueView value={figure.value} />
      {short && <span className="acct-cell-note" aria-hidden="true">{short}</span>}
      {figure.tradesSince > 0 && <span className="acct-cell-note" aria-hidden="true">{figure.tradesSince} {figure.tradesSince === 1 ? "trade" : "trades"} since, not included</span>}
      <span className="ds-sr-only">{detail}</span>
    </span>
  );
}
function TradesCell({ account }: { account: AccountViewModel }) {
  const { summary } = useAccountFacts(account);
  return <>{summary ? summary.tradeCount.toLocaleString("en-US") : "—"}</>;
}
function RulebookCell({ account }: { account: AccountViewModel }) {
  const facts = useAccountFacts(account);
  return (
    <span className="acct-rulebook-cell">
      <RulebookSummary facts={facts} />
      <SetupBadge items={facts.setup} />
    </span>
  );
}
function LastImportCell({ account }: { account: AccountViewModel }) {
  const { lastImportAt } = useAccountFacts(account);
  return <LastImport at={lastImportAt} timeZone={account.timezone} />;
}

/** Collects per-account facts for the KPI row from the same cached queries the table and cards use. */
function FactsProbe({ account, checkedAt, report }: { account: AccountViewModel; checkedAt: string; report: (id: string, facts: Facts[string]) => void }) {
  const facts = useAccountFacts(account);
  const { truth } = useTodayAccount(account, checkedAt);
  const needsSetup = facts.setup === null ? null : facts.setup.length > 0;
  // Only a balance Today calls current counts, exactly as the card's "Estimated balance"; a checkpoint or a stale
  // estimate is shown on the account, not totalled.
  const amount = truth.kind === "checking" ? undefined : truth.kind === "current" ? truth.result.balance : null;
  useEffect(() => report(account.id, { needsSetup, lastImportAt: facts.lastImportAt, balance: amount == null ? amount : { amount, currency: account.currency } }),
    [account.id, account.currency, needsSetup, facts.lastImportAt, amount, report]);
  return null;
}

type Facts = Record<string, { needsSetup: boolean | null; lastImportAt: string | null | undefined; balance: CurrentBalance }>;

const sameBalance = (a: CurrentBalance, b: CurrentBalance) => a === b || (!!a && !!b && a.amount === b.amount && a.currency === b.currency);

function Kpis({ live, checkedAt }: { live: AccountViewModel[]; checkedAt: string }) {
  const [facts, setFacts] = useState<Facts>({});
  const report = useCallback((id: string, f: Facts[string]) => setFacts(prev => (prev[id]?.needsSetup === f.needsSetup && prev[id]?.lastImportAt === f.lastImportAt && prev[id] && sameBalance(prev[id].balance, f.balance) ? prev : { ...prev, [id]: f })), []);
  const known = live.map(a => facts[a.id]).filter(Boolean);
  const allKnown = known.length === live.length;
  const needsSetup = allKnown && known.every(f => f.needsSetup !== null) ? known.filter(f => f.needsSetup).length : null;
  const imports = known.map(f => f.lastImportAt);
  const lastImport = allKnown && imports.every(i => i !== undefined) ? imports.reduce<string | null>((latest, at) => (at && (!latest || at > latest) ? at : latest), null) : undefined;
  const balance = currentBalanceKpi(live.map(a => facts[a.id]?.balance));
  const paused = live.filter(a => a.status === "paused").length;
  return (
    <div className="acct-kpis">
      {live.map(a => <FactsProbe key={a.id} account={a} checkedAt={checkedAt} report={report} />)}
      <MetricCard label="Live accounts" value={{ kind: "count", value: live.length }} sub={paused ? `${live.length - paused} active · ${paused} paused` : "Active and paused, not archived"} />
      <MetricCard label="Need setup" value={{ kind: "count", value: needsSetup }} sub="Firm or rulebook still to add" />
      <MetricCard label="Current balance" value={balance.value} sub={balance.sub} />
      <MetricCard label="Last import" value={lastImport === undefined ? { kind: "text", text: null } : { kind: "text", text: lastImport === null ? "None yet" : formatInstant(lastImport) }} sub="Across live accounts, this computer's time" />
    </div>
  );
}

/* ---------- Page ---------- */

export function AccountsPage() {
  const navigate = useNavigate();
  const accounts = useAccounts("all");
  const active = useActiveAccount();
  const dialogs = useAccountDialogs();
  const { checkedAt } = useCheckTime();
  const [filter, setFilter] = useState<AccountFilter>("live");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"table" | "cards">("table");
  const [sort, setSort] = useState<SortState | null>({ columnId: "account", direction: "ascending" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const all = accounts.data ?? [];
  const counts = useMemo(() => Object.fromEntries(FILTERS.map(f => [f, filterAccounts(all, f).length])) as Record<AccountFilter, number>, [all]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const visible = filterAccounts(all, filter).filter(a => !q || [a.name, a.propFirm, a.broker, a.externalRef].some(v => v?.toLowerCase().includes(q)));
    if (!sort) return visible;
    const dir = sort.direction === "ascending" ? 1 : -1;
    const label = (a: AccountViewModel) => `${a.propFirm ?? ""} ${a.name}`.trim().toLowerCase();
    return [...visible].sort((a, b) => {
      switch (sort.columnId) {
        case "type": return ACCOUNT_TYPE_LABELS[a.accountType].localeCompare(ACCOUNT_TYPE_LABELS[b.accountType]) * dir;
        case "status": return a.status.localeCompare(b.status) * dir;
        default: return label(a).localeCompare(label(b)) * dir;
      }
    });
  }, [all, filter, query, sort]);
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
  const resetPage = () => setPage(1);
  const open = (a: AccountViewModel) => navigate(`/accounts/${encodeURIComponent(a.id)}`);

  const columns: DataColumn<AccountViewModel>[] = [
    {
      id: "account", header: "Account", rowHeader: true, sortable: true,
      cell: a => (
        <span className="acct-cell-name">
          <AccountMark account={a} />
          <span className="acct-cell-text">
            <span className="acct-cell-title">
              <span className="acct-cell-label" title={a.propFirm ? undefined : a.name}>{a.propFirm ?? a.name}</span>
              {active.activeId === a.id && <span className="acct-active-pill">Active account</span>}
            </span>
            {a.propFirm && <span className="ds-faint" title={a.name}>{a.name}</span>}
          </span>
        </span>
      ),
    },
    { id: "platform", header: "Platform", cell: a => a.broker ?? <span className="ds-faint">Not set</span> },
    { id: "type", header: "Type", sortable: true, cell: a => ACCOUNT_TYPE_LABELS[a.accountType] },
    { id: "status", header: "Status", sortable: true, cell: a => <AccountStatus account={a} /> },
    // Not sortable: each balance is read per row (estimate or checkpoint, possibly unknown or in another currency),
    // so the page has no list of comparable amounts to order by. Starting balance stays on the account's details.
    { id: "balance", header: "Current balance", align: "end", cell: a => <BalanceCell account={a} checkedAt={checkedAt} /> },
    { id: "pnl", header: "Net P&L", align: "end", cell: a => <NetPnlCell account={a} /> },
    { id: "rulebook", header: "Rulebook", cell: a => <RulebookCell account={a} /> },
    { id: "trades", header: "Trades", align: "end", cell: a => <TradesCell account={a} /> },
    { id: "last", header: "Last import", cell: a => <LastImportCell account={a} /> },
    {
      id: "menu", header: "Actions", hideHeader: true,
      cell: a => (
        <DropdownMenu
          label={`Actions for ${a.name}`}
          trigger={<IconButton size="sm" variant="ghost" label={`Actions for ${a.name}`} icon={<Ellipsis size={16} aria-hidden="true" />} />}
          items={accountMenu(a, { open: dialogs.open, activate: dialogs.activate, activeId: dialogs.activeId, onOpen: () => open(a), onRulebook: () => navigate(`/accounts/${encodeURIComponent(a.id)}/rulebook`), tradeCount: null })}
        />
      ),
    },
  ];

  // The same status filter (left) and search (right, on the same row) for both layouts.
  const statusFilter = (
    <SegmentedControl<AccountFilter>
      label="Show"
      value={filter}
      onValueChange={f => { setFilter(f); resetPage(); }}
      options={FILTERS.map(f => ({ value: f, label: accountFilterLabels[f], count: counts[f] }))}
    />
  );
  const search = <SearchField label="Search accounts" value={query} onValueChange={v => { setQuery(v); resetPage(); }} placeholder="Search name, firm, platform or number" />;

  const addButton = (
    <Button variant="primary" icon={<Plus size={16} aria-hidden="true" />} onClick={() => dialogs.open({ kind: "create" })}>
      Add account
    </Button>
  );

  return (
    <div className="acct-page">
      <div className="acct-page-head">
        <p className="acct-sub">Every account you journal, with its status, setup and rulebook. Failed and passed attempts stay in history.</p>
        <div className="acct-head-actions">
          {all.length > 0 && (
            <SegmentedControl label="Layout" value={view} onValueChange={setView} options={[{ value: "table", label: "Table" }, { value: "cards", label: "Cards" }]} />
          )}
          {all.length > 0 && (
            <DropdownMenu label="Import trades" trigger={<Button icon={<Upload size={16} aria-hidden="true" />}>Import trades<ChevronDown size={14} aria-hidden="true" /></Button>} items={[
              { label: "Quick import: check and import a CSV in one step", icon: <Zap size={16} aria-hidden="true" />, onSelect: () => navigate("/import/quick", { state: { accountId: active.activeId } }) },
              { label: "Full wizard: first-time or custom files", icon: <Workflow size={16} aria-hidden="true" />, onSelect: () => navigate("/import", { state: { accountId: active.activeId } }) },
            ]} />
          )}
          {addButton}
        </div>
      </div>

      <StateBoundary
        state={toAsyncState(accounts)}
        label="accounts"
        scope="route"
        onRetry={retryRead(accounts.refresh)}
        loading={<LoadingState label="Loading accounts" layout="table" rows={4} />}
        empty={{
          "no-records": (
            <div className="ds-card">
              <EmptyState
                kind="no-records"
                title="Add your first trading account"
                description={
                  <>
                    <p>FundedFlow files every trade, import and journal entry under an account, so start by adding the one you trade.</p>
                    <p>Only its name, currency, time zone and starting balance are needed now. The firm's exact rules can be set up later; nothing is sent anywhere.</p>
                  </>
                }
                action={addButton}
              />
            </div>
          ),
        }}
      >
        {() => (
          // Its own grid: StateBoundary's content doesn't take part in the page's gap, so the KPI row touched the list.
          <div className="acct-body">
            <Kpis live={filterAccounts(all, "live")} checkedAt={checkedAt} />
            {view === "table" ? (
              <DataTable
                className="acct-table"
                label="Accounts"
                headingLevel={2}
                columns={columns}
                rows={pageRows}
                getRowId={a => a.id}
                getRowLabel={a => a.name}
                sort={sort}
                onSortChange={s => { setSort(s); resetPage(); }}
                onRowClick={open}
                activeRowId={active.activeId}
                isRowMuted={a => a.archivedAt !== null}
                toolbar={statusFilter}
                actions={search}
                fallback={rows.length === 0 ? <EmptyState kind="no-matches" size="compact" description={filter === "archived" ? "No archived accounts." : "No accounts match this search and filter."} action={<Button size="sm" onClick={() => { setQuery(""); setFilter("live"); }}>Show live accounts</Button>} /> : undefined}
                pagination={{ page, pageSize, total: rows.length, onPageChange: setPage, pageSizeOptions: [10, 25, 50], onPageSizeChange: n => { setPageSize(n); resetPage(); } }}
                footer={filter !== "archived" && counts.archived > 0 ? <button type="button" className="acct-link" onClick={() => { setFilter("archived"); resetPage(); }}>{counts.archived} archived</button> : undefined}
              />
            ) : (
              <>
                <div className="acct-card-toolbar">{statusFilter}{search}</div>
                <ul className="acct-cards" aria-label="Accounts">
                  {rows.map(a => (
                    <li key={a.id} className="acct-card-wrap">
                      <OverviewCard account={a} activeId={active.activeId} checkedAt={checkedAt} dialogs={dialogs} />
                    </li>
                  ))}
                </ul>
                {rows.length === 0 && <EmptyState kind="no-matches" size="compact" description={filter === "archived" ? "No archived accounts." : "No accounts match this search and filter."} action={<Button size="sm" onClick={() => { setQuery(""); setFilter("live"); }}>Show live accounts</Button>} />}
              </>
            )}
            <p className="ds-faint acct-footnote">
              Current balance is the last saved estimate while Today calls it current, otherwise the latest balance checkpoint you recorded (labelled as one),
              otherwise — with the reason; it is never the starting balance, which stays on each account's details. Net P&amp;L is the sum of closed trades with a known result.
              Cards show drawdown headroom, floor and progress only from the last saved estimate while it is current; otherwise they say why the figure is unknown, never Safe.
            </p>
          </div>
        )}
      </StateBoundary>
      {dialogs.element}
    </div>
  );
}
