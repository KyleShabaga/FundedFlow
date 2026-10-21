// Field-level comparison of two rulebook versions (Build 19). It reports what each
// version states, side by side; it never derives a figure from either. Unknown,
// none, off and manual-only values are shown as such, and a change is shown even
// when one side is unknown.
import type { RuleDefinitionInput, RulebookVersionDetail } from "@fundedflow/domain";
import { describeValue, RULE_FIELDS, RULE_TYPE_LABELS } from "./rule-fields";
import { SUPPORT_LABELS } from "./versions";

export type ChangeKind = "added" | "removed" | "changed" | "unchanged";

export interface FieldChange {
  field: string;
  label: string;
  before: string | null;
  after: string | null;
  kind: ChangeKind;
}

export interface RuleComparison {
  ruleKey: string;
  label: string;
  kind: ChangeKind;
  fields: FieldChange[];
}

export interface VersionComparison {
  meta: FieldChange[];
  rules: RuleComparison[];
  /** Number of changed, added and removed rows across everything. */
  changeCount: number;
}

type Rule = Pick<RuleDefinitionInput, "ruleKey" | "ruleType" | "displayLabel" | "providerLabel" | "sourceText" | "supportStatus"> & { parameters: unknown; id?: string };
/** A stored version, or a draft as currently edited (its rules not yet saved). */
export type ComparableVersion = Pick<RulebookVersionDetail, "version" | "applicability"> & { rules: readonly Rule[]; claims?: RulebookVersionDetail["claims"] };
type Detail = ComparableVersion;

const kindOf = (before: string | null, after: string | null): ChangeKind =>
  before === null ? (after === null ? "unchanged" : "added") : after === null ? "removed" : before === after ? "unchanged" : "changed";

export function ruleLabel(rule: Pick<Rule, "ruleType" | "displayLabel" | "providerLabel" | "ruleKey">): string {
  return rule.displayLabel ?? rule.providerLabel ?? RULE_TYPE_LABELS[rule.ruleType] ?? rule.ruleKey;
}

function ruleFields(rule: Rule, currency: string | null, sources: (ruleKey: string) => string | null): Map<string, { label: string; text: string }> {
  const out = new Map<string, { label: string; text: string }>();
  out.set("ruleType", { label: "Rule type", text: RULE_TYPE_LABELS[rule.ruleType] });
  out.set("supportStatus", { label: "Support", text: SUPPORT_LABELS[rule.supportStatus] });
  for (const spec of RULE_FIELDS[rule.ruleType]) {
    out.set(`parameters.${spec.key}`, { label: spec.label, text: describeValue(spec, (rule.parameters as Record<string, unknown>)[spec.key], currency) });
  }
  out.set("providerLabel", { label: "Provider wording", text: rule.providerLabel ?? "None" });
  out.set("sourceText", { label: "Source text", text: rule.sourceText ?? "None" });
  const s = sources(rule.ruleKey);
  if (s !== null) out.set("sources", { label: "Source claims", text: s });
  return out;
}

export interface CompareOptions {
  currency: string | null;
  /** Applicability in words. */
  applicability?: (a: RulebookVersionDetail["applicability"][number]) => string;
  /** Source claims for a rule in words; null hides the row (drafts carry no claims yet). */
  sources?: (detail: Detail, ruleKey: string) => string | null;
}

/**
 * Compares `active` (the version in force, or null when none is) with `proposed`. Rules are matched by
 * `ruleKey`, which is stable across versions of one rulebook.
 */
export function compareVersions(active: Detail | null, proposed: Detail, options: CompareOptions): VersionComparison {
  const date = (v: string | null) => v ?? "Not stated";
  const where = (d: Detail) => d.applicability.length === 0 ? "This account only" : d.applicability.map(a => options.applicability?.(a) ?? a.programmePhaseId).sort().join("; ");
  const metaRows: [string, string, (d: Detail) => string | null][] = [
    ["effectiveFrom", "Provider-stated from", d => date(d.version.effectiveFrom)],
    ["effectiveTo", "Provider-stated until", d => date(d.version.effectiveTo)],
    ["capturedAt", "Terms captured", d => d.version.capturedAt],
    ["applicability", "Applies to", where],
    ["changeReason", "Reason for change", d => d.version.changeReason ?? "None given"],
  ];
  const meta = metaRows.map(([field, label, read]) => {
    const before = active ? read(active) : null;
    const after = read(proposed);
    return { field, label, before, after, kind: active ? kindOf(before, after) : ("added" as ChangeKind) };
  });
  const sources = (d: Detail) => (key: string) => options.sources?.(d, key) ?? null;
  const asRules = (d: Detail | null) => new Map(((d?.rules ?? []) as Rule[]).map(r => [r.ruleKey, r]));
  const before = asRules(active);
  const after = asRules(proposed);
  const keys = [...new Set([...after.keys(), ...before.keys()])];
  const rules = keys.map(key => {
    const b = before.get(key);
    const a = after.get(key);
    const bf = b ? ruleFields(b, options.currency, sources(active!)) : new Map<string, { label: string; text: string }>();
    const af = a ? ruleFields(a, options.currency, sources(proposed)) : new Map<string, { label: string; text: string }>();
    const fieldKeys = [...new Set([...af.keys(), ...bf.keys()])];
    const fields = fieldKeys.map(f => {
      const x = bf.get(f)?.text ?? null;
      const y = af.get(f)?.text ?? null;
      return { field: f, label: (af.get(f) ?? bf.get(f))!.label, before: x, after: y, kind: kindOf(x, y) };
    });
    const kind: ChangeKind = !b ? "added" : !a ? "removed" : fields.some(f => f.kind !== "unchanged") ? "changed" : "unchanged";
    return { ruleKey: key, label: ruleLabel((a ?? b)!), kind, fields };
  });
  const changeCount = meta.filter(m => m.kind !== "unchanged").length
    + rules.reduce((n, r) => n + (r.kind === "added" || r.kind === "removed" ? 1 : r.fields.filter(f => f.kind !== "unchanged").length), 0);
  return { meta, rules, changeCount };
}
