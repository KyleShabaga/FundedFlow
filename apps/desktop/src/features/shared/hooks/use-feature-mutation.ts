import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useRef, useSyncExternalStore } from "react";
import { useRuntime } from "../../../app/RuntimeProvider";
import { FeatureDataError } from "../errors";
import { submissionsFor } from "../submissions";

interface WriteSpec<Input, Output, Submitted = Input> {
  scope: string;
  run: (input: Input, assertReady: () => void) => Promise<Output>;
  invalidate: (result?: Output) => readonly QueryKey[];
  confirmedFailure?: (result: Output) => boolean;
  /** Definite failures that still mean the affected reads are out of date (e.g. a native "sources changed" refusal). */
  refreshOn?: readonly FeatureDataError["category"][];
  /** What an uncertain write is reviewed against, kept with its lock (default: the input as sent). */
  submitted?: (input: Input) => Submitted;
}
export function useFeatureMutation<Input, Output, Submitted = Input>(spec: WriteSpec<Input, Output, Submitted>) {
  const client = useQueryClient();
  const { state, check } = useRuntime();
  const current = useRef({ state, spec, check });
  current.current = { state, spec, check };
  const submissions = submissionsFor(client);
  useSyncExternalStore(submissions.subscribe, submissions.snapshot, submissions.snapshot);
  const invalidate = async (snapshot: WriteSpec<Input, Output, Submitted>, result?: Output) => {
    // A confirmed write remains successful if a later read refresh fails.
    await Promise.allSettled(snapshot.invalidate(result).map(queryKey => client.invalidateQueries({ queryKey })));
  };
  const mutation = useMutation<Output, FeatureDataError, { operation: Promise<Output>; snapshot: WriteSpec<Input, Output, Submitted> }>({
    retry: false, networkMode: "always",
    mutationFn: ({ operation }) => operation,
    onSuccess: (result, { snapshot }) => invalidate(snapshot, result),
    onError: (error, { snapshot }) => {
      if (error.category === "unavailable" && current.current.state.kind === "ready") void current.current.check();
      // A definite refusal committed nothing; refreshing what it was checked against never resends anything.
      if (snapshot.refreshOn?.includes(error.category)) void invalidate(snapshot);
    },
  });
  const scopeStatus = submissions.status(spec.scope);
  const submit = (input: Input): Promise<Output> => {
    if (current.current.state.kind !== "ready") return Promise.reject(new FeatureDataError(current.current.state.kind === "unsupported-schema" ? "unsupported-schema" : "unavailable"));
    const locked = submissions.status(current.current.spec.scope);
    if (locked !== "idle") return Promise.reject(new FeatureDataError(locked === "pending" ? "duplicate-submission" : "uncertain-outcome"));
    const snapshot = current.current.spec;
    // Reserve synchronously, before TanStack starts its async mutation lifecycle, including across hook instances.
    const operation = submissions.execute(snapshot.scope, () => {
      if (current.current.state.kind !== "ready") throw new FeatureDataError(current.current.state.kind === "unsupported-schema" ? "unsupported-schema" : "unavailable");
      return snapshot.run(input, () => {
        if (current.current.state.kind !== "ready") throw new FeatureDataError(current.current.state.kind === "unsupported-schema" ? "unsupported-schema" : "unavailable");
      });
    }, snapshot.submitted ? snapshot.submitted(input) : input);
    return mutation.mutateAsync({ operation, snapshot });
  };
  /**
   * Re-reads the records the trader will review (`readReviewed`, a query's throwing refresh) and marks the
   * write's other affected reads stale. Rejects if that read fails or the runtime isn't ready. It never
   * resends the write and never releases the lock.
   */
  const checkUncertainOutcome = async (readReviewed: () => Promise<unknown>) => {
    if (current.current.state.kind !== "ready") throw new FeatureDataError("unavailable");
    await readReviewed();
    void invalidate(current.current.spec);
  };
  const acknowledgeUncertainOutcome = async (confirmation: { recordsReviewed: true }) => {
    if (current.current.state.kind !== "ready") throw new FeatureDataError("unavailable");
    // Call only after the UI/user has checked persisted records. This is acknowledgement, not proof of rollback.
    submissions.acknowledge(spec.scope, confirmation);
    await invalidate(spec);
    mutation.reset();
  };
  const currentScope = !mutation.variables || mutation.variables.snapshot.scope === spec.scope;
  const failedResult = currentScope && mutation.isSuccess && spec.confirmedFailure?.(mutation.data);
  return {
    submit, data: currentScope ? mutation.data : undefined, error: currentScope ? mutation.error : null,
    isPending: (currentScope && mutation.isPending) || scopeStatus === "pending",
    canSubmit: state.kind === "ready" && !(currentScope && mutation.isPending) && scopeStatus === "idle",
    outcome: scopeStatus === "uncertain" ? "uncertain-outcome" as const : currentScope && mutation.isPending ? "submitting" as const : currentScope && mutation.isError ? "failed" as const
      : failedResult ? "confirmed-failure" as const : currentScope && mutation.isSuccess ? "confirmed-success" as const : "idle" as const,
    /** What the pending or uncertain write in this scope sent; it outlives the form that sent it. */
    submitted: submissions.submitted(spec.scope) as Submitted | undefined,
    canAcknowledgeUncertainOutcome: submissions.canAcknowledge(spec.scope),
    checkUncertainOutcome,
    acknowledgeUncertainOutcome,
    reset: mutation.reset, // Resetting feedback never clears an uncertain write lock.
  };
}
