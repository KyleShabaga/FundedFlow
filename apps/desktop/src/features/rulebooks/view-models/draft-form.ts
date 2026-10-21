// The draft editor's form state (Build 19). Values are kept as the rule JSON the backend stores,
// so what is validated is exactly what will be saved: the domain's ruleDefinitionInputSchema and
// checkRuleDefinitions here, Rust's check_rule_definitions again on save.
import {
  checkRuleDefinitions,
  ruleDefinitionInputSchema,
  RULE_PARAMETER_SCHEMA_VERSION,
  type RuleDefinitionInput,
  type RulebookDraftUpdate,
  type RulebookVersionDetail,
  type RuleType,
} from "@fundedflow/domain";
import { emptyParameters, RULE_TYPE_LABELS } from "./rule-fields";

export type DraftRule = Omit<RuleDefinitionInput, "parameters"> & { parameters: Record<string, unknown> };

export interface DraftForm {
  changeReason: string;
  capturedAt: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  rules: DraftRule[];
  applicability: RulebookDraftUpdate["applicability"];
}

export interface FormIssue {
  /** Backend-style path: "rules[0].parameters.amount", "changeReason". */
  field: string;
  message: string;
}

export function formFromDetail(d: RulebookVersionDetail): DraftForm {
  return {
    changeReason: d.version.changeReason ?? "",
    capturedAt: d.version.capturedAt,
    effectiveFrom: d.version.effectiveFrom,
    effectiveTo: d.version.effectiveTo,
    rules: d.rules.map(({ id: _id, rulebookVersionId: _v, ...rule }) => structuredClone(rule) as DraftRule),
    applicability: d.applicability.map(a => ({ catalogueVersionId: a.catalogueVersionId, programmePhaseId: a.programmePhaseId, phasePathId: a.phasePathId })),
  };
}

export function formToUpdate(form: DraftForm): RulebookDraftUpdate {
  return {
    changeReason: form.changeReason.trim() === "" ? null : form.changeReason.trim(),
    capturedAt: form.capturedAt,
    effectiveFrom: form.effectiveFrom,
    effectiveTo: form.effectiveTo,
    rules: form.rules.map((r, i) => ({ ...r, displayOrder: i })) as RuleDefinitionInput[],
    applicability: form.applicability,
  };
}

/** Whether the form differs from what was loaded. Order of rules counts. */
export function isDirty(form: DraftForm, baseline: DraftForm): boolean {
  return JSON.stringify(formToUpdate(form)) !== JSON.stringify(formToUpdate(baseline));
}

/** A unique key for a new rule of `type` ("max_drawdown", then "max_drawdown:2"). */
export function newRuleKey(type: RuleType, taken: readonly string[]): string {
  if (!taken.includes(type)) return type;
  let n = 2;
  while (taken.includes(`${type}:${n}`)) n += 1;
  return `${type}:${n}`;
}

export function newRule(type: RuleType, taken: readonly string[]): DraftRule {
  const manual = type === "trading_restriction" || type === "manual_check" || type === "unknown";
  return {
    ruleKey: newRuleKey(type, taken),
    ruleType: type,
    parameterSchemaVersion: RULE_PARAMETER_SCHEMA_VERSION,
    providerLabel: null,
    displayLabel: RULE_TYPE_LABELS[type],
    sourceText: null,
    // New values start unknown, so a new calculable rule needs setup until its values are entered.
    supportStatus: manual ? "manual_only" : "needs_setup",
    overrideKind: null,
    displayOrder: taken.length,
    parameters: emptyParameters(type),
  } as DraftRule;
}

/**
 * Problems that stop the draft from saving, in the backend's field paths. Drafts may hold
 * unknown values, but only on rules marked `needs_setup` (checkRuleDefinitions).
 */
export function validateForm(form: DraftForm, options: { supersedes: boolean }): FormIssue[] {
  const issues: FormIssue[] = [];
  if (options.supersedes && form.changeReason.trim() === "") issues.push({ field: "changeReason", message: "Say what changed and why" });
  if (form.changeReason.length > 2_000) issues.push({ field: "changeReason", message: "Use at most 2,000 characters" });
  if (form.effectiveFrom && form.effectiveTo && Date.parse(form.effectiveTo) <= Date.parse(form.effectiveFrom)) {
    issues.push({ field: "effectiveTo", message: "Must be after the start date" });
  }
  const parsed: RuleDefinitionInput[] = [];
  form.rules.forEach((rule, i) => {
    const result = ruleDefinitionInputSchema.safeParse({ ...rule, displayOrder: i });
    if (result.success) parsed.push(result.data);
    else for (const issue of result.error.issues) {
      issues.push({ field: `rules[${i}].${issue.path.join(".")}`, message: friendly(issue.message) });
    }
  });
  if (parsed.length === form.rules.length) issues.push(...checkRuleDefinitions(parsed));
  return issues;
}

function friendly(message: string): string {
  if (/expected (number|int)/i.test(message)) return "Enter a whole number";
  if (/expected string/i.test(message)) return "Enter a value";
  if (/Invalid input/i.test(message)) return "Check this value";
  return message;
}
