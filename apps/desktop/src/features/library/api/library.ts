// Build 20 review library: strategies (playbooks), tags and checklists (templates). Shared by every account.
import {
  archiveInputSchema, checklistInputSchema, checklistSchema, librarySchema, strategyInputSchema, strategySchema, tagInputSchema, tagSchema,
  type ArchiveInput, type ChecklistInput, type StrategyInput, type TagInput,
} from "@fundedflow/domain";
import { repository } from "../../../lib/data/api";
import { validateInput } from "../../shared/errors";
import { readOperation, requireAccount, writeOperation } from "../../shared/operations";

export async function readLibrary(signal?: AbortSignal) {
  return readOperation(() => repository.library.load(), value => librarySchema.parse(value), signal);
}
const same = (id: string | null) => (value: { id: string }) => { if (id) requireAccount(value.id, id); };
export async function saveStrategy(id: string | null, input: StrategyInput, assertReady?: () => void) {
  const parsed = validateInput(strategyInputSchema, input);
  return writeOperation(() => repository.library.saveStrategy(id, parsed), value => { const s = strategySchema.parse(value); same(id)(s); return s; }, assertReady);
}
export async function saveTag(id: string | null, input: TagInput, assertReady?: () => void) {
  const parsed = validateInput(tagInputSchema, input);
  return writeOperation(() => repository.library.saveTag(id, parsed), value => { const t = tagSchema.parse(value); same(id)(t); return t; }, assertReady);
}
export async function saveChecklist(id: string | null, input: ChecklistInput, assertReady?: () => void) {
  const parsed = validateInput(checklistInputSchema, input);
  return writeOperation(() => repository.library.saveChecklist(id, parsed), value => { const c = checklistSchema.parse(value); same(id)(c); return c; }, assertReady);
}
export async function setArchived(input: ArchiveInput, assertReady?: () => void) {
  const parsed = validateInput(archiveInputSchema, input);
  return writeOperation(() => repository.library.setArchived(parsed), () => undefined, assertReady);
}
