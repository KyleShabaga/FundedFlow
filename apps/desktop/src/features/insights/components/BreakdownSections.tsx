// Insights breakdowns (by day, week or month, symbol, side, source, strategy, weekday) and tag analysis (setups,
// mistakes, emotions, general tags from Build 20 reviews). Each row is a summary of its trades and opens them; tag
// groups overlap (a trade with two tags is in both), which the tables say.
import { byPeriod, bySide, bySource, byStrategy, bySymbol, byTag, byWeekday, type PeriodKind } from "@fundedflow/domain";
import { useMemo } from "react";
import { Link } from "react-router-dom";

import { EmptyState, PnlBars, SegmentedControl } from "../../../design-system";
import { periodLabel } from "../view-models/insights";
import { barValue, BASIS_LABEL, GroupTable, groupDetail, type SectionProps } from "./shared";

const PERIOD_NAME: Record<Exclude<PeriodKind, "year">, string> = { day: "Day", week: "Week", month: "Month" };

export function BreakdownsSection({ selection, basis, currency, state, update, drill }: SectionProps) {
  const trades = selection.trades;
  const kind = state.period;
  const periods = useMemo(() => byPeriod(trades, kind).map(g => ({ ...g, label: periodLabel(kind, g.key) })), [trades, kind]);
  const scope = `${BASIS_LABEL[basis]} · selected attempts and filters`;
  const common = { basis, currency, drill, drillBasis: scope };
  return (
    <div className="in-section">
      <section className="ds-card in-card" aria-labelledby="in-period-h">
        <div className="in-card-head">
          <h3 id="in-period-h" className="ds-title">By {PERIOD_NAME[kind].toLowerCase()}</h3>
          <SegmentedControl<Exclude<PeriodKind, "year">> label="Group trades by" value={kind} onValueChange={period => update({ period })}
            options={[{ value: "day", label: "Day" }, { value: "week", label: "Week" }, { value: "month", label: "Month" }]} />
        </div>
        <p className="ds-faint in-note">Each account's stored trading day (its zone and reset time); weeks run Monday to Friday.</p>
        <PnlBars label={`${BASIS_LABEL[basis]} by ${PERIOD_NAME[kind].toLowerCase()}`} currency={currency} maxHeight={360}
          items={[...periods].reverse().map(g => ({ key: g.key, label: g.label, value: barValue(g.summary, basis), detail: groupDetail(g.summary) }))}
          onSelect={key => { const g = periods.find(p => p.key === key); if (g) drill({ title: g.label, basis: scope, ids: g.summary.tradeIds }); }} />
      </section>
      <GroupTable label={`By ${PERIOD_NAME[kind].toLowerCase()}`} nameHeader={PERIOD_NAME[kind]} groups={[...periods].reverse()} {...common} />
      <div className="in-two">
        <GroupTable label="By symbol" nameHeader="Symbol root" groups={bySymbol(trades)} {...common}
          note="Contract months are grouped by their instrument root (ESZ6 and ESH7 are ES); unknown symbols stand alone." />
        <GroupTable label="By weekday" nameHeader="Weekday" groups={byWeekday(trades)} {...common} />
        <GroupTable label="By side" nameHeader="Side" groups={bySide(trades)} {...common} />
        <GroupTable label="By source" nameHeader="Source" groups={bySource(trades)} {...common} />
      </div>
      <GroupTable label="By strategy" nameHeader="Strategy" groups={byStrategy(trades)} {...common}
        note="The strategy recorded on each trade's review, by the name it had when chosen." />
    </div>
  );
}

const TAG_KINDS = [
  { kind: "setup", title: "Setups", header: "Setup" },
  { kind: "mistake", title: "Mistakes", header: "Mistake" },
  { kind: "emotion", title: "Mindset", header: "Mindset tag" },
  { kind: "general", title: "Other tags", header: "Tag" },
] as const;

export function TagsSection({ selection, basis, currency, drill }: SectionProps) {
  const trades = selection.trades;
  const groups = TAG_KINDS.map(k => ({ ...k, groups: byTag(trades, k.kind) })).filter(k => k.groups.length > 0);
  const tagged = trades.filter(t => (t.review?.tags.length ?? 0) > 0).length;
  if (groups.length === 0) {
    return (
      <div className="ds-card">
        <EmptyState kind="no-records" title="No tags on these trades"
          description="Tag setups, mistakes and mindset on a trade's review in the Journal; they show here once recorded."
          action={<Link to="/journal?view=library&section=tags">Open the tag library</Link>} />
      </div>
    );
  }
  return (
    <div className="in-section">
      <p className="ds-faint in-note">
        {tagged} of {trades.length} closed trades carry a tag. A trade with several tags counts in each, so rows can add up to more than the total.
      </p>
      {groups.map(g => (
        <GroupTable key={g.kind} label={g.title} nameHeader={g.header} groups={g.groups} basis={basis} currency={currency} drill={drill}
          drillBasis={`${BASIS_LABEL[basis]} · trades tagged on their review`} />
      ))}
    </div>
  );
}
