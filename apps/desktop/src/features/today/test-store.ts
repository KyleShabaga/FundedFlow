// TEST ONLY. The Build 19 in-memory store (accounts, rulebooks, snapshots, canonical inputs) plus what Today reads:
// trades, import history, financial observations and frozen comparisons, following the Rust rules for those
// (src-tauri/src/store/evidence.rs: account-scoped, append-only, exact comparison via the shared domain function).
// Synthetic data only; native persistence is covered by the Rust evidence and snapshot tests.
import {
  calculateRiskSnapshot,
  compareFinancialEvidence,
  defaultEnginePolicy,
  evaluateAccountRisk,
  RepositoryError,
  type Account,
  type EngineResult,
  type FinancialObservation,
  type ImportBatch,
  type ObservationInput,
  type Reconciliation,
  type ReconciliationRequest,
  type RiskInputsQuery,
  type Snapshot,
} from "@fundedflow/domain";
import { loadRiskCalculation } from "../../lib/data/calculate-risk";
import { createRulebookStore } from "../rulebooks/test-store";
import { createDailyReviewFake } from "../daily-reviews/test-store";

export function createTodayStore(seed: Account[], options: { syntheticOpening?: boolean } = {}) {
  const base = createRulebookStore(seed);
  const observations: FinancialObservation[] = [];
  const reconciliations: Reconciliation[] = [];
  const imports = new Map<string, ImportBatch[]>();
  /** Reads that should fail, by repository method name. */
  const failing = new Set<string>();
  let next = 1;
  let clock = Date.parse("2026-10-21T16:00:00.000Z");
  const recorded = () => new Date((clock += 1000)).toISOString();
  const guard = (name: string) => { if (failing.has(name)) throw new RepositoryError({ kind: "database", message: `${name} failed` }); };
  const mine = (accountId: string) => observations.filter(o => o.accountId === accountId);

  const evidence = {
    ...base.repository.evidence,
    inputs: async (q: RiskInputsQuery) => {
      guard("inputs");
      const inputs = await base.repository.evidence.inputs(q);
      const own = mine(q.accountId).filter(o => Date.parse(o.observedAt) <= Date.parse(q.asOf));
      return { ...inputs, observations: [...(options.syntheticOpening === false ? [] : inputs.observations), ...structuredClone(own)] };
    },
    list: async (accountId: string) => { guard("observations"); return structuredClone(mine(accountId)); },
    create: async (input: ObservationInput) => {
      const account = base.accounts.get(input.accountId);
      if (!account) throw new RepositoryError({ kind: "notFound", message: "account" });
      if (account.archivedAt) throw new RepositoryError({ kind: "validation", message: "archived", issues: [{ field: "accountId", message: "Archived attempts are read-only" }] });
      const row: FinancialObservation = {
        ...structuredClone(input), id: `obs-${next++}`, recordedAt: recorded(), effectiveTradingDay: input.observedAt.slice(0, 10),
        timezone: account.timezone, tradingDayResetTime: account.tradingDayResetTime, supersedesId: null, correctionReason: null,
      };
      observations.push(row);
      return structuredClone(row);
    },
    reconcile: async (request: ReconciliationRequest) => {
      const observation = observations.find(o => o.id === request.observationId && o.accountId === request.accountId);
      const baseline = observations.find(o => o.id === request.baselineObservationId && o.accountId === request.accountId);
      if (!observation || !baseline) throw new RepositoryError({ kind: "notFound", message: "observation" });
      const trades = structuredClone(base.trades.get(request.accountId) ?? []);
      const superseded = observations.filter(o => o.supersedesId).map(o => o.supersedesId!);
      const result = compareFinancialEvidence(request, observation, baseline, trades, [], superseded, mine(request.accountId));
      const row: Reconciliation = {
        id: `rec-${next++}`, accountId: request.accountId, recordedAt: recorded(), request: structuredClone(request), observation: structuredClone(observation),
        baseline: structuredClone(baseline), trades, ledger: [], ledgerHistory: [], result, supersededIds: superseded, observations: structuredClone(mine(request.accountId)),
      };
      reconciliations.push(row);
      return structuredClone(row);
    },
    reconciliations: async (accountId: string) => { guard("reconciliations"); return structuredClone(reconciliations.filter(r => r.accountId === accountId)); },
    resolutions: async () => [],
  };
  const daily = createDailyReviewFake({ account: id => base.accounts.get(id), trades: id => base.trades.get(id) ?? [] }, { currentDay: "2026-10-21" });
  const repository = {
    ...base.repository,
    evidence,
    dailyReviews: daily.repository,
    snapshots: {
      ...base.repository.snapshots,
      latest: async (accountId: string) => { guard("latest"); return base.repository.snapshots.latest(accountId); },
    },
    trades: {
      list: async (accountId: string) => { guard("trades"); return structuredClone([...(base.trades.get(accountId) ?? [])].sort((a, b) => (a.entryAt < b.entryAt ? 1 : -1))); },
    },
    imports: { list: async (accountId: string) => structuredClone(imports.get(accountId) ?? []) },
  };

  /**
   * Saves a snapshot whose inputs hash is the real engine's for these records (so the unchanged-inputs check is
   * genuine), with the engine's verdict replaced by `verdict`: a fixture of what Build 16 might say, for the screen.
   */
  async function saveEstimate(accountId: string, asOf: string, verdict: (r: EngineResult) => EngineResult, coverage: Partial<RiskInputsQuery["coverage"]> = {}): Promise<Snapshot> {
    const query: RiskInputsQuery = {
      accountId, asOf,
      coverage: { baseline: "available", eodHistory: "available", closedTrades: "available", fees: "available", ledger: "available",
        openPositions: "unsupported", intradayHistory: "unsupported", sourceReference: "Test coverage statement", ...coverage },
    };
    const loaded = await loadRiskCalculation(repository as never, query, defaultEnginePolicy);
    const real = evaluateAccountRisk(loaded.inputs, loaded.policy);
    const engine = verdict(structuredClone(real));
    const input = calculateRiskSnapshot(loaded.inputs, loaded.policy, false);
    return base.repository.snapshots.save({
      ...input, status: engine.status.toLowerCase() as Snapshot["status"], statusReasons: engine.reasons.length ? engine.reasons : engine.status === "Unknown" ? ["fixture"] : [],
      balance: engine.balance, explanation: { ...input.explanation, engine },
    });
  }

  return { ...base, repository, observations, reconciliations, imports, failing, saveEstimate, daily };
}

/** A Build 16-shaped drawdown outcome for fixtures: the values are what the screen must show, never compute. */
export function drawdownOutcome(over: Partial<EngineResult["rules"][number]> & { headroom: string | null; floor?: string }): EngineResult["rules"][number] {
  const { headroom, floor = "48000", ...rest } = over;
  return {
    ruleId: "rule-dd", ruleKey: "max_drawdown", ruleType: "max_drawdown", state: "satisfied", reasonCode: "within_limit",
    metrics: { highWaterMark: "50000", drawdownFloor: floor, drawdownHeadroom: headroom, drawdownLocked: false },
    formula: "floor = initial reference (static) minus amount; headroom = comparable balance - floor",
    operands: { opening: "50000", amount: "2000", highWaterMark: "50000" }, sourceReferences: [], missingInputs: [], evidence: [], assumptions: [], ...rest,
  };
}
