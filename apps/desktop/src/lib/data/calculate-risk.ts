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
 * Loads one calculation's sources (P0-02): the canonical inputs, reconciliation revisions and prior-breach history,
 * captured natively from one database state (`evidence.capture`). Reads only. The engine must evaluate exactly
 * these: the reconciliation revisions and prior breaches are sources, so they replace whatever the caller's policy
 * carried, and promotion re-reads them natively and refuses if anything changed. The caller's own statements
 * (coverage, rule currency, boundary, caution buffer) are kept as statements; capture never verifies them.
 */
export async function loadRiskCalculation(
  repository: JournalRepository,
  query: RiskInputsQuery,
  policy: EnginePolicy,
): Promise<RiskCalculationInputs> {
  const captured = await repository.evidence.capture(query);
  if (captured.inputs.account.id !== query.accountId)
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
  return {
    inputs: captured.inputs,
    policy: {
      ...policy,
      reconciliationRevisionIds: [...captured.reconciliationRevisionIds],
      priorBreaches: captured.priorBreaches.map((b) => ({ ...b, sourceReferences: [...b.sourceReferences] })),
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

/**
 * Captures, evaluates and promotes (P0-02). The calculation becomes the account's current result only if native
 * finds its sources unchanged inside the write transaction; otherwise it rejects with a `conflict` and writes
 * nothing. Never retried here: a new calculation is the trader's deliberate choice.
 */
export async function calculateAndSaveRisk(
  repository: JournalRepository,
  query: RiskInputsQuery,
  policy: EnginePolicy,
  isEndOfDay: boolean,
): Promise<Snapshot> {
  const loaded = await loadRiskCalculation(repository, query, policy);
  return repository.snapshots.promote(
    calculateRiskSnapshot(loaded.inputs, loaded.policy, isEndOfDay),
  );
}
