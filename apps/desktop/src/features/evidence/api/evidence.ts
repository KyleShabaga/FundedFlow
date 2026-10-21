// Build 15.5 financial evidence through the existing repository (Build 21 is its first UI): balance checkpoints the
// trader reads off the firm's dashboard, and frozen exact comparisons with the journal's own bookkeeping. A
// checkpoint is user-reported, never independently verified by FundedFlow; a comparison never changes data.
import {
  observationInputSchema,
  observationSchema,
  reconciliationRequestSchema,
  reconciliationSchema,
  type ObservationInput,
  type ReconciliationRequest,
} from "@fundedflow/domain";
import { z } from "zod";
import { repository } from "../../../lib/data/api";
import { recordId } from "../../shared/contracts";
import { FeatureDataError, validateInput } from "../../shared/errors";
import { readOperation, requireAccount, writeOperation } from "../../shared/operations";

const scoped = <T extends { accountId: string }>(rows: readonly T[], accountId: string) => {
  for (const row of rows) requireAccount(row.accountId, accountId);
  return [...rows];
};

/** Every observation of the attempt, originals and replacements, oldest recording first. */
export async function readObservations(accountId: string, signal?: AbortSignal) {
  validateInput(recordId, accountId);
  return readOperation(() => repository.evidence.list(accountId), rows => scoped(z.array(observationSchema).parse(rows), accountId), signal);
}

/** Frozen balance comparisons of the attempt. Old results stay readable; they never become current again. */
export async function readReconciliations(accountId: string, signal?: AbortSignal) {
  validateInput(recordId, accountId);
  return readOperation(() => repository.evidence.reconciliations(accountId), rows => scoped(z.array(reconciliationSchema).parse(rows), accountId), signal);
}

export async function recordObservation(accountId: string, input: ObservationInput, assertReady?: () => void) {
  validateInput(recordId, accountId);
  const parsed = validateInput(observationInputSchema, input);
  if (parsed.accountId !== accountId) throw new FeatureDataError("validation");
  return writeOperation(() => repository.evidence.create(parsed), value => {
    const saved = observationSchema.parse(value);
    requireAccount(saved.accountId, accountId);
    return saved;
  }, assertReady);
}

export async function reconcileBalance(accountId: string, request: ReconciliationRequest, assertReady?: () => void) {
  validateInput(recordId, accountId);
  const parsed = validateInput(reconciliationRequestSchema, request);
  if (parsed.accountId !== accountId) throw new FeatureDataError("validation");
  return writeOperation(() => repository.evidence.reconcile(parsed), value => {
    const saved = reconciliationSchema.parse(value);
    requireAccount(saved.accountId, accountId);
    return saved;
  }, assertReady);
}
