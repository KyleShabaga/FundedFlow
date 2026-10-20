// Tagged presence states for rule values (Build 9.5).
//
// A rule value is never a bare null or a bare zero. "The provider says there
// is none", "the rule is switched off", "this does not apply here" and "we do
// not know yet" are different facts and stay distinct; an explicit zero is a
// known value of "0". A dash on a marketing card is not evidence of `explicit_none`.

import { z } from "zod";

export const presenceStates = ["unknown", "explicit_none", "disabled", "not_applicable", "value"] as const;
export type PresenceState = (typeof presenceStates)[number];

export function presence<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("unknown") }),
    z.strictObject({ state: z.literal("explicit_none") }),
    z.strictObject({ state: z.literal("disabled") }),
    z.strictObject({ state: z.literal("not_applicable") }),
    z.strictObject({ state: z.literal("value"), value }),
  ]);
}

export type Presence<T> =
  | { state: "unknown" }
  | { state: "explicit_none" }
  | { state: "disabled" }
  | { state: "not_applicable" }
  | { state: "value"; value: T };

export const UNKNOWN = { state: "unknown" } as const;

export function known<T>(value: T): { state: "value"; value: T } {
  return { state: "value", value };
}
