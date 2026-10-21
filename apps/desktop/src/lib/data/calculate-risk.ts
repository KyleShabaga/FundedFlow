import {
  RepositoryError,
  calculateRiskSnapshot,
  type EnginePolicy,
  type JournalRepository,
  type RiskInputsQuery,
  type Snapshot,
} from "@fundedflow/domain";
/** Non-visual orchestration, on the existing repository. No new gateway or state owner. */
export async function calculateAndSaveRisk(
  repository: JournalRepository,
  query: RiskInputsQuery,
  policy: EnginePolicy,
  isEndOfDay: boolean,
): Promise<Snapshot> {
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
  policy = {
    ...policy,
    reconciliationRevisionIds: [
      ...policy.reconciliationRevisionIds,
      ...reviews
        .filter((r) => r.accountId === query.accountId)
        .map((r) => r.id),
      ...resolutions.flat().map((r) => r.id),
    ].sort(),
  };
  return repository.snapshots.save(
    calculateRiskSnapshot(calculationInputs, policy, isEndOfDay),
  );
}
