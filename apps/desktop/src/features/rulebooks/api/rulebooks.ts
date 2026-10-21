// Rulebook editor operations (Build 19) over the existing JournalRepository. Reads of rulebooks,
// versions and assignments stay in features/references; this module adds the editor's writes,
// the audit log and the read-only risk-input read used by the preview.
import {
  accountRiskInputsSchema,
  accountRulebookAssignmentSchema,
  assignmentGuardSchema,
  assignmentInputSchema,
  changeContextSchema,
  draftIssueSchema,
  rulebookDraftInputSchema,
  rulebookDraftUpdateSchema,
  rulebookEventSchema,
  rulebookVersionDetailSchema,
  riskInputsQuerySchema,
  type AssignmentGuard,
  type AssignmentInput,
  type ChangeContext,
  type RiskInputsQuery,
  type RulebookDraftInput,
  type RulebookDraftUpdate,
} from "@fundedflow/domain";
import { repository } from "../../../lib/data/api";
import { recordId } from "../../shared/contracts";
import { validateInput } from "../../shared/errors";
import { readOperation, requireAccount, writeOperation } from "../../shared/operations";

/** The local audit label. FundedFlow has no sign-in: this names "you, on this computer", not a verified identity. */
export const LOCAL_ACTOR = "local_user";
export const context = (reason: string | null): ChangeContext => ({ actor: LOCAL_ACTOR, reason: reason?.trim() ? reason.trim() : null });

export async function readRulebookEvents(accountId: string, signal?: AbortSignal) {
  validateInput(recordId, accountId);
  return readOperation(() => repository.rulebooks.listEvents({ rulebookId: null, accountId }), values => values.map(v => rulebookEventSchema.parse(v)), signal);
}

/**
 * Build 15.5 risk inputs for an explicit cutoff. The native read runs in a transaction it never
 * commits and writes nothing (tested in rulebook_editor_tests.rs); the preview only reports what
 * evidence exists.
 */
export async function readRiskInputs(query: RiskInputsQuery, signal?: AbortSignal) {
  const parsed = validateInput(riskInputsQuerySchema, query);
  return readOperation(() => repository.evidence.inputs(parsed), value => {
    const inputs = accountRiskInputsSchema.parse(value);
    requireAccount(inputs.account.id, parsed.accountId);
    return inputs;
  }, signal);
}

export async function createDraft(input: RulebookDraftInput, reason: string | null) {
  const parsed = validateInput(rulebookDraftInputSchema, input);
  return writeOperation(() => repository.rulebooks.createDraft(parsed, validateInput(changeContextSchema, context(reason))), v => rulebookVersionDetailSchema.parse(v));
}

export async function updateDraft(id: string, expectedUpdatedAt: string, input: RulebookDraftUpdate, reason: string | null) {
  validateInput(recordId, id);
  const parsed = validateInput(rulebookDraftUpdateSchema, input);
  return writeOperation(() => repository.rulebooks.updateDraft(id, expectedUpdatedAt, parsed, context(reason)), v => {
    const detail = rulebookVersionDetailSchema.parse(v);
    requireAccount(detail.version.id, id);
    return detail;
  });
}

export async function discardDraft(id: string, expectedUpdatedAt: string, reason: string) {
  validateInput(recordId, id);
  return writeOperation(() => repository.rulebooks.discardDraft(id, expectedUpdatedAt, context(reason)), v => {
    const detail = rulebookVersionDetailSchema.parse(v);
    requireAccount(detail.version.id, id);
    return detail;
  });
}

export async function publishVersion(id: string, reviewer: string | null, expectedUpdatedAt: string, reason: string | null) {
  validateInput(recordId, id);
  return writeOperation(() => repository.rulebooks.publish(id, reviewer?.trim() || null, { expectedUpdatedAt, context: context(reason) }), v => {
    const detail = rulebookVersionDetailSchema.parse(v);
    requireAccount(detail.version.id, id);
    return detail;
  });
}

export async function assignVersion(input: AssignmentInput, guard: AssignmentGuard) {
  const parsed = validateInput(assignmentInputSchema, input);
  const g = validateInput(assignmentGuardSchema, guard);
  return writeOperation(() => repository.rulebooks.assign(parsed, g), v => {
    const assignment = accountRulebookAssignmentSchema.parse(v);
    requireAccount(assignment.accountId, parsed.accountId);
    return assignment;
  });
}

/** What stops the stored version from being published now (`validate_rulebook_draft`); empty when nothing does. */
export async function readPublishIssues(id: string, signal?: AbortSignal) {
  validateInput(recordId, id);
  return readOperation(() => repository.rulebooks.validateDraft(id), values => values.map(v => draftIssueSchema.parse(v)), signal);
}
