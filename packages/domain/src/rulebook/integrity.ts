// Rulebook checks that need more than one field (Build 9.5). The Rust adapter
// enforces the same rules before writing (src-tauri/src/store/rulebooks.rs),
// and the schema's triggers enforce freezing and assignment validity.

import type { DraftIssue, Rulebook, RulebookVersion, RulebookVersionDetail } from "./versions.js";
import { manualRuleTypes, requiredValues, type RuleDefinitionInput } from "./rules.js";

function valueKnown(parameters: Record<string, unknown>, path: string): boolean {
  const v = parameters[path];
  if (typeof v === "string") return v !== "unknown";
  if (v !== null && typeof v === "object" && "state" in v) return (v as { state: string }).state !== "unknown";
  return v !== undefined;
}

/**
 * Problems that stop a set of rules from being published. Unknown values are
 * allowed, but only on rules marked `needs_setup`, so nothing unknown is ever
 * presented as enforceable.
 */
export function checkRuleDefinitions(rules: readonly RuleDefinitionInput[]): DraftIssue[] {
  const issues: DraftIssue[] = [];
  const keys = new Set<string>();
  rules.forEach((rule, i) => {
    const at = (field: string) => `rules[${i}].${field}`;
    if (keys.has(rule.ruleKey)) issues.push({ field: at("ruleKey"), message: `Duplicate rule key '${rule.ruleKey}'` });
    keys.add(rule.ruleKey);

    const manual = manualRuleTypes.includes(rule.ruleType);
    if (manual && rule.supportStatus !== "manual_only" && rule.supportStatus !== "unsupported") {
      issues.push({ field: at("supportStatus"), message: `A ${rule.ruleType} rule is confirmed by a person (manual_only)` });
    }
    const missing = requiredValues[rule.ruleType].filter(
      (p) => !valueKnown(rule.parameters as Record<string, unknown>, p),
    );
    if (rule.supportStatus === "supported" && missing.length > 0) {
      issues.push({ field: at("supportStatus"), message: `Unknown ${missing.join(", ")}: mark the rule needs_setup` });
    }
    if (rule.supportStatus === "needs_setup" && missing.length === 0 && !manual) {
      issues.push({ field: at("supportStatus"), message: "Every needed value is known: mark the rule supported" });
    }
    if (rule.overrideKind === "personal_limit" && rule.providerLabel !== null) {
      issues.push({ field: at("providerLabel"), message: "A personal limit has no provider wording" });
    }
  });
  return issues;
}

/** Whether a version may be assigned to `accountId`. */
export function canAssign(rulebook: Rulebook, version: RulebookVersion, accountId: string): boolean {
  if (version.recordStatus !== "active") return false;
  if (rulebook.ownerAccountId !== null) {
    return rulebook.ownerAccountId === accountId && version.verificationStatus === "needs_review";
  }
  return version.verificationStatus === "verified";
}

/**
 * Problems that stop publishing a version. A private version is published
 * from draft (it is then in use); a catalogue version goes draft → needs_review,
 * and then needs_review → verified with a named reviewer, at least one
 * applicability row and no conflicting claims.
 */
export function checkPublish(detail: RulebookVersionDetail, reviewer: string | null): DraftIssue[] {
  const { rulebook, version } = detail;
  const issues = checkRuleDefinitions(detail.rules);
  const privateBook = rulebook.ownerAccountId !== null;
  if (version.recordStatus !== "active") issues.push({ field: "recordStatus", message: "The version is archived" });
  if (version.verificationStatus === "draft") {
    if (reviewer !== null) issues.push({ field: "reviewer", message: "Publish the draft first, then verify it" });
    if (privateBook && detail.applicability.length > 0) {
      issues.push({ field: "applicability", message: "An account-private rulebook does not apply to catalogue phases" });
    }
  } else if (version.verificationStatus === "needs_review" && !privateBook) {
    if (reviewer === null || reviewer.trim() === "") issues.push({ field: "reviewer", message: "Verifying needs a reviewer" });
    if (detail.applicability.length === 0) {
      issues.push({ field: "applicability", message: "Say which phase or path the version applies to" });
    }
    if (detail.claims.some((c) => c.claimStatus === "conflicting")) {
      issues.push({ field: "claims", message: "Resolve the conflicting source claims first" });
    }
  } else {
    issues.push({ field: "verificationStatus", message: `A ${version.verificationStatus} version cannot be published` });
  }
  return issues;
}
