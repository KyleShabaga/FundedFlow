import type { AssignmentGuard, AssignmentInput, EnginePolicy, RiskInputsQuery, RulebookDraftInput, RulebookDraftUpdate } from "@fundedflow/domain";
import * as api from "../api/rulebooks";
import * as risk from "../api/risk";
import { featureKeys as keys } from "../../shared/query-keys";
import { useFeatureQuery } from "../../shared/hooks/use-feature-query";
import { useFeatureMutation } from "../../shared/hooks/use-feature-mutation";

type CoverageAssertion = RiskInputsQuery["coverage"];

export const useRulebookEvents = (accountId: string | null) =>
  useFeatureQuery({ key: keys.rulebookEvents(accountId), enabled: accountId !== null, read: signal => api.readRulebookEvents(accountId!, signal) });

/**
 * Canonical inputs (and review history) for an explicit cutoff, read-only, for a preview or a
 * calculation. Keyed under the account's snapshots, which trade, import, ledger and rulebook writes
 * already invalidate, so a preview never outlives the evidence it was made from.
 */
export const useCalculationInputs = (accountId: string | null, asOf: string | null, coverage: CoverageAssertion, policy: EnginePolicy) =>
  useFeatureQuery({
    key: [...keys.snapshotsRoot(accountId), "calculation-inputs", asOf, coverage, policy],
    enabled: accountId !== null && asOf !== null,
    read: signal => risk.readCalculationInputs({ accountId: accountId!, asOf: asOf!, coverage }, policy, signal),
    isEmpty: () => false,
  });

/** Whether a stored engine calculation still matches its sources for its cutoff (re-read, never assumed). */
export const useCalculationFreshness = (accountId: string | null, snapshot: { id: string; explanation: Record<string, unknown> } | null) =>
  useFeatureQuery({
    key: [...keys.snapshotsRoot(accountId), "freshness", snapshot?.id ?? null],
    enabled: accountId !== null && snapshot !== null,
    read: signal => risk.readFreshness(accountId!, snapshot!.explanation, signal),
    isEmpty: () => false,
  });

export const useCalculateRisk = (accountId: string) => useFeatureMutation({
  scope: JSON.stringify(["risk-calculation", accountId]),
  run: ({ query, policy }: { query: RiskInputsQuery; policy: EnginePolicy }) => risk.calculateNow(query, policy),
  invalidate: () => [keys.snapshotsRoot(accountId)],
});

// One write at a time per account's rulebook: a second click or window gets duplicate-submission.
const scope = (accountId: string) => JSON.stringify(["rulebook", accountId]);
const affected = (accountId: string) => [...keys.rulebookRoots, keys.assignments(accountId), keys.rulebookEvents(accountId), keys.detail(accountId), keys.snapshotsRoot(accountId)];

export const useCreateRulebookDraft = (accountId: string) => useFeatureMutation({
  scope: scope(accountId),
  run: ({ input, reason }: { input: RulebookDraftInput; reason: string | null }) => api.createDraft(input, reason),
  invalidate: () => affected(accountId),
});
export const useSaveRulebookDraft = (accountId: string) => useFeatureMutation({
  scope: scope(accountId),
  run: ({ id, expectedUpdatedAt, input, reason }: { id: string; expectedUpdatedAt: string; input: RulebookDraftUpdate; reason: string | null }) =>
    api.updateDraft(id, expectedUpdatedAt, input, reason),
  invalidate: () => affected(accountId),
});
export const useDiscardRulebookDraft = (accountId: string) => useFeatureMutation({
  scope: scope(accountId),
  run: ({ id, expectedUpdatedAt, reason }: { id: string; expectedUpdatedAt: string; reason: string }) => api.discardDraft(id, expectedUpdatedAt, reason),
  invalidate: () => affected(accountId),
});
export const usePublishRulebookVersion = (accountId: string) => useFeatureMutation({
  scope: scope(accountId),
  run: ({ id, reviewer, expectedUpdatedAt, reason }: { id: string; reviewer: string | null; expectedUpdatedAt: string; reason: string | null }) =>
    api.publishVersion(id, reviewer, expectedUpdatedAt, reason),
  invalidate: () => affected(accountId),
});
export const useAssignRulebookVersion = (accountId: string) => useFeatureMutation({
  scope: scope(accountId),
  run: ({ input, guard }: { input: AssignmentInput; guard: AssignmentGuard }) => api.assignVersion(input, guard),
  invalidate: () => affected(accountId),
});

/** Server-side publish checks for the stored revision (keyed by it, so a save re-checks). */
export const usePublishIssues = (id: string | null, revision: string | null) =>
  useFeatureQuery({ key: [...keys.rulebookVersion(id), "publish-issues", revision], enabled: id !== null && revision !== null, read: signal => api.readPublishIssues(id!, signal), isEmpty: () => false });
