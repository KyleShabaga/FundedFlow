// TEST ONLY. An in-memory stand-in for the account parts of JournalRepository, following the Rust
// rules the Build 15 screens rely on (status changes, archive/restore conflicts, atomic resets).
// Synthetic data only; never imported by production code.
import {
  RepositoryError,
  type Account,
  type AccountHistory,
  type AccountInput,
  type AttemptLink,
  type AttemptSummary,
  type ResetInput,
  type StatusChangeInput,
} from "@fundedflow/domain";

export const T = "2026-10-20T15:00:00.000Z";

export function makeAccount(over: Partial<Account> & Pick<Account, "id" | "name">): Account {
  return {
    broker: null, propFirm: null, externalRef: null, accountType: "evaluation", status: "active", currency: "USD",
    startingBalance: "50000", timezone: "America/New_York", tradingDayResetTime: "17:00", notes: null,
    createdAt: T, updatedAt: T, archivedAt: null, predecessorAccountId: null, successorAccountId: null, ...over,
  };
}

const invalid = (field: string, message: string) => new RepositoryError({ kind: "validation", message, issues: [{ field, message }] });

export function createTestStore(seed: Account[] = []) {
  const accounts = new Map(seed.map(a => [a.id, { ...a }]));
  const history = new Map<string, AccountHistory>(seed.map(a => [a.id, { statusEvents: [{ status: a.status, effectiveAt: T, cause: null, note: null, recordedAt: T }], archiveEvents: [] }]));
  const links: AttemptLink[] = [];
  const settings = new Map<string, unknown>();
  const tradeCounts = new Map<string, number>();
  let next = 1;
  const require = (id: string) => {
    const a = accounts.get(id);
    if (!a) throw new RepositoryError({ kind: "notFound", message: `account ${id}` });
    return a;
  };
  const fromInput = (input: AccountInput) => ({
    name: input.name.trim(), broker: input.broker ?? null, propFirm: input.propFirm ?? null, externalRef: input.externalRef ?? null,
    accountType: input.accountType, status: input.status, currency: input.currency.toUpperCase(), startingBalance: input.startingBalance,
    timezone: input.timezone, tradingDayResetTime: input.tradingDayResetTime, notes: input.notes ?? null,
  });
  const create = (input: AccountInput, over: Partial<Account> = {}): Account => {
    const id = `acct-${next++}`;
    const a: Account = { ...makeAccount({ id, name: input.name }), ...fromInput(input), ...over };
    accounts.set(id, a);
    history.set(id, { statusEvents: [{ status: a.status, effectiveAt: T, cause: null, note: null, recordedAt: T }], archiveEvents: [] });
    return { ...a };
  };
  const chain = (id: string): Account[] => {
    let root = require(id);
    while (root.predecessorAccountId) root = require(root.predecessorAccountId);
    const out = [root];
    while (out[out.length - 1].successorAccountId) out.push(require(out[out.length - 1].successorAccountId!));
    return out;
  };

  const repository = {
    accounts: {
      list: async (options?: { includeArchived?: boolean }) => [...accounts.values()].filter(a => options?.includeArchived || !a.archivedAt).map(a => ({ ...a })),
      get: async (id: string) => ({ ...require(id) }),
      create: async (input: AccountInput) => create(input),
      update: async (id: string, input: AccountInput) => {
        const a = require(id);
        Object.assign(a, fromInput(input), { updatedAt: T });
        return { ...a };
      },
      archive: async (id: string) => {
        const a = require(id);
        if (a.archivedAt) throw new RepositoryError({ kind: "notFound", message: "already archived" });
        a.archivedAt = T;
        history.get(id)!.archiveEvents.push({ action: "archived", occurredAt: T });
      },
      restore: async (id: string) => {
        const a = require(id);
        if (!a.archivedAt) throw invalid("id", "The account is not archived");
        const holder = [...accounts.values()].find(o => o.id !== id && !o.archivedAt && (o.status === "active" || o.status === "paused") && a.broker && a.externalRef && o.broker === a.broker && o.externalRef === a.externalRef);
        if (holder) throw new RepositoryError({ kind: "conflict", message: `cannot restore: '${holder.name}' uses it` });
        a.archivedAt = null;
        history.get(id)!.archiveEvents.push({ action: "restored", occurredAt: T });
        return { ...a };
      },
      changeStatus: async (id: string, input: StatusChangeInput) => {
        const a = require(id);
        if (a.archivedAt) throw invalid("id", "Restore the account before changing its status");
        if (a.status === input.status) throw invalid("status", `The account is already ${a.status}`);
        a.status = input.status;
        history.get(id)!.statusEvents.push({ status: input.status, effectiveAt: input.effectiveAt ?? T, cause: input.cause ?? null, note: input.note ?? null, recordedAt: T });
        return { ...a };
      },
      history: async (id: string) => {
        require(id);
        return structuredClone(history.get(id)!);
      },
      resetAttempt: async (input: ResetInput) => {
        const pred = require(input.predecessorAccountId);
        if (pred.archivedAt) throw invalid("predecessorAccountId", "Restore the archived account before resetting it");
        if (pred.successorAccountId) throw new RepositoryError({ kind: "conflict", message: "already reset" });
        // Atomic: nothing changes until every step is known to succeed.
        const successor = create(
          { name: input.name, accountType: pred.accountType, status: "active", currency: pred.currency, startingBalance: input.startingBalance, timezone: pred.timezone, tradingDayResetTime: pred.tradingDayResetTime, broker: pred.broker, propFirm: pred.propFirm, externalRef: input.externalRef ?? null, notes: input.notes ?? null },
          { predecessorAccountId: pred.id },
        );
        if (pred.status !== input.priorOutcome) {
          pred.status = input.priorOutcome;
          history.get(pred.id)!.statusEvents.push({ status: input.priorOutcome, effectiveAt: input.effectiveAt, cause: input.reason ?? null, note: null, recordedAt: T });
        }
        pred.successorAccountId = successor.id;
        const link: AttemptLink = { predecessorAccountId: pred.id, successorAccountId: successor.id, priorOutcome: input.priorOutcome, effectiveAt: input.effectiveAt, reason: input.reason ?? null, source: input.source, rulebookDecision: input.rulebook.kind === "assign" ? "assigned" : "deferred", createdAt: T };
        links.push(link);
        return { predecessor: { ...pred }, successor: { ...require(successor.id) }, link, rulebookAssignment: null };
      },
      lineage: async (id: string): Promise<AttemptSummary[]> =>
        chain(id).map((a, i) => ({
          accountId: a.id, attemptNumber: i + 1, name: a.name, status: a.status, archivedAt: a.archivedAt, externalRef: a.externalRef,
          startingBalance: a.startingBalance, createdAt: a.createdAt, resetToNext: links.find(l => l.predecessorAccountId === a.id) ?? null,
          tradeCount: tradeCounts.get(a.id) ?? 0, firstTradingDay: tradeCounts.get(a.id) ? "2026-10-19" : null, lastTradingDay: tradeCounts.get(a.id) ? "2026-10-19" : null,
          importCount: 0, netPnl: tradeCounts.get(a.id) ? "125.5" : null, tradesWithUnknownPnl: 0,
        })),
      listActive: async () => [...accounts.values()].filter(a => !a.archivedAt && a.status === "active"),
      previewDeletion: async () => { throw new RepositoryError({ kind: "notFound", message: "not used" }); },
    },
    settings: {
      get: async (key: string) => (settings.has(key) ? { key, value: settings.get(key), updatedAt: T } : null),
      list: async () => [...settings.entries()].map(([key, value]) => ({ key, value, updatedAt: T })),
      set: async (key: string, value: unknown) => { settings.set(key, value); return { key, value, updatedAt: T }; },
      remove: async (key: string) => { settings.delete(key); },
    },
    rulebooks: {
      list: async () => [],
      listVersions: async () => [],
      getVersion: async () => { throw new RepositoryError({ kind: "notFound", message: "no version" }); },
      listAssignments: async () => [],
    },
    // The catalogue isn't part of these flows: an unreadable catalogue only removes firm suggestions.
    catalogue: { load: async () => { throw new RepositoryError({ kind: "notFound", message: "no catalogue" }); } },
    imports: { list: async () => [] },
  };
  return { repository, accounts, settings, tradeCounts, links };
}
