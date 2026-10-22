// Typed access to `list_account_freshness` (P0-D06, src-tauri/src/store/freshness.rs): the stored instants the
// account freshness indicator reads, for every account in one call. It computes no verdict.
import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

const instant = z.iso.datetime({ offset: true });
export const accountFreshnessInputsSchema = z.object({
  accountId: z.string().min(1),
  currentTradingDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tradingDayStarts: z.array(instant).min(2),
  nextTradingDayStart: instant,
  lastCommittedImportAt: instant.nullable(),
  lastFailedImportAt: instant.nullable(),
  lastManualTradeAt: instant.nullable(),
  lastConfirmedCheckpointAt: instant.nullable(),
});
export type AccountFreshnessInputs = z.infer<typeof accountFreshnessInputsSchema>;

export const freshnessGateway = {
  list: async (asOf: string): Promise<AccountFreshnessInputs[]> => z.array(accountFreshnessInputsSchema).parse(await invoke<unknown>("list_account_freshness", { asOf })),
};
