// One rule of a version: read-only facts, or the editable fields of a draft (Build 19).
import { manualRuleTypes, supportStatuses, type RuleClaim, type SupportStatus } from "@fundedflow/domain";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";

import { Badge, IconButton, RuleStateBadge, Select, StatList, Textarea, TextField } from "../../../design-system";
import { ruleLabel } from "../view-models/compare";
import type { DraftRule } from "../view-models/draft-form";
import { describeValue, headlinePresence, RULE_FIELDS, RULE_TYPE_LABELS } from "../view-models/rule-fields";
import { catalogueNames, notCalculated, SUPPORT_LABELS } from "../view-models/versions";
import { errorUnder, RuleParameterFields } from "./RuleParameterFields";

const CLAIM_TONE = { candidate: "neutral", verified: "profit", rejected: "neutral", stale: "warn", conflicting: "loss" } as const;

export function RuleSources({ claims, names }: { claims: readonly RuleClaim[]; names: ReturnType<typeof catalogueNames> }) {
  if (claims.length === 0) return <span className="ds-faint">No source claims recorded</span>;
  return (
    <ul className="rb-plain-list">
      {claims.map(c => {
        const s = names.source(c.sourceId);
        return (
          <li key={c.id}>
            <Badge tone={CLAIM_TONE[c.claimStatus]}>{c.claimStatus === "conflicting" ? "Conflicting" : c.claimStatus.charAt(0).toUpperCase() + c.claimStatus.slice(1)}</Badge>{" "}
            {s?.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.label}</a> : <span>{s?.label ?? "Source"}</span>}
            {c.field && <span className="ds-faint"> · {c.field}</span>}
            {c.providerText && <span className="ds-faint"> · “{c.providerText}”</span>}
            {c.note && <span className="ds-faint"> · {c.note}</span>}
          </li>
        );
      })}
    </ul>
  );
}

export function RuleSummaryBadge({ rule }: { rule: Pick<DraftRule, "ruleType" | "supportStatus" | "parameters"> }) {
  return <RuleStateBadge context="detail" support={rule.supportStatus} presence={headlinePresence(rule.ruleType, rule.parameters)}
    meter={rule.supportStatus === "supported" ? <Badge tone="flow">Can be calculated</Badge> : undefined} />;
}

export function RuleCard({ rule, index, count, currency, claims, names, editor }: {
  rule: DraftRule;
  index: number;
  count: number;
  currency: string;
  claims: readonly RuleClaim[];
  names: ReturnType<typeof catalogueNames>;
  /** Present for an editable draft. */
  editor?: {
    onChange: (rule: DraftRule) => void;
    onRemove: () => void;
    onMove: (delta: -1 | 1) => void;
    errors: Record<string, string>;
    disabled?: boolean;
  };
}) {
  const label = ruleLabel(rule);
  const headingId = `rb-rule-${index}-title`;
  const why = notCalculated(rule);
  const manual = manualRuleTypes.includes(rule.ruleType);
  const supportOptions = supportStatuses
    .filter(s => !manual || s === "manual_only" || s === "unsupported")
    .map(s => ({ value: s, label: SUPPORT_LABELS[s] }));
  const e = editor?.errors ?? {};
  return (
    <section className="ds-card rb-rule" aria-labelledby={headingId}>
      <header className="rb-rule-head">
        <div>
          <h3 id={headingId} className="ds-title">{label}</h3>
          <span className="ds-faint">{RULE_TYPE_LABELS[rule.ruleType]} · key <span className="ds-mono">{rule.ruleKey}</span></span>
        </div>
        <div className="rb-rule-actions">
          <RuleSummaryBadge rule={rule} />
          {editor && <>
            <IconButton label={`Move ${label} up`} icon={<ArrowUp size={16} aria-hidden="true" />} variant="ghost" size="sm" disabled={editor.disabled || index === 0} onClick={() => editor.onMove(-1)} />
            <IconButton label={`Move ${label} down`} icon={<ArrowDown size={16} aria-hidden="true" />} variant="ghost" size="sm" disabled={editor.disabled || index === count - 1} onClick={() => editor.onMove(1)} />
            <IconButton label={`Remove ${label}`} icon={<Trash2 size={16} aria-hidden="true" />} variant="ghost" size="sm" disabled={editor.disabled} onClick={editor.onRemove} />
          </>}
        </div>
      </header>
      {why && <p className="rb-rule-note"><Badge tone="flow">Not calculated</Badge> {why}</p>}
      {editor ? (
        <div className="rb-form">
          <div className="rb-inline-fields">
            <TextField id={`rb-r${index}-displayLabel`} label="Your label" optional value={rule.displayLabel ?? ""} disabled={editor.disabled}
              onChange={ev => editor.onChange({ ...rule, displayLabel: ev.target.value === "" ? null : ev.target.value })} error={e[`rules[${index}].displayLabel`]} />
            <Select<SupportStatus> id={`rb-r${index}-supportStatus`} label="Support" options={supportOptions} value={rule.supportStatus} disabled={editor.disabled}
              description="Needs setup while a needed value is unknown; Manual check is confirmed by you, never calculated."
              onValueChange={v => editor.onChange({ ...rule, supportStatus: v })} error={e[`rules[${index}].supportStatus`]} />
          </div>
          <RuleParameterFields type={rule.ruleType} parameters={rule.parameters} index={index} errors={e} currency={currency} disabled={editor.disabled}
            onChange={parameters => editor.onChange({ ...rule, parameters })} />
          <div className="rb-inline-fields">
            <TextField id={`rb-r${index}-providerLabel`} label="Provider wording" optional value={rule.providerLabel ?? ""} disabled={editor.disabled}
              description="Exactly as the firm writes it." onChange={ev => editor.onChange({ ...rule, providerLabel: ev.target.value === "" ? null : ev.target.value })}
              error={errorUnder(e, `rules[${index}].providerLabel`)} />
          </div>
          <Textarea id={`rb-r${index}-sourceText`} label="Source text" optional rows={2} value={rule.sourceText ?? ""} disabled={editor.disabled}
            onChange={ev => editor.onChange({ ...rule, sourceText: ev.target.value === "" ? null : ev.target.value })} error={e[`rules[${index}].sourceText`]} />
        </div>
      ) : (
        <StatList label={`${label} values`} items={[
          ...RULE_FIELDS[rule.ruleType].map(spec => ({ label: spec.label, value: describeValue(spec, rule.parameters[spec.key], currency) })),
          { label: "Support", value: SUPPORT_LABELS[rule.supportStatus] },
          ...(rule.providerLabel ? [{ label: "Provider wording", value: rule.providerLabel }] : []),
          ...(rule.sourceText ? [{ label: "Source text", value: rule.sourceText }] : []),
          { label: "Sources", value: <RuleSources claims={claims} names={names} /> },
        ]} />
      )}
    </section>
  );
}
