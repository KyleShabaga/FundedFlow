import {
  snapshotInputSchema,
  type SnapshotInput,
} from "../contracts/snapshots.js";
import {
  accountRiskInputsSchema,
  type AccountRiskInputs,
} from "../risk/contracts.js";
import { enginePolicySchema, type EnginePolicy } from "./contracts.js";
import { evaluateAccountRisk } from "./evaluate.js";
import { canonicalEngineJson } from "./canonical.js";
/** Pure mapper. The existing host/repository performs the eventual native write. */
export function calculateRiskSnapshot(
  input: AccountRiskInputs,
  policy: EnginePolicy,
  isEndOfDay: boolean,
): SnapshotInput {
  input = accountRiskInputsSchema.parse(input);
  policy = enginePolicySchema.parse(policy);
  const result = evaluateAccountRisk(input, policy);
  const csv = input.trades.some((t) => t.source === "csv_import");
  const manual =
    input.observations.length > 0 ||
    input.ledger.length > 0 ||
    input.trades.some((t) => t.source === "manual");
  const one = (field: string) => {
    const values = result.rules
      .filter((r) => ["satisfied", "breached", "caution"].includes(r.state))
      .map((r) => r.metrics[field])
      .filter((v) => v !== undefined && v !== null);
    return values.length === 1 ? values[0] : null;
  };
  return snapshotInputSchema.parse({
    accountId: result.accountId,
    rulebookVersionId: result.rulebookVersionId,
    tradingDay: result.tradingDay,
    isEndOfDay,
    dataAsOf: result.dataAsOf,
    dataSource: csv
      ? manual
        ? "mixed"
        : "csv_import"
      : manual
        ? "manual"
        : "none",
    engineVersion: result.engineVersion,
    inputsHash: result.inputsHash,
    feesIncluded: input.coverage.fees === "available",
    unrealizedIncluded: false,
    balance: result.balance,
    realizedDayPnl: result.realizedDayPnl,
    unrealizedPnl: null,
    dailyLossLimit: one("dailyLossLimit"),
    dailyLossRemaining: one("dailyLossRemaining"),
    drawdownMode: result.rules.some((r) => r.ruleType === "max_drawdown")
      ? ({
          static: "static",
          end_of_day_trailing: "eod_trailing",
          intraday_trailing: "intraday_trailing",
        }[
          String(
            input.rulebookVersions
              .find((v) => v.version.id === result.rulebookVersionId)
              ?.rules.find((r) => r.ruleType === "max_drawdown")?.parameters
              .method,
          )
        ] ?? null)
      : null,
    highWaterMark: one("highWaterMark"),
    drawdownFloor: one("drawdownFloor"),
    drawdownHeadroom: one("drawdownHeadroom"),
    drawdownLocked: one("drawdownLocked"),
    profitTarget: one("profitTarget"),
    tradingDaysCompleted: result.tradingDaysCompleted,
    tradingDaysRequired: one("tradingDaysRequired"),
    status: result.status.toLowerCase(),
    statusReasons: result.reasons,
    explanation: {
      engine: result,
      inputs: JSON.parse(canonicalEngineJson(input)),
      policy: JSON.parse(canonicalEngineJson(policy)),
      recalculation:
        "New source/correction/version/as-of/policy changes inputsHash; preserve older rows",
    },
  });
}
