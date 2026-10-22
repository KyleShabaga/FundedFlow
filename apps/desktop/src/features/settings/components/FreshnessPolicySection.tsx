// Settings → Account freshness (P0-D06): which policy colours the account menu's dots. Presets save at once; a custom
// policy is validated and saved with its own button; Reset to default goes back to the default policy. The policy
// changes thresholds, never a result: there is no way to mark an account fresh by hand.
import { useState } from "react";

import { Button, FormSection, InlineNotice, RadioGroup, Select, StatList, Switch, TextField } from "../../../design-system";
import { LIMITS, policyText, type FreshnessRules, type PresetName } from "../../accounts/freshness";
import { useFreshnessPolicy } from "../../accounts/hooks/freshness";
import "./settings.css";

type Mode = PresetName | "custom";
type Unit = FreshnessRules["records"]["unit"];

const MODE_OPTIONS: { value: Mode; label: string; description: string }[] = [
  { value: "default", label: "Default: updated since the previous trading day", description: "Fresh when an import or a trade you entered was saved after the previous trading day began (in the account's time zone and reset time). No firm checkpoint needed." },
  { value: "three_days", label: "Records within 3 days", description: "Fresh when records were updated in the last 72 hours. No firm checkpoint needed." },
  { value: "with_checkpoint", label: "Records within 3 days and a firm checkpoint within 7 days", description: "Also needs a balance checkpoint you confirmed from the firm's dashboard in the last 7 days." },
  { value: "custom", label: "Custom", description: "Set your own limits." },
];

interface Draft { count: string; unit: Unit; checkpoint: boolean; checkpointDays: string }
const draftOf = (rules: FreshnessRules): Draft => ({
  count: String(rules.records.count), unit: rules.records.unit,
  checkpoint: rules.checkpoint.required, checkpointDays: String(rules.checkpoint.required ? rules.checkpoint.maxDays : 7),
});
const whole = (text: string) => (/^\d{1,3}$/.test(text.trim()) ? Number(text.trim()) : NaN);

function validate(d: Draft): { rules: FreshnessRules | null; errors: { count?: string; checkpointDays?: string } } {
  const limit = d.unit === "trading_days" ? LIMITS.tradingDays : LIMITS.days;
  const count = whole(d.count);
  const days = whole(d.checkpointDays);
  const errors: { count?: string; checkpointDays?: string } = {};
  if (!(count >= limit.min && count <= limit.max)) errors.count = `Enter a whole number from ${limit.min} to ${limit.max}.`;
  if (d.checkpoint && !(days >= LIMITS.checkpointDays.min && days <= LIMITS.checkpointDays.max)) errors.checkpointDays = `Enter a whole number from ${LIMITS.checkpointDays.min} to ${LIMITS.checkpointDays.max}.`;
  if (errors.count || errors.checkpointDays) return { rules: null, errors };
  return { rules: { records: { unit: d.unit, count }, checkpoint: d.checkpoint ? { required: true, maxDays: days } : { required: false } } as FreshnessRules, errors };
}

export function FreshnessPolicySection() {
  const { policy, ready, save, isSaving, saveError } = useFreshnessPolicy();
  const [customOpen, setCustomOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<{ count?: string; checkpointDays?: string }>({});
  const mode: Mode | null = !ready ? null : customOpen ? "custom" : policy.mode;
  const current = draft ?? draftOf(policy.rules);

  const choose = (next: Mode) => {
    if (next === "custom") {
      setCustomOpen(true);
      setDraft(draftOf(policy.rules));
      setErrors({});
      return;
    }
    setCustomOpen(false);
    setDraft(null);
    if (next !== policy.mode) void save({ mode: next }).catch(() => undefined);
  };
  const saveCustom = () => {
    const { rules, errors: found } = validate(current);
    setErrors(found);
    if (!rules) return;
    void save({ mode: "custom", rules }).then(() => { setCustomOpen(false); setDraft(null); }, () => undefined);
  };
  const reset = () => {
    setCustomOpen(false);
    setDraft(null);
    setErrors({});
    void save({ mode: "default" }).catch(() => undefined);
  };
  const shown = mode === "custom" && customOpen ? validate(current).rules ?? policy.rules : policy.rules;
  const limit = current.unit === "trading_days" ? LIMITS.tradingDays : LIMITS.days;

  return (
    <FormSection
      headingLevel={2}
      title="Account freshness"
      description="The dots in the account menu show how recent each account's records are. They aren't a live connection to your broker or firm, and they don't check balances or rules."
      actions={ready && (policy.mode !== "default" || customOpen) ? <Button size="sm" variant="ghost" onClick={reset} disabled={isSaving}>Reset to default</Button> : undefined}
    >
      <RadioGroup<Mode> label="Freshness policy" value={mode} disabled={!ready || isSaving} onValueChange={choose} options={MODE_OPTIONS} />
      {mode === "custom" && customOpen && (
        <div className="st-fresh-custom">
          <div className="st-fresh-row">
            <TextField label="Records updated within" inputMode="numeric" value={current.count} error={errors.count}
              description={`${limit.min}–${limit.max}`} onChange={e => setDraft({ ...current, count: e.target.value })} />
            <Select<Unit> label="Unit" value={current.unit} onValueChange={unit => setDraft({ ...current, unit })}
              options={[{ value: "trading_days", label: "trading days (Mon–Fri)" }, { value: "days", label: "days (24 hours each)" }]} />
          </div>
          <Switch label="Require a firm checkpoint you confirmed" checked={current.checkpoint} onChange={e => setDraft({ ...current, checkpoint: e.target.checked })}
            description="Without one, or with an older one, the account needs attention." />
          {current.checkpoint && (
            <TextField label="Checkpoint within (days)" inputMode="numeric" value={current.checkpointDays} error={errors.checkpointDays}
              description={`${LIMITS.checkpointDays.min}–${LIMITS.checkpointDays.max}`} onChange={e => setDraft({ ...current, checkpointDays: e.target.value })} fieldClassName="st-fresh-days" />
          )}
          <div><Button variant="primary" loading={isSaving} onClick={saveCustom}>Save custom policy</Button></div>
        </div>
      )}
      {policy.fallback && !customOpen && (
        <InlineNotice tone="warning" title="Saved policy couldn't be used">The default policy applies until you choose again.</InlineNotice>
      )}
      {saveError && (
        <InlineNotice tone="error" title="Policy not saved">Your choice couldn't be saved. The dots still use: {policyText(policy.rules)}.</InlineNotice>
      )}
      <StatList bordered label="What the dots mean" items={[
        { label: "Green: fresh", value: ready ? capital(policyText(shown)) + "." : null },
        { label: "Yellow: needs attention", value: ready ? `Older records${shown.checkpoint.required ? ", a missing or older firm checkpoint" : ""}, or the newest import failed.` : null },
        { label: "Grey: unknown", value: "No records yet, couldn't check, or a finished attempt (no new data expected). Never shown as fresh." },
      ]} />
    </FormSection>
  );
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
