// Calculation preview (Build 19 block D). The rules engine (Build 16) is not part of this build, so
// no figure, room left or Safe/Stop result is produced: the panel says so first. What it can show
// truthfully is the Build 15.5 evidence each rule would need and whether that evidence exists, read
// through the read-only `get_account_risk_inputs` and the domain's `assessRuleEvidence`. Reading
// writes nothing (no snapshot, assignment or status).
import { assessRuleEvidence, type AccountRiskInputs, type EvidenceState, type RuleDefinitionInput, type RuleParameters, type RuleType } from "@fundedflow/domain";
import { useState } from "react";

import { Badge, formatInstant, InlineNotice, Select, StateBoundary, StatList, type Tone, UnavailableState } from "../../../design-system";
import { retryRead, toAsyncState } from "../../shared/presentation";
import { useRiskInputs } from "../hooks/rulebooks";
import { ruleLabel } from "../view-models/compare";
import { notCalculated } from "../view-models/versions";

export const ENGINE_UNAVAILABLE_TITLE = "Preview unavailable — rule evaluator not connected";

const STATE: Record<EvidenceState, { label: string; tone: Tone }> = {
  available: { label: "Available (you reported it)", tone: "profit" },
  missing: { label: "Missing", tone: "loss" },
  incomplete: { label: "Incomplete", tone: "warn" },
  stale: { label: "Stale", tone: "warn" },
  conflicting: { label: "Conflicting", tone: "loss" },
  unsupported: { label: "Not supported in this version", tone: "neutral" },
  manual_verification: { label: "Needs your manual check", tone: "flow" },
};

const NEEDS: Record<string, string> = {
  baseline: "Opening balance checkpoint",
  closedTrades: "Complete closed trades",
  fees: "Complete fees",
  ledger: "Ledger movements",
  openPositions: "Open positions",
  eodHistory: "End-of-day settlements",
  intradayHistory: "Intraday equity history",
  current_equity: "Current equity",
  verified_method: "Verified drawdown method",
  verified_basis: "Verified basis (balance or equity)",
  manual_policy_verification: "Provider policy, checked by you",
  execution_history: "Execution history",
};

type Coverage = AccountRiskInputs["coverage"];
const ASSERTABLE = [
  ["closedTrades", "All closed trades are imported"],
  ["fees", "Fees are complete"],
  ["ledger", "Payouts, resets and corrections are recorded"],
] as const;
const ASSERT_OPTIONS = [
  { value: "available", label: "Yes, complete" },
  { value: "incomplete", label: "Not sure or partly" },
  { value: "missing", label: "No" },
] as const;

type Rule = Pick<RuleDefinitionInput, "ruleKey" | "ruleType" | "supportStatus" | "displayLabel" | "providerLabel"> & { parameters: unknown };

function needsFor(inputs: AccountRiskInputs, rule: Rule) {
  try {
    return assessRuleEvidence(inputs, rule.ruleType as RuleType, rule.parameters as RuleParameters<RuleType>);
  } catch {
    return null; // Parameters not valid yet (an unsaved edit): the editor shows the field errors.
  }
}

export function EvidencePreview({ accountId, rules, timeZone, versionLabel }: {
  accountId: string; rules: readonly Rule[]; timeZone: string; versionLabel: string;
}) {
  // One explicit cutoff per opening of the panel, so the key and the result are stable.
  const [asOf] = useState(() => new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString());
  const [assert, setAssert] = useState<Record<(typeof ASSERTABLE)[number][0], EvidenceState>>({ closedTrades: "incomplete", fees: "incomplete", ledger: "incomplete" });
  const coverage: Coverage = {
    baseline: "available", eodHistory: "available", // Checked against recorded observations natively; never promoted by this assertion.
    openPositions: "unsupported", intradayHistory: "unsupported",
    ...assert,
    sourceReference: "Rulebook preview: coverage asserted by the user on this computer",
  };
  const inputs = useRiskInputs(accountId, asOf, coverage);
  return (
    <div className="rb-preview">
      <UnavailableState title={ENGINE_UNAVAILABLE_TITLE} size="compact"
        reason={`FundedFlow's rules engine isn't part of this version, so ${versionLabel} produces no limit, room left or Safe / Caution / Stop result here. Nothing is estimated in its place. Below: the evidence each rule would need, and whether this account has it.`} />
      <fieldset className="rb-assert">
        <legend className="ds-label">What you can confirm about this account's history</legend>
        <p className="ds-faint">Your answers are a statement for this check only. They are not saved and don't verify anything.</p>
        <div className="rb-inline-fields">
          {ASSERTABLE.map(([key, label]) => (
            <Select key={key} label={label} size="sm" options={ASSERT_OPTIONS} value={assert[key]} onValueChange={v => setAssert(a => ({ ...a, [key]: v }))} />
          ))}
        </div>
      </fieldset>
      <StateBoundary state={toAsyncState(inputs)} label="evidence check" onRetry={retryRead(inputs.refresh)} timeZone={timeZone}>
        {data => {
          const lastObservation = data.observations.reduce<string | null>((m, o) => (m === null || o.observedAt > m ? o.observedAt : m), null);
          return (
            <>
              <StatList label="Evidence check basis" items={[
                { label: "Inputs as of", value: formatInstant(data.asOf, { timeZone, year: true, zoneName: true }) },
                { label: "Trading day", value: data.effectiveTradingDay },
                { label: "Latest balance checkpoint", value: lastObservation ? formatInstant(lastObservation, { timeZone, year: true, zoneName: true }) : <span className="ds-faint">None recorded</span> },
                { label: "Closed trades read", value: { kind: "count", value: data.trades.length } },
              ]} />
              <table className="rb-compare-table">
                <caption>Evidence each rule needs</caption>
                <thead><tr><th scope="col">Rule</th><th scope="col">Needs</th><th scope="col">This account</th></tr></thead>
                <tbody>
                  {rules.map(rule => {
                    const manual = notCalculated(rule as never);
                    const needs = manual ? null : needsFor(data, rule);
                    return (
                      <tr key={rule.ruleKey}>
                        <th scope="row">{ruleLabel(rule as never)}</th>
                        {manual ? (
                          <td colSpan={2}><Badge tone="flow">Not calculated</Badge> {manual}</td>
                        ) : needs === null ? (
                          <td colSpan={2} className="ds-faint">Fix this rule's values to check its evidence.</td>
                        ) : needs.length === 0 ? (
                          <td colSpan={2} className="ds-faint">No evidence requirement recorded.</td>
                        ) : (
                          <>
                            <td><ul className="rb-plain-list">{needs.map(n => <li key={n.requirement}>{NEEDS[n.requirement] ?? n.requirement}</li>)}</ul></td>
                            <td><ul className="rb-plain-list">{needs.map(n => <li key={n.requirement}><Badge tone={STATE[n.state].tone}>{STATE[n.state].label}</Badge></li>)}</ul></td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <InlineNotice tone="info" live="off" title="This is an inputs check, not a result">
                “Available” means you reported it; it is never a pass. Open positions and intraday equity aren't imported in this version,
                so rules that need them stay unknown even when everything else is present.
              </InlineNotice>
            </>
          );
        }}
      </StateBoundary>
    </div>
  );
}
