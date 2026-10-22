// Typed access to the first-run acceptance commands in src-tauri/src/legal.rs (NA-3), and to quitting the app
// when the user declines. Independent of the journal runtime: these work while the journal is still opening
// or has failed to open.

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { z } from "zod";

import type { AcceptedDocument } from "../../legal";

const token = z.string().min(1).max(64);
export const legalAcceptanceSchema = z.object({
  documents: z.array(z.object({ id: token, version: token, digest: z.string().regex(/^[0-9a-f]{64}$/) })).min(1),
  acceptedAt: z.iso.datetime({ offset: true }),
});
export type LegalAcceptance = z.infer<typeof legalAcceptanceSchema>;

export const legalGateway = {
  /** The stored record, or null when there is none (or it can't be trusted). */
  async read(): Promise<LegalAcceptance | null> {
    const value = await invoke<unknown>("get_legal_acceptance");
    if (value === null) return null;
    // A record this build can't read is treated like no record: the screen is shown again.
    const parsed = legalAcceptanceSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  },
  async record(documents: AcceptedDocument[]): Promise<LegalAcceptance> {
    return legalAcceptanceSchema.parse(await invoke<unknown>("record_legal_acceptance", { documents }));
  },
  /** Closes the only window, which ends the app. Needs `core:window:allow-close` and nothing wider. */
  quit: (): Promise<void> => getCurrentWindow().close(),
};

/* The record is read once before the first render (main.tsx), so the app never flashes before the gate. */

let primed: { value: LegalAcceptance | null } | null = null;

/** What `preloadLegalAcceptance` found; undefined when it hasn't run or didn't answer in time. */
export const peekLegalAcceptance = (): LegalAcceptance | null | undefined => primed?.value;

/** Sets the preloaded answer (tests use it to start with or without a record). */
export function primeLegalAcceptance(value: LegalAcceptance | null | undefined) {
  primed = value === undefined ? null : { value };
}

/** Reads the record before the first render. A slow or failed read leaves it to the gate to retry. */
export async function preloadLegalAcceptance(timeoutMs = 2_000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      legalGateway.read(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), timeoutMs); }),
    ]);
    primeLegalAcceptance(value);
  } catch {
    primeLegalAcceptance(undefined);
  } finally {
    clearTimeout(timer);
  }
}
