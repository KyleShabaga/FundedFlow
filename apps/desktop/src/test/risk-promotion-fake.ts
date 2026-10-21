// TEST ONLY. The P0-02 promotion contract for the in-memory journals, mirroring
// src-tauri/src/store/risk_promotion.rs: capture reads the canonical inputs, reconciliation revisions and prior-breach
// history together; promote re-captures for the calculation's own cutoff and coverage and refuses (a `conflict`
// RepositoryError, nothing stored) unless they equal what it froze, or if a still-eligible current result has a later
// cutoff; current/freshness re-check on every read. The fakes are single-threaded, so "one database state" is
// trivially true here; native snapshot isolation and BEGIN IMMEDIATE are proven by the Rust tests.
import {
  RepositoryError,
  canonicalEngineJson,
  type AccountRiskInputs,
  type CurrentRisk,
  type EnginePolicy,
  type Reconciliation,
  type ReconciliationResolution,
  type RiskCapture,
  type RiskInputsQuery,
  type Snapshot,
  type SnapshotFreshness,
  type SnapshotInput,
} from "@fundedflow/domain";

interface Sources {
  evidence: {
    inputs(query: RiskInputsQuery): Promise<AccountRiskInputs>;
    reconciliations?(accountId: string): Promise<Reconciliation[]>;
    resolutions?(id: string): Promise<ReconciliationResolution[]>;
  };
  snapshots: { save(input: SnapshotInput): Promise<Snapshot> };
}

type Breach = EnginePolicy["priorBreaches"][number];

const isEngine = (s: { engineVersion: string; explanation: Record<string, unknown> }) =>
  s.engineVersion.startsWith("fundedflow-risk/") && typeof s.explanation.engine === "object" && s.explanation.engine !== null
  && typeof s.explanation.policy === "object" && s.explanation.policy !== null;

function priorBreaches(stored: readonly Snapshot[], accountId: string, exclude: string | null): Breach[] {
  const ordered = [...stored].filter(s => s.accountId === accountId && s.id !== exclude)
    .sort((a, b) => (a.tradingDay !== b.tradingDay ? (a.tradingDay < b.tradingDay ? 1 : -1) : a.calculatedAt !== b.calculatedAt ? (a.calculatedAt < b.calculatedAt ? 1 : -1) : a.id < b.id ? -1 : 1));
  const out = new Map<string, Breach>();
  for (const s of ordered) {
    if (!isEngine(s)) continue;
    const r = s.explanation.engine as { accountId?: string; rulebookVersionId?: string | null; assignmentId?: string | null; asOf?: string;
      rules?: { state: string; ruleKey: string; sourceReferences: string[] }[] };
    if (r.accountId !== accountId || !r.rulebookVersionId || !r.assignmentId || !r.asOf) continue;
    for (const rule of r.rules ?? []) {
      const key = `${r.assignmentId}|${rule.ruleKey}`;
      if (rule.state !== "breached" || rule.sourceReferences.length === 0 || out.has(key)) continue;
      out.set(key, { accountId, rulebookVersionId: r.rulebookVersionId, assignmentId: r.assignmentId, ruleKey: rule.ruleKey, observedAt: r.asOf, sourceReferences: [...rule.sourceReferences] });
    }
  }
  return [...out.values()];
}

const print = (inputs: unknown, revisions: unknown, breaches: unknown) => canonicalEngineJson({ inputs, priorBreaches: breaches, reconciliationRevisionIds: revisions });
const conflict = (message: string) => new RepositoryError({ kind: "conflict", message });

/** Adds `evidence.capture` and `snapshots.promote/current/freshness` over a fake's own reads and stored snapshots. */
export function attachRiskPromotion(repository: Sources, stored: () => readonly Snapshot[]) {
  const promotions: { accountId: string; snapshotId: string; promotedAt: string }[] = [];

  async function captureExcluding(query: RiskInputsQuery, exclude: string | null): Promise<RiskCapture> {
    const inputs = structuredClone(await repository.evidence.inputs(query));
    const reviews = (await repository.evidence.reconciliations?.(query.accountId)) ?? [];
    const revisions: string[] = [];
    for (const r of reviews) {
      revisions.push(r.id);
      for (const x of (await repository.evidence.resolutions?.(r.id)) ?? []) revisions.push(x.id);
    }
    const superseded = new Set(inputs.observations.map(o => o.supersedesId));
    const latest = new Map<string, Reconciliation>();
    for (const r of reviews)
      if (r.accountId === query.accountId && !superseded.has(r.observation.id) && Date.parse(r.request.asOf) <= Date.parse(query.asOf)) latest.set(r.observation.id, r);
    for (const r of latest.values())
      if (r.result.reconciliationStatus !== "matched") inputs.missingInputs.push(`reconciliation_review:${r.id}:${r.result.reconciliationStatus}`);
    const reconciliationRevisionIds = [...new Set(revisions)].sort();
    const breaches = priorBreaches(stored(), query.accountId, exclude);
    return { inputs, reconciliationRevisionIds, priorBreaches: breaches, sourceFingerprint: print(inputs, reconciliationRevisionIds, breaches) };
  }

  const frozen = (s: Pick<Snapshot, "engineVersion" | "explanation">) => {
    if (!isEngine(s)) return null;
    const inputs = s.explanation.inputs as AccountRiskInputs;
    const policy = s.explanation.policy as EnginePolicy;
    return { query: { accountId: inputs.account.id, asOf: inputs.asOf, coverage: inputs.coverage } as RiskInputsQuery,
      print: print(inputs, policy.reconciliationRevisionIds, policy.priorBreaches), asOf: inputs.asOf };
  };

  async function unchanged(s: Snapshot): Promise<boolean | null> {
    const f = frozen(s);
    if (!f) return null;
    return (await captureExcluding(f.query, s.id)).sourceFingerprint === f.print;
  }

  async function current(accountId: string): Promise<CurrentRisk> {
    const last = promotions.filter(p => p.accountId === accountId).slice(-1)[0];
    const snapshot = last ? stored().find(s => s.id === last.snapshotId) ?? null : null;
    if (!last || !snapshot) return { snapshot: null, promotedAt: null, sourcesUnchanged: null };
    return { snapshot: structuredClone(snapshot), promotedAt: last.promotedAt, sourcesUnchanged: await unchanged(snapshot) };
  }

  Object.assign(repository.evidence, { capture: (query: RiskInputsQuery) => captureExcluding(query, null) });
  Object.assign(repository.snapshots, {
    promote: async (input: SnapshotInput): Promise<Snapshot> => {
      const f = frozen(input as Snapshot);
      if (!f) throw new RepositoryError({ kind: "validation", message: "only an engine calculation can become current", issues: [{ field: "engineVersion", message: "must be an engine calculation" }] });
      if ((await captureExcluding(f.query, null)).sourceFingerprint !== f.print) throw conflict("the records this calculation used changed before it was saved; nothing was saved");
      const now = await current(f.query.accountId);
      if (now.snapshot && now.sourcesUnchanged && Date.parse((now.snapshot.explanation.inputs as AccountRiskInputs).asOf) > Date.parse(f.asOf))
        throw conflict("a calculation with a later cutoff is current; nothing was saved");
      const saved = await repository.snapshots.save(input);
      promotions.push({ accountId: saved.accountId, snapshotId: saved.id, promotedAt: saved.calculatedAt });
      return saved;
    },
    current,
    freshness: async (snapshotId: string): Promise<SnapshotFreshness> => {
      const s = stored().find(x => x.id === snapshotId);
      if (!s) throw new RepositoryError({ kind: "notFound", message: "snapshot" });
      return { snapshotId, sourcesUnchanged: await unchanged(s) };
    },
  });
  return { promotions };
}
