import {
  RepositoryError,
  calculateRiskSnapshot,
  evaluateAccountRisk,
  type AccountRiskInputs,
  type EnginePolicy,
  type EngineResult,
  type JournalRepository,
  type RiskInputsQuery,
  type Snapshot,
} from "@fundedflow/domain";

export interface RiskCalculationInputs {
  inputs: AccountRiskInputs;
  policy: EnginePolicy;
}

/**
 * Loads the canonical inputs and reconciliation review history for one calculation, exactly as
 * `calculateAndSaveRisk` hashes them. Reads only. Use it to re-evaluate (a preview) or to check a
 * stored result against fresh sources (`isEngineResultCurrent`) with the same identity rules.
 * Reconciliation revision ids are merged into the policy without duplicates, so passing a stored
 * snapshot's frozen policy back in yields the same identity when nothing changed.
 */
export async function loadRiskCalculation(
  repository: JournalRepository,
  query: RiskInputsQuery,
  policy: EnginePolicy,
): Promise<RiskCalculationInputs> {
  const [inputs, reviews] = await Promise.all([
    repository.evidence.inputs(query),
    repository.evidence.reconciliations(query.accountId),
  ]);
  if (
    inputs.account.id !== query.accountId ||
    reviews.some((r) => r.accountId !== query.accountId)
  )
    throw new RepositoryError({
      kind: "validation",
      message: "Risk sources belong to a different account attempt",
      issues: [
        {
          field: "accountId",
          message: "Risk sources belong to a different account attempt",
        },
      ],
    });
  const resolutions = await Promise.all(
    reviews.map((r) => repository.evidence.resolutions(r.id)),
  );
  const calculationInputs = {
    ...inputs,
    missingInputs: [...inputs.missingInputs],
  };
  const superseded = new Set(inputs.observations.map((o) => o.supersedesId));
  const latest = new Map<string, (typeof reviews)[number]>();
  for (const r of reviews)
    if (
      r.accountId === query.accountId &&
      !superseded.has(r.observation.id) &&
      Date.parse(r.request.asOf) <= Date.parse(query.asOf)
    )
      latest.set(r.observation.id, r);
  for (const r of latest.values())
    if (r.result.reconciliationStatus !== "matched")
      calculationInputs.missingInputs.push(
        `reconciliation_review:${r.id}:${r.result.reconciliationStatus}`,
      );
  return {
    inputs: calculationInputs,
    policy: {
      ...policy,
      reconciliationRevisionIds: [
        ...new Set([
          ...policy.reconciliationRevisionIds,
          ...reviews
            .filter((r) => r.accountId === query.accountId)
            .map((r) => r.id),
          ...resolutions.flat().map((r) => r.id),
        ]),
      ].sort(),
    },
  };
}

/** Evaluates without saving: the same inputs and identity as a saved calculation, no write. */
export async function evaluateRisk(
  repository: JournalRepository,
  query: RiskInputsQuery,
  policy: EnginePolicy,
): Promise<{ result: EngineResult } & RiskCalculationInputs> {
  const loaded = await loadRiskCalculation(repository, query, policy);
  return { ...loaded, result: evaluateAccountRisk(loaded.inputs, loaded.policy) };
}

/** Non-visual orchestration, on the existing repository. No new gateway or state owner. */
export async function calculateAndSaveRisk(
  repository: JournalRepository,
  query: RiskInputsQuery,
  policy: EnginePolicy,
  isEndOfDay: boolean,
): Promise<Snapshot> {
  const loaded = await loadRiskCalculation(repository, query, policy);
  return repository.snapshots.save(
    calculateRiskSnapshot(loaded.inputs, loaded.policy, isEndOfDay),
  );
}
