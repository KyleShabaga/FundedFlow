import { instant } from "../contracts/fields.js";
import { tradingDay } from "../rulebook/versions.js";
import { accountInputSchema } from "../contracts/accounts.js";
import {
  accountRiskInputsSchema,
  riskMoney,
  type AccountRiskInputs,
} from "../risk/contracts.js";
import { assessRuleEvidence } from "../risk/sufficiency.js";
import { isMicros, microsToDecimal, toMicros } from "../primitives/money.js";
import { requiredValues, type RuleDefinition } from "../rulebook/rules.js";
import { canonicalEngineJson, engineSha256 } from "./canonical.js";
import { resolveEngineApplicability } from "./applicability.js";
import {
  defaultEnginePolicy,
  enginePolicySchema,
  engineResultSchema,
  ENGINE_VERSION,
  type EnginePolicy,
  type EngineResult,
  type RuleOutcome,
  type RuleOutcomeState,
} from "./contracts.js";

const money = (v: string) => {
  riskMoney.parse(v);
  return toMicros(v)!;
};
const wire = (v: bigint) => microsToDecimal(v);
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const unique = (v: string[]) => [...new Set(v)].sort();
const time = (v: string) => Date.parse(v);
const maximum = (values: bigint[]) => values.reduce((a, b) => (a > b ? a : b));
const sum = (values: bigint[]) => values.reduce((a, b) => a + b, 0n);

function lastAt<T>(
  records: readonly T[],
  at: number,
  timestamp: (record: T) => number,
): T | undefined {
  let left = 0,
    right = records.length;
  while (left < right) {
    const middle = Math.floor((left + right) / 2);
    if (timestamp(records[middle]!) <= at) left = middle + 1;
    else right = middle;
  }
  return records[left - 1];
}

function financialContext(input: AccountRiskInputs) {
  const replaced = new Set(input.observations.map((o) => o.supersedesId));
  const observations = input.observations
    .filter(
      (o) => !replaced.has(o.id) && time(o.observedAt) <= time(input.asOf),
    )
    .sort(
      (a, b) =>
        time(a.observedAt) - time(b.observedAt) || compareText(a.id, b.id),
    );
  const openings = observations.filter(
    (o) =>
      o.kind === "opening_balance" &&
      o.value !== null &&
      o.currency === input.account.currency &&
      o.confirmation === "user_confirmed" &&
      o.confidence === "user_reported",
  );
  const baseline = openings.length === 1 ? openings[0]! : null;
  const start = baseline ? time(baseline.observedAt) : null;
  const trades = input.trades
    .filter(
      (t) =>
        t.exitAt !== null &&
        time(t.exitAt) <= time(input.asOf) &&
        (start === null || time(t.exitAt) > start),
    )
    .sort(
      (a, b) => time(a.exitAt!) - time(b.exitAt!) || compareText(a.id, b.id),
    );
  const ledger = input.ledger.filter(
    (e) =>
      time(e.effectiveAt) <= time(input.asOf) &&
      (start === null || time(e.effectiveAt) > start),
  );
  ledger.sort(
    (a, b) =>
      time(a.effectiveAt) - time(b.effectiveAt) || compareText(a.id, b.id),
  );
  const missing: string[] = [];
  if (
    input.trades.some(
      (t) =>
        !instant.safeParse(t.entryAt).success ||
        (t.exitAt !== null && !instant.safeParse(t.exitAt).success) ||
        !tradingDay.safeParse(t.tradingDay).success,
    ) ||
    input.ledger.some(
      (e) =>
        !instant.safeParse(e.effectiveAt).success ||
        !tradingDay.safeParse(e.tradingDay).success,
    )
  )
    missing.push("invalid_stored_time_or_trading_day");
  try {
    if (money(input.account.startingBalance) < 0n)
      missing.push("invalid_starting_balance_configuration");
    accountInputSchema.shape.tradingDayResetTime.parse(
      input.account.tradingDayResetTime,
    );
    new Intl.DateTimeFormat("en-US", {
      timeZone: input.account.timezone,
    }).format(0);
  } catch {
    missing.push("invalid_financial_or_session_configuration");
  }
  if (
    baseline &&
    riskMoney.safeParse(input.account.startingBalance).success &&
    money(baseline.value!) !== money(input.account.startingBalance)
  )
    missing.push("opening_and_starting_reference_conflict");
  if (!baseline)
    missing.push(
      openings.length
        ? "ambiguous_opening_baseline"
        : "missing_opening_baseline",
    );
  if (trades.some((t) => t.realizedPnl === null))
    missing.push("unknown_realized_pnl");
  if (
    start !== null &&
    input.trades.some(
      (t) =>
        time(t.entryAt) <= start &&
        (t.exitAt === null || time(t.exitAt) > start),
    )
  )
    missing.push("baseline_open_position_allocation");
  const values = trades
    .filter((t) => t.realizedPnl !== null)
    .map((t) => money(t.realizedPnl!));
  const dayValues = trades
    .filter(
      (t) =>
        t.tradingDay === input.effectiveTradingDay && t.realizedPnl !== null,
    )
    .map((t) => money(t.realizedPnl!));
  const complete =
    missing.length === 0 &&
    [
      input.coverage.baseline,
      input.coverage.closedTrades,
      input.coverage.fees,
      input.coverage.ledger,
    ].every((s) => s === "available");
  const balance = complete
    ? money(baseline!.value!) +
      sum(values) +
      sum(ledger.filter((e) => e.affectsBalance).map((e) => money(e.amount)))
    : null;
  const dayPnl =
    missing.length === 0 &&
    input.coverage.closedTrades === "available" &&
    input.coverage.fees === "available" &&
    !trades.some((t) => t.realizedPnl === null)
      ? sum(dayValues)
      : null;
  const days = new Map<string, bigint>();
  for (const t of trades)
    if (t.realizedPnl !== null)
      days.set(
        t.tradingDay,
        (days.get(t.tradingDay) ?? 0n) + money(t.realizedPnl),
      );
  let running = baseline ? money(baseline.value!) : 0n;
  const groups = new Map<number, typeof trades>();
  for (const t of trades) {
    const key = time(t.exitAt!);
    const group = groups.get(key);
    if (group) group.push(t);
    else groups.set(key, [t]);
  }
  let balancePeak = running;
  const points = [...groups.entries()].map(([atMillis, group]) => {
    const values = group.map((t) =>
      t.realizedPnl === null ? 0n : money(t.realizedPnl),
    );
    const net = sum(values),
      negative = sum(values.filter((v) => v < 0n)),
      previous = running;
    running += net;
    balancePeak = balancePeak > running ? balancePeak : running;
    return {
      atMillis,
      balancePeak,
      maximumPossible: previous + sum(values.filter((v) => v > 0n)),
      id: group
        .map((t) => t.id)
        .sort()
        .join("|"),
      at: group[0]!.exitAt!,
      day: group[0]!.tradingDay,
      value: running,
      net,
      negative,
      minimumPossible: previous + negative,
      mixed: values.some((v) => v < 0n) && values.some((v) => v > 0n),
    };
  });
  const conflicts: typeof observations = [];
  const seenObservations = new Map<string, string>();
  for (const o of observations)
    if (o.value !== null) {
      const key = JSON.stringify([
        o.kind,
        o.basis,
        o.currency,
        time(o.observedAt),
      ]);
      if (seenObservations.has(key) && seenObservations.get(key) !== o.value)
        conflicts.push(o);
      else seenObservations.set(key, o.value);
    }
  let ledgerAdjustment = 0n;
  const ledgerLevels = ledger.map((e) => ({
    atMillis: time(e.effectiveAt),
    adjustment: (ledgerAdjustment += e.affectsBalance ? money(e.amount) : 0n),
  }));
  if (baseline && complete)
    for (const observed of observations.filter(
      (o) =>
        ["balance", "eod_settlement"].includes(o.kind) &&
        o.basis === "balance" &&
        o.currency === input.account.currency &&
        o.value !== null &&
        time(o.observedAt) >= time(baseline.observedAt),
    )) {
      const prefix =
        lastAt(points, time(observed.observedAt), (p) => p.atMillis)?.value ??
        money(baseline.value!);
      const movements =
        lastAt(ledgerLevels, time(observed.observedAt), (e) => e.atMillis)
          ?.adjustment ?? 0n;
      if (prefix + movements !== money(observed.value!))
        missing.push("historical_checkpoint_conflict");
    }
  const currentBalances = observations.filter(
    (o) =>
      o.kind === "balance" &&
      time(o.observedAt) === time(input.asOf) &&
      o.value !== null &&
      o.currency === input.account.currency,
  );
  if (
    balance !== null &&
    currentBalances.some((o) => money(o.value!) !== balance)
  )
    missing.push("observed_derived_balance_conflict");
  if (conflicts.some((o) => ["balance", "opening_balance"].includes(o.kind)))
    missing.push("conflicting_observations");
  if (observations.some((o) => o.currency !== input.account.currency))
    missing.push("observation_currency_mismatch");
  if (
    observations.some(
      (o) =>
        o.timezone !== input.account.timezone ||
        o.tradingDayResetTime !== input.account.tradingDayResetTime,
    )
  )
    missing.push("session_context_changed");
  return {
    observations,
    baseline,
    trades,
    ledger,
    missing,
    balance,
    dayPnl,
    days,
    points,
    conflicts,
  };
}
type Context = ReturnType<typeof financialContext>;
function presenceOutcome(rule: RuleDefinition): RuleOutcomeState | null {
  const primary: Record<string, string> = {
    max_drawdown: "amount",
    profit_target: "amount",
    daily_loss_limit: "limit",
    consistency: "maxBestDayShare",
    min_trading_days: "days",
    max_position_size: "limits",
    max_trades_per_day: "count",
    payout_count_transition: "payoutsRequired",
    scaling_plan: "offered",
  };
  const p = rule.parameters as Record<string, unknown>;
  const v = p[primary[rule.ruleType] ?? ""];
  if (v && typeof v === "object" && "state" in v) {
    const state = (v as { state: string }).state;
    return state === "unknown"
      ? "unknown"
      : state === "explicit_none"
        ? "absent"
        : state === "disabled"
          ? "disabled"
          : state === "not_applicable"
            ? "not_applicable"
            : null;
  }
  return null;
}
function baseOutcome(
  rule: RuleDefinition,
  input: AccountRiskInputs,
): RuleOutcome {
  return {
    ruleId: rule.id,
    ruleKey: rule.ruleKey,
    ruleType: rule.ruleType,
    state: "unknown",
    reasonCode: "missing_inputs",
    metrics: {},
    operands: {},
    formula: "",
    sourceReferences: [],
    missingInputs: [],
    evidence: assessRuleEvidence(input, rule.ruleType, rule.parameters),
    assumptions: [
      "User-reported financial evidence; not an official broker compliance determination",
    ],
  };
}
function calculate(
  rule: RuleDefinition,
  out: RuleOutcome,
  c: Context,
  input: AccountRiskInputs,
  policy: EnginePolicy,
  phase: string,
): RuleOutcome {
  const set = (state: RuleOutcomeState, reason: string) => {
    out.state = state;
    out.reasonCode = reason;
    return out;
  };
  const absent = presenceOutcome(rule);
  if (
    absent &&
    rule.ruleType === "daily_loss_limit" &&
    rule.parameters.condition !== "always" &&
    absent !== "unknown"
  )
    return set("manual_only", "conditional_daily_absence_unresolved");
  if (absent) return set(absent, `rule_${absent}`);
  if (rule.supportStatus === "manual_only")
    return set("manual_only", "manual_rule_verification");
  if (rule.supportStatus === "unsupported")
    return set("unsupported", "unsupported_rule");
  if (rule.supportStatus !== "supported")
    return set("unknown", "rule_needs_setup");
  const bad = out.evidence.filter((e) => e.state !== "available");
  out.missingInputs = unique([...c.missing, ...bad.map((e) => e.requirement)]);
  const riskyMovement = c.ledger.some((e) => e.affectsBalance);
  const block = (): RuleOutcome | null => {
    if (c.missing.some((r) => r.includes("conflict")))
      return set("conflicting", c.missing.find((r) => r.includes("conflict"))!);
    if (c.missing.length) return set("unknown", c.missing[0]!);
    if (bad.some((e) => e.state === "conflicting"))
      return set("conflicting", "conflicting_evidence");
    if (bad.some((e) => e.state === "stale"))
      return set("stale", "stale_evidence");
    if (bad.length)
      return set(
        bad.some((e) => e.state === "unsupported")
          ? "unsupported"
          : bad.some((e) => e.state === "manual_verification")
            ? "manual_only"
            : "unknown",
        "insufficient_rule_evidence",
      );
    return null;
  };
  if (c.missing.length) return block()!;
  const threshold = (
    headroom: bigint,
    breach: boolean,
    normal = "satisfied",
  ) => {
    if (!isMicros(headroom)) return set("unsupported", "arithmetic_overflow");
    if (policy.boundary === null)
      return set("unknown", "missing_breach_boundary_policy");
    if (breach) return set("breached", "loss_threshold_breached");
    const caution =
      policy.personalCautionHeadroom === null
        ? null
        : money(policy.personalCautionHeadroom);
    if (caution !== null && headroom <= caution) {
      out.assumptions.push(
        "Caution threshold is a personal preference, not firm policy",
      );
      return set("caution", "personal_caution_buffer");
    }
    return set("satisfied", normal);
  };
  const crossed = (value: bigint, floor: bigint) =>
    policy.boundary === "touch_is_breach" ? value <= floor : value < floor;
  switch (rule.ruleType) {
    case "max_drawdown": {
      const p = rule.parameters;
      if (p.amount.state !== "value")
        return set("unknown", "missing_drawdown_amount");
      if (c.baseline === null || c.balance === null)
        return block() ?? set("unknown", "missing_balance");
      const amount = money(p.amount.value),
        opening = money(c.baseline.value!);
      if (amount < 0n) return set("unsupported", "negative_drawdown_amount");
      const kind =
        p.method === "end_of_day_trailing"
          ? "eod_settlement"
          : p.method === "intraday_trailing"
            ? "intraday_peak"
            : null;
      const basis = p.basis === "realized" ? "balance" : "equity";
      const history =
        kind === null
          ? []
          : c.observations.filter(
              (o) =>
                o.kind === kind &&
                o.basis === basis &&
                o.value !== null &&
                o.currency === input.account.currency &&
                o.confirmation === "user_confirmed" &&
                o.confidence === "user_reported" &&
                time(o.observedAt) >= time(c.baseline!.observedAt),
            );
      if (p.method === "unknown")
        return set("unsupported", "unknown_drawdown_method");
      if (kind !== null && c.conflicts.some((o) => o.kind === kind))
        return set("conflicting", "conflicting_trailing_reference_sources");
      if (kind !== null && !history.length)
        return set("unknown", "missing_peak_or_settlement_history");
      let runningHigh = opening;
      const historicalLevels = history.map((o) => {
        const value = money(o.value!);
        runningHigh = runningHigh > value ? runningHigh : value;
        return { atMillis: time(o.observedAt), high: runningHigh };
      });
      const referenceAt = (at: number) =>
        p.method === "static"
          ? p.lock.state === "value"
            ? (lastAt(c.points, at, (p) => p.atMillis)?.balancePeak ?? opening)
            : opening
          : (lastAt(historicalLevels, at, (p) => p.atMillis)?.high ?? opening);
      const high = referenceAt(time(input.asOf));
      let locked = false;
      const floorAt = (peak: bigint) => {
        if (
          p.lock.state === "value" &&
          peak >= money(p.lock.value.triggerBalance)
        ) {
          locked = true;
          return money(p.lock.value.lockedFloor);
        }
        return (p.method === "static" ? opening : peak) - amount;
      };
      if (p.lock.state === "unknown")
        return set("unknown", "unknown_lock_policy");
      if (
        p.lock.state === "value" &&
        (money(p.lock.value.lockedFloor) <
          (p.method === "static"
            ? opening
            : money(p.lock.value.triggerBalance)) -
            amount ||
          money(p.lock.value.lockedFloor) < opening - amount ||
          money(p.lock.value.lockedFloor) > money(p.lock.value.triggerBalance))
      )
        return set("unsupported", "nonmonotonic_lock_policy");
      const currentEquity = c.observations.filter(
        (o) =>
          o.kind === "equity" &&
          o.basis === "equity" &&
          o.currency === input.account.currency &&
          o.value !== null &&
          time(o.observedAt) === time(input.asOf) &&
          o.validUntil !== null &&
          time(o.validUntil) >= time(input.asOf) &&
          o.confirmation === "user_confirmed" &&
          o.confidence === "user_reported",
      );
      const floor = floorAt(high),
        balance =
          p.basis === "realized"
            ? c.balance
            : currentEquity.length === 1
              ? money(currentEquity[0]!.value!)
              : null;
      if (![high, floor].every(isMicros))
        return set("unsupported", "arithmetic_overflow");
      out.metrics = {
        highWaterMark: wire(high),
        drawdownFloor: wire(floor),
        drawdownHeadroom: balance === null ? null : wire(balance - floor),
        drawdownLocked: locked,
      };
      out.operands = {
        opening: wire(opening),
        amount: wire(amount),
        highWaterMark: wire(high),
      };
      out.formula =
        "floor = initial reference (static) or sourced high-water mark (trailing) minus amount, or sourced locked floor; headroom = comparable balance - floor";
      out.sourceReferences.push(...history.map((o) => o.id));
      const blocked = block();
      if (blocked) return blocked;
      if (riskyMovement)
        return set("manual_only", "ledger_effect_on_risk_floor_unspecified");
      if (p.basis !== "realized" || balance === null)
        return set("unsupported", "unobserved_equity_history");
      let historical = false,
        ambiguous = false;
      for (const point of c.points) {
        const ref = referenceAt(time(point.at));
        if (crossed(point.value, floorAt(ref))) historical = true;
        else if (point.mixed && crossed(point.minimumPossible, floorAt(ref)))
          ambiguous = true;
      }
      if (
        !historical &&
        p.method === "static" &&
        p.lock.state === "value" &&
        c.points.some(
          (point) =>
            point.mixed &&
            point.maximumPossible >=
              money(
                p.lock.state === "value" ? p.lock.value.triggerBalance : "0",
              ) &&
            point.balancePeak <
              money(
                p.lock.state === "value" ? p.lock.value.triggerBalance : "0",
              ),
        )
      )
        return set("unknown", "simultaneous_lock_trigger_order_unavailable");
      if (ambiguous && !historical && !crossed(balance, floor))
        return set("unknown", "simultaneous_close_order_unavailable");
      return threshold(balance - floor, historical || crossed(balance, floor));
    }
    case "daily_loss_limit": {
      const p = rule.parameters;
      if (p.limit.state !== "value")
        return set("unknown", "missing_daily_limit");
      if (p.resetBasis !== "account_trading_day" || p.basis !== "realized")
        return set("unsupported", "unsupported_daily_loss_basis_or_session");
      if (p.condition !== "always")
        return set("manual_only", "conditional_daily_loss_trigger_unmodeled");
      if (p.breach === "unknown")
        return set("unknown", "unknown_daily_breach_policy");
      const blocked = block();
      if (blocked) return blocked;
      if (riskyMovement)
        return set("manual_only", "ledger_effect_on_daily_loss_unspecified");
      if (c.dayPnl === null) return set("unknown", "missing_day_pnl");
      const limit = money(p.limit.value);
      if (limit < 0n) return set("unsupported", "negative_daily_limit");
      const remaining = limit + c.dayPnl;
      out.metrics = {
        dailyLossLimit: wire(limit),
        dailyLossRemaining: wire(remaining),
      };
      out.operands = { realizedDayPnl: wire(c.dayPnl), limit: wire(limit) };
      out.formula = "daily remaining = limit + net realized trading-day P&L";
      let running = 0n,
        breached = false;
      let ambiguous = false;
      const runningByDay = new Map<string, bigint>();
      for (const point of c.points) {
        running = runningByDay.get(point.day) ?? 0n;
        const minimumPossible = running + point.negative;
        running += point.net;
        runningByDay.set(point.day, running);
        if (p.breach === "hard" || point.day === input.effectiveTradingDay) {
          if (crossed(running, -limit)) breached = true;
          else if (point.mixed && crossed(minimumPossible, -limit))
            ambiguous = true;
        }
      }
      if (ambiguous && !breached)
        return set("unknown", "simultaneous_close_order_unavailable");
      if (p.breach === "soft" && breached)
        return set("breached", "sourced_soft_daily_limit_reached");
      return threshold(remaining, breached || crossed(c.dayPnl, -limit));
    }
    case "profit_target": {
      const p = rule.parameters;
      if (p.amount.state !== "value") return set("unknown", "missing_target");
      const blocked = block();
      if (blocked) return blocked;
      if (riskyMovement)
        return set("manual_only", "ledger_effect_on_target_unspecified");
      if (p.basis !== "balance" || c.balance === null || !c.baseline)
        return set("unsupported", "unsupported_target_basis");
      const target = money(p.amount.value),
        profit = c.balance - money(c.baseline.value!);
      if (target < 0n) return set("unsupported", "negative_profit_target");
      out.metrics = {
        profitTarget: wire(target),
        profit: wire(profit),
        remaining: wire(profit >= target ? 0n : target - profit),
        attained: profit >= target,
      };
      out.operands = { target: wire(target), profit: wire(profit) };
      out.formula =
        "profit = qualified balance - opening baseline; remaining = max(target - profit, 0)";
      return set(
        "satisfied",
        profit >= target
          ? "profit_target_attained"
          : "profit_target_in_progress",
      );
    }
    case "min_trading_days": {
      const p = rule.parameters;
      if (p.days.state !== "value" || p.minDayProfit.state === "unknown")
        return set("unknown", "missing_qualifying_day_threshold");
      if (p.dayBasis !== "trading_day")
        return set("unsupported", "unsupported_calendar_day_semantics");
      const blocked = block();
      if (blocked) return blocked;
      const thresholdValue =
        p.minDayProfit.state === "value" ? money(p.minDayProfit.value) : null;
      if (thresholdValue !== null && thresholdValue < 0n)
        return set("unsupported", "negative_qualifying_day_threshold");
      const completed = [...c.days.values()].filter(
        (v) => thresholdValue === null || v >= thresholdValue,
      ).length;
      out.metrics = {
        tradingDaysCompleted: completed,
        tradingDaysRequired: p.days.value,
        attained: completed >= p.days.value,
      };
      out.formula =
        "count distinct Rust-derived trading days meeting the sourced minimum daily net P&L";
      return set(
        "satisfied",
        completed >= p.days.value
          ? "minimum_days_attained"
          : "minimum_days_in_progress",
      );
    }
    case "consistency": {
      const p = rule.parameters;
      if (p.maxBestDayShare.state !== "value")
        return set("unknown", "missing_consistency_share");
      if (p.appliesTo === "unknown" || p.denominator === "unknown")
        return set("unknown", "unknown_consistency_basis");
      if (p.appliesTo === "payout")
        return set("manual_only", "payout_cycle_not_modeled");
      // An unrecorded phase is not "outside the evaluation": it must not pass as not applicable.
      if (phase === "unknown")
        return set("unknown", "unknown_account_phase");
      if (p.appliesTo === "evaluation" && phase !== "evaluation")
        return set("not_applicable", "evaluation_consistency_outside_phase");
      if (p.appliesTo === "both" && phase !== "evaluation")
        return set("manual_only", "payout_cycle_not_modeled");
      const blocked = block();
      if (blocked) return blocked;
      const best = maximum([0n, ...c.days.values()]);
      let denominator = sum([...c.days.values()]);
      if (p.denominator === "profit_target") {
        const targets =
          input.rulebookVersions
            .find(
              (v) =>
                v.version.id === input.applicableAssignment?.rulebookVersionId,
            )
            ?.rules.filter(
              (r) =>
                r.ruleType === "profit_target" &&
                r.parameters.amount.state === "value",
            ) ?? [];
        if (targets.length !== 1)
          return set("unknown", "ambiguous_or_missing_profit_target_reference");
        const target = targets[0]!;
        if (
          target.ruleType !== "profit_target" ||
          target.parameters.amount.state !== "value"
        )
          return set("unknown", "missing_profit_target_reference");
        denominator = money(target.parameters.amount.value);
        out.sourceReferences.push(target.id);
      }
      if (denominator <= 0n)
        return set("unknown", "nonpositive_consistency_denominator");
      const [whole, fraction = ""] = p.maxBestDayShare.value.split(".");
      const scale = 10n ** BigInt(fraction.length),
        share = BigInt(whole! + fraction);
      if (share <= 0n || share > scale)
        return set("unsupported", "consistency_share_out_of_range");
      out.metrics = {
        bestDayProfit: wire(best),
        denominator: wire(denominator),
        attained: best * scale <= denominator * share,
      };
      out.operands = {
        bestDayProfit: wire(best),
        denominator: wire(denominator),
      };
      out.formula =
        "bestDayProfit × shareScale <= denominator × sourcedMaxShare (exact cross multiplication)";
      return set(
        best * scale <= denominator * share ? "satisfied" : "caution",
        best * scale <= denominator * share
          ? "consistency_met"
          : "consistency_needs_more_profit",
      );
    }
    case "max_position_size":
      return set(
        "unsupported",
        rule.parameters.combination === "unknown"
          ? "unknown_position_equivalency"
          : "missing_concurrent_execution_history",
      );
    case "max_trades_per_day":
      return set("unsupported", "closed_round_trips_are_not_execution_counts");
    case "payout_eligibility": {
      const p = rule.parameters;
      if (c.balance !== null && p.minBalance.state === "value")
        out.metrics.minimumBalanceAttained =
          c.balance >= money(p.minBalance.value);
      if (c.balance !== null && c.baseline && p.minProfit.state === "value")
        out.metrics.minimumProfitAttained =
          c.balance - money(c.baseline.value!) >= money(p.minProfit.value);
      out.formula =
        "supported subconditions compare sourced minimum balance/profit; waiting-day and cycle semantics remain manual";
      return set(
        "manual_only",
        "payout_waiting_day_and_cycle_semantics_unspecified",
      );
    }
    case "payout_count_transition":
      out.metrics.recordedPayoutMovements = c.ledger.filter(
        (e) => e.kind === "payout",
      ).length;
      return set(
        "manual_only",
        "ledger_movements_do_not_prove_qualifying_payout_count",
      );
    case "scaling_plan":
      return set(
        "manual_only",
        rule.parameters.schedule.state === "unknown"
          ? "unspecified_scaling_schedule"
          : "missing_concurrent_position_history",
      );
    case "trading_restriction":
      return set("manual_only", "manual_trading_restriction");
    case "manual_check":
      return set("manual_only", "manual_rule_verification");
    case "unknown":
      return set("unknown", "unknown_rule_family");
    default: {
      const exhaustive: never = rule;
      return exhaustive;
    }
  }
}

/** Pure source-aware rule evaluation. Validation errors reject; unavailable facts produce Unknown. */
export function evaluateAccountRisk(
  raw: AccountRiskInputs,
  rawPolicy: EnginePolicy = defaultEnginePolicy,
): EngineResult {
  const input = accountRiskInputsSchema.parse(raw),
    policy = enginePolicySchema.parse(rawPolicy);
  const applicability = resolveEngineApplicability(input),
    { assignment, detail } = applicability;
  const reasons = [...applicability.reasons];
  const references = unique([
    ...policy.reconciliationRevisionIds,
    ...input.observations.flatMap((o) => [o.id, o.sourceReference]),
    ...input.trades.flatMap((t) => [
      t.id,
      ...(t.importBatchId ? [t.importBatchId] : []),
    ]),
    ...input.ledger.map((e) => e.id),
    ...input.ledgerHistory.map((e) => e.id),
    ...input.phaseHistory.map((e) => e.id),
  ]);
  let c: Context;
  try {
    c = financialContext(input);
  } catch {
    c = {
      observations: [],
      baseline: null,
      trades: [],
      ledger: [],
      missing: ["invalid_or_overflowing_financial_record"],
      balance: null,
      dayPnl: null,
      days: new Map(),
      points: [],
      conflicts: [],
    };
  }
  reasons.push(...c.missing);
  if (
    (c.balance !== null && !isMicros(c.balance)) ||
    (c.dayPnl !== null && !isMicros(c.dayPnl))
  )
    reasons.push("financial_aggregate_overflow");
  if (
    input.ledgerHistory.some(
      (h) => h.entry.accountId !== input.account.id || h.entryId !== h.entry.id,
    )
  )
    reasons.push("foreign_or_inconsistent_ledger_revision");
  if (
    input.rulebookVersions.some(
      (v) =>
        !input.assignments.some((a) => a.rulebookVersionId === v.version.id),
    )
  )
    reasons.push("unassigned_rulebook_in_input");
  if (
    new Set(input.trades.map((t) => t.id)).size !== input.trades.length ||
    new Set(input.observations.map((o) => o.id)).size !==
      input.observations.length ||
    new Set(input.ledger.map((e) => e.id)).size !== input.ledger.length
  )
    reasons.push("duplicate_financial_record_id");
  if (input.account.status !== "active" || input.account.archivedAt !== null)
    reasons.push("historical_or_inactive_account");
  if (input.coverage.closedTrades !== "available")
    reasons.push("incomplete_trade_history");
  if (
    input.missingInputs.some(
      (x) =>
        ![
          "openPositions",
          "intradayHistory",
          "eodHistory",
          "rulebook_assignment",
        ].includes(x),
    )
  )
    reasons.push(...input.missingInputs);
  const rules = (detail?.rules ?? [])
    .slice()
    .sort(
      (a, b) => compareText(a.ruleKey, b.ruleKey) || compareText(a.id, b.id),
    )
    .map((rule) => {
      let out = baseOutcome(rule, input);
      const claims = detail!.claims.filter(
        (c) => c.ruleDefinitionId === rule.id,
      );
      out.sourceReferences = unique([
        ...references,
        ...claims.flatMap((c) => [c.id, c.sourceId]),
      ]);
      if (claims.some((c) => c.claimStatus === "conflicting")) {
        out.state = "conflicting";
        out.reasonCode = "conflicting_rule_claims";
        return out;
      }
      if (claims.some((c) => c.claimStatus === "stale")) {
        out.state = "stale";
        out.reasonCode = "stale_rule_claims";
        return out;
      }
      if (applicability.reasons.length) {
        out.reasonCode = applicability.reasons[0]!;
        return out;
      }
      const verified = claims.filter(
        (c) =>
          c.claimStatus === "verified" &&
          c.reviewedBy !== null &&
          c.reviewedAt !== null &&
          c.origin === "provider_stated",
      );
      if (
        applicability.providerVerified &&
        !unique([
          ...requiredValues[rule.ruleType],
          ...Object.keys(rule.parameters),
        ]).every((field) =>
          verified.some(
            (c) =>
              c.field === null ||
              c.field === field ||
              c.field === `parameters.${field}`,
          ),
        )
      ) {
        out.reasonCode = "unverified_parameter_claims";
        return out;
      }
      if (
        detail!.rulebook.ownerAccountId !== null &&
        detail!.version.userConfirmedAt === null
      ) {
        out.reasonCode = "unconfirmed_private_rulebook";
        return out;
      }
      const monetary =
        [
          "max_drawdown",
          "profit_target",
          "daily_loss_limit",
          "payout_eligibility",
          "scaling_plan",
        ].includes(rule.ruleType) ||
        (rule.ruleType === "min_trading_days" &&
          rule.parameters.minDayProfit.state === "value");
      if (
        monetary &&
        presenceOutcome(rule) === null &&
        (policy.ruleCurrency !== input.account.currency ||
          (applicability.providerVerified &&
            !policy.ruleCurrencySourceClaimIds.some((id) =>
              verified.some(
                (c) =>
                  c.id === id && (c.field === null || c.field === "currency"),
              ),
            )))
      ) {
        out.reasonCode = "unresolved_or_mismatched_rule_currency";
        return out;
      }
      try {
        out = calculate(rule, out, c, input, policy, applicability.phaseKey);
      } catch {
        out.state = "unsupported";
        out.reasonCode = "arithmetic_overflow_or_invalid_financial_value";
        out.metrics = {};
        out.operands = {};
      }
      if (
        ["max_drawdown", "daily_loss_limit"].includes(rule.ruleType) &&
        policy.boundary !== null &&
        applicability.providerVerified &&
        !policy.boundarySourceClaimIds.some((id) =>
          verified.some(
            (c) =>
              c.id === id &&
              (c.field === null || c.field === "breach_boundary"),
          ),
        )
      ) {
        out.state = "unknown";
        out.reasonCode = "unsourced_breach_boundary";
      }
      const prior = policy.priorBreaches.find(
        (p) =>
          p.accountId === input.account.id &&
          p.assignmentId === assignment?.id &&
          p.rulebookVersionId === detail!.version.id &&
          p.ruleKey === rule.ruleKey &&
          time(p.observedAt) <= time(input.asOf) &&
          p.sourceReferences.every((id) => out.sourceReferences.includes(id)),
      );
      if (prior && out.state !== "conflicting" && out.state !== "stale") {
        out.state = "breached";
        out.reasonCode = "known_prior_breach_persists";
      }
      if (rule.overrideKind === "personal_limit" && out.state === "breached") {
        out.state = "caution";
        out.reasonCode = "personal_limit_exceeded";
      }
      return out;
    });
  if (
    !rules.length ||
    rules.every((r) =>
      ["absent", "disabled", "not_applicable"].includes(r.state),
    )
  )
    reasons.push("no_material_evaluable_rules");
  if (
    policy.priorBreaches.some(
      (p) =>
        p.accountId === input.account.id &&
        time(p.observedAt) <= time(input.asOf) &&
        (p.assignmentId !== assignment?.id ||
          p.rulebookVersionId !== detail?.version.id),
    )
  )
    reasons.push("historical_breach_requires_version_policy_review");
  if (
    policy.priorBreaches.some(
      (p) =>
        p.accountId === input.account.id &&
        time(p.observedAt) <= time(input.asOf) &&
        p.sourceReferences.some((id) => !references.includes(id)),
    )
  )
    reasons.push("prior_breach_source_requires_review");
  const passed = new Set<RuleOutcomeState>([
    "satisfied",
    "absent",
    "disabled",
    "not_applicable",
  ]);
  const confirmedBreach =
    applicability.reasons.length === 0 &&
    rules.some((r) => r.state === "breached");
  const indeterminate =
    reasons.length > 0 ||
    rules.some((r) => !passed.has(r.state) && r.state !== "caution");
  const status = confirmedBreach
    ? "Stop"
    : indeterminate
      ? "Unknown"
      : rules.some((r) => r.state === "caution")
        ? "Caution"
        : "Safe";
  const timestamps = [
    ...c.observations.map((o) => o.observedAt),
    ...c.trades.map((t) => t.exitAt!),
    ...c.ledger.map((e) => e.effectiveAt),
  ].sort((a, b) => time(a) - time(b));
  const hash = engineSha256(
    canonicalEngineJson({ engineVersion: ENGINE_VERSION, input, policy }),
  );
  return engineResultSchema.parse({
    accountId: input.account.id,
    rulebookVersionId: detail?.version.id ?? null,
    assignmentId: assignment?.id ?? null,
    programmePhaseId: assignment?.programmePhaseId ?? null,
    phasePathId: assignment?.phasePathId ?? null,
    engineVersion: ENGINE_VERSION,
    tradingDay: input.effectiveTradingDay,
    asOf: input.asOf,
    dataAsOf: timestamps.at(-1) ?? null,
    inputsHash: hash,
    status,
    assurance: detail?.rulebook.ownerAccountId
      ? "user_defined_estimate"
      : applicability.providerVerified
        ? "user_reported_estimate"
        : "unverified",
    reasons: unique([
      ...reasons,
      ...rules.filter((r) => !passed.has(r.state)).map((r) => r.reasonCode),
    ]),
    rules,
    balance:
      c.missing.length === 0 && c.balance !== null && isMicros(c.balance)
        ? wire(c.balance)
        : null,
    tradingDaysCompleted:
      input.coverage.closedTrades === "available" &&
      input.coverage.fees === "available" &&
      c.missing.length === 0
        ? c.days.size
        : null,
    realizedDayPnl:
      c.dayPnl !== null && isMicros(c.dayPnl) ? wire(c.dayPnl) : null,
    sourceReferences: references,
    assumptions: [
      "Rust-normalized net realized P&L already includes fees",
      "Coverage, checkpoints and actor labels are user-reported",
      "Closed round trips do not establish live equity, execution counts or intraday peak history",
    ],
  });
}

/** Cache guard against freshly fetched canonical inputs; it does not fetch or certify freshness itself. */
export function isEngineResultCurrent(
  result: EngineResult,
  input: AccountRiskInputs,
  policy: EnginePolicy,
): boolean {
  try {
    return (
      result.engineVersion === ENGINE_VERSION &&
      result.accountId === input.account.id &&
      result.inputsHash === evaluateAccountRisk(input, policy).inputsHash
    );
  } catch {
    return false;
  }
}
