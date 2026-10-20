// App settings: key → JSON value (apps/desktop/src-tauri/src/store/settings.rs).

import { z } from "zod";

/** Lower-case dotted names, e.g. `ui.theme`; Rust enforces the same rule. */
export const settingKey = z.string().regex(/^[a-z][a-z0-9_.]{0,63}$/, "Use lower-case letters, digits, '_' and '.'");

export const settingSchema = z.object({
  key: z.string(),
  value: z.unknown(),
  updatedAt: z.string(),
});
export type Setting = z.infer<typeof settingSchema>;
