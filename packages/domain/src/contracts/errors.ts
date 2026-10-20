// Error DTOs for the Rust command payloads in apps/desktop/src-tauri/src.
// Field names and shapes must match the serde structs there; see fields.ts.

import { z } from "zod";

export const fieldIssueSchema = z.object({ field: z.string(), message: z.string() });
export type FieldIssue = z.infer<typeof fieldIssueSchema>;

export const appErrorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("validation"), message: z.string(), issues: z.array(fieldIssueSchema) }),
  z.object({ kind: z.literal("notFound"), message: z.string() }),
  z.object({ kind: z.literal("conflict"), message: z.string() }),
  z.object({ kind: z.literal("database"), message: z.string() }),
  z.object({ kind: z.literal("unavailable"), message: z.string() }),
]);
export type AppError = z.infer<typeof appErrorSchema>;
