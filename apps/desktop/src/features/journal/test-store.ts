// TEST ONLY. In-memory trades, reviews, library and screenshots for the Build 20 screens, following the Rust rules in
// src-tauri/src/store/{trades,reviews,library,attachments}.rs closely enough for UI journeys (account scoping, revision
// conflicts, label snapshots, archive instead of delete). Real persistence and calculations are tested in Rust
// (store/journal_review_tests.rs). Synthetic data only; never imported by production code.
import {
  RepositoryError,
  type Account,
  type ArchiveInput,
  type AttachmentMeta,
  type Checklist,
  type ChecklistInput,
  type ReviewInput,
  type ScreenshotInput,
  type Strategy,
  type StrategyInput,
  type Tag,
  type TagInput,
  type Trade,
  type TradeChangeOptions,
  type TradeCorrection,
  type TradeInput,
  type TradeReview,
} from "@fundedflow/domain";
import { createTestStore, T } from "../accounts/test-store";
import { ACTIVE_ACCOUNT_SETTING } from "../accounts/active-account";
import { createDailyReviewFake } from "../daily-reviews/test-store";
import { createInsightsFake } from "../insights/test-store";

const notFound = (what: string) => new RepositoryError({ kind: "notFound", message: `${what} was not found` });
const conflict = (message: string) => new RepositoryError({ kind: "conflict", message });
const invalid = (field: string, message: string) => new RepositoryError({ kind: "validation", message, issues: [{ field, message }] });

export function trade(over: Partial<Trade> & Pick<Trade, "id" | "accountId">): Trade {
  return {
    source: "manual", importBatchId: null, brokerTradeId: null, symbol: "ESZ6", side: "long", quantity: "1",
    entryAt: "2026-10-19T13:30:00.000Z", entryPrice: "5000", exitAt: "2026-10-19T14:00:00.000Z", exitPrice: "5002", fees: "4", feesRecorded: true,
    tradingDay: "2026-10-19", reportedPnl: null, grossPnl: "100", realizedPnl: "96", pnlStatus: "calculated", notes: null, roundTrip: null,
    createdAt: T, updatedAt: T, ...over,
  };
}

/** A 1×1 PNG header with distinct trailing bytes. */
export function pngBytes(salt = 1): Uint8Array<ArrayBuffer> {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, salt]);
}

/** `base` lets the Build 26 cross-feature store share one accounts/settings/rulebook store with Today. */
export function createJournalStore<B extends { repository: object; accounts: Map<string, Account>; settings: Map<string, unknown> } = ReturnType<typeof createTestStore>>(
  accounts: Account[], trades: Trade[] = [], activeId: string | null = accounts[0]?.id ?? null, currentDay = "2026-10-20", base: B = createTestStore(accounts) as unknown as B) {
  if (activeId) base.settings.set(ACTIVE_ACCOUNT_SETTING, activeId);
  const all = new Map(trades.map(t => [t.id, { trade: { ...t }, deletedAt: null as string | null }]));
  const corrections = new Map<string, TradeCorrection[]>();
  const reviews = new Map<string, TradeReview>();
  const strategies = new Map<string, Strategy>();
  const tags = new Map<string, Tag>();
  const checklists = new Map<string, Checklist>();
  const files = new Map<string, { data: string; status: "ok" | "missing" | "corrupt" }>();
  const calls: { method: string; args: unknown[] }[] = [];
  let next = 1;
  let clock = Date.parse(T);
  const id = (p: string) => `${p}-${next++}`;
  const now = () => new Date((clock += 1000)).toISOString();
  const log = (method: string, ...args: unknown[]) => calls.push({ method, args: structuredClone(args) });
  const account = (accountId: string) => {
    const a = base.accounts.get(accountId);
    if (!a) throw notFound("account");
    return a;
  };
  const active = (accountId: string, tradeId: string) => {
    const row = all.get(tradeId);
    if (!row || row.deletedAt || row.trade.accountId !== accountId) throw notFound("trade");
    return row;
  };
  const ordered = (accountId: string) => [...all.values()].filter(r => r.trade.accountId === accountId && !r.deletedAt)
    .map(r => r.trade).sort((a, b) => (a.entryAt === b.entryAt ? (a.id < b.id ? -1 : 1) : a.entryAt < b.entryAt ? -1 : 1));
  /** The test double's stand-in for Rust's P&L: ES-like point value 50, fees subtracted. */
  const derive = (input: TradeInput): Partial<Trade> => {
    const exitAt = input.exitAt ?? null;
    if (!exitAt || !input.exitPrice) return { exitAt: null, exitPrice: null, grossPnl: null, realizedPnl: null, pnlStatus: "open", tradingDay: input.entryAt.slice(0, 10) };
    const gross = (Number(input.exitPrice) - Number(input.entryPrice)) * Number(input.quantity) * 50 * (input.side === "short" ? -1 : 1);
    const net = gross - Number(input.fees ?? 0);
    return { exitAt: new Date(exitAt).toISOString(), exitPrice: input.exitPrice, grossPnl: String(gross), realizedPnl: String(net), pnlStatus: "calculated", tradingDay: new Date(exitAt).toISOString().slice(0, 10) };
  };
  /** As Rust validates fees (TASK-042): a blank fee is stored as "0" and not recorded; any given value is recorded. */
  const fees = (input: TradeInput) => {
    const given = input.fees?.trim() ? input.fees.trim() : null;
    return { fees: given ?? "0", feesRecorded: given !== null };
  };
  const meta = (a: AttachmentMeta) => ({ ...a, fileStatus: files.get(a.id)?.status === "missing" ? "missing" as const : "ok" as const });

  const daily = createDailyReviewFake({
    account: accountId => base.accounts.get(accountId),
    trades: accountId => [...all.values()].filter(r => r.deletedAt === null && r.trade.accountId === accountId).map(r => ({ ...r.trade })),
    checklists: () => structuredClone([...checklists.values()]),
  }, { currentDay });
  const causes = new Map<string, string | null>();
  const insights = createInsightsFake({
    account: accountId => base.accounts.get(accountId),
    trades: () => [...all.values()].map(r => ({ trade: { ...r.trade }, deletedAt: r.deletedAt })),
    review: tradeId => reviews.get(tradeId),
    cause: accountId => causes.get(accountId) ?? null,
  });
  const repository = {
    ...base.repository,
    insights: insights.repository,
    journal: { list: async () => [] },
    trades: {
      list: async (accountId: string) => { account(accountId); return ordered(accountId).reverse().map(t => ({ ...t })); },
      create: async (input: TradeInput) => {
        log("trades.create", input);
        account(input.accountId);
        const t = trade({ id: id("trade"), accountId: input.accountId, symbol: input.symbol.toUpperCase(), side: input.side, quantity: input.quantity,
          entryAt: new Date(input.entryAt).toISOString(), entryPrice: input.entryPrice, ...fees(input), reportedPnl: input.realizedPnl ?? null,
          notes: input.notes ?? null, createdAt: now(), updatedAt: now(), ...derive(input) });
        all.set(t.id, { trade: t, deletedAt: null });
        return { ...t };
      },
      update: async (tradeId: string, input: TradeInput, options?: TradeChangeOptions) => {
        log("trades.update", tradeId, input, options);
        const row = active(input.accountId, tradeId);
        if (options?.expectedUpdatedAt && options.expectedUpdatedAt !== row.trade.updatedAt) throw conflict("changed");
        const before = { ...row.trade };
        row.trade = { ...row.trade, symbol: input.symbol, side: input.side, quantity: input.quantity, entryAt: new Date(input.entryAt).toISOString(),
          entryPrice: input.entryPrice, ...fees(input), notes: input.notes ?? null, ...derive(input), updatedAt: now() };
        corrections.set(tradeId, [...(corrections.get(tradeId) ?? []), { id: id("c"), tradeId, kind: "edit", correctedAt: row.trade.updatedAt, actor: "local_user",
          reason: options?.reason ?? null, changedFields: ["fees"], before: { fees: before.fees }, after: { fees: row.trade.fees } }]);
        return { ...row.trade };
      },
      remove: async (tradeId: string, reason?: string | null) => {
        log("trades.remove", tradeId, reason);
        const row = all.get(tradeId);
        if (!row || row.deletedAt) throw notFound("trade");
        row.deletedAt = now();
      },
      restore: async (accountId: string, tradeId: string) => {
        log("trades.restore", accountId, tradeId);
        const row = all.get(tradeId);
        if (!row || !row.deletedAt || row.trade.accountId !== accountId) throw notFound("deleted trade");
        row.deletedAt = null;
        return { ...row.trade };
      },
      listDeleted: async (accountId: string) => [...all.values()].filter(r => r.deletedAt && r.trade.accountId === accountId).map(r => ({ trade: { ...r.trade }, deletedAt: r.deletedAt! })),
      detail: async (accountId: string, tradeId: string) => {
        account(accountId);
        const row = active(accountId, tradeId);
        const list = ordered(accountId);
        const at = list.findIndex(t => t.id === tradeId);
        return {
          trade: { ...row.trade },
          importSource: row.trade.source === "csv_import" ? {
            batchId: row.trade.importBatchId ?? "batch", fileName: "Performance.csv", fileSha256: "a".repeat(64), sourceFormat: "performance" as const,
            sourceTimezone: "America/New_York", importedAt: T, rowNumber: 1, lineNumber: 2, headers: ["symbol", "buyFillId"], rawCells: ["MNQZ6", "9001"],
          } : null,
          corrections: corrections.get(tradeId) ?? [],
          previousTradeId: list[at - 1]?.id ?? null, nextTradeId: list[at + 1]?.id ?? null, position: at + 1, total: list.length,
        };
      },
    },
    reviews: {
      get: async (accountId: string, tradeId: string) => { active(accountId, tradeId); const r = reviews.get(tradeId); return r ? { ...structuredClone(r), attachments: r.attachments.map(meta) } : null; },
      save: async (input: ReviewInput) => {
        log("reviews.save", input);
        account(input.accountId);
        active(input.accountId, input.tradeId);
        const existing = reviews.get(input.tradeId);
        if (existing && input.expectedRevision !== existing.revision && !(input.expectedRevision === null && existing.revision === 1 && !existing.thesis && !existing.reflection)) throw conflict("changed");
        const strategy = input.strategyId ? strategies.get(input.strategyId) ?? null : null;
        const checklist = input.checklistId ? checklists.get(input.checklistId) ?? null : null;
        const keep = <X extends { id: string | null }>(prev: X | null | undefined, id: string | null | undefined, label: string | undefined) =>
          id ? (prev?.id === id ? prev : { id, label: label ?? "?", currentLabel: null, archived: false }) : null;
        const r: TradeReview = {
          id: existing?.id ?? id("review"), tradeId: input.tradeId, accountId: input.accountId, revision: (existing?.revision ?? 0) + 1,
          reviewedAt: input.reviewed ? existing?.reviewedAt ?? now() : null,
          strategy: keep(existing?.strategy, input.strategyId, strategy?.name), checklist: keep(existing?.checklist, input.checklistId, checklist?.name),
          plannedEntryPrice: input.plannedEntryPrice || null, plannedStopPrice: input.plannedStopPrice || null, plannedTargetPrice: input.plannedTargetPrice || null,
          plannedRisk: input.plannedRisk || null, plannedRiskSource: input.plannedRisk ? "entered" : null, rMultiple: null,
          executionRating: input.executionRating ?? null, thesis: input.thesis ?? null, reflection: input.reflection ?? null,
          tags: input.tagIds.map(t => existing?.tags.find(x => x.tagId === t) ?? { tagId: t, label: tags.get(t)!.name, kind: tags.get(t)!.kind, currentLabel: null, archived: false }),
          checklistResults: input.checklistResults.map(a => ({ itemId: a.itemId, label: checklist?.items.find(i => i.id === a.itemId)?.label ?? "?", result: a.result, note: a.note ?? null, currentLabel: null, archived: false })),
          adherence: { followed: input.checklistResults.filter(a => a.result === "followed").length, missed: input.checklistResults.filter(a => a.result === "missed").length, notApplicable: input.checklistResults.filter(a => a.result === "not_applicable").length },
          attachments: existing?.attachments ?? [], createdAt: existing?.createdAt ?? now(), updatedAt: now(),
        };
        reviews.set(input.tradeId, r);
        return structuredClone(r);
      },
      summaries: async (accountId: string) => [...reviews.values()].filter(r => r.accountId === accountId && all.get(r.tradeId) && !all.get(r.tradeId)!.deletedAt).map(r => ({
        tradeId: r.tradeId, reviewed: r.reviewedAt !== null, strategyId: r.strategy?.id ?? null, strategyName: r.strategy?.label ?? null, tags: r.tags,
        executionRating: r.executionRating, adherence: r.adherence, screenshotCount: r.attachments.length, notes: [r.thesis, r.reflection].filter(Boolean).join("\n"),
      })),
      addScreenshot: async (input: ScreenshotInput) => {
        log("reviews.addScreenshot", { ...input, dataBase64: `${input.dataBase64.length} chars` });
        active(input.accountId, input.tradeId);
        if (!input.dataBase64.startsWith("iVBORw0KGgo")) throw invalid("file", "only PNG, JPEG and WebP images can be attached (checked from the file's contents)");
        let r = reviews.get(input.tradeId);
        if (!r) {
          r = { id: id("review"), tradeId: input.tradeId, accountId: input.accountId, revision: 1, reviewedAt: null, strategy: null, checklist: null, plannedEntryPrice: null,
            plannedStopPrice: null, plannedTargetPrice: null, plannedRisk: null, plannedRiskSource: null, rMultiple: null, executionRating: null, thesis: null, reflection: null,
            tags: [], checklistResults: [], adherence: { followed: 0, missed: 0, notApplicable: 0 }, attachments: [], createdAt: now(), updatedAt: now() };
          reviews.set(input.tradeId, r);
        }
        if (r.attachments.some(a => files.get(a.id)?.data === input.dataBase64)) throw conflict("this screenshot is already attached to the trade");
        const a: AttachmentMeta = { id: id("shot"), fileName: input.fileName ?? null, mimeType: "image/png", byteSize: 30, width: 1, height: 1, sha256: "b".repeat(64), caption: null, createdAt: now(), fileStatus: "ok" };
        files.set(a.id, { data: input.dataBase64, status: "ok" });
        r.attachments.push(a);
        return meta(a);
      },
      readScreenshot: async (accountId: string, attachmentId: string) => {
        const r = [...reviews.values()].find(x => x.accountId === accountId && x.attachments.some(a => a.id === attachmentId));
        if (!r) throw notFound("screenshot");
        const f = files.get(attachmentId)!;
        return { attachmentId, status: f.status, mimeType: "image/png", dataBase64: f.status === "ok" ? f.data : null };
      },
      removeScreenshot: async (accountId: string, attachmentId: string) => {
        log("reviews.removeScreenshot", accountId, attachmentId);
        const r = [...reviews.values()].find(x => x.accountId === accountId && x.attachments.some(a => a.id === attachmentId));
        if (!r) throw notFound("screenshot");
        r.attachments = r.attachments.filter(a => a.id !== attachmentId);
      },
    },
    dailyReviews: daily.repository,
    library: {
      load: async () => ({ strategies: [...strategies.values()].map(s => ({ ...s })), tags: [...tags.values()].map(t => ({ ...t })), checklists: structuredClone([...checklists.values()]) }),
      saveStrategy: async (sid: string | null, input: StrategyInput) => {
        log("library.saveStrategy", sid, input);
        if ([...strategies.values()].some(s => s.id !== sid && s.name.toLowerCase() === input.name.trim().toLowerCase())) throw conflict("a strategy with this name already exists");
        const s: Strategy = { id: sid ?? id("strategy"), name: input.name.trim(), description: input.description ?? null, archived: sid ? strategies.get(sid)!.archived : false, reviewCount: 0, createdAt: T, updatedAt: now() };
        strategies.set(s.id, s);
        for (const r of reviews.values()) if (r.strategy?.id === s.id && r.strategy.label !== s.name) r.strategy = { ...r.strategy, currentLabel: s.name };
        return { ...s };
      },
      saveTag: async (tid: string | null, input: TagInput) => {
        log("library.saveTag", tid, input);
        const t: Tag = { id: tid ?? id("tag"), name: input.name.trim(), kind: input.kind, archived: tid ? tags.get(tid)!.archived : false, reviewCount: 0, createdAt: T, updatedAt: now() };
        tags.set(t.id, t);
        return { ...t };
      },
      saveChecklist: async (cid: string | null, input: ChecklistInput) => {
        log("library.saveChecklist", cid, input);
        const prev = cid ? checklists.get(cid) : undefined;
        const items = input.items.map((item, i) => ({ id: item.id ?? id("item"), label: item.label, sortOrder: i, archived: false }));
        const archived = (prev?.items ?? []).filter(i => !items.some(x => x.id === i.id)).map(i => ({ ...i, archived: true }));
        const c: Checklist = { id: cid ?? id("checklist"), name: input.name.trim(), description: input.description ?? null, scope: input.scope, strategyId: input.strategyId ?? null,
          archived: prev?.archived ?? false, items: [...items, ...archived], reviewCount: 0, createdAt: T, updatedAt: now() };
        checklists.set(c.id, c);
        return structuredClone(c);
      },
      setArchived: async (input: ArchiveInput) => {
        log("library.setArchived", input);
        const map = input.entity === "strategy" ? strategies : input.entity === "tag" ? tags : checklists;
        const entry = map.get(input.id);
        if (!entry) throw notFound(input.entity);
        entry.archived = input.archived;
      },
    },
  };
  return { repository, calls, reviews, files, strategies, tags, checklists, all, base, daily, insights, causes };
}
