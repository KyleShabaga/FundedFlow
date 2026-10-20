import { accountCatalogueLinkSchema, accountPhaseEventSchema, accountRulebookAssignmentSchema, applicableRulebookQuerySchema,
  applicableRulebookSchema, catalogueSnapshotSchema, offerSelectionSchema, rulebookSchema, rulebookVersionDetailSchema, type ApplicableRulebookQuery } from "@fundedflow/domain";
import { z } from "zod";
import { repository } from "../../../lib/data/api";
import { recordId } from "../../shared/contracts";
import { validateInput } from "../../shared/errors";
import { readOperation, requireAccount } from "../../shared/operations";

export const readCatalogue = (signal?: AbortSignal) => readOperation(() => repository.catalogue.load(), value => catalogueSnapshotSchema.parse(value), signal);
export async function readAccountLink(id: string, signal?: AbortSignal) {
  validateInput(recordId, id);
  return readOperation(() => repository.catalogue.getAccountLink(id), value => { requireAccount(value.accountId, id); return accountCatalogueLinkSchema.parse(value); }, signal);
}
export async function readPhaseEvents(id: string, signal?: AbortSignal) {
  validateInput(recordId, id);
  return readOperation(() => repository.catalogue.listPhaseEvents(id), values => values.map(value => { requireAccount(value.accountId, id); return accountPhaseEventSchema.parse(value); }), signal);
}
export async function readOfferSelections(id: string, signal?: AbortSignal) {
  validateInput(recordId, id);
  return readOperation(() => repository.catalogue.listOfferSelections(id), values => values.map(value => { requireAccount(value.accountId, id); return offerSelectionSchema.parse(value); }), signal);
}
export async function readRulebooks(accountId: string | null, signal?: AbortSignal) {
  if (accountId !== null) validateInput(recordId, accountId);
  return readOperation(() => repository.rulebooks.list(accountId), value => z.array(rulebookSchema).parse(value), signal);
}
export async function readRulebookVersions(id: string, signal?: AbortSignal) {
  validateInput(recordId, id);
  return readOperation(() => repository.rulebooks.listVersions(id), value => z.array(rulebookVersionDetailSchema).parse(value), signal);
}
export async function readRulebookVersion(id: string, signal?: AbortSignal) {
  validateInput(recordId, id);
  return readOperation(() => repository.rulebooks.getVersion(id), value => { requireAccount(value.version.id, id); return rulebookVersionDetailSchema.parse(value); }, signal);
}
export async function readApplicableRulebook(query: ApplicableRulebookQuery, signal?: AbortSignal) {
  const parsed = validateInput(applicableRulebookQuerySchema, query);
  return readOperation(() => repository.rulebooks.getApplicable(parsed), value => applicableRulebookSchema.parse(value), signal);
}
export async function readRulebookAssignments(id: string, signal?: AbortSignal) {
  validateInput(recordId, id);
  return readOperation(() => repository.rulebooks.listAssignments(id), values => values.map(value => { requireAccount(value.accountId, id); return accountRulebookAssignmentSchema.parse(value); }), signal);
}
