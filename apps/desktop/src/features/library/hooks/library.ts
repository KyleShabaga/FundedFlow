import type { ArchiveInput, ChecklistInput, StrategyInput, TagInput } from "@fundedflow/domain";
import { readLibrary, saveChecklist, saveStrategy, saveTag, setArchived } from "../api/library";
import { featureKeys as keys } from "../../shared/query-keys";
import { useFeatureQuery } from "../../shared/hooks/use-feature-query";
import { useFeatureMutation } from "../../shared/hooks/use-feature-mutation";

// Reviews show a template's current name beside the one they recorded, so library edits refresh every review.
const affected = () => [keys.library, keys.reviewsAll, keys.dailyReviewsAll, keys.insightsRoot];
const scope = JSON.stringify(["library"]);
/** What a library write sent, kept with the one library lock so an uncertain write is checked against that item. */
export interface LibraryChange { entity: "strategy" | "tag" | "checklist"; id: string | null; name: string | null }

export const useLibrary = () => useFeatureQuery({ key: keys.library, read: signal => readLibrary(signal), isEmpty: () => false });
export const useSaveStrategy = () => useFeatureMutation({ scope, run: ({ id, input }: { id: string | null; input: StrategyInput }, guard) => saveStrategy(id, input, guard), invalidate: affected,
  submitted: ({ id, input }): LibraryChange => ({ entity: "strategy", id, name: input.name }) });
export const useSaveTag = () => useFeatureMutation({ scope, run: ({ id, input }: { id: string | null; input: TagInput }, guard) => saveTag(id, input, guard), invalidate: affected,
  submitted: ({ id, input }): LibraryChange => ({ entity: "tag", id, name: input.name }) });
export const useSaveChecklist = () => useFeatureMutation({ scope, run: ({ id, input }: { id: string | null; input: ChecklistInput }, guard) => saveChecklist(id, input, guard), invalidate: affected,
  submitted: ({ id, input }): LibraryChange => ({ entity: "checklist", id, name: input.name }) });
export const useSetArchived = () => useFeatureMutation({ scope, run: (input: ArchiveInput, guard) => setArchived(input, guard), invalidate: affected,
  submitted: (input): LibraryChange => ({ entity: input.entity, id: input.id, name: null }) });
