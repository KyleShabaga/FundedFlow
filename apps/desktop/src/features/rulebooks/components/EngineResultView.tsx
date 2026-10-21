// A Build 16 engine result, as the engine produced it (Build 19 blocks D and F). Status with its
// assurance, the cutoff and data times, the versions and inputs hash, then each rule's outcome with
// its formula, operands, missing inputs, evidence and sources. Values are formatted, never derived.
import type { EngineResult, RuleOutcome } from "@fundedflow/domain";

import { Badge, formatInstant, formatMoney, InlineNotice, StatList, StatusIndicator } from "../../../design-system";
import { ASSURANCE, OUTCOME, quantityLabel, reasonText, RESULT_STATUS } from "../view-models/engine-wording";

type Value = string | number | boolean | null;

function quantity(value: Value, currency: string): string {
  if (value === null) return "Unknown";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return value.toLocaleString("en-US");
  return formatMoney(value, { signed: false, currency, dp: 2 });
}

function money(value: string | null, currency: string) {
  return value === null ? <span className="ds-faint">Unknown</span> : formatMoney(value, { currency, dp: 2 });
}

/** One rule's outcome as the engine recorded it (also Today's per-metric explanation, Build 21). */
export function RuleResult({ outcome, label, currency }: { outcome: RuleOutcome; label: string; currency: string }) {
  const state = OUTCOME[outcome.state];
  const operands = Object.entries(outcome.operands);
  const metrics = Object.entries(outcome.metrics);
  const headingId = `rb-outcome-${outcome.ruleKey.replace(/[^a-z0-9]/gi, "-")}`;
  return (
    <section className="ds-card rb-rule" aria-labelledby={headingId}>
      <header className="rb-rule-head">
        <h4 id={headingId} className="ds-title">{label}</h4>
        <Badge tone={state.tone}>{state.label}</Badge>
      </header>
      <p className="rb-rule-note">{reasonText(outcome.reasonCode)}</p>
      {outcome.formula && <p><span className="ds-label">Formula</span> <span className="ds-mono">{outcome.formula}</span></p>}
      {operands.length > 0 && <StatList label={`${label}: operands`} items={operands.map(([k, v]) => ({ label: quantityLabel(k), value: quantity(v, currency) }))} />}
      {metrics.length > 0 && <StatList label={`${label}: results`} items={metrics.map(([k, v]) => ({ label: quantityLabel(k), value: quantity(v as Value, currency) }))} />}
      {outcome.missingInputs.length > 0 && (
        <div>
          <span className="ds-label">Missing or unresolved</span>
          <ul className="rb-plain-list">{outcome.missingInputs.map(m => <li key={m}>{reasonText(m)}</li>)}</ul>
        </div>
      )}
      {outcome.evidence.length > 0 && (
        <div>
          <span className="ds-label">Evidence</span>
          <ul className="rb-plain-list">{outcome.evidence.map(e => <li key={e.requirement}><span className="ds-mono">{e.requirement}</span>: {e.state.replace(/_/g, " ")}</li>)}</ul>
        </div>
      )}
      {outcome.assumptions.length > 0 && <ul className="rb-plain-list ds-faint">{outcome.assumptions.map(a => <li key={a}>{a}</li>)}</ul>}
      <details>
        <summary>Sources and contributing records ({outcome.sourceReferences.length})</summary>
        <ul className="rb-plain-list ds-mono rb-hash">{outcome.sourceReferences.map(s => <li key={s}>{s}</li>)}</ul>
      </details>
    </section>
  );
}

export function EngineResultView({ result, mode, timeZone, currency, ruleLabels, versionLabel, calculatedAt }: {
  result: EngineResult;
  /** simulation: a preview of a proposal, never the account's status. recorded: a stored calculation. */
  mode: "simulation" | "recorded";
  timeZone: string;
  currency: string;
  /** Rule names by ruleKey, from the version evaluated. */
  ruleLabels: Record<string, string>;
  versionLabel: string;
  /** Native recording time of a stored calculation. */
  calculatedAt?: string;
}) {
  const status = RESULT_STATUS[result.status];
  const at = (v: string | null) => (v ? formatInstant(v, { timeZone, year: true, zoneName: true }) : <span className="ds-faint">No records</span>);
  return (
    <div className="rb-explain">
      {mode === "simulation" && (
        <InlineNotice tone="info" live="off" title="Simulation: not this account's status">
          What the account's recorded evidence would give under {versionLabel}. Nothing is assigned, published or saved.
        </InlineNotice>
      )}
      <div className="rb-status">
        <StatusIndicator status={status.kind} label={mode === "simulation" ? `Simulated: ${status.label}` : status.label} />
        {/* Visible, not only a hover title: what the result can be trusted for is part of the result. */}
        <p className="rb-assurance">{ASSURANCE[result.assurance]}</p>
      </div>
      {result.reasons.length > 0 && (
        <section aria-label="Why the status is not Safe">
          <span className="ds-label">Why</span>
          <ul className="rb-plain-list">{result.reasons.map(r => <li key={r}>{reasonText(r)}</li>)}</ul>
        </section>
      )}
      <StatList label="Calculation basis" items={[
        { label: "Cutoff (as of)", value: at(result.asOf) },
        { label: "Newest data used", value: at(result.dataAsOf) },
        ...(calculatedAt ? [{ label: "Calculated at", value: at(calculatedAt) }] : []),
        { label: "Trading day", value: result.tradingDay },
        { label: "Rulebook version", value: versionLabel },
        { label: "Assignment", value: result.assignmentId === null ? <span className="ds-faint">None</span> : mode === "simulation" ? "Simulated (not assigned)" : <span className="ds-mono rb-hash">{result.assignmentId}</span> },
        { label: "Engine", value: result.engineVersion },
        { label: "Inputs hash", value: <span className="ds-mono rb-hash">{result.inputsHash}</span> },
        { label: "Balance (closed trades and ledger)", value: money(result.balance, currency) },
        { label: "Today's realized P&L", value: money(result.realizedDayPnl, currency) },
        { label: "Trading days with trades", value: result.tradingDaysCompleted === null ? <span className="ds-faint">Unknown</span> : { kind: "count", value: result.tradingDaysCompleted } },
      ]} />
      <section className="rb-editor" aria-label="Rule results">
        {result.rules.map(r => <RuleResult key={r.ruleId} outcome={r} label={ruleLabels[r.ruleKey] ?? r.ruleKey} currency={currency} />)}
        {result.rules.length === 0 && <p className="ds-faint">No rules were evaluated.</p>}
      </section>
      <ul className="rb-plain-list ds-faint">{result.assumptions.map(a => <li key={a}>{a}</li>)}</ul>
    </div>
  );
}
