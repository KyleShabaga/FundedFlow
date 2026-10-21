// The Accounts page: every account with its status, setup and rulebook, and the
// place to add, open, edit, archive and select accounts. It shows only values the
// backend supplies: starting balance (never presented as today's balance), Rust's
// known net P&L per attempt, and rulebook assignment. Current balance, drawdown and
// target meters wait for Builds 15.5/16 and are marked unavailable, never computed here.
import { accountFilterLabels, filterAccounts, type AccountFilter } from "@fundedflow/domain";
import { Ellipsis, Plus, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  AccountCard,
  Button,
  compareMoney,
  type DataColumn,
  DataTable,
  DropdownMenu,
  EmptyState,
  formatInstant,
  IconButton,
  LoadingState,
  MetricCard,
  MoneyCell,
  SearchField,
  SegmentedControl,
  type SortState,
  StateBoundary,
} from "../../../design-system";
import { retryRead, toAsyncState } from "../../shared/presentation";
import { useActiveAccount } from "../active-account";
import { useAccounts } from "../hooks/accounts";
import type { AccountViewModel } from "../view-models/account";
import { accountMenu, useAccountDialogs } from "./AccountActions";
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

/** Collects per-account facts for the KPI row from the same cached queries the table uses. */
function FactsProbe({ account, report }: { account: AccountViewModel; report: (id: string, facts: { needsSetup: boolean | null; lastImportAt: string | null | undefined }) => void }) {
  const facts = useAccountFacts(account);
  const needsSetup = facts.setup === null ? null : facts.setup.length > 0;
  useEffect(() => report(account.id, { needsSetup, lastImportAt: facts.lastImportAt }), [account.id, needsSetup, facts.lastImportAt, report]);
  return null;
}

type Facts = Record<string, { needsSetup: boolean | null; lastImportAt: string | null | undefined }>;

function Kpis({ live }: { live: AccountViewModel[] }) {
  const [facts, setFacts] = useState<Facts>({});
  const report = useCallback((id: string, f: Facts[string]) => setFacts(prev => (prev[id]?.needsSetup === f.needsSetup && prev[id]?.lastImportAt === f.lastImportAt ? prev : { ...prev, [id]: f })), []);
  const known = live.map(a => facts[a.id]).filter(Boolean);
  const allKnown = known.length === live.length;
  const needsSetup = allKnown && known.every(f => f.needsSetup !== null) ? known.filter(f => f.needsSetup).length : null;
  const imports = known.map(f => f.lastImportAt);
  const lastImport = allKnown && imports.every(i => i !== undefined) ? imports.reduce<string | null>((latest, at) => (at && (!latest || at > latest) ? at : latest), null) : undefined;
  const paused = live.filter(a => a.status === "paused").length;
  return (
    <div className="acct-kpis">
      {live.map(a => <FactsProbe key={a.id} account={a} report={report} />)}
      <MetricCard label="Live accounts" value={{ kind: "count", value: live.length }} sub={paused ? `${live.length - paused} active · ${paused} paused` : "Active and paused, not archived"} />
      <MetricCard label="Need setup" value={{ kind: "count", value: needsSetup }} sub="Firm or rulebook still to add" />
      <MetricCard label="Current balance" value={{ kind: "unavailable", reason: "Needs balance checkpoints; starting balances are in the table. Currencies are never added together." }} />
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
        // Amounts in different currencies are never compared: group by currency first.
        case "start": return a.currency !== b.currency ? a.currency.localeCompare(b.currency) : compareMoney(a.startingBalance, b.startingBalance, sort.direction);
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
    { id: "start", header: "Starting balance", align: "end", sortable: true, firstDirection: "descending", cell: a => <MoneyCell value={a.startingBalance} signed={false} currency={a.currency} /> },
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
            <Button icon={<Upload size={16} aria-hidden="true" />} onClick={() => navigate("/import", { state: { accountId: active.activeId } })}>
              Import trades
            </Button>
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
          <>
            <Kpis live={filterAccounts(all, "live")} />
            {view === "table" ? (
              <DataTable
                label="Accounts"
                columns={columns}
                rows={pageRows}
                getRowId={a => a.id}
                getRowLabel={a => a.name}
                sort={sort}
                onSortChange={s => { setSort(s); resetPage(); }}
                onRowClick={open}
                activeRowId={active.activeId}
                isRowMuted={a => a.archivedAt !== null}
                toolbar={
                  <>
                    <SearchField label="Search accounts" value={query} onValueChange={v => { setQuery(v); resetPage(); }} placeholder="Search name, firm, platform or number" />
                    <SegmentedControl<AccountFilter>
                      label="Show"
                      value={filter}
                      onValueChange={f => { setFilter(f); resetPage(); }}
                      options={FILTERS.map(f => ({ value: f, label: accountFilterLabels[f], count: counts[f] }))}
                    />
                  </>
                }
                fallback={rows.length === 0 ? <EmptyState kind="no-matches" size="compact" description={filter === "archived" ? "No archived accounts." : "No accounts match this search and filter."} action={<Button size="sm" onClick={() => { setQuery(""); setFilter("live"); }}>Show live accounts</Button>} /> : undefined}
                pagination={{ page, pageSize, total: rows.length, onPageChange: setPage, pageSizeOptions: [10, 25, 50], onPageSizeChange: n => { setPageSize(n); resetPage(); } }}
                footer={filter !== "archived" && counts.archived > 0 ? <button type="button" className="acct-link" onClick={() => { setFilter("archived"); resetPage(); }}>{counts.archived} archived</button> : undefined}
              />
            ) : (
              <div className="acct-cards">
                {rows.map(a => (
                  <article key={a.id} className="acct-card-wrap" aria-label={a.name}>
                    <AccountCard
                      name={a.name}
                      firm={a.propFirm}
                      phase={`${ACCOUNT_TYPE_LABELS[a.accountType]} · ${a.status[0].toUpperCase()}${a.status.slice(1)}${a.archivedAt ? " · Archived" : ""}`}
                      phaseTone={a.status === "failed" ? "loss" : a.status === "passed" ? "profit" : a.status === "active" ? "flow" : "neutral"}
                      breached={a.status === "failed"}
                      balance={null}
                      startingBalance={a.startingBalance}
                      currency={a.currency}
                      footer={
                        <>
                          <span>{active.activeId === a.id ? "Active account · " : ""}Current balance not available yet</span>
                          <Button size="sm" variant="ghost" onClick={() => open(a)} aria-label={`Open ${a.name}`}>Open</Button>
                        </>
                      }
                    />
                  </article>
                ))}
                {rows.length === 0 && <EmptyState kind="no-matches" size="compact" />}
              </div>
            )}
            <p className="ds-faint acct-footnote">
              Starting balance is what each attempt began with, not today's balance. Net P&amp;L is the sum of closed trades with a known result.
              Drawdown and target meters appear once balance checkpoints and rule calculations are available; until then risk shows as Unknown, never Safe.
            </p>
          </>
        )}
      </StateBoundary>
      {dialogs.element}
    </div>
  );
}
