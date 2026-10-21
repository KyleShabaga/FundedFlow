import { describe, it, expect } from "vitest";
import {
  evaluateAccountRisk,
  calculateRiskSnapshot,
  engineSha256,
  canonicalEngineJson,
  type RuleDefinition,
} from "../../src/index.js";
import {
  inputs,
  policy,
  trade,
  drawdown,
  rule,
  id,
  instant,
} from "./fixtures.js";
const evaluate = (i = inputs()) => evaluateAccountRisk(i, policy(i));

describe("pure sourced risk engine", () => {
  it("fresh fully covered static account has exact floor and headroom", () => {
    const r = evaluate();
    expect(r.status).toBe("Safe");
    expect(r.balance).toBe("50000");
    expect(r.rules[0]!.metrics).toMatchObject({
      drawdownFloor: "48000",
      drawdownHeadroom: "2000",
    });
    expect(r.assurance).toBe("user_reported_estimate");
  });
  it("threshold equality follows the explicit sourced boundary", () => {
    const i = inputs();
    i.trades = [trade("-2000")];
    expect(evaluate(i).status).toBe("Stop");
    const p = policy(i);
    p.boundary = "below_is_breach";
    expect(evaluateAccountRisk(i, p).status).toBe("Safe");
  });
  it("earlier breach cannot be erased by subsequent profit", () => {
    const i = inputs();
    i.trades = [trade("-2100", 1), trade("2500", 2)];
    expect(evaluate(i).status).toBe("Stop");
    expect(evaluate(i).balance).toBe("50400");
  });
  it("a breach wins when an unrelated rule remains unknown", () => {
    const i = inputs([
      drawdown(),
      rule("manual_check", { description: "Manual policy" }, 2),
    ]);
    i.rulebookVersions[0]!.rules[1]!.supportStatus = "manual_only";
    i.trades = [trade("-2100")];
    expect(evaluate(i).status).toBe("Stop");
  });
  for (const state of [
    "missing",
    "incomplete",
    "stale",
    "conflicting",
    "unsupported",
    "manual_verification",
  ] as const)
    it(`does not certify ${state} history`, () => {
      const i = inputs();
      i.coverage.closedTrades = state;
      expect(evaluate(i).status).toBe("Unknown");
    });
  it("does not invent baseline or fees", () => {
    const i = inputs();
    i.observations = [];
    expect(evaluate(i).balance).toBeNull();
    expect(evaluate(i).status).toBe("Unknown");
    i.observations = inputs().observations;
    i.coverage.fees = "missing";
    expect(evaluate(i).balance).toBeNull();
  });
  it("does not infer current equity from closed trades", () => {
    const r = drawdown("intraday_trailing");
    const i = inputs([r]);
    i.coverage.intradayHistory = "available";
    expect(evaluate(i).status).toBe("Unknown");
  });
  it("EOD peak and lock produce distinct exact floors", () => {
    const r = drawdown("end_of_day_trailing");
    if (r.ruleType !== "max_drawdown") throw Error();
    r.parameters.lock = {
      state: "value",
      value: { triggerBalance: "52500", lockedFloor: "50500" },
    };
    const i = inputs([r]);
    i.coverage.eodHistory = "available";
    i.trades = [trade("3000", 1, "2026-10-19")];
    i.observations.push({
      ...i.observations[0]!,
      id: id(8),
      kind: "eod_settlement",
      value: "53000",
      observedAt: "2026-10-19T21:00:00.000Z",
      effectiveTradingDay: "2026-10-20",
    });
    const out = evaluate(i);
    expect(out.rules[0]!.metrics).toMatchObject({
      drawdownFloor: "50500",
      drawdownHeadroom: "2500",
      drawdownLocked: true,
    });
    expect(out.status).toBe("Safe");
  });
  it("adequate manual intraday checkpoints expose exact estimate but not complete feed sufficiency", () => {
    const r = drawdown("intraday_trailing");
    if (r.ruleType !== "max_drawdown") throw Error();
    r.parameters.basis = "realized_and_unrealized";
    const i = inputs([r]);
    i.observations.push(
      {
        ...i.observations[0]!,
        id: id(8),
        kind: "intraday_peak",
        basis: "equity",
        value: "52000",
        observedAt: "2026-10-20T15:00:00.000Z",
      },
      {
        ...i.observations[0]!,
        id: id(9),
        kind: "equity",
        basis: "equity",
        value: "51000",
        observedAt: instant,
        validUntil: instant,
      },
    );
    const out = evaluate(i);
    expect(out.rules[0]!.metrics).toMatchObject({
      drawdownFloor: "50000",
      drawdownHeadroom: "1000",
    });
    expect(out.status).toBe("Unknown");
    expect(out.rules[0]!.state).toBe("unsupported");
  });
  it("realized daily loss preserves an earlier same-day and prior-day hard breach", () => {
    const r = rule("daily_loss_limit", {
      limit: { state: "value", value: "100" },
      basis: "realized",
      resetBasis: "account_trading_day",
      breach: "hard",
      condition: "always",
    });
    const i = inputs([r]);
    i.trades = [trade("-101", 1, "2026-10-19"), trade("200", 2, "2026-10-19")];
    expect(evaluate(i).status).toBe("Stop");
  });
  it("conditional DLL cannot acquire guessed trigger semantics", () => {
    const i = inputs([
      rule("daily_loss_limit", {
        limit: { state: "value", value: "100" },
        basis: "realized",
        resetBasis: "account_trading_day",
        breach: "hard",
        condition: "below_initial_trail",
      }),
    ]);
    expect(evaluate(i).rules[0]!.reasonCode).toBe(
      "conditional_daily_loss_trigger_unmodeled",
    );
  });
  it("personal caution is separate from a firm breach", () => {
    const i = inputs();
    i.trades = [trade("-1900")];
    const p = policy(i);
    p.personalCautionHeadroom = "100";
    expect(evaluateAccountRisk(i, p).status).toBe("Caution");
    expect(evaluateAccountRisk(i, p).rules[0]!.reasonCode).toBe(
      "personal_caution_buffer",
    );
  });
  it("target tracks progress without declaring the evaluation passed", () => {
    const i = inputs([
      rule("profit_target", {
        amount: { state: "value", value: "3000" },
        basis: "balance",
      }),
    ]);
    i.trades = [trade("150")];
    expect(evaluate(i).rules[0]!.metrics).toMatchObject({
      profit: "150",
      remaining: "2850",
      attained: false,
    });
  });
  it("five distinct profitable days at $150 use exact net P&L", () => {
    const i = inputs([
      rule("min_trading_days", {
        days: { state: "value", value: 5 },
        minDayProfit: { state: "value", value: "150" },
        dayBasis: "trading_day",
      }),
    ]);
    i.trades = [
      trade("150", 1, "2026-10-12"),
      trade("149.999999", 1, "2026-10-13"),
      trade("150", 1, "2026-10-14"),
      trade("150", 1, "2026-10-15"),
      trade("150", 1, "2026-10-16"),
    ].map((t, n) => ({ ...t, id: id(500 + n) }));
    expect(evaluate(i).rules[0]!.metrics).toMatchObject({
      tradingDaysCompleted: 4,
      attained: false,
    });
    i.trades[1]!.realizedPnl = "150";
    expect(evaluate(i).rules[0]!.metrics).toMatchObject({
      tradingDaysCompleted: 5,
      attained: true,
    });
  });
  it("same-day rows count once and unknown profitable threshold stays unknown", () => {
    const i = inputs([
      rule("min_trading_days", {
        days: { state: "value", value: 5 },
        minDayProfit: { state: "value", value: "150" },
        dayBasis: "trading_day",
      }),
    ]);
    i.trades = [trade("100", 1), trade("50", 2)];
    expect(evaluate(i).rules[0]!.metrics.tradingDaysCompleted).toBe(1);
    const r = i.rulebookVersions[0]!.rules[0]!;
    if (r.ruleType === "min_trading_days")
      r.parameters.minDayProfit = { state: "unknown" };
    expect(evaluate(i).status).toBe("Unknown");
  });
  it("consistency compares exact shares and keeps negative days", () => {
    const i = inputs([
      rule("consistency", {
        maxBestDayShare: { state: "value", value: "0.5" },
        denominator: "total_profit",
        appliesTo: "evaluation",
      }),
    ]);
    i.trades = [
      trade("150", 1, "2026-10-12"),
      trade("150", 1, "2026-10-13"),
      trade("-1", 1, "2026-10-14"),
    ].map((t, n) => ({ ...t, id: id(550 + n) }));
    expect(evaluate(i).rules[0]!.metrics).toMatchObject({
      denominator: "299",
      bestDayProfit: "150",
      attained: false,
    });
  });
  for (const state of [
    "explicit_none",
    "disabled",
    "not_applicable",
    "unknown",
  ] as const)
    it(`preserves ${state} presence`, () => {
      const r = drawdown();
      if (r.ruleType === "max_drawdown") r.parameters.amount = { state };
      const out = evaluate(inputs([r]));
      expect(out.status).toBe("Unknown");
      expect(out.rules[0]!.state).toBe(
        state === "explicit_none" ? "absent" : state,
      );
    });
  for (const type of [
    "max_position_size",
    "max_trades_per_day",
    "scaling_plan",
    "payout_eligibility",
    "payout_count_transition",
  ] as const)
    it(`${type} cannot infer live or qualifying events`, () => {
      const rules: RuleDefinition[] = [
        rule("max_position_size", {
          limits: {
            state: "value",
            value: [
              { contractClass: "mini", symbolRoot: null, maxContracts: 4 },
              { contractClass: "micro", symbolRoot: null, maxContracts: 40 },
            ],
          },
          combination: "aggregate_equivalent",
          microsPerMini: { state: "value", value: 10 },
        }),
        rule("max_trades_per_day", { count: { state: "value", value: 5 } }),
        rule("scaling_plan", {
          offered: { state: "value", value: true },
          schedule: { state: "unknown" },
        }),
        rule("payout_eligibility", {
          initialWaitingDays: { state: "value", value: 5 },
          frequency: { state: "unknown" },
          minBalance: { state: "value", value: "50000" },
          minProfit: { state: "explicit_none" },
          perRequestCap: { state: "unknown" },
        }),
        rule("payout_count_transition", {
          payoutsRequired: { state: "value", value: 5 },
          nextPhase: "live_funded",
        }),
      ];
      const i = inputs([rules.find((r) => r.ruleType === type)!]);
      expect(evaluate(i).status).toBe("Unknown");
    });
  it("does not treat an evaluation-only rule as not applicable when the phase is unrecorded", () => {
    const i = inputs([
      drawdown(),
      rule("consistency", {
        maxBestDayShare: { state: "value", value: "0.5" },
        denominator: "total_profit",
        appliesTo: "evaluation",
      }, 2),
    ]);
    // An account-private rulebook needs no catalogue phase, so its phase can be unknown.
    i.rulebookVersions[0]!.rulebook.ownerAccountId = i.account.id;
    i.rulebookVersions[0]!.version.verificationStatus = "needs_review";
    i.rulebookVersions[0]!.version.userConfirmedAt = instant;
    i.phaseHistory = [];
    i.trades = [trade("150", 1, "2026-10-19")];
    const r = evaluate(i);
    const consistency = r.rules.find((x) => x.ruleType === "consistency")!;
    expect(consistency).toMatchObject({ state: "unknown", reasonCode: "unknown_account_phase" });
    expect(r.status).toBe("Unknown");
  });
  it("does not convert an account-private rulebook to official compliance", () => {
    const i = inputs();
    i.rulebookVersions[0]!.rulebook.ownerAccountId = i.account.id;
    i.rulebookVersions[0]!.version.verificationStatus = "needs_review";
    i.rulebookVersions[0]!.version.userConfirmedAt = instant;
    expect(evaluate(i).assurance).toBe("user_defined_estimate");
  });
  for (const field of [
    "phase",
    "path",
    "provider",
    "claim",
    "currency",
    "archive",
    "failed",
    "baseline",
    "boundary",
    "rulebook",
  ] as const)
    it(`fails closed for invalid ${field} context`, () => {
      const i = inputs();
      const p = policy(i);
      switch (field) {
        case "phase":
          i.phaseHistory = [];
          break;
        case "path":
          i.catalogueLink.selectedPhasePathId = id(99);
          break;
        case "provider":
          i.catalogueLink.providerId = id(99);
          break;
        case "claim":
          i.rulebookVersions[0]!.claims[0]!.claimStatus = "conflicting";
          break;
        case "currency":
          i.observations[0]!.currency = "EUR";
          break;
        case "archive":
          i.account.archivedAt = instant;
          break;
        case "failed":
          i.account.status = "failed";
          break;
        case "baseline":
          i.coverage.baseline = "incomplete";
          break;
        case "boundary":
          p.boundary = null;
          break;
        case "rulebook":
          i.rulebookVersions[0]!.version.verificationStatus = "stale";
          break;
      }
      expect(evaluateAccountRisk(i, p).status).toBe("Unknown");
    });
  it("never crosses an attempt despite a reused broker reference", () => {
    const i = inputs();
    i.trades = [{ ...trade("100"), accountId: id(999) }];
    expect(() => evaluate(i)).toThrow();
  });
  it("does not mutate inputs and preserves exact JSON-safe deterministic results", () => {
    const i = inputs();
    i.trades = [trade("1", 2), trade("-2", 1)];
    const before = JSON.stringify(i);
    const first = evaluate(i);
    expect(JSON.stringify(i)).toBe(before);
    i.trades.reverse();
    i.observations.reverse();
    expect(evaluate(i)).toEqual(first);
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
  });
  it("version/correction/account/policy changes cannot reuse snapshot identity", () => {
    const i = inputs();
    const first = evaluate(i);
    i.trades.push(trade("0.000001"));
    expect(evaluate(i).inputsHash).not.toBe(first.inputsHash);
    const mapped = calculateRiskSnapshot(i, policy(i), true);
    expect(mapped.explanation).toHaveProperty("inputs");
    expect(mapped.inputsHash).toBe(evaluate(i).inputsHash);
  });
  it("unknown financial/count fields map to null, not manufactured zero", () => {
    const i = inputs();
    i.coverage.closedTrades = "incomplete";
    i.coverage.fees = "missing";
    const s = calculateRiskSnapshot(i, policy(i), true);
    expect(s.balance).toBeNull();
    expect(s.realizedDayPnl).toBeNull();
    expect(s.tradingDaysCompleted).toBeNull();
    expect(s.drawdownLocked).toBeNull();
  });
  it("SHA-256 matches standard Node vectors including UTF-8", () => {
    expect(engineSha256("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(engineSha256("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(canonicalEngineJson({ b: 2, a: [2, 1] })).toBe('{"a":[1,2],"b":2}');
  });
});

it("same-timestamp mixed closes cannot acquire an invented breach order", () => {
  const i = inputs();
  i.trades = [
    trade("-2100", 1),
    { ...trade("2500", 2), exitAt: trade("-2100", 1).exitAt },
  ];
  expect(evaluateAccountRisk(i, policy(i)).status).toBe("Unknown");
  i.trades.reverse();
  expect(evaluateAccountRisk(i, policy(i)).status).toBe("Unknown");
});

it("requires explicit account-compatible rule currency and sourced units", () => {
  const i = inputs();
  const p = policy(i);
  p.ruleCurrency = "EUR";
  expect(evaluateAccountRisk(i, p).status).toBe("Unknown");
  p.ruleCurrency = "USD";
  p.ruleCurrencySourceClaimIds = [];
  expect(evaluateAccountRisk(i, p).status).toBe("Unknown");
});

it("preserves a sourced prior breach and does not transfer it to another attempt", () => {
  const i = inputs(),
    p = policy(i);
  p.priorBreaches = [
    {
      accountId: i.account.id,
      rulebookVersionId: id(20),
      assignmentId: id(30),
      ruleKey: "rule_1",
      observedAt: "2026-10-19T20:00:00.000Z",
      sourceReferences: [id(2)],
    },
  ];
  expect(evaluateAccountRisk(i, p).status).toBe("Stop");
  p.priorBreaches[0]!.accountId = id(999);
  expect(evaluateAccountRisk(i, p).status).toBe("Safe");
});
it("does not auto-switch to newer published versions and changes hashes for explicit reassignment", () => {
  const i = inputs();
  const original = evaluateAccountRisk(i, policy(i));
  const next = JSON.parse(
    JSON.stringify(i.rulebookVersions[0]!),
  ) as (typeof i.rulebookVersions)[number];
  next.version.id = id(21);
  next.version.versionNumber = 2;
  next.rules.forEach((r) => (r.rulebookVersionId = next.version.id));
  next.applicability.forEach((a) => (a.rulebookVersionId = next.version.id));
  i.rulebookVersions.push(next);
  i.assignments.push({
    ...i.assignments[0]!,
    id: id(31),
    rulebookVersionId: id(21),
    effectiveFrom: "2026-11-01",
  });
  expect(evaluateAccountRisk(i, policy(i)).rulebookVersionId).toBe(
    original.rulebookVersionId,
  );
  i.assignments[0]!.effectiveTo = "2026-10-20";
  i.assignments[1]!.effectiveFrom = "2026-10-20";
  i.applicableAssignment = i.assignments[1]!;
  const updated = evaluateAccountRisk(i, policy(i));
  expect(updated.rulebookVersionId).toBe(id(21));
  expect(updated.inputsHash).not.toBe(original.inputsHash);
});
it("fails closed on aggregate overflow and duplicate records", () => {
  const i = inputs();
  i.trades = [trade("9223372036854.775807")];
  expect(evaluateAccountRisk(i, policy(i)).status).toBe("Unknown");
  i.trades = [trade("1"), trade("1")];
  expect(evaluateAccountRisk(i, policy(i)).status).toBe("Unknown");
});
it("retains Rust trading-day grouping over a weekend/DST boundary without a second clock algorithm", () => {
  const i = inputs([
    rule("min_trading_days", {
      days: { state: "value", value: 1 },
      minDayProfit: { state: "explicit_none" },
      dayBasis: "trading_day",
    }),
  ]);
  i.asOf = "2026-11-02T23:00:00.000Z";
  i.effectiveTradingDay = "2026-11-02";
  i.trades = [
    {
      ...trade("150"),
      entryAt: "2026-11-01T05:30:00.000Z",
      exitAt: "2026-11-01T06:30:00.000Z",
      tradingDay: "2026-11-02",
    },
  ];
  expect(
    evaluateAccountRisk(i, policy(i)).rules[0]!.metrics.tradingDaysCompleted,
  ).toBe(1);
});

it("inconsistent historical settlement cannot create a fabricated trailing breach", () => {
  const i = inputs([drawdown("end_of_day_trailing")]);
  i.coverage.eodHistory = "available";
  i.observations.push({
    ...i.observations[0]!,
    id: id(88),
    kind: "eod_settlement",
    value: "53000",
    observedAt: "2026-10-19T20:00:00.000Z",
  });
  const r = evaluateAccountRisk(i, policy(i));
  expect(r.status).toBe("Unknown");
  expect(r.rules[0]!.state).toBe("conflicting");
});

it("a mid-attempt baseline cannot silently replace a different configured initial reference", () => {
  const i = inputs();
  i.observations[0]!.value = "51000";
  i.trades = [trade("-2100")];
  const r = evaluateAccountRisk(i, policy(i));
  expect(r.status).toBe("Unknown");
  expect(r.reasons).toContain("opening_and_starting_reference_conflict");
});

it("a sourced static lock tightens once triggered and never relaxes the initial floor", () => {
  const d = drawdown();
  if (d.ruleType !== "max_drawdown") throw Error();
  d.parameters.lock = {
    state: "value",
    value: { triggerBalance: "53000", lockedFloor: "49500" },
  };
  const i = inputs([d]);
  i.trades = [trade("3000", 1), trade("-3600", 2)];
  const r = evaluateAccountRisk(i, policy(i));
  expect(r.status).toBe("Stop");
  expect(r.rules[0]!.metrics).toMatchObject({
    drawdownFloor: "49500",
    drawdownLocked: true,
  });
  d.parameters.lock = {
    state: "value",
    value: { triggerBalance: "40000", lockedFloor: "39000" },
  };
  const bad = inputs([d]);
  expect(evaluateAccountRisk(bad, policy(bad)).status).toBe("Unknown");
});

it("a removed source cannot silently clear a supplied known prior breach", () => {
  const i = inputs(),
    p = policy(i);
  p.priorBreaches = [
    {
      accountId: i.account.id,
      rulebookVersionId: id(20),
      assignmentId: id(30),
      ruleKey: "rule_1",
      observedAt: "2026-10-19T20:00:00.000Z",
      sourceReferences: ["removed-trade"],
    },
  ];
  expect(evaluateAccountRisk(i, p).status).toBe("Unknown");
  expect(evaluateAccountRisk(i, p).reasons).toContain(
    "prior_breach_source_requires_review",
  );
});

it("conditional DLL None does not become unconditional no-limit compliance", () => {
  const d = rule(
    "daily_loss_limit",
    {
      limit: { state: "explicit_none" },
      basis: "unknown",
      resetBasis: "unknown",
      breach: "unknown",
      condition: "below_initial_trail",
    },
    2,
  );
  const i = inputs([drawdown(), d]);
  const r = evaluateAccountRisk(i, policy(i));
  expect(r.status).toBe("Unknown");
  expect(r.rules[1]!.reasonCode).toBe("conditional_daily_absence_unresolved");
});

it("unknown ordering cannot hide a possible static lock trigger", () => {
  const d = drawdown();
  if (d.ruleType !== "max_drawdown") throw Error();
  d.parameters.amount = { state: "value", value: "5000" };
  d.parameters.lock = {
    state: "value",
    value: { triggerBalance: "53000", lockedFloor: "51000" },
  };
  const i = inputs([d]);
  i.trades = [
    trade("4000", 1),
    { ...trade("-1500", 2), exitAt: trade("4000", 1).exitAt },
    trade("-2000", 3),
  ];
  expect(evaluateAccountRisk(i, policy(i)).status).toBe("Unknown");
});
it("malformed stored times cannot be dropped and replaced by a zero daily P&L", () => {
  const i = inputs();
  i.trades = [{ ...trade("-3000"), exitAt: "invalid" }];
  const r = evaluateAccountRisk(i, policy(i));
  expect(r.status).toBe("Unknown");
  expect(r.realizedDayPnl).toBeNull();
});

it("exact share bounds reject an invalid stored ratio before evaluation", () => {
  const consistency = rule("consistency", {
      maxBestDayShare: {
        state: "value",
        value: "1",
      },
      denominator: "total_profit",
      appliesTo: "evaluation",
    });
  if (consistency.ruleType !== "consistency") throw Error();
  const i = inputs([consistency]);
  // Simulate malformed historical input. The canonical input parser must reject this ratio
  // before it can reach any calculation; floating-point rounding must not validate it as one.
  consistency.parameters.maxBestDayShare = { state: "value", value: "1.0000000000000000000000000001" };
  i.rulebookVersions[0]!.rules[0] = consistency;
  i.trades = [trade("150")];
  expect(() => evaluateAccountRisk(i, policy(i))).toThrow(/canonical decimal greater than 0 and at most 1/);
});
it("a sourced soft daily threshold still stops current-day trading without failing the account", () => {
  const i = inputs([
    rule("daily_loss_limit", {
      limit: { state: "value", value: "100" },
      basis: "realized",
      resetBasis: "account_trading_day",
      breach: "soft",
      condition: "always",
    }),
  ]);
  i.trades = [trade("-101")];
  expect(evaluateAccountRisk(i, policy(i)).status).toBe("Stop");
  expect(i.account.status).toBe("active");
});
it("coalesces a large same-instant import deterministically without inventing fill order", () => {
  const i = inputs();
  i.trades = Array.from({ length: 1000 }, (_, n) => ({
    ...trade("1"),
    id: id(1000 + n),
  }));
  const r = evaluateAccountRisk(i, policy(i));
  expect(r.balance).toBe("51000");
  expect(r.status).toBe("Safe");
  i.trades.reverse();
  expect(evaluateAccountRisk(i, policy(i))).toEqual(r);
});
