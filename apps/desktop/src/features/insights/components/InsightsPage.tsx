// Insights (Build 23, docs/design/screens/07-insights.md): learn from traceable evidence. One read-only snapshot of
// exactly the chosen attempts (archived and failed ones included on request), one canonical included-trade selection
// over it (selectTrades), and every figure a summary of a subset of that selection that opens its exact trades. The
// choices live in the URL, so returning from a trade restores them. Money never crosses currencies.
import { selectTrades, summarize, type InsightsDataset, type InsightsFilter } from "@fundedflow/domain";
import { Filter, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  ErrorState,
  formatInstant,
  InlineNotice,
  LoadingState,
  Popover,
  SegmentedControl,
  Select,
  StateBoundary,
  Switch,
  TabPanel,
  Tabs,
  TextField,
} from "../../../design-system";
import { useActiveAccount } from "../../accounts/active-account";
import type { AccountViewModel } from "../../accounts/view-models/account";
import { retryRead, toAsyncState } from "../../shared/presentation";
import { useInsightsDataset } from "../hooks/insights";
import {
  type Drill,
  type InsightsState,
  isFiltered,
  LIST_STATUSES,
  NO_STRATEGY,
  parseInsightsParams,
  type Section,
  STATUS_LABEL,
  toInsightsParams,
  tradesText,
} from "../view-models/insights";
import { AttemptsSection } from "./AttemptsSection";
import { BreakdownsSection, TagsSection } from "./BreakdownSections";
import { CalendarSection } from "./CalendarSection";
import { ContributingTradesDrawer } from "./ContributingTrades";
import { OverviewSection } from "./OverviewSection";
import { BASIS_LABEL, DrillButton, type SectionProps } from "./shared";
import "./insights.css";

const ANY = "__any__";

export function InsightsPage() {
  const active = useActiveAccount();
  const [params, setParams] = useSearchParams();
  const state = useMemo(() => parseInsightsParams(params), [params]);
  const update = (patch: Partial<InsightsState>) => setParams(toInsightsParams({ ...state, ...patch }), { replace: true });
  const navigate = useNavigate();

  if (active.state.kind === "loading") return <LoadingState label="Loading accounts" layout="table" rows={4} />;
  if (active.state.kind === "error") return <ErrorState scope="route" title="Accounts couldn't be loaded" message="Insights needs to know which accounts exist. Use the recovery controls, then try again." />;
  const accounts = active.accounts ?? [];
  if (accounts.length === 0) {
    return (
      <div className="ds-card">
        <EmptyState kind="not-configured" title="Add an account to see Insights"
          description="Insights adds up the closed trades of the accounts you choose. Add an account and its trades first."
          action={<Button variant="primary" onClick={() => navigate("/accounts")}>Go to Accounts</Button>} />
      </div>
    );
  }
  // Explicit attempts from the URL; otherwise the active account. Never silently widened.
  const selectedIds = state.accounts ?? (active.activeId ? [active.activeId] : []);
  return (
    <div className="in-page">
      <div className="in-head">
        <p className="jr-sub">Closed trades only: every number opens the trades it was added up from. Not account balance, live equity or firm compliance.</p>
        <div className="in-head-actions">
          <AccountPicker accounts={accounts} selected={selectedIds} state={state} update={update} />
          <SegmentedControl label="P&L basis" value={state.basis} onValueChange={basis => update({ basis })}
            options={[{ value: "net", label: "Net P&L" }, { value: "gross", label: "Gross P&L" }]} />
        </div>
      </div>
      {selectedIds.length === 0 ? (
        <div className="ds-card">
          <EmptyState kind="not-configured" title="Choose the accounts to analyse"
            description="Pick one or more attempts with Accounts above. Failed, passed, closed and archived attempts can be chosen too." />
        </div>
      ) : (
        <Loaded key={[...selectedIds].sort().join(",")} ids={selectedIds} state={state} update={update} />
      )}
    </div>
  );
}

function Loaded({ ids, state, update }: { ids: string[]; state: InsightsState; update: (p: Partial<InsightsState>) => void }) {
  const dataset = useInsightsDataset(ids);
  return (
    <StateBoundary state={toAsyncState(dataset)} label="insights" scope="route" onRetry={retryRead(dataset.refresh)}
      loading={<LoadingState label="Adding up the selected trades" layout="panel" />}>
      {data => <Body dataset={data} ids={ids} state={state} update={update} />}
    </StateBoundary>
  );
}

function Body({ dataset, ids, state, update }: { dataset: InsightsDataset; ids: string[]; state: InsightsState; update: (p: Partial<InsightsState>) => void }) {
  const filter: InsightsFilter = { ...state.filter, accountIds: ids };
  const filterKey = JSON.stringify(filter);
  const selection = useMemo(() => selectTrades(dataset, filter), [dataset, filterKey]);
  const summary = useMemo(() => summarize(selection.trades), [selection]);
  const [drill, setDrill] = useState<Drill | null>(null);
  const hasTags = selection.trades.some(t => (t.review?.tags.length ?? 0) > 0);
  const props: SectionProps = { selection, summary, basis: state.basis, currency: selection.currency, state, update, drill: setDrill };
  const zone = selection.accounts[0]?.timezone;
  const failedImports = selection.accounts.reduce((n, a) => n + a.failedImportCount, 0);
  const allClosed = selection.candidates.length + selection.excluded.filteredOut;
  const clear = () => update({ filter: { ...state.filter, from: null, to: null, symbol: null, side: "all", strategyId: null, tagId: null, source: "all" }, day: null });
  const sections: { value: Section; label: string }[] = [
    { value: "overview", label: "Overview" }, { value: "calendar", label: "Calendar" }, { value: "breakdowns", label: "Breakdowns" },
    ...(hasTags ? [{ value: "tags" as const, label: "Tags" }] : []), { value: "attempts", label: "Attempts" },
  ];
  const section = sections.some(s => s.value === state.section) ? state.section : "overview";

  return (
    <div className="in-body">
      <FilterBar dataset={dataset} state={state} update={update} currencies={selection.currencies} onClear={clear} />
      <p className="ds-faint in-prov" aria-live="polite">
        {selection.accounts.length === 1 ? selection.accounts[0]!.name : `${selection.accounts.length} attempts`} · {tradesText(selection.trades.length)} included
        {selection.currency ? ` · ${selection.currency}` : ""} · {BASIS_LABEL[state.basis]} · journal read {formatInstant(selection.dataAsOf, { timeZone: zone })} · definitions {selection.version}
        {selection.excluded.open ? ` · ${selection.excluded.open} open left out` : ""}
        {selection.excluded.deleted ? ` · ${selection.excluded.deleted} deleted left out` : ""}
        {selection.excluded.filteredOut ? ` · ${selection.excluded.filteredOut} filtered out` : ""}
        {selection.excluded.otherCurrency ? ` · ${selection.excluded.otherCurrency} in another currency` : ""}
      </p>
      {selection.missingAccountIds.length > 0 && (
        <InlineNotice tone="warning" title="Some chosen accounts no longer exist">
          {selection.missingAccountIds.length === 1 ? "One account was" : `${selection.missingAccountIds.length} accounts were`} not found and is left out. Choose accounts again to clear this.
        </InlineNotice>
      )}
      {failedImports > 0 && (
        <InlineNotice tone="warning" title="An import for these accounts failed">
          {failedImports === 1 ? "One CSV import" : `${failedImports} CSV imports`} did not complete, so those rows are not in the journal or in these figures. See Import history.
        </InlineNotice>
      )}
      {selection.currencyConflict ? (
        <InlineNotice tone="warning" title="These attempts use different currencies">
          {selection.currencies.join(", ")} amounts are never added together or converted. Choose one currency in the filters to see its figures; the Attempts tab compares each attempt in its own currency.
        </InlineNotice>
      ) : null}
      {summary.unknownPnl > 0 && (
        <InlineNotice tone="info" title={`${tradesText(summary.unknownPnl)} with an unknown P&L`}
          actions={<DrillButton ids={summary.unknownIds} title="Trades with an unknown P&L" basis="No point value or broker P&L, or another currency" drill={setDrill}>View them</DrillButton>}>
          They are counted but left out of every sum and ratio, never treated as zero.
        </InlineNotice>
      )}
      {allClosed === 0 ? (
        <div className="ds-card">
          <EmptyState kind="no-records" title="No closed trades in these attempts"
            description={selection.excluded.open ? `${tradesText(selection.excluded.open)} still open; Insights counts closed trades only.` : "Import or enter trades in the Journal, then come back."} />
        </div>
      ) : selection.candidates.length === 0 ? (
        <div className="ds-card">
          <EmptyState kind="no-matches" title="No closed trades match these filters" description={`All ${tradesText(allClosed)} are filtered out.`}
            action={<Button onClick={clear}>Clear filters</Button>} />
        </div>
      ) : (
        <Tabs label="Insights sections" value={section} onValueChange={v => update({ section: v as Section })} items={sections}>
          <TabPanel value="overview" heading="Overview">{selection.currency ? <OverviewSection {...props} /> : <ChooseCurrency />}</TabPanel>
          <TabPanel value="calendar" heading="Calendar">{selection.currency ? <CalendarSection {...props} /> : <ChooseCurrency />}</TabPanel>
          <TabPanel value="breakdowns" heading="Breakdowns">{selection.currency ? <BreakdownsSection {...props} /> : <ChooseCurrency />}</TabPanel>
          {hasTags && <TabPanel value="tags" heading="Tags">{selection.currency ? <TagsSection {...props} /> : <ChooseCurrency />}</TabPanel>}
          <TabPanel value="attempts" heading="Attempts"><AttemptsSection {...props} /></TabPanel>
        </Tabs>
      )}
      <ContributingTradesDrawer drill={drill} selection={selection} onClose={() => setDrill(null)} />
    </div>
  );
}

function ChooseCurrency() {
  return (
    <div className="ds-card">
      <EmptyState kind="not-configured" title="Choose a currency" description="These attempts hold trades in more than one currency. Pick one with the Currency filter; amounts are never converted." />
    </div>
  );
}

function FilterBar({ dataset, state, update, currencies, onClear }: {
  dataset: InsightsDataset; state: InsightsState; update: (p: Partial<InsightsState>) => void; currencies: string[]; onClear: () => void;
}) {
  const f = state.filter;
  const set = (patch: Partial<InsightsState["filter"]>) => update({ filter: { ...f, ...patch }, day: null });
  const symbols = [...new Set(dataset.trades.map(t => t.symbolRoot ?? t.symbol))].sort();
  const strategies = new Map<string, string>();
  const tags = new Map<string, string>();
  for (const t of dataset.trades) {
    if (t.review?.strategyId) strategies.set(t.review.strategyId, t.review.strategyName ?? "Strategy");
    for (const tag of t.review?.tags ?? []) tags.set(tag.tagId, `${tag.label} (${tag.kind})`);
  }
  const allCurrencies = [...new Set([...currencies, ...dataset.accounts.map(a => a.currency)])].sort();
  return (
    <section className="ds-card in-filters" aria-label="Filters">
      <span className="in-filters-title"><Filter size={14} aria-hidden="true" /> Filters</span>
      <TextField type="date" label="From trading day" value={f.from ?? ""} onChange={e => set({ from: e.target.value || null })} />
      <TextField type="date" label="To trading day" value={f.to ?? ""} onChange={e => set({ to: e.target.value || null })} />
      <Select size="sm" label="Symbol" value={f.symbol ?? ANY} onValueChange={v => set({ symbol: v === ANY ? null : v })}
        options={[{ value: ANY, label: "All symbols" }, ...symbols.map(s => ({ value: s, label: s }))]} />
      <Select size="sm" label="Side" value={f.side} onValueChange={side => set({ side })}
        options={[{ value: "all", label: "Long and short" }, { value: "long", label: "Long" }, { value: "short", label: "Short" }]} />
      <Select size="sm" label="Strategy" value={f.strategyId ?? ANY} onValueChange={v => set({ strategyId: v === ANY ? null : v })}
        options={[{ value: ANY, label: "Any strategy" }, { value: NO_STRATEGY, label: "No strategy" }, ...[...strategies].map(([value, label]) => ({ value, label }))]} />
      <Select size="sm" label="Tag" value={f.tagId ?? ANY} onValueChange={v => set({ tagId: v === ANY ? null : v })}
        options={[{ value: ANY, label: "Any tag" }, ...[...tags].map(([value, label]) => ({ value, label }))]} />
      <Select size="sm" label="Source" value={f.source} onValueChange={source => set({ source })}
        options={[{ value: "all", label: "Imported and manual" }, { value: "csv_import", label: "Imported" }, { value: "manual", label: "Manual" }]} />
      {allCurrencies.length > 1 && (
        <Select size="sm" label="Currency" value={f.currency ?? ANY} onValueChange={v => set({ currency: v === ANY ? null : v })}
          options={[{ value: ANY, label: "Choose…" }, ...allCurrencies.map(c => ({ value: c, label: c }))]} />
      )}
      <Button size="sm" variant="ghost" onClick={onClear} disabled={!isFiltered(f)} disabledReason={!isFiltered(f) ? "No filters are set" : undefined}>Clear filters</Button>
    </section>
  );
}

function AccountPicker({ accounts, selected, state, update }: { accounts: AccountViewModel[]; selected: string[]; state: InsightsState; update: (p: Partial<InsightsState>) => void }) {
  const chosen = new Set(selected);
  const shown = accounts.filter(a => state.statuses.includes(a.status) && (state.archived || a.archivedAt === null || chosen.has(a.id)));
  const choose = (ids: string[]) => update({ accounts: ids, day: null, filter: { ...state.filter, currency: null } });
  const toggle = (id: string) => choose(chosen.has(id) ? selected.filter(x => x !== id) : [...selected, id]);
  const names = accounts.filter(a => chosen.has(a.id));
  const summary = names.length === 0 ? "Choose accounts" : names.length === 1 ? names[0]!.name : `${names.length} accounts`;
  return (
    <Popover label="Accounts to analyse" width={380}
      trigger={<Button icon={<Users size={16} aria-hidden="true" />} aria-label={`Accounts: ${summary}`}>{summary}</Button>}>
      <div className="in-picker">
        <fieldset className="in-picker-statuses">
          <legend className="ds-label">Show attempts that are</legend>
          {LIST_STATUSES.map(s => (
            <Checkbox key={s} label={STATUS_LABEL[s]} checked={state.statuses.includes(s)}
              onChange={e => update({ statuses: e.target.checked ? [...state.statuses, s] : state.statuses.filter(x => x !== s) })} />
          ))}
        </fieldset>
        <Switch label="Include archived attempts" description="Archived attempts are read-only history; they never count toward Today's risk." checked={state.archived}
          onChange={e => update({ archived: e.target.checked })} />
        <fieldset className="in-picker-list">
          <legend className="ds-label">Accounts ({shown.length} shown)</legend>
          {shown.length === 0 && <p className="ds-faint">No account matches these statuses.</p>}
          {shown.map(a => (
            <Checkbox key={a.id} checked={chosen.has(a.id)} onChange={() => toggle(a.id)}
              label={<span className="in-picker-row">{a.name}<Badge>{STATUS_LABEL[a.status]}</Badge>{a.archivedAt && <Badge variant="outline">Archived</Badge>}<span className="ds-faint">{a.currency}{a.externalRef ? ` · ${a.externalRef}` : ""}</span></span>} />
          ))}
        </fieldset>
        <div className="in-picker-actions">
          <Button size="sm" onClick={() => choose([...new Set([...selected, ...shown.map(a => a.id)])])} disabled={shown.length === 0}>Select all shown</Button>
          <Button size="sm" variant="ghost" onClick={() => choose([])} disabled={selected.length === 0}>Clear</Button>
        </div>
      </div>
    </Popover>
  );
}
