import type { AssignmentGuard, AssignmentInput, RiskInputsQuery, RulebookDraftInput, RulebookDraftUpdate } from "@fundedflow/domain";
import * as api from "../api/rulebooks";
import { featureKeys as keys } from "../../shared/query-keys";
import { useFeatureQuery } from "../../shared/hooks/use-feature-query";
import { useFeatureMutation } from "../../shared/hooks/use-feature-mutation";

type CoverageAssertion = RiskInputsQuery["coverage"];

export const useRulebookEvents = (accountId: string | null) =>
  useFeatureQuery({ key: keys.rulebookEvents(accountId), enabled: accountId !== null, read: signal => api.readRulebookEvents(accountId!, signal) });

/** Read-only Build 15.5 inputs for an explicit cutoff, for the evidence check beside a preview. */
export const useRiskInputs = (accountId: string | null, asOf: string | null, coverage: CoverageAssertion) =>
  useFeatureQuery({
    key: [...keys.riskInputs(accountId, asOf), coverage],
    enabled: accountId !== null && asOf !== null,
    read: signal => api.readRiskInputs({ accountId: accountId!, asOf: asOf!, coverage }, signal),
    isEmpty: () => false,
  });

// One write at a time per account's rulebook: a second click or window gets duplicate-submission.
const scope = (accountId: string) => JSON.stringify(["rulebook", accountId]);
const affected = (accountId: string) => [...keys.rulebookRoots, keys.assignments(accountId), keys.rulebookEvents(accountId), keys.detail(accountId)];

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
  invalidate: () => [...affected(accountId), keys.latestSnapshot(accountId)],
});

/** Server-side publish checks for the stored revision (keyed by it, so a save re-checks). */
export const usePublishIssues = (id: string | null, revision: string | null) =>
  useFeatureQuery({ key: [...keys.rulebookVersion(id), "publish-issues", revision], enabled: id !== null && revision !== null, read: signal => api.readPublishIssues(id!, signal), isEmpty: () => false });
