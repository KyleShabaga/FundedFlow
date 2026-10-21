import { it, expect } from "vitest";
import math from "../fixtures/engine-math.json" with { type: "json" };
import economics from "../fixtures/trade-contract.json" with { type: "json" };
import engineWire from "../fixtures/engine-contract.json" with { type: "json" };
import {
  accountRiskInputsSchema,
  enginePolicySchema,
  evaluateAccountRisk,
  calculateRiskSnapshot,
  toMicros,
  microsToDecimal,
  tradeSchema,
  type RuleDefinition,
} from "../../src/index.js";
import { inputs, policy, trade, drawdown, rule, id } from "./fixtures.js";
for (const f of math)
  it(`native exact financial reference: ${f.name}`, () => {
    let r: RuleDefinition;
    if (f.kind === "drawdown") {
      r = drawdown(
        f.method as "static" | "end_of_day_trailing" | "intraday_trailing",
      );
      if (r.ruleType !== "max_drawdown") throw Error();
      r.parameters.amount = { state: "value", value: f.amount! };
      if (f.trigger)
        r.parameters.lock = {
          state: "value",
          value: { triggerBalance: f.trigger, lockedFloor: f.lockedFloor! },
        };
      const i = inputs([r]);
      i.observations[0]!.value = f.opening!;
      if (f.method !== "static") {
        i.coverage.eodHistory = "available";
        i.observations.push({
          ...i.observations[0]!,
          id: id(8),
          kind:
            f.method === "end_of_day_trailing"
              ? "eod_settlement"
              : "intraday_peak",
          value: f.peak!,
          observedAt: "2026-10-19T21:00:00.000Z",
        });
        i.trades = [
          trade(
            microsToDecimal(toMicros(f.peak!)! - toMicros(f.opening!)!),
            1,
            "2026-10-19",
          ),
          trade(microsToDecimal(toMicros(f.balance!)! - toMicros(f.peak!)!), 2),
        ];
      } else
        i.trades = [
          trade(microsToDecimal(toMicros(f.balance!)! - toMicros(f.opening!)!)),
        ];
      expect(evaluateAccountRisk(i, policy(i)).rules[0]!.metrics).toMatchObject(
        f.expected,
      );
    } else if (f.kind === "daily") {
      r = rule("daily_loss_limit", {
        limit: { state: "value", value: f.limit! },
        basis: "realized",
        resetBasis: "account_trading_day",
        breach: "hard",
        condition: "always",
      });
      const i = inputs([r]);
      i.trades = [trade(f.net!)];
      expect(evaluateAccountRisk(i, policy(i)).rules[0]!.metrics).toMatchObject(
        f.expected,
      );
    } else {
      r = rule("consistency", {
        maxBestDayShare: { state: "value", value: f.share! },
        denominator: "total_profit",
        appliesTo: "evaluation",
      });
      const i = inputs([r]);
      i.trades = [
        trade(f.best!, 1, "2026-10-19"),
        trade(microsToDecimal(toMicros(f.total!)! - toMicros(f.best!)!), 2),
      ];
      expect(evaluateAccountRisk(i, policy(i)).rules[0]!.metrics).toMatchObject(
        f.expected,
      );
    }
  });
it("consumes Rust-computed net trade P&L without subtracting fees a second time", () => {
  const c = economics.cases[0]!;
  const i = inputs();
  const stored = tradeSchema.parse(JSON.parse(c.tradeWire));
  i.trades = [{ ...stored, accountId: i.account.id, id: id(999) }];
  expect(stored.fees).toBe("4.12");
  expect(stored.realizedPnl).toBe("208.38");
  expect(evaluateAccountRisk(i, policy(i)).balance).toBe("50208.38");
});
for (const f of engineWire)
  it(`engine/native persistence contract remains stable: ${f.name}`, () => {
    expect(
      evaluateAccountRisk(
        accountRiskInputsSchema.parse(f.input),
        enginePolicySchema.parse(f.policy),
      ),
    ).toEqual(f.result);
    expect(
      calculateRiskSnapshot(
        accountRiskInputsSchema.parse(f.input),
        enginePolicySchema.parse(f.policy),
        true,
      ),
    ).toEqual(f.snapshot);
  });
