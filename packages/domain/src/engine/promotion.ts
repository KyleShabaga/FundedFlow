// P0-02: atomic promotion of a current risk result. Shapes match
// apps/desktop/src-tauri/src/store/risk_promotion.rs. Native SQLite decides; these only describe its answers.
import { z } from "zod";

import { snapshotSchema } from "../contracts/snapshots.js";
import { accountRiskInputsSchema } from "../risk/contracts.js";
import { enginePolicySchema } from "./contracts.js";

/**
 * Every source of one calculation (account, cutoff, coverage statement), read natively from one database state:
 * the canonical inputs with unresolved reconciliation reviews as missing inputs, every reconciliation revision, and
 * the continuing breaches recorded by the account's earlier calculations. A calculation must freeze exactly these;
 * promotion re-reads them inside its write transaction and refuses if they differ.
 */
export const riskCaptureSchema = z.strictObject({
  inputs: accountRiskInputsSchema,
  reconciliationRevisionIds: z.array(z.string()),
  priorBreaches: enginePolicySchema.shape.priorBreaches,
  /** sha256 of the canonical inputs, revisions and prior breaches (diagnostic; never accepted back as proof). */
  sourceFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
});
export type RiskCapture = z.infer<typeof riskCaptureSchema>;

/**
 * The account's current result: its newest promoted calculation, and whether that calculation's sources are
 * unchanged now for its own cutoff (re-checked natively on every read). It says nothing about whether the cutoff
 * is today: applicability (trading day, newer records, rulebook in force) is the reader's separate check.
 */
export const currentRiskSchema = z.strictObject({
  snapshot: snapshotSchema.nullable(),
  promotedAt: z.string().nullable(),
  /** null when nothing is promoted, or the calculation froze no engine sources. */
  sourcesUnchanged: z.boolean().nullable(),
});
export type CurrentRisk = z.infer<typeof currentRiskSchema>;

/** Whether one stored calculation's sources are unchanged for its own cutoff (null: not an engine calculation). */
export const snapshotFreshnessSchema = z.strictObject({
  snapshotId: z.string().min(1),
  sourcesUnchanged: z.boolean().nullable(),
});
export type SnapshotFreshness = z.infer<typeof snapshotFreshnessSchema>;
