// Build 19 ↔ Build 16: calculation inputs, previews, freshness and saved calculations for one account
// attempt, through the existing repository and the Build 16 helpers. React never calculates: every
// figure comes from `evaluateAccountRisk` / `simulateRulebookVersion` in @fundedflow/domain.
import {
  engineResultSchema,
  enginePolicySchema,
  isEngineResultCurrent,
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

/**
 * Continuing breaches from this account's earlier engine calculations, for the next one: every rule the
 * engine recorded as breached, with its version, assignment and sources. The engine decides what still
 * applies (a different version or a missing source means review, never Safe).
 */
export function priorBreachesFrom(explanations: readonly Record<string, unknown>[], accountId: string): EnginePolicy["priorBreaches"] {
  const out = new Map<string, EnginePolicy["priorBreaches"][number]>();
  for (const e of explanations) {
    const r = recordedEngineResult(e)?.result;
    if (!r || r.accountId !== accountId || !r.rulebookVersionId || !r.assignmentId) continue;
    for (const rule of r.rules) {
      if (rule.state !== "breached" || rule.sourceReferences.length === 0) continue;
      const key = `${r.assignmentId}|${rule.ruleKey}`;
      if (!out.has(key)) out.set(key, { accountId, rulebookVersionId: r.rulebookVersionId, assignmentId: r.assignmentId, ruleKey: rule.ruleKey, observedAt: r.asOf, sourceReferences: rule.sourceReferences });
    }
  }
  return [...out.values()];
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
  | { kind: "not-engine" };

/**
 * Whether a stored engine calculation still matches its sources: the canonical inputs are read again for
 * the same cutoff, coverage statement and frozen policy, and compared with `isEngineResultCurrent`.
 * "current" says the sources for that cutoff are unchanged, not that the cutoff is today.
 */
export async function readFreshness(accountId: string, explanation: Record<string, unknown>, signal?: AbortSignal) {
  validateInput(recordId, accountId);
  const recorded = recordedEngineResult(explanation);
  if (!recorded || !recorded.coverage) return readOperation(async () => ({ kind: "not-engine" }) as Freshness, v => v, signal);
  const { result, policy, coverage } = recorded;
  return readOperation(() => loadRiskCalculation(repository, { accountId, asOf: result.asOf, coverage }, policy), loaded => {
    requireAccount(loaded.inputs.account.id, accountId);
    return (isEngineResultCurrent(result, loaded.inputs, loaded.policy) ? { kind: "current" } : { kind: "changed" }) as Freshness;
  }, signal);
}

/** Calculates now and saves a new snapshot (an explicit user action). Earlier snapshots are kept. */
export async function calculateNow(query: RiskInputsQuery, policy: EnginePolicy) {
  const parsed = validateInput(riskInputsQuerySchema, query);
  const p = validateInput(enginePolicySchema, policy);
  return writeOperation(() => calculateAndSaveRisk(repository, parsed, p, false), snapshot => {
    requireAccount(snapshot.accountId, parsed.accountId);
    return snapshot;
  });
}
