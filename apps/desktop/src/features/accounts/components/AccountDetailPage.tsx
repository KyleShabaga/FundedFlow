// One account's profile: saved settings with labels and units, setup, rulebook,
// activity, lifecycle history and attempt lineage. Archived and historical
// attempts are browsable and clearly not live.
import { isHistorical, statusLabels } from "@fundedflow/domain";
import { ArrowLeft, Ellipsis, History, Pencil, Upload } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  Badge,
  Button,
  type DataColumn,
  DataTable,
  DropdownMenu,
  EmptyState,
  formatInstant,
  IconButton,
  InlineNotice,
  MoneyCell,
  StateBoundary,
  StatList,
  StatusIndicator,
  TabPanel,
  Tabs,
  zonedWallTime,
} from "../../../design-system";
import { retryRead, toAsyncState } from "../../shared/presentation";
import { useActiveAccount } from "../active-account";
import { PROP_ACCOUNT_TYPES } from "../setup";
import { useAccount, useAccountHistory, useAccountLineage } from "../hooks/accounts";
import type { AccountViewModel } from "../view-models/account";
import { accountMenu, useAccountDialogs } from "./AccountActions";
import { ACCOUNT_TYPE_LABELS, AccountMark, AccountStatus, LastImport, RulebookSummary, SetupBadge, useAccountFacts } from "./presentation";
import "./accounts.css";

type Attempt = NonNullable<ReturnType<typeof useAccountLineage>["data"]>[number];

const notSet = <span className="ds-faint">Not set</span>;

function Overview({ account, onEdit }: { account: AccountViewModel; onEdit?: () => void }) {
  const facts = useAccountFacts(account);
  const summary = facts.summary;
  const zoneNow = zonedWallTime(Date.now(), account.timezone).slice(11);
  return (
    <div className="acct-detail-grid">
      <section className="ds-card acct-panel" aria-labelledby="acct-settings">
        <h2 id="acct-settings" className="ds-title">Account settings</h2>
        <StatList
          label="Account settings"
          items={[
            { label: "Name", value: account.name },
            { label: "Prop firm", value: account.propFirm ?? notSet },
            { label: "Platform", value: account.broker ?? notSet },
            { label: "Account number", value: account.externalRef ?? notSet },
            { label: "Type", value: ACCOUNT_TYPE_LABELS[account.accountType] },
            { label: "Status", value: <AccountStatus account={account} /> },
            { label: "Currency", value: account.currency },
            { label: "Starting balance", value: { kind: "money", amount: account.startingBalance, signed: false, currency: account.currency } },
            { label: "Time zone", value: `${account.timezone} (now ${zoneNow})` },
            { label: "Trading day starts at", value: account.tradingDayResetTime === "00:00" ? "00:00 (calendar days)" : `${account.tradingDayResetTime}, ${account.timezone}` },
            { label: "Added", value: formatInstant(account.createdAt, { timeZone: account.timezone, year: true }) },
          ]}
        />
        {account.notes && (
          <div className="acct-notes">
            <h3 className="ds-label">Notes</h3>
            <p>{account.notes}</p>
          </div>
        )}
      </section>

      <div className="acct-detail-side">
        <section className="ds-card acct-panel" aria-labelledby="acct-setup">
          <div className="acct-panel-head">
            <h2 id="acct-setup" className="ds-title">Setup</h2>
            <SetupBadge items={facts.setup} />
          </div>
          {facts.setup === null ? (
            <p className="ds-faint" role="status">Checking setup…</p>
          ) : facts.setup.length === 0 ? (
            <p className="acct-setup-ok">
              {PROP_ACCOUNT_TYPES.has(account.accountType)
                ? "Firm and rulebook are set."
                : "Nothing more is needed: personal, demo and other accounts don't need a firm or rulebook."}
            </p>
          ) : (
            <ul className="acct-setup-list">
              {facts.setup.map(item => (
                <li key={item.key}>
                  <b>{item.label}</b>
                  <span className="ds-faint">{item.detail}</span>
                  {item.key === "firm" && onEdit && <Button size="sm" variant="ghost" onClick={onEdit}>Add firm</Button>}
                  {item.key === "rulebook" && <span className="ds-faint">Rulebooks are assigned in the rulebook editor (coming soon).</span>}
                </li>
              ))}
            </ul>
          )}
          <div className="acct-rulebook-line">
            <span className="ds-label">Rulebook</span>
            <RulebookSummary facts={facts} />
          </div>
        </section>

        <section className="ds-card acct-panel" aria-labelledby="acct-risk">
          <h2 id="acct-risk" className="ds-title">Risk</h2>
          <StatusIndicator status="unknown" label="Not calculated yet" detail="Current balance, drawdown and limits need balance checkpoints and rule calculations" />
          <p className="ds-faint">
            Room left and limits appear once balance checkpoints and rule calculations are available. Until then this account is never shown as safe.
          </p>
        </section>

        <section className="ds-card acct-panel" aria-labelledby="acct-activity">
          <h2 id="acct-activity" className="ds-title">Activity</h2>
          <StatList
            label="Activity"
            items={[
              { label: "Trades", value: summary ? { kind: "count", value: summary.tradeCount } : null },
              { label: "Net P&L (known trades)", value: summary ? { kind: "money", amount: summary.netPnl, currency: account.currency } : null },
              ...(summary && summary.tradesWithUnknownPnl > 0 ? [{ label: "Trades without P&L", value: { kind: "count" as const, value: summary.tradesWithUnknownPnl } }] : []),
              { label: "Trading days", value: summary?.firstTradingDay ? `${summary.firstTradingDay} – ${summary.lastTradingDay}` : summary ? "None yet" : null },
              { label: "Imports", value: summary ? { kind: "count", value: summary.importCount } : null },
              { label: "Last import", value: <LastImport at={facts.lastImportAt} timeZone={account.timezone} /> },
            ]}
          />
        </section>
      </div>
    </div>
  );
}

function HistoryTab({ account }: { account: AccountViewModel }) {
  const history = useAccountHistory(account.id);
  return (
    <StateBoundary state={toAsyncState(history)} label="history" onRetry={retryRead(history.refresh)}
      empty={{ "no-records": <EmptyState kind="no-records" size="compact" title="No status changes yet" description="Status changes, archiving and restoring appear here with when they took effect." /> }}>
      {h => {
        // Events have no ids from the backend; their order and time identify them, so keys combine both.
        const events = [
          ...h.statusEvents.map(e => ({ at: e.effectiveAt, node: (
            <>
              <span className="acct-event-head"><AccountStatus account={{ status: e.status, archivedAt: null }} /><span className="ds-faint">{formatInstant(e.effectiveAt, { timeZone: account.timezone, year: true, zoneName: true })}</span></span>
              <span>{e.cause ?? <span className="ds-faint">Cause not recorded</span>}</span>
              {e.note && <span className="ds-faint acct-event-note">{e.note}</span>}
              <span className="ds-faint acct-event-meta">Recorded {formatInstant(e.recordedAt, { timeZone: account.timezone, year: true })}</span>
            </>
          ) })),
          ...h.archiveEvents.map(e => ({ at: e.occurredAt, node: (
            <span className="acct-event-head"><Badge>{e.action === "archived" ? "Archived" : "Restored"}</Badge><span className="ds-faint">{formatInstant(e.occurredAt, { timeZone: account.timezone, year: true, zoneName: true })}</span></span>
          ) })),
        ].sort((a, b) => (a.at < b.at ? 1 : -1));
        return (
          <ol className="acct-timeline" aria-label="Status history, newest first">
            {events.map((e, i) => <li key={`${e.at}-${i}`}>{e.node}</li>)}
          </ol>
        );
      }}
    </StateBoundary>
  );
}

function AttemptsTab({ account }: { account: AccountViewModel }) {
  const lineage = useAccountLineage(account.id);
  const navigate = useNavigate();
  const columns: DataColumn<Attempt>[] = [
    { id: "n", header: "Attempt", cell: a => `#${a.attemptNumber}` },
    { id: "name", header: "Name", rowHeader: true, cell: a => (<span className="acct-cell-title">{a.name}{a.accountId === account.id && <span className="acct-active-pill">This attempt</span>}</span>) },
    { id: "status", header: "Status", cell: a => <AccountStatus account={a} /> },
    { id: "start", header: "Starting balance", align: "end", cell: a => <MoneyCell value={a.startingBalance} signed={false} currency={account.currency} /> },
    { id: "trades", header: "Trades", align: "end", cell: a => a.tradeCount.toLocaleString("en-US") },
    { id: "pnl", header: "Net P&L", align: "end", cell: a => <MoneyCell value={a.netPnl} currency={account.currency} /> },
    { id: "days", header: "Trading days", cell: a => (a.firstTradingDay ? `${a.firstTradingDay} – ${a.lastTradingDay}` : <span className="ds-faint">None</span>) },
    { id: "next", header: "Reset", cell: a => (a.resetToNext ? `${statusLabels[a.resetToNext.priorOutcome]}, ${formatInstant(a.resetToNext.effectiveAt, { timeZone: account.timezone, year: true })}` : <span className="ds-faint">—</span>) },
  ];
  return (
    <StateBoundary state={toAsyncState(lineage)} label="attempts" onRetry={retryRead(lineage.refresh)}>
      {attempts => (
        <>
          <DataTable label="Attempts" columns={columns} rows={attempts} getRowId={a => a.accountId} activeRowId={account.id}
            onRowClick={a => a.accountId !== account.id && navigate(`/accounts/${encodeURIComponent(a.accountId)}`)} />
          <p className="ds-faint acct-footnote">Each attempt keeps its own trades, imports, journal and history. A new attempt never reuses the previous one's balance or risk figures.</p>
        </>
      )}
    </StateBoundary>
  );
}

export function AccountDetailPage() {
  const { accountId = "" } = useParams();
  const account = useAccount(accountId || null);
  const lineage = useAccountLineage(accountId || null);
  const active = useActiveAccount();
  const dialogs = useAccountDialogs();
  const navigate = useNavigate();

  return (
    <div className="acct-page">
      <Link to="/accounts" className="acct-back"><ArrowLeft size={16} aria-hidden="true" />All accounts</Link>
      <StateBoundary state={toAsyncState(account)} label="account" scope="route" onRetry={retryRead(account.refresh)}>
        {a => {
          const archived = a.archivedAt !== null;
          const attempt = lineage.data?.find(x => x.accountId === a.id);
          const tradeCount = attempt?.tradeCount ?? null;
          const isActive = active.activeId === a.id;
          return (
            <>
              <header className="acct-detail-head">
                <div className="acct-detail-id">
                  <AccountMark account={a} />
                  <div>
                    <h2 className="acct-detail-title">{a.propFirm ? `${a.propFirm} · ${a.name}` : a.name}</h2>
                    <div className="acct-badges">
                      <Badge tone="neutral">{ACCOUNT_TYPE_LABELS[a.accountType]}</Badge>
                      <AccountStatus account={a} />
                      {isActive && <span className="acct-active-pill">Active account</span>}
                      {attempt && (lineage.data?.length ?? 0) > 1 && <span className="ds-faint">Attempt {attempt.attemptNumber} of {lineage.data?.length}</span>}
                    </div>
                  </div>
                </div>
                <div className="acct-head-actions">
                  {!archived && !isActive && <Button onClick={() => dialogs.activate(a)}>Use as active account</Button>}
                  {!archived && <Button icon={<Upload size={16} aria-hidden="true" />} onClick={() => navigate("/import", { state: { accountId: a.id } })}>Import trades</Button>}
                  <Button variant="ghost" icon={<History size={16} aria-hidden="true" />} onClick={() => navigate("/import/history", { state: { accountId: a.id } })}>Import history</Button>
                  {!archived && <Button variant="primary" icon={<Pencil size={16} aria-hidden="true" />} onClick={() => dialogs.open({ kind: "edit", account: a, tradeCount })}>Edit</Button>}
                  {archived && <Button variant="primary" onClick={() => dialogs.open({ kind: "restore", account: a })}>Restore from archive</Button>}
                  <DropdownMenu
                    label="More account actions"
                    trigger={<IconButton label="More account actions" icon={<Ellipsis size={16} aria-hidden="true" />} />}
                    items={accountMenu(a, { open: dialogs.open, activate: dialogs.activate, activeId: active.activeId, onOpen: () => navigate(`/accounts/${encodeURIComponent(a.id)}`), tradeCount, attemptNumber: attempt?.attemptNumber }).filter(e => !(e.type === undefined && (e.label === "Open" || e.label === "Edit")))}
                  />
                </div>
              </header>

              {archived && (
                <InlineNotice tone="info" live="off" title="Archived: read-only">
                  This account is kept for review. Restore it to edit it, change its status or make it active.
                </InlineNotice>
              )}
              {!archived && isHistorical(a) && (
                <InlineNotice tone="info" live="off" title={`${statusLabels[a.status]} attempt`}>
                  This is a finished attempt, kept for review. It never counts as a live account
                  {a.successorAccountId ? "; the next attempt continues the account." : ". Start a new attempt from the actions menu if the firm reset it."}
                </InlineNotice>
              )}

              <Tabs label="Account sections" defaultValue="overview" items={[{ value: "overview", label: "Overview" }, { value: "history", label: "History" }, { value: "attempts", label: "Attempts", count: lineage.data?.length }]}>
                <TabPanel value="overview"><Overview account={a} onEdit={archived ? undefined : () => dialogs.open({ kind: "edit", account: a, tradeCount })} /></TabPanel>
                <TabPanel value="history"><HistoryTab account={a} /></TabPanel>
                <TabPanel value="attempts"><AttemptsTab account={a} /></TabPanel>
              </Tabs>
            </>
          );
        }}
      </StateBoundary>
      {dialogs.element}
    </div>
  );
}
