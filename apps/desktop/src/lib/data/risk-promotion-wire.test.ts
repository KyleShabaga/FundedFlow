// P0-02 IPC contract on real native payloads (src-tauri risk_promotion_tests::promotion_command_wire_fixture):
// the four commands parse through the adapter's schemas, and what the TypeScript engine freezes from a native capture
// is canonically identical to that capture, which is what native promotion compares.
import { calculateRiskSnapshot, canonicalEngineJson, defaultEnginePolicy } from "@fundedflow/domain";
import { expect, it } from "vitest";

import fixture from "../../test/fixtures/risk-promotion-wire.json";
import { createTauriRepository } from "./tauri-repository";

const payload = (command: string) => fixture.find(f => f.command === command)!;
const repository = () => createTauriRepository(async (command: string) => payload(command).output as never);

it("each P0-02 command's native payload parses through the adapter", async () => {
  const repo = repository();
  const capture = await repo.evidence.capture(payload("capture_account_risk").args.query as never);
  expect(capture.priorBreaches).toHaveLength(1);
  expect(capture.reconciliationRevisionIds.length).toBeGreaterThan(0);
  const promoted = await repo.snapshots.promote(payload("promote_account_risk").args.input as never);
  const current = await repo.snapshots.current(payload("get_current_account_risk").args.accountId as string);
  expect(current.snapshot?.id).toBe(promoted.id);
  expect(current.sourcesUnchanged).toBe(true);
  const freshness = await repo.snapshots.freshness(payload("get_account_snapshot_freshness").args.snapshotId as string);
  expect(freshness.sourcesUnchanged).toBe(true);
});

it("the engine freezes a native capture exactly as captured (inputs, reconciliation revisions, prior breaches)", async () => {
  const capture = await repository().evidence.capture(payload("capture_account_risk").args.query as never);
  const policy = { ...defaultEnginePolicy, reconciliationRevisionIds: capture.reconciliationRevisionIds, priorBreaches: capture.priorBreaches };
  const snapshot = calculateRiskSnapshot(capture.inputs, policy, false);
  const raw = payload("capture_account_risk").output as { inputs: unknown; reconciliationRevisionIds: unknown; priorBreaches: unknown };
  expect(canonicalEngineJson(snapshot.explanation.inputs)).toBe(canonicalEngineJson(raw.inputs));
  const frozen = snapshot.explanation.policy as { reconciliationRevisionIds: unknown; priorBreaches: unknown };
  expect(canonicalEngineJson(frozen.reconciliationRevisionIds)).toBe(canonicalEngineJson(raw.reconciliationRevisionIds));
  expect(canonicalEngineJson(frozen.priorBreaches)).toBe(canonicalEngineJson(raw.priorBreaches));
});
