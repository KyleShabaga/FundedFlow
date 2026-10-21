// Build 26.9 developer tools: the debug-only native commands behind Add Fake Data and Reset All Data.
// Loaded only through `import.meta.env.DEV` imports, so production bundles never contain it, and the
// commands themselves exist only in debug builds of the Rust app (src-tauri/src/dev_tools).
import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

export const presets = ["ui_smoke", "stress"] as const;
export type Preset = (typeof presets)[number];

const resetReportSchema = z.object({
  status: z.enum(["pending", "completed", "unchanged", "failed"]),
  requestedAt: z.string(),
  finishedAt: z.string().nullable(),
  dataDir: z.string(),
  backup: z.string().nullable(),
  message: z.string(),
  log: z.string().nullable(),
});
export type ResetReport = z.infer<typeof resetReportSchema>;

export const devToolsStatusSchema = z.object({
  isolated: z.boolean(),
  dataDir: z.string().nullable(),
  defaultDataDir: z.string().nullable(),
  problem: z.string().nullable(),
  envVar: z.string(),
  presets: z.array(z.object({ id: z.enum(presets), scenarios: z.array(z.string()), windowDays: z.number() })),
  defaultSeed: z.number().int(),
  lastReset: resetReportSchema.nullable(),
});
export type DevToolsStatus = z.infer<typeof devToolsStatusSchema>;

const accountReportSchema = z.object({
  scenario: z.string(),
  accountId: z.string(),
  name: z.string(),
  status: z.string(),
  archived: z.boolean(),
  trades: z.number(),
  winners: z.number(),
  losers: z.number(),
  breakeven: z.number(),
  tradingDays: z.number(),
  startingBalance: z.string(),
  endingBalance: z.string(),
  netPnl: z.string(),
  fees: z.string(),
  drawdownFloor: z.string().nullable(),
  importBatches: z.number(),
  rejectedImportRows: z.number(),
  journalEntries: z.number(),
  tradeReviews: z.number(),
  dailyReviews: z.number(),
  observations: z.number(),
  covers: z.array(z.string()),
});

export const seedReportSchema = z.object({
  preset: z.enum(presets),
  seed: z.number().int(),
  anchorDay: z.string(),
  accounts: z.array(accountReportSchema),
  skipped: z.array(z.string()),
  totalAccounts: z.number(),
  totalTrades: z.number(),
});
export type SeedReport = z.infer<typeof seedReportSchema>;

export const resetPreviewSchema = z.object({
  dataDir: z.string(),
  scope: z.string(),
  counts: z.object({
    accounts: z.number(),
    archivedAccounts: z.number(),
    trades: z.number(),
    importBatches: z.number(),
    journalEntries: z.number(),
    tradeReviews: z.number(),
    dailyReviews: z.number(),
    rulebooks: z.number(),
    observations: z.number(),
    snapshots: z.number(),
  }).nullable(),
  backupPattern: z.string(),
  tool: z.string(),
  toolOutput: z.string(),
  cli: z.string(),
});
export type ResetPreview = z.infer<typeof resetPreviewSchema>;

export const resetHandoffSchema = z.object({ dataDir: z.string(), report: z.string(), log: z.string(), reopen: z.string() });
export type ResetHandoff = z.infer<typeof resetHandoffSchema>;

/** A refusal or failure from a developer command, with the native message. */
export class DevToolError extends Error {
  constructor(message: string, readonly kind: string = "unknown") {
    // Native messages are sentence fragments ("this test journal already has…").
    super(message.charAt(0).toUpperCase() + message.slice(1));
  }
}

async function call<T>(command: string, schema: z.ZodType<T>, args?: Record<string, unknown>): Promise<T> {
  let raw: unknown;
  try {
    raw = await invoke(command, args);
  } catch (e) {
    const parsed = z.object({ kind: z.string(), message: z.string() }).safeParse(e);
    if (parsed.success) throw new DevToolError(parsed.data.message, parsed.data.kind);
    throw new DevToolError(typeof e === "string" ? e : e instanceof Error ? e.message : "The developer command failed.");
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw new DevToolError("The developer command returned an unexpected response.", "invalid-response");
  return result.data;
}

export const devTools = {
  status: () => call("dev_tools_status", devToolsStatusSchema),
  seed: (options: { preset: Preset; seed: number }) => call("dev_seed_fake_data", seedReportSchema, { options }),
  previewReset: () => call("dev_reset_preview", resetPreviewSchema),
  handOffReset: (confirmation: string) => call("dev_reset_handoff", resetHandoffSchema, { confirmation }),
  dismissResetReport: () => call("dev_dismiss_reset_report", z.null()),
};

export const devToolKeys = { status: ["dev-tools", "status"] as const };

export const presetLabels: Record<Preset, { label: string; description: string }> = {
  ui_smoke: {
    label: "UI Smoke",
    description: "7 accounts, about 500 trades over 120 days: on track, target reached, near drawdown, failed, archived, empty and CSV imports.",
  },
  stress: {
    label: "Stress / Edge Cases",
    description: "Everything in UI Smoke over 180 days, plus a high-volume account with 20–30 trade days: about 900 trades.",
  },
};
