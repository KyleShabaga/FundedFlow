// Journal DTOs for the Rust command payloads in apps/desktop/src-tauri/src.
// Field names and shapes must match the serde structs there; see fields.ts.

import { z } from "zod";

import { instant } from "./fields.js";

export const journalEntryInputSchema = z.strictObject({
  accountId: z.string().min(1),
  /** Optional trade of the same account. */
  tradeId: z.string().min(1).nullish(),
  entryAt: instant,
  title: z.string().trim().min(1, "Required").max(200),
  body: z.string().max(100_000),
  tags: z.array(z.string().trim().max(40, "Tags are at most 40 characters")).max(20),
});
export type JournalEntryInput = z.input<typeof journalEntryInputSchema>;

export const journalEntrySchema = z.object({
  id: z.string(),
  accountId: z.string(),
  tradeId: z.string().nullable(),
  entryAt: z.string(),
  title: z.string(),
  body: z.string(),
  tags: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type JournalEntry = z.infer<typeof journalEntrySchema>;
