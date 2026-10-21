// Rulebook version states and names as the trader sees them (Build 19). Verified,
// needs review, account-private, stale, superseded and drafts are different facts with
// different words; a private or unreviewed version is never styled as verified.
import type { AccountRulebookAssignment, CatalogueSnapshot, RulebookVersionDetail, RuleType, SupportStatus } from "@fundedflow/domain";
import { canAssign, manualRuleTypes } from "@fundedflow/domain";
import type { Tone } from "../../../design-system";

export interface VersionState {
  label: string;
  tone: Tone;
  /** One sentence on what the state means for this account. */
  detail: string;
}

export function versionState(d: Pick<RulebookVersionDetail, "rulebook" | "version">): VersionState {
  const privateBook = d.rulebook.ownerAccountId !== null;
  switch (d.version.verificationStatus) {
    case "draft":
      return { label: "Draft", tone: "neutral", detail: "Being edited. Not in use until it is published." };
    case "rejected":
      return { label: "Discarded draft", tone: "neutral", detail: "Set aside without being published. Kept for the record." };
    case "needs_review":
      return privateBook
        ? { label: "Account rules (private)", tone: "flow", detail: "Your own rules for this account. Estimates only: never checked against the firm's published terms." }
        : { label: "Needs review", tone: "warn", detail: "Not verified yet, so it can't be assigned. A named reviewer must check it against the source." };
    case "verified":
      return { label: "Verified", tone: "profit", detail: `Checked against the provider's published source by ${d.version.verifiedBy ?? "a named reviewer"}.` };
    case "stale":
      return { label: "Stale", tone: "warn", detail: "A newer source contradicts it. It stays in force where assigned until you choose a corrected version." };
    case "superseded":
      return { label: "Superseded", tone: "neutral", detail: "A newer verified version replaced it. Accounts keep it until you assign another one." };
  }
}

export const isEditable = (d: Pick<RulebookVersionDetail, "version">) => d.version.verificationStatus === "draft" && d.version.verifiedAt === null;

export const SUPPORT_LABELS: Record<SupportStatus, string> = {
  supported: "Can be calculated",
  manual_only: "Manual check",
  unsupported: "Not tracked",
  needs_setup: "Needs setup",
};

/** Rules that can never be presented as calculated, whatever the engine returns. */
export function notCalculated(rule: { ruleType: RuleType; supportStatus: SupportStatus }): string | null {
  if (manualRuleTypes.includes(rule.ruleType) || rule.supportStatus === "manual_only") return "Confirmed by you, not calculated";
  if (rule.supportStatus === "unsupported") return "Recorded, not evaluated";
  if (rule.supportStatus === "needs_setup") return "A needed value is unknown";
  return null;
}

/** Names from the catalogue for a version's provider, phases and paths. Ids stay visible when a name is missing. */
export function catalogueNames(catalogue: CatalogueSnapshot | undefined) {
  const g = catalogue?.graph;
  const provider = (id: string | null) => (id ? g?.providers.find(p => p.id === id)?.displayName ?? null : null);
  const phase = (id: string | null) => {
    if (!id || !g) return null;
    const p = g.programmePhases.find(x => x.id === id);
    if (!p) return null;
    const cv = g.catalogueVersions.find(v => v.id === p.catalogueVersionId);
    const variant = cv ? g.programmeVariants.find(v => v.id === cv.programmeVariantId) : undefined;
    return { programme: variant?.displayName ?? null, phase: p.providerLabel, catalogueVersion: cv?.versionNumber ?? null };
  };
  const path = (id: string | null) => (id ? g?.phasePaths.find(p => p.id === id)?.providerLabel ?? null : null);
  const source = (id: string) => {
    const s = catalogue?.sources.find(x => x.id === id);
    return s ? { label: s.publisher ?? s.descriptor ?? s.url ?? "Source", url: s.url, capturedAt: s.capturedAt } : null;
  };
  return { provider, phase, path, source };
}

/** Where an assignment applies, in words. */
export function applicabilityText(names: ReturnType<typeof catalogueNames>, phaseId: string | null, pathId: string | null): string {
  if (!phaseId) return "This account (no catalogue phase)";
  const p = names.phase(phaseId);
  const path = names.path(pathId);
  const base = p ? [p.programme, p.phase].filter(Boolean).join(" · ") : `Phase ${phaseId}`;
  return path ? `${base} · ${path}` : base;
}

/** Versions this account may be assigned to now (domain `canAssign`). */
export function assignableVersions(details: readonly RulebookVersionDetail[], accountId: string): RulebookVersionDetail[] {
  return details.filter(d => canAssign(d.rulebook, d.version, accountId));
}

/** The account's open assignment (no end), which a new assignment would end. */
export function openAssignment(assignments: readonly AccountRulebookAssignment[]): AccountRulebookAssignment | null {
  return assignments.find(a => a.effectiveTo === null) ?? null;
}
