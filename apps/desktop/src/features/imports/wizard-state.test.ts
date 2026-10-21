import { describe, expect, it } from "vitest";
import { initialWizardState, wizardReducer, type WizardAction } from "./wizard-state";

describe("reviewed destination acknowledgement", () => {
  const file = { name: "trades.csv", content: "synthetic", size: 9, version: 1 };
  it.each<WizardAction>([
    { type: "account", accountId: "other" },
    { type: "file", file: { ...file, version: 2 } },
    { type: "clear-file" },
    { type: "timezone", timezone: "Asia/Tokyo" },
    { type: "format", format: "generic" },
    { type: "date-format", dateFormat: "mdy" },
    { type: "columns", columns: { symbol: "Ticker", side: "Side", quantity: "Qty", entryTime: "Time", entryPrice: "Price" } },
  ])("clears confirmation for a $type change", action => {
    const state = { ...initialWizardState("attempt", "UTC"), file, confirmedTargetFor: "reviewed-preview-token" };
    expect(wizardReducer(state, action).confirmedTargetFor).toBeNull();
  });
  it("keeps a deliberate confirmation during a refresh of unchanged account timezone", () => {
    const state = { ...initialWizardState("attempt", "UTC"), file, confirmedTargetFor: "reviewed-preview-token" };
    expect(wizardReducer(state, { type: "timezone", timezone: "UTC" }).confirmedTargetFor).toBe("reviewed-preview-token");
  });
});
