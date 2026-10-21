// Build 19 ↔ Build 16: calculation inputs, previews, freshness and saved calculations for one account
// attempt, through the existing repository and the Build 16 helpers. React never calculates: every
// figure comes from `evaluateAccountRisk` / `simulateRulebookVersion` in @fundedflow/domain.
import {
  engineResultSchema,
  enginePolicySchema,
  riskInputsQuerySchema,
  type EnginePolicy,
  type EngineResult,
  type RiskInputsQuery,
} from "@fundedflow/domain";
import { repository } from "../../../lib/data/api";
import { calculateAndSaveRisk, loadRiskCalculation } from "../../../lib/data/calculate-risk";
import { recordId } from "../../shared/contracts";
import { validateInput } from "../../shared/errors";
import { readOperation, requireAccount, writeOperation } from "../../shared/operations";

export type Coverage = RiskInputsQuery["coverage"];

/** A stored calculation's engine record, when it was written by the Build 16 engine. */
export function recordedEngineResult(explanation: Record<string, unknown>): { result: EngineResult; policy: EnginePolicy; coverage: Coverage | null } | null {
  const result = engineResultSchema.safeParse(explanation.engine);
  const policy = enginePolicySchema.safeParse(explanation.policy);
  if (!result.success || !policy.success) return null;
  const coverage = (explanation.inputs as { coverage?: Coverage } | undefined)?.coverage ?? null;
  return { result: result.data, policy: policy.data, coverage };
}

/** Canonical inputs and review history for an explicit cutoff, exactly as a saved calculation would hash them. Reads only. */
export async function readCalculationInputs(query: RiskInputsQuery, policy: EnginePolicy, signal?: AbortSignal) {
  const parsed = validateInput(riskInputsQuerySchema, query);
  const p = validateInput(enginePolicySchema, policy);
  return readOperation(() => loadRiskCalculation(repository, parsed, p), loaded => {
    requireAccount(loaded.inputs.account.id, parsed.accountId);
    return loaded;
  }, signal);
}

export type Freshness =
  | { kind: "current" }
  | { kind: "changed" }
  | { kind: "not-engine" }
  /** Stored history that was never promoted as the current result (saved before P0-02, or as history only). */
  | { kind: "not-promoted" };

/**
 * Whether a stored engine calculation's sources are unchanged for its own cutoff, coverage and frozen policy: native
 * re-reads them from one database state and compares (P0-02). "current" says the sources for that cutoff are
 * unchanged, not that the cutoff is today or that the calculation was promoted.
 */
export async function readFreshness(accountId: string, snapshot: { id: string; explanation: Record<string, unknown> }, signal?: AbortSignal) {
  validateInput(recordId, accountId);
  if (!recordedEngineResult(snapshot.explanation)?.coverage) return readOperation(async () => ({ kind: "not-engine" }) as Freshness, v => v, signal);
  return readOperation(() => repository.snapshots.freshness(snapshot.id), checked =>
    (checked.sourcesUnchanged === null ? { kind: "not-engine" } : checked.sourcesUnchanged ? { kind: "current" } : { kind: "changed" }) as Freshness, signal);
}

/**
 * Calculates now and promotes it as the current result (an explicit user action). Earlier snapshots are kept. A
 * `conflict` means the records changed (or a later cutoff is current) and nothing was saved.
 */
export async function calculateNow(query: RiskInputsQuery, policy: EnginePolicy) {
  const parsed = validateInput(riskInputsQuerySchema, query);
  const p = validateInput(enginePolicySchema, policy);
  return writeOperation(() => calculateAndSaveRisk(repository, parsed, p, false), snapshot => {
    requireAccount(snapshot.accountId, parsed.accountId);
    return snapshot;
  });
}
