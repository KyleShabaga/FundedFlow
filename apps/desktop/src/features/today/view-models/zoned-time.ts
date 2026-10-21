// A balance checkpoint is entered as the wall-clock time the trader read it, in the account's zone. A comparison
// needs that exact instant, so on top of format.ts's conversion this refuses a time skipped by a daylight-saving
// change and a time that happens twice, rather than silently picking one. Trading days stay with Rust.
import { zonedWallTime, zonedWallTimeToInstant } from "../../../design-system";

export type ZonedInstant = { kind: "ok"; instant: string } | { kind: "invalid" } | { kind: "skipped" } | { kind: "repeated" };

// Daylight-saving shifts in use are 30 or 60 minutes.
const SHIFTS = [30, 60].map(m => m * 60_000);

export function checkpointInstant(local: string, timeZone: string): ZonedInstant {
  const instant = zonedWallTimeToInstant(local, timeZone);
  if (instant === "") return { kind: "invalid" };
  const ms = Date.parse(instant);
  if (zonedWallTime(ms, timeZone) !== local) return { kind: "skipped" };
  if (SHIFTS.some(shift => zonedWallTime(ms - shift, timeZone) === local || zonedWallTime(ms + shift, timeZone) === local)) return { kind: "repeated" };
  return { kind: "ok", instant };
}
