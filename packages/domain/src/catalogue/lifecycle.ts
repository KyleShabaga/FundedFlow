// A tracked account's link to the catalogue and its phase history (Build 9).
//
// Phase (evaluation, simulated_funded, ...) and record status (active, paused,
// passed, failed, closed; archive is a soft delete) are separate dimensions.
// Phase history is append-only: a correction is a new event that names the
// event it corrects. The current phase is derived from the history, never
// edited on its own.

import { z } from "zod";

import { catalogueId, catalogueInstant, providerLabel } from "./fields.js";
import { phaseKeys, type PhaseKey } from "./versions.js";

/** Where a user-editable account value came from, for resolving conflicts. */
export const accountFieldSources = ["user_entered", "imported", "catalogue_derived", "unknown"] as const;

/**
 * The catalogue references an account carries beside its existing fields.
 * Every reference is optional: legacy, manual-only and unknown-programme
 * accounts stay valid without a placeholder provider.
 */
export const accountCatalogueLinkSchema = z
  .strictObject({
    accountId: z.string().min(1),
    providerId: catalogueId.nullable(),
    programmeVariantId: catalogueId.nullable(),
    /** The exact catalogue version selected. Later versions never replace it silently. */
    catalogueVersionId: catalogueId.nullable(),
    /** The funded path the user chose, if the programme has paths. */
    selectedPhasePathId: catalogueId.nullable(),
    /** Evaluation → funded successor link between account instances (`accounts.parent_account_id`). */
    parentAccountId: z.string().min(1).nullable(),
    sizeSource: z.enum(accountFieldSources),
  })
  .superRefine((l, ctx) => {
    if (l.programmeVariantId !== null && l.providerId === null) {
      ctx.addIssue({ code: "custom", path: ["providerId"], message: "A programme needs its provider" });
    }
    if (l.catalogueVersionId !== null && l.programmeVariantId === null) {
      ctx.addIssue({ code: "custom", path: ["programmeVariantId"], message: "A catalogue version needs its variant" });
    }
    if (l.selectedPhasePathId !== null && l.catalogueVersionId === null) {
      ctx.addIssue({ code: "custom", path: ["catalogueVersionId"], message: "A selected path needs its catalogue version" });
    }
    if (l.parentAccountId === l.accountId) {
      ctx.addIssue({ code: "custom", path: ["parentAccountId"], message: "An account cannot be its own parent" });
    }
  });
export type AccountCatalogueLink = z.infer<typeof accountCatalogueLinkSchema>;

export const phaseEventSources = ["user_entered", "imported", "catalogue_derived", "system", "unknown"] as const;
export const phaseEventActors = ["user", "system", "importer"] as const;

export const accountPhaseEventSchema = z
  .strictObject({
    id: catalogueId,
    accountId: z.string().min(1),
    /** Phase before the transition, when known. */
    fromPhase: z.enum(phaseKeys).nullable(),
    toPhase: z.enum(phaseKeys),
    /** Provider wording for the new phase, if any. */
    providerLabel: providerLabel.nullable(),
    /** When the transition happened; null when unknown. */
    occurredAt: catalogueInstant.nullable(),
    /** When it was recorded. Events apply in recording order. */
    recordedAt: catalogueInstant,
    source: z.enum(phaseEventSources),
    actor: z.enum(phaseEventActors),
    note: z.string().max(2_000).nullable(),
    /** The earlier event this one corrects; the corrected event stays in history. */
    correctionOfEventId: catalogueId.nullable(),
    /** Snapshot of the configuration active at the transition. */
    catalogueVersionId: catalogueId.nullable(),
    programmePhaseId: catalogueId.nullable(),
    phasePathId: catalogueId.nullable(),
  })
  .superRefine((e, ctx) => {
    if (e.correctionOfEventId === e.id) {
      ctx.addIssue({ code: "custom", path: ["correctionOfEventId"], message: "An event cannot correct itself" });
    }
    if (e.phasePathId !== null && e.programmePhaseId === null) {
      ctx.addIssue({ code: "custom", path: ["programmePhaseId"], message: "A path snapshot needs its phase" });
    }
    if (e.programmePhaseId !== null && e.catalogueVersionId === null) {
      ctx.addIssue({ code: "custom", path: ["catalogueVersionId"], message: "A phase snapshot needs its catalogue version" });
    }
  });
export type AccountPhaseEvent = z.infer<typeof accountPhaseEventSchema>;

export type PhaseHistoryIssue =
  | { code: "foreign_account"; eventId: string }
  | { code: "duplicate_event_id"; eventId: string }
  | { code: "unknown_correction_target"; eventId: string; targetId: string }
  | { code: "correction_target_not_earlier"; eventId: string; targetId: string }
  | { code: "contradictory_transition"; eventId: string; expectedFrom: PhaseKey | null; fromPhase: PhaseKey | null }
  | { code: "occurred_out_of_order"; eventId: string };

export interface PhaseHistory {
  /** Latest effective phase; `unknown` with no effective events. */
  currentPhase: PhaseKey;
  /** Events in application order, minus those superseded by a correction. */
  effective: AccountPhaseEvent[];
  /** Findings that need review. Nothing is silently normalized or dropped. */
  issues: PhaseHistoryIssue[];
}

/** Order of application: `recordedAt`, then `id` (UUIDv7 ids sort by creation). */
function compareRecorded(a: AccountPhaseEvent, b: AccountPhaseEvent): number {
  const byTime = Date.parse(a.recordedAt) - Date.parse(b.recordedAt);
  return byTime !== 0 ? byTime : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Derives an account's current phase from its event history.
 *
 * A correction removes the event it names (and any earlier correction of that
 * event) from the effective sequence; the original stays in the input. A
 * `fromPhase` that disagrees with the previous effective phase, or an
 * `occurredAt` earlier than the previous effective event's, is reported for
 * review but the event still applies, because it is what was recorded.
 */
export function derivePhaseHistory(accountId: string, events: readonly AccountPhaseEvent[]): PhaseHistory {
  const issues: PhaseHistoryIssue[] = [];
  const seen = new Set<string>();
  const ordered: AccountPhaseEvent[] = [];
  for (const event of [...events].sort(compareRecorded)) {
    if (event.accountId !== accountId) issues.push({ code: "foreign_account", eventId: event.id });
    else if (seen.has(event.id)) issues.push({ code: "duplicate_event_id", eventId: event.id });
    else {
      seen.add(event.id);
      ordered.push(event);
    }
  }

  const position = new Map(ordered.map((e, i) => [e.id, i]));
  const superseded = new Set<string>();
  for (const [i, event] of ordered.entries()) {
    const target = event.correctionOfEventId;
    if (target === null) continue;
    const targetIndex = position.get(target);
    if (targetIndex === undefined) issues.push({ code: "unknown_correction_target", eventId: event.id, targetId: target });
    else if (targetIndex >= i) issues.push({ code: "correction_target_not_earlier", eventId: event.id, targetId: target });
    else superseded.add(target);
  }

  const effective = ordered.filter((e) => !superseded.has(e.id));
  let previous: AccountPhaseEvent | null = null;
  for (const event of effective) {
    const expectedFrom = previous?.toPhase ?? null;
    // An unknown starting phase (no prior event, or fromPhase not recorded) is not a contradiction.
    if (event.fromPhase !== null && expectedFrom !== null && event.fromPhase !== expectedFrom) {
      issues.push({ code: "contradictory_transition", eventId: event.id, expectedFrom, fromPhase: event.fromPhase });
    }
    if (
      previous?.occurredAt != null &&
      event.occurredAt !== null &&
      Date.parse(event.occurredAt) < Date.parse(previous.occurredAt)
    ) {
      issues.push({ code: "occurred_out_of_order", eventId: event.id });
    }
    previous = event;
  }

  return { currentPhase: previous?.toPhase ?? "unknown", effective, issues };
}
