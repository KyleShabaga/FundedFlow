// Account setup completeness, kept apart from validity, lifecycle and risk.
//
// 1. Validity: a stored account passed Rust validation, so it is valid.
// 2. Setup: optional follow-ups that make prop-firm features work (firm, rulebook).
//    None of them blocks journaling or imports.
// 3. Lifecycle: status (active, paused, passed, failed, closed) and archived.
// 4. Rulebook verification: whether the current assignment's version is verified.
// 5. Risk data: not available until Builds 15.5/16, so always reported as unknown here.
//
// Only facts the backend returns are used. Nothing is inferred from a firm's name.
import type { AccountRulebookAssignment, RulebookVersionDetail } from "@fundedflow/domain";
import type { AccountViewModel } from "./view-models/account";

/** Account types that belong to a prop firm, so a firm and rulebook are expected. */
export const PROP_ACCOUNT_TYPES = new Set<AccountViewModel["accountType"]>(["evaluation", "sim_funded", "live_funded"]);

export interface SetupItem {
  key: "firm" | "rulebook";
  label: string;
  /** Why it matters, in the trader's terms. */
  detail: string;
}

export type RulebookStatus =
  | { kind: "loading" }
  | { kind: "unknown"; detail?: string } // could not be read
  | { kind: "none" }
  | { kind: "assigned"; assignment: AccountRulebookAssignment };

/** The assignment in force on a trading day (Rust's, never the calendar day), if any. */
export function currentAssignment(assignments: readonly AccountRulebookAssignment[], tradingDay: string): AccountRulebookAssignment | null {
  const today = tradingDay;
  const inForce = assignments.filter(a => a.effectiveFrom <= today && (a.effectiveTo === null || a.effectiveTo > today));
  return inForce.sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0] ?? null;
}

/**
 * Follow-ups for an account. Personal, demo and other accounts never need a firm or rulebook.
 * Returns null while the rulebook status is unknown, so the UI never claims "complete" without the facts.
 */
export function setupItems(account: Pick<AccountViewModel, "accountType" | "propFirm">, rulebook: RulebookStatus): SetupItem[] | null {
  if (!PROP_ACCOUNT_TYPES.has(account.accountType)) return [];
  if (rulebook.kind === "loading" || rulebook.kind === "unknown") return null;
  const items: SetupItem[] = [];
  if (!account.propFirm) items.push({ key: "firm", label: "Firm not set", detail: "Add the prop firm so its programmes and rulebooks can be matched." });
  if (rulebook.kind === "none") {
    items.push({ key: "rulebook", label: "No rulebook", detail: "Assign the firm's rulebook to see limits and room left. Journaling and imports work without it." });
  }
  return items;
}

export type Verification = "verified" | "needs_review" | "private";

/** How a rulebook version is presented: the trader's own rules, verified catalogue terms, or terms still to check. */
export function verificationOf(detail: Pick<RulebookVersionDetail, "rulebook" | "version">): Verification {
  if (detail.rulebook.ownerAccountId !== null) return "private";
  return detail.version.verificationStatus === "verified" ? "verified" : "needs_review";
}
