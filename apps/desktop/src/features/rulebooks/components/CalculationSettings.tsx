// What the trader states before a calculation (Build 19 ↔ Build 16): which parts of the history are
// complete (coverage), the currency of the rule amounts and whether touching a limit is a breach
// (EnginePolicy). FundedFlow never assumes these: unstated values leave the affected rules Unknown.
// Statements are for this calculation only; they are frozen into a saved calculation, not stored as
// settings, and never verify anything.
import type { EnginePolicy, EvidenceState, RulebookVersionDetail, RiskInputsQuery } from "@fundedflow/domain";
import { useMemo, useState } from "react";

import { Select, TextField } from "../../../design-system";
import { useSnapshotHistory } from "../../insights/hooks/insights";
import { priorBreachesFrom } from "../api/risk";

type Coverage = RiskInputsQuery["coverage"];
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
const NOT_STATED = "not_stated";

/** Verified provider claims that back a field (a whole-rule claim backs every field). */
function backingClaims(version: RulebookVersionDetail | null, field: string): string[] {
  return (version?.claims ?? [])
    .filter(c => c.claimStatus === "verified" && c.origin === "provider_stated" && c.reviewedBy !== null && (c.field === null || c.field === field))
    .map(c => c.id);
}

export function useCalculationSettings(accountId: string, currency: string, version: RulebookVersionDetail | null) {
  const [assert, setAssert] = useState<Record<(typeof ASSERTABLE)[number][0], EvidenceState>>({ closedTrades: "incomplete", fees: "incomplete", ledger: "incomplete" });
  const [ruleCurrency, setRuleCurrency] = useState<string>(NOT_STATED);
  const [boundary, setBoundary] = useState<string>(NOT_STATED);
  const [caution, setCaution] = useState("");
  const history = useSnapshotHistory(accountId);
  const coverage: Coverage = useMemo(() => ({
    // Checked natively against recorded checkpoints; these are never promoted by a statement.
    baseline: "available", eodHistory: "available",
    openPositions: "unsupported", intradayHistory: "unsupported",
    ...assert,
    sourceReference: "Coverage stated by the user on this computer for this calculation",
  }), [assert]);
  const cautionValid = caution.trim() === "" || /^\d+(\.\d{1,6})?$/.test(caution.trim());
  const policy: EnginePolicy = useMemo(() => ({
    ruleCurrency: ruleCurrency === NOT_STATED ? null : ruleCurrency,
    ruleCurrencySourceClaimIds: backingClaims(version, "currency"),
    boundary: boundary === NOT_STATED ? null : (boundary as EnginePolicy["boundary"]),
    boundarySourceClaimIds: backingClaims(version, "breach_boundary"),
    personalCautionHeadroom: caution.trim() === "" || !cautionValid ? null : caution.trim(),
    reconciliationRevisionIds: [],
    priorBreaches: priorBreachesFrom((history.data ?? []).map(s => s.explanation), accountId),
  }), [ruleCurrency, boundary, caution, cautionValid, version, history.data, accountId]);
  const element = (
    <fieldset className="rb-assert">
      <legend className="ds-label">What you state for this calculation</legend>
      <p className="ds-faint">Not saved as a setting and not verified. A saved calculation keeps what you stated with it.</p>
      <div className="rb-inline-fields">
        {ASSERTABLE.map(([key, label]) => (
          <Select key={key} label={label} size="sm" options={ASSERT_OPTIONS} value={assert[key]} onValueChange={v => setAssert(a => ({ ...a, [key]: v }))} />
        ))}
      </div>
      <div className="rb-inline-fields">
        <Select label="Rule amounts are in" size="sm" value={ruleCurrency} onValueChange={setRuleCurrency}
          options={[{ value: NOT_STATED, label: "Not stated" }, { value: currency, label: `${currency} (the account's currency)` }]} />
        <Select label="A limit is breached when the balance" size="sm" value={boundary} onValueChange={setBoundary}
          options={[{ value: NOT_STATED, label: "Not stated" }, { value: "touch_is_breach", label: "touches the limit" }, { value: "below_is_breach", label: "goes below the limit" }]} />
        <TextField label="Personal caution buffer" optional numeric inputMode="decimal" suffix={currency} value={caution} onChange={e => setCaution(e.target.value)}
          description="Your own warning margin, never firm policy." error={cautionValid ? undefined : "Use a positive amount, e.g. 250"} />
      </div>
    </fieldset>
  );
  return { coverage, policy, element, historyLoaded: history.data !== undefined || history.error !== null };
}
