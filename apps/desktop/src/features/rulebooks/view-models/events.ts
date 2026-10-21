import type { RulebookEvent } from "@fundedflow/domain";

/** How the rulebook audit log names each recorded action. */
export const EVENT_ACTIONS: Record<RulebookEvent["action"], string> = {
  draft_created: "Draft started",
  draft_saved: "Draft saved",
  draft_discarded: "Draft discarded",
  published: "Published",
  verified: "Verified",
  assigned: "Assigned to the account",
  conflict_flagged: "Source conflict recorded",
};
