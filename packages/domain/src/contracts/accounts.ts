// Account DTOs for the Rust command payloads in apps/desktop/src-tauri/src.
// Field names and shapes must match the serde structs there; see fields.ts.

import { z } from "zod";

import { nonNegativeDecimal, optionalText } from "./fields.js";

export const accountTypes = ["evaluation", "sim_funded", "live_funded", "personal", "demo", "other"] as const;
export const accountStatuses = ["active", "paused", "passed", "failed", "closed"] as const;

export const accountInputSchema = z.strictObject({
  name: z.string().trim().min(1, "Required").max(100),
  broker: optionalText(100),
  propFirm: optionalText(100),
  externalRef: optionalText(100),
  accountType: z.enum(accountTypes),
  status: z.enum(accountStatuses),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/, "Use a 3-letter code such as USD"),
  startingBalance: nonNegativeDecimal,
  /** IANA zone, e.g. America/New_York. Checked against the tz database in Rust. */
  timezone: z.string().trim().min(1),
  /** HH:MM in `timezone`: 00:00 for plain calendar days, otherwise 12:00–23:59 (opens the next day's session). */
  tradingDayResetTime: z.string().regex(/^(00:00|(1[2-9]|2[0-3]):[0-5]\d)$/, "Use 00:00 or a time from 12:00 to 23:59"),
  notes: optionalText(20_000),
});
export type AccountInput = z.input<typeof accountInputSchema>;

export const accountSchema = z.object({
  id: z.string(),
  name: z.string(),
  broker: z.string().nullable(),
  propFirm: z.string().nullable(),
  externalRef: z.string().nullable(),
  accountType: z.enum(accountTypes),
  status: z.enum(accountStatuses),
  currency: z.string(),
  startingBalance: z.string(),
  timezone: z.string(),
  tradingDayResetTime: z.string(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Set while archived: hidden from live views and read-only. Independent of `status`. */
  archivedAt: z.string().nullable().default(null),
  /** The attempt this account is an evaluation reset of. See lifecycle.ts. */
  predecessorAccountId: z.string().nullable().default(null),
  /** The reset attempt that follows this account. */
  successorAccountId: z.string().nullable().default(null),
});
export type Account = z.infer<typeof accountSchema>;
