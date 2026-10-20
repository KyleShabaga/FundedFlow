// Account ledger: non-trade money movements. Shapes match
// apps/desktop/src-tauri/src/store/ledger.rs. Amounts are signed decimal text in the
// account currency; payouts and fees are negative. Fees never change the balance
// the rules see; payouts, resets and corrections always do.

import { z } from "zod";

import { decimal, optionalText } from "./fields.js";

export const ledgerKinds = [
  "balance_correction",
  "payout",
  "reset",
  "evaluation_fee",
  "activation_fee",
  "reset_fee",
  "other",
] as const;
export type LedgerKind = (typeof ledgerKinds)[number];

const feeKinds: readonly LedgerKind[] = ["evaluation_fee", "activation_fee", "reset_fee"];

export const ledgerEntryInputSchema = z.strictObject({
  accountId: z.string().min(1),
  kind: z.enum(ledgerKinds),
  amount: decimal.refine((v) => Number(v) !== 0, "Must not be zero"),
  /** Omit to use the kind's rule; required for `other`. */
  affectsBalance: z.boolean().nullish(),
  effectiveAt: z.iso.datetime({ offset: true, message: "Enter a date and time" }),
  note: optionalText(20_000),
}).superRefine((e, ctx) => {
  const negative = e.kind === "payout" || feeKinds.includes(e.kind);
  if (negative && Number(e.amount) > 0) {
    ctx.addIssue({ code: "custom", path: ["amount"], message: `A ${e.kind.replace("_", " ")} is negative` });
  }
  if (e.kind === "other" && (e.affectsBalance === null || e.affectsBalance === undefined)) {
    ctx.addIssue({ code: "custom", path: ["affectsBalance"], message: "Say whether this changes the account balance" });
  }
});
export type LedgerEntryInput = z.input<typeof ledgerEntryInputSchema>;

export const ledgerEntrySchema = z.object({
  id: z.string(),
  accountId: z.string(),
  kind: z.enum(ledgerKinds),
  amount: z.string(),
  affectsBalance: z.boolean(),
  effectiveAt: z.string(),
  /** Derived in Rust from the account's time zone and trading-day reset time. */
  tradingDay: z.string(),
  note: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;
