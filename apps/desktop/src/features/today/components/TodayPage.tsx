// Today (Build 21, docs/design/screens/08-today.md): for each active account attempt, the latest evidence-backed
// estimate of its prop-firm risk and how far it can be trusted. Order: freshness first, all active accounts, the
// selected account's status and figures (each with its explanation), then actions and the realized-only section.
//
// The selected account is the app's one active-account choice (the header selector), so trade links resolve in
// the same attempt. Today never changes that choice by itself; it only switches when the trader presses Show.
// Finished, paused and archived attempts are history: they never feed today's risk, and a reset attempt starts
// from its own records. Every read is keyed by account id and the selected account remounts on a switch, so no
// figure, explanation or pending response of one attempt can render under another.
import { BookOpen, CircleCheck, ClipboardList, Plus, RefreshCw, Scale, Upload } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import {
  Button, DayCard, EmptyState, ErrorState, formatMoney, InlineNotice, LoadingState, MetricCard, StatusIndicator, useToast,
} from "../../../design-system";
import { useActiveAccount } from "../../accounts/active-account";
import { ACCOUNT_TYPE_LABELS, AccountStatus, accountLabel, RulebookSummary, useAccountFacts } from "../../accounts/components/presentation";
import type { AccountViewModel } from "../../accounts/view-models/account";
import { useCommitCsvImport, useImportHistory } from "../../imports/hooks/imports";
import { groupByDay, joinRows, stats } from "../../journal/components/journal-model";
import { useAccountRulebookContext } from "../../rulebooks/components/context";
import { useTrades } from "../../trades/hooks/trades";
import { useCheckTime, useTodayAccount } from "../hooks/today";
import { useDailyReviewIndex } from "../../daily-reviews/hooks/daily-reviews";
import { dailyReviewPath } from "../../daily-reviews/view-models/daily-review";
import { checkpointSummary, splitAttempts } from "../view-models/today";
import { AccountsOverview } from "./AccountsOverview";
import { FreshnessPanel } from "./FreshnessPanel";
import { DISCLAIMER, RiskSection } from "./RiskSection";
import { VerifyBalanceDialog } from "./VerifyBalanceDialog";
import "./today.css";

export function TodayPage() {
  const active = useActiveAccount();
  const navigate = useNavigate();
  const toast = useToast();
  const { checkedAt, recheck } = useCheckTime();
  const [showing, setShowing] = useState<string | null>(null);
  const { state } = active;

  if (state.kind === "loading") return <LoadingState label="Loading accounts" layout="metrics" rows={3} />;
  if (state.kind === "error") return <ErrorState scope="route" title="Accounts couldn't be loaded" message="Today needs your accounts to show their estimates. Use the recovery controls, then try again." />;
  if (state.kind === "no-accounts") {
    return (
      <div className="td-page">
        <div className="ds-card">
          <EmptyState kind="not-configured" title="Add an account to see today's risk"
            description="Today estimates each prop-firm account's room left from the trades, checkpoints and rulebook you record. Nothing is shown until there is an account."
            action={<Button variant="primary" icon={<Plus size={16} aria-hidden="true" />} onClick={() => navigate("/accounts")}>Add account</Button>} />
        </div>
        <TodayFootnote />
      </div>
    );
  }

  const all = active.accounts ?? [];
  const { active: live, history } = splitAttempts(all.filter(a => a.archivedAt === null));
  const archived = all.filter(a => a.archivedAt !== null).length;
  const selected = state.kind === "selected" ? state.account : null;
  const show = (a: AccountViewModel) => {
    setShowing(a.id);
    active.select(a.id)
      .catch(() => toast.show({ tone: "error", title: "The account wasn't switched", description: "Try again when local data is available." }))
      .finally(() => setShowing(null));
  };
  const overview = live.length > 1 || (live.length > 0 && (selected === null || !live.some(a => a.id === selected.id)))
    ? <AccountsOverview accounts={live} selectedId={selected?.id ?? null} checkedAt={checkedAt} onShow={show} showing={showing} />
    : null;

  return (
    <div className="td-page">
      {/* P0-D21: Check again stays at the top, beside the freshness it refreshes; the general note is the page footer. */}
      <div className="td-intro">
        <Button size="sm" variant="ghost" icon={<RefreshCw size={16} aria-hidden="true" />} onClick={recheck}>Check again</Button>
      </div>
      {selected && live.some(a => a.id === selected.id)
        ? <SelectedAccount key={selected.id} account={selected} checkedAt={checkedAt} overview={overview} predecessor={all.find(a => a.id === selected.predecessorAccountId) ?? null} />
        : (
          <>
            {selected
              ? <HistoricalAttempt key={selected.id} account={selected} successor={all.find(a => a.id === selected.successorAccountId) ?? null} onShow={show} />
              : (
                <div className="ds-card">
                  <EmptyState kind="not-configured"
                    title={state.kind === "unavailable" ? "The selected account isn't available" : "Choose an account"}
                    description={live.length ? "Pick an active account below (or in the selector at the top) to see its estimate." : "None of your accounts is active. Today shows estimates for active attempts only."}
                    action={live.length ? undefined : <Button onClick={() => navigate("/accounts")}>Go to Accounts</Button>} />
                </div>
              )}
            {overview}
          </>
        )}
      <HistoryList history={history} archived={archived} />
      <TodayFootnote />
    </div>
  );
}

/** The general estimate note, at the end of the page in normal flow. Metric-specific states stay with their figures. */
function TodayFootnote() {
  return (
    <footer className="td-footnote">
      <p><strong>{DISCLAIMER}</strong> Today reads only what is saved on this computer; it is not connected to your broker or firm.</p>
    </footer>
  );
}

function SelectedAccount({ account, checkedAt, overview, predecessor }: { account: AccountViewModel; checkedAt: string; overview: ReactNode; predecessor: AccountViewModel | null }) {
  const today = useTodayAccount(account, checkedAt);
  const facts = useAccountFacts(account);
  const rulebook = useAccountRulebookContext(account.id);
  const imports = useImportHistory(account.id);
  const importing = useCommitCsvImport(account.id).isPending;
  const [verifying, setVerifying] = useState(false);
  const opening = today.observations.data ? checkpointSummary(today.observations.data).opening : null;
  return (
    <>
      {account.predecessorAccountId && (
        <InlineNotice tone="info" live="off" title="New attempt after a reset">
          This attempt starts from its own opening balance, rulebook, trades and checkpoints. Nothing from the earlier attempt
          {predecessor ? ` (${predecessor.name})` : ""} carries over, and its history is unchanged.{" "}
          <Link to={`/accounts/${encodeURIComponent(account.predecessorAccountId)}`}>Earlier attempt (history only)</Link>
        </InlineNotice>
      )}
      <FreshnessPanel account={account} today={today} imports={imports.data ?? (imports.error ? null : undefined)} importing={importing} checkedAt={checkedAt} />
      {overview}
      <section className="ds-card td-panel td-account" aria-labelledby="td-account-title">
        <div className="td-panel-head">
          <div>
            <h2 id="td-account-title" className="td-account-name">{accountLabel(account)}</h2>
            <p className="ds-faint td-card-line">{ACCOUNT_TYPE_LABELS[account.accountType]} · {account.currency} · <AccountStatus account={account} /></p>
          </div>
          <div className="td-card-line"><RulebookSummary facts={facts} /></div>
        </div>
        {facts.setup && facts.setup.length > 0 && (
          <InlineNotice tone="warning" live="off" title="Setup needed for limits"
            actions={<Link to={facts.setup.some(s => s.key === "rulebook") ? `/accounts/${encodeURIComponent(account.id)}/rulebook` : `/accounts/${encodeURIComponent(account.id)}`}>Finish setup</Link>}>
            <ul className="td-list">{facts.setup.map(s => <li key={s.key}><b>{s.label}.</b> {s.detail}</li>)}</ul>
          </InlineNotice>
        )}
        {facts.setup === null && facts.rulebook.kind === "unknown" && (
          <InlineNotice tone="warning" live="off" title="Rulebook unknown">The rulebook assignment couldn't be read, so limits are Unknown.</InlineNotice>
        )}
      </section>
      <RiskSection account={account} today={today} current={rulebook.currentVersion.data ?? null} />
      <TodayActions account={account} onVerify={() => setVerifying(true)} />
      <RealizedSection account={account} />
      <VerifyBalanceDialog account={account} open={verifying} onOpenChange={setVerifying} opening={opening} />
    </>
  );
}

function TodayActions({ account, onVerify }: { account: AccountViewModel; onVerify: () => void }) {
  const navigate = useNavigate();
  const id = encodeURIComponent(account.id);
  // The review opens for this account and its current trading day as Rust reports it (zone, reset, weekends), read
  // separately from the risk estimate: it never waits for, refreshes or changes a saved calculation.
  const reviews = useDailyReviewIndex(account.id);
  const current = reviews.data?.accountId === account.id ? reviews.data : undefined;
  const todays = current?.reviews.find(r => r.tradingDay === current.currentTradingDay) ?? null;
  const reviewLabel = todays?.status === "draft" ? "Continue review" : todays?.status === "completed" ? "Open review" : "Review session";
  return (
    <section className="ds-card td-panel" aria-labelledby="td-actions-title">
      <h2 id="td-actions-title" className="ds-title">Next steps</h2>
      <div className="td-action-grid">
        <Button icon={<Upload size={16} aria-hidden="true" />} onClick={() => navigate("/import", { state: { accountId: account.id } })}>Import CSV</Button>
        <Button icon={<Scale size={16} aria-hidden="true" />} onClick={onVerify}>Verify balance</Button>
        <Button icon={<BookOpen size={16} aria-hidden="true" />} onClick={() => navigate(`/accounts/${id}/rulebook`)}>Review rulebook</Button>
        <Button icon={<ClipboardList size={16} aria-hidden="true" />} onClick={() => navigate("/journal?view=log")}>View trades</Button>
        <Button icon={<Plus size={16} aria-hidden="true" />} onClick={() => navigate("/accounts")}>Add account</Button>
        <Button icon={<CircleCheck size={16} aria-hidden="true" />} disabled={!current}
          disabledReason={!current ? (reviews.error ? "The trading day couldn't be read. Try again." : "Finding the trading day…") : undefined}
          onClick={() => current && navigate(dailyReviewPath(account.id, current.currentTradingDay))}>
          {reviewLabel}
        </Button>
      </div>
    </section>
  );
}

/** Closed trades only (Build 20's journal statistics): realized, all time, never equity or a risk figure. */
function RealizedSection({ account }: { account: AccountViewModel }) {
  const trades = useTrades(account.id);
  const navigate = useNavigate();
  const rows = useMemo(() => joinRows(trades.data ?? [], []), [trades.data]);
  const s = useMemo(() => stats(rows), [rows]);
  const days = useMemo(() => groupByDay(rows).slice(0, 5), [rows]);
  const basis = "Realized · closed trades · all time";
  let body: ReactNode;
  if (trades.data === undefined) body = trades.error ? <StatusIndicator status="unknown" label="Trades couldn't be read" /> : <LoadingState label="Loading trades" layout="metrics" rows={4} />;
  else if (trades.data.length === 0) body = <p className="ds-faint">No trades yet. Import a CSV or add a trade in the Journal.</p>;
  else body = (
    <>
      <div className="td-metrics">
        <MetricCard label="Net P&L" value={{ kind: "money", amount: s.net, currency: account.currency }} basis={basis}
          sub={s.unknown ? `${s.unknown} trade${s.unknown === 1 ? "" : "s"} with unknown P&L left out` : `${s.winners} W · ${s.losers} L`} />
        <MetricCard label="Win rate" value={{ kind: "percent", value: s.winRate, dp: 0 }} basis={basis} sub={`${s.known} closed trades with known P&L`} />
        <MetricCard label="Profit factor" value={s.profitFactor === null ? { kind: "unavailable", reason: "No losing trades yet" } : { kind: "text", text: s.profitFactor.toFixed(2) }} basis={basis} />
        <MetricCard label="Average win / loss" value={{ kind: "money", amount: s.averageWin, currency: account.currency }} basis={basis}
          sub={<>Average loss <span className="ds-mono">{formatMoney(s.averageLoss, { currency: account.currency })}</span></>} />
      </div>
      <h3 className="ds-label">Recent trading days</h3>
      <div className="td-days">
        {days.map(d => {
          const ds = stats(d.rows);
          return <DayCard key={d.day} day={d.day} trades={d.rows.length} pnl={ds.net} winRate={ds.winRate} currency={account.currency} onClick={() => navigate("/journal?view=day")} />;
        })}
      </div>
    </>
  );
  return (
    <section className="ds-card td-panel" aria-labelledby="td-realized-title">
      <div className="td-panel-head">
        <h2 id="td-realized-title" className="ds-title">Closed trades</h2>
        <span className="ds-faint">Realized results only; not live equity and not a risk figure.</span>
      </div>
      {body}
    </section>
  );
}

function HistoricalAttempt({ account, successor, onShow }: { account: AccountViewModel; successor: AccountViewModel | null; onShow: (a: AccountViewModel) => void }) {
  return (
    <section className="ds-card td-panel" aria-labelledby="td-history-title">
      <div className="td-panel-head">
        <h2 id="td-history-title" className="td-account-name">{accountLabel(account)}</h2>
        <AccountStatus account={account} />
      </div>
      <StatusIndicator status="neutral" label="Not in today's risk" />
      <p>This attempt isn't active, so Today doesn't estimate it and it adds nothing to the active accounts. Its trades, checkpoints and saved calculations are kept as history; a failure or reset recorded for it is not undone.</p>
      <div className="td-actions-left">
        <Link to={`/accounts/${encodeURIComponent(account.id)}`}>Open its history</Link>
        <Link to="/journal">Its trades</Link>
        {successor && (successor.status === "active" && successor.archivedAt === null
          ? <Button size="sm" onClick={() => onShow(successor)}>Show the new attempt ({successor.name})</Button>
          : <Link to={`/accounts/${encodeURIComponent(successor.id)}`}>Next attempt: {successor.name}</Link>)}
      </div>
    </section>
  );
}

function HistoryList({ history, archived }: { history: readonly AccountViewModel[]; archived: number }) {
  if (history.length === 0 && archived === 0) return null;
  return (
    <details className="ds-card td-panel td-history">
      <summary>Not in today's risk ({history.length + archived})</summary>
      <p className="ds-faint">Passed, failed, closed and paused attempts are history. They are never part of today's estimates.</p>
      <ul className="td-list">
        {history.map(a => <li key={a.id}><Link to={`/accounts/${encodeURIComponent(a.id)}`}>{accountLabel(a)}</Link> <AccountStatus account={a} /></li>)}
        {archived > 0 && <li className="ds-faint">{archived} archived account{archived === 1 ? "" : "s"}: see <Link to="/accounts">Accounts</Link>.</li>}
      </ul>
    </details>
  );
}
