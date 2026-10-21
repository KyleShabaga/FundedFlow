// TEST ONLY. In-memory daily reviews for the Build 22 screens, following src-tauri/src/store/daily_reviews.rs closely
// enough for UI journeys: one review per account and day, revision conflicts, archived accounts read-only, explicit
// complete/reopen with history, label snapshots, Unknown adherence without applicable answers, known-P&L-only
// outcome and trade links by id. Trading days and "now" are given by the test, never derived from the clock.
// Real persistence, session windows and DST are tested in Rust (store/daily_review_tests.rs).
import {
  RepositoryError,
  type Account,
  type Checklist,
  type DailyAdherence,
  type DailyReview,
  type DailyReviewDay,
  type DailyReviewIndex,
  type DailyReviewInput,
  type DailyReviewRef,
  type DailyReviewRepository,
  type Trade,
} from "@fundedflow/domain";

const conflict = (message: string) => new RepositoryError({ kind: "conflict", message });
const invalid = (field: string, message: string) => new RepositoryError({ kind: "validation", message: `${field}: ${message}`, issues: [{ field, message }] });
const notFound = () => new RepositoryError({ kind: "notFound", message: "account was not found" });

const micros = (v: string) => {
  const [i, f = ""] = v.replace("-", "").split(".");
  const n = BigInt(i || "0") * 1_000_000n + BigInt((f + "000000").slice(0, 6));
  return v.startsWith("-") ? -n : n;
};
const text = (m: bigint) => {
  const neg = m < 0n; const a = neg ? -m : m;
  const frac = (a % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${a / 1_000_000n}${frac ? `.${frac}` : ""}`;
};

export interface DailyReviewFakeSource {
  account: (id: string) => Account | undefined;
  /** Active (not deleted) trades of the account. */
  trades: (accountId: string) => Trade[];
  checklists?: () => Checklist[];
}

export function createDailyReviewFake(source: DailyReviewFakeSource, options: { currentDay?: string | ((accountId: string) => string) } = {}) {
  const reviews = new Map<string, DailyReview & { links: { tradeId: string; updatedAt: string }[] }>();
  const failing = new Set<string>();
  const calls: { method: string; args: unknown[] }[] = [];
  let clock = Date.parse("2026-10-20T15:00:00.000Z");
  let next = 1;
  const now = () => new Date((clock += 1000)).toISOString();
  const key = (accountId: string, day: string) => `${accountId}|${day}`;
  const current = (accountId: string) => typeof options.currentDay === "function" ? options.currentDay(accountId) : options.currentDay ?? "2026-10-20";
  const guard = (name: string) => { if (failing.has(name)) throw new RepositoryError({ kind: "database", message: `${name} failed` }); };
  const account = (id: string) => { const a = source.account(id); if (!a) throw notFound(); return a; };
  const dayTrades = (accountId: string, day: string) => source.trades(accountId).filter(t => t.tradingDay === day).sort((a, b) => (a.entryAt < b.entryAt ? -1 : 1));
  const weekday = (day: string) => { const d = new Date(`${day}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.getUTCDay() % 6 !== 0; };

  function adherence(review: Pick<DailyReview, "answers" | "checklist">): DailyAdherence {
    const count = (k: string) => review.answers.filter(a => a.result === k).length;
    const followed = count("followed"); const missed = count("missed"); const answered = followed + missed;
    const items = source.checklists?.().find(c => c.id === review.checklist?.id)?.items.filter(i => !i.archived) ?? [];
    return {
      followed, missed, notApplicable: count("not_applicable"), answered,
      unanswered: items.filter(i => !review.answers.some(a => a.itemId === i.id)).length,
      percent: answered === 0 ? null : String(Math.round((followed * 100) / answered)),
    };
  }

  function view(accountId: string, day: string): DailyReviewDay {
    const a = account(accountId);
    if (!weekday(day)) throw invalid("tradingDay", "is not a trading day: trading days run Monday to Friday");
    const stored = reviews.get(key(accountId, day));
    const trades = dayTrades(accountId, day);
    const known = trades.filter(t => t.realizedPnl !== null);
    const open = trades.filter(t => t.pnlStatus === "open").length;
    const missing = (stored?.links ?? []).filter(l => !trades.some(t => t.id === l.tradeId)).map(l => ({ tradeId: l.tradeId, symbol: "?", reason: "deleted" as const, movedTo: null, netPnlWhenSaved: null }));
    const rows = trades.map(t => {
      const link = stored ? (stored.links.find(l => l.tradeId === t.id) ? (stored.links.find(l => l.tradeId === t.id)!.updatedAt === t.updatedAt ? "linked" : "changed") : "added") : null;
      return { tradeId: t.id, symbol: t.symbol, side: t.side, entryAt: t.entryAt, exitAt: t.exitAt, netPnl: t.realizedPnl, pnlStatus: t.pnlStatus, link } as DailyReviewDay["trades"][number];
    });
    const { links: _links, ...review } = stored ?? { links: [] };
    return {
      accountId, tradingDay: day, session: { timezone: a.timezone, resetTime: a.tradingDayResetTime },
      sessionStart: `${day}T00:00:00.000Z`, sessionEnd: `${day}T21:00:00.000Z`, currentTradingDay: current(accountId),
      isFuture: day > current(accountId), archived: a.archivedAt !== null,
      review: stored ? structuredClone(review as DailyReview) : null,
      trades: rows, missingTrades: missing,
      outcome: { trades: trades.length, closedWithKnownPnl: known.length, unknownPnl: trades.length - known.length - open, open, net: known.length ? text(known.reduce((s, t) => s + micros(t.realizedPnl!), 0n)) : null },
      dayState: trades.length ? "traded" : stored?.noTradeDay ? "no_trade_day" : "no_trades_recorded",
      sessionSettingsChanged: false, tradesChanged: rows.some(r => r.link && r.link !== "linked") || missing.length > 0,
    };
  }

  function writable(accountId: string) {
    const a = account(accountId);
    if (a.archivedAt) throw conflict("this account is archived, so its daily reviews are read-only");
    return a;
  }
  function checkRevision(stored: DailyReview | undefined, expected: number | null) {
    if (stored && expected === null) throw conflict("this day already has a review that you have not loaded; reload it before saving");
    if (stored && expected !== stored.revision) throw conflict("this review was changed after you opened it; reload it and apply your edits again");
    if (!stored && expected !== null) throw conflict("this review no longer exists; reload the day");
  }

  const repository: DailyReviewRepository = {
    getDay: async (accountId, day) => { guard("getDay"); calls.push({ method: "getDay", args: [accountId, day] }); return view(accountId, day); },
    list: async (accountId): Promise<DailyReviewIndex> => {
      guard("list");
      const a = account(accountId);
      const mine = [...reviews.values()].filter(r => r.accountId === accountId).sort((x, y) => (x.tradingDay < y.tradingDay ? 1 : -1));
      return {
        accountId, currentTradingDay: current(accountId), session: { timezone: a.timezone, resetTime: a.tradingDayResetTime }, archived: a.archivedAt !== null,
        reviews: mine.map(r => {
          const v = view(accountId, r.tradingDay);
          return {
            id: r.id, tradingDay: r.tradingDay, status: r.status, revision: r.revision, planTiming: r.plan.timing,
            hasPlan: [r.plan.focus, r.plan.setups, r.plan.noTradeConditions, r.plan.commitments, r.plan.maxRisk, r.plan.notes].some(Boolean),
            hasReflection: Object.values(r.reflection).some(Boolean), noTradeDay: r.noTradeDay, keyLesson: r.reflection.keyLesson,
            adherence: r.adherence, outcome: v.outcome, tradesChanged: v.tradesChanged, completedAt: r.completedAt, updatedAt: r.updatedAt,
          };
        }),
        legacyNotes: [],
      };
    },
    save: async (input: DailyReviewInput) => {
      guard("save");
      calls.push({ method: "save", args: [structuredClone(input)] });
      writable(input.accountId);
      const day = input.tradingDay;
      if (!weekday(day)) throw invalid("tradingDay", "is not a trading day");
      const complete = input.action === "complete";
      const reflectionGiven = Object.values(input.reflection).some(Boolean) || input.answers.length > 0 || input.noTradeDay;
      if (day > current(input.accountId) && (reflectionGiven || complete)) throw invalid("tradingDay", "this trading day hasn't started; only its plan can be written now");
      if (input.noTradeDay && dayTrades(input.accountId, day).length) throw invalid("noTradeDay", "trades are recorded for this day; it can't be marked a no-trade day");
      const k = key(input.accountId, day);
      const stored = reviews.get(k);
      checkRevision(stored, input.expectedRevision ?? null);
      const at = now();
      const planGiven = Object.values(input.plan).some(Boolean);
      const checklist = input.checklistId ? source.checklists?.().find(c => c.id === input.checklistId) ?? null : null;
      const wasCompleted = stored?.status === "completed";
      const revision = (stored?.revision ?? 0) + 1;
      const kind: DailyReview["events"][number]["kind"] = complete && !wasCompleted ? "completed" : wasCompleted ? "edited" : "saved";
      const events = [...(stored?.events ?? []), ...(stored ? [] : [{ kind: "created" as const, revision, at }]), ...(stored || kind !== "saved" ? [{ kind, revision, at }] : [])];
      const review: DailyReview = {
        id: stored?.id ?? `dr-${next++}`, accountId: input.accountId, tradingDay: day,
        status: complete || wasCompleted ? "completed" : "draft", revision,
        plan: {
          focus: input.plan.focus ?? null, setups: input.plan.setups ?? null, noTradeConditions: input.plan.noTradeConditions ?? null,
          commitments: input.plan.commitments ?? null, maxRisk: input.plan.maxRisk || null, notes: input.plan.notes ?? null,
          authoredAt: planGiven ? stored?.plan.authoredAt ?? at : null,
          timing: planGiven ? stored?.plan.timing ?? (day >= current(input.accountId) ? "pre_session" : "retrospective") : null,
        },
        reflection: {
          marketContext: input.reflection.marketContext ?? null, wentWell: input.reflection.wentWell ?? null, mistakes: input.reflection.mistakes ?? null,
          emotions: input.reflection.emotions ?? null, keyLesson: input.reflection.keyLesson ?? null, nextAction: input.reflection.nextAction ?? null,
          notes: input.reflection.notes ?? null,
        },
        noTradeDay: input.noTradeDay,
        checklist: checklist ? { id: checklist.id, label: stored?.checklist?.id === checklist.id ? stored.checklist.label : checklist.name, currentLabel: null, archived: checklist.archived } : null,
        answers: input.answers.map(a => {
          const item = checklist?.items.find(i => i.id === a.itemId);
          if (!item) throw invalid("answers.0.itemId", "item not found");
          const before = stored?.answers.find(b => b.itemId === a.itemId);
          return { itemId: a.itemId, label: before?.label ?? item.label, result: a.result, note: a.note ?? null, currentLabel: before && before.label !== item.label ? item.label : null, archived: item.archived };
        }),
        adherence: { followed: 0, missed: 0, notApplicable: 0, unanswered: 0, answered: 0, percent: null },
        savedWith: { timezone: account(input.accountId).timezone, resetTime: account(input.accountId).tradingDayResetTime },
        completedAt: complete && !wasCompleted ? at : stored?.completedAt ?? null,
        firstCompletedAt: stored?.firstCompletedAt ?? (complete ? at : null),
        editedAfterCompletionAt: wasCompleted ? at : stored?.editedAfterCompletionAt ?? null,
        reopenedAt: stored?.reopenedAt ?? null, events, createdAt: stored?.createdAt ?? at, updatedAt: at,
      };
      review.adherence = adherence(review);
      reviews.set(k, { ...review, links: dayTrades(input.accountId, day).map(t => ({ tradeId: t.id, updatedAt: t.updatedAt })) });
      return view(input.accountId, day);
    },
    reopen: async (ref: DailyReviewRef) => {
      guard("reopen");
      writable(ref.accountId);
      const stored = reviews.get(key(ref.accountId, ref.tradingDay));
      checkRevision(stored, ref.expectedRevision);
      if (stored!.status !== "completed") throw conflict("this review is already a draft");
      const at = now();
      const revision = stored!.revision + 1;
      reviews.set(key(ref.accountId, ref.tradingDay), { ...stored!, status: "draft", completedAt: null, reopenedAt: at, revision, updatedAt: at, events: [...stored!.events, { kind: "reopened", revision, at }] });
      return view(ref.accountId, ref.tradingDay);
    },
    relinkTrades: async (ref: DailyReviewRef) => {
      guard("relink");
      writable(ref.accountId);
      const stored = reviews.get(key(ref.accountId, ref.tradingDay));
      checkRevision(stored, ref.expectedRevision);
      const at = now();
      const revision = stored!.revision + 1;
      reviews.set(key(ref.accountId, ref.tradingDay), {
        ...stored!, revision, updatedAt: at, events: [...stored!.events, { kind: "relinked", revision, at }],
        links: dayTrades(ref.accountId, ref.tradingDay).map(t => ({ tradeId: t.id, updatedAt: t.updatedAt })),
      });
      return view(ref.accountId, ref.tradingDay);
    },
  };
  return { repository, reviews, failing, calls };
}
