// Journal library (Build 20), a sub-view of the Journal: the account's trade notes, its daily reviews (Build 22; earlier
// day notes are listed apart, read only), and the shared review library: playbooks (strategies), templates
// (checklists) and tags. Nothing a review used is deleted: archiving hides it from new choices, and past reviews keep
// the labels they recorded. Library writes share one lock; an uncertain one is checked against the item as stored
// (on the page and in the dialog that sent it) before saving is allowed again.
import { tagKinds, type LegacyDayNote, type Checklist, type ChecklistInput, type Strategy, type Tag, type TagKind } from "@fundedflow/domain";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { type FormEvent, type ReactNode, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import {
  ActionPill,
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  formatInstant,
  IconButton,
  InlineNotice,
  LoadingState,
  MoneyCell,
  RadioGroup,
  SearchField,
  SegmentedControl,
  Select,
  StatList,
  StateBoundary,
  TabPanel,
  Tabs,
  Textarea,
  TextField,
  useToast,
} from "../../../design-system";
import type { AccountViewModel } from "../../accounts/view-models/account";
import { type LibraryChange, useLibrary, useSaveChecklist, useSaveStrategy, useSaveTag, useSetArchived } from "../../library/hooks/library";
import { useReviewSummaries } from "../../reviews/hooks/reviews";
import { fieldErrors, retryRead, toAsyncState } from "../../shared/presentation";
import { UncertainOutcomeReview, type UncertainWrite } from "../../shared/UncertainOutcomeReview";
import { useTrades } from "../../trades/hooks/trades";
import { DayChooser } from "../../daily-reviews/components/DayChooser";
import "../../daily-reviews/components/daily-review.css";
import { useDailyReviewIndex } from "../../daily-reviews/hooks/daily-reviews";
import { adherenceShort, dailyReviewPath, statusView } from "../../daily-reviews/view-models/daily-review";
import { useJournalEntries } from "../hooks/journal";
import { longDay, NetPnl, TagList, tradePath } from "./presentation";

const SECTIONS = ["notes", "daily", "playbooks", "templates", "tags"] as const;
type Section = (typeof SECTIONS)[number];
export const TAG_KIND_LABELS: Record<TagKind, string> = { setup: "Setup", mistake: "Mistake", emotion: "Mindset", general: "General" };

export function LibraryView({ account }: { account: AccountViewModel }) {
  const [params, setParams] = useSearchParams();
  const section: Section = (SECTIONS as readonly string[]).includes(params.get("section") ?? "") ? (params.get("section") as Section) : "notes";
  const setSection = (s: string) => setParams(p => { const next = new URLSearchParams(p); next.set("section", s); return next; }, { replace: true });
  const library = useLibrary();
  const lib = library.data;
  // Any library write hook reports the one shared library lock.
  const write = useSetArchived();
  return (
    <div className="jr-library">
      {write.outcome === "uncertain-outcome" && <LibraryWriteReview write={write} change={write.submitted} />}
      <Tabs label="Library sections" value={section} onValueChange={setSection} items={[
        { value: "notes", label: "Trade notes" }, { value: "daily", label: "Daily journals" },
        { value: "playbooks", label: "Playbooks", count: lib?.strategies.filter(s => !s.archived).length },
        { value: "templates", label: "Templates", count: lib?.checklists.filter(c => !c.archived).length },
        { value: "tags", label: "Tags", count: lib?.tags.filter(t => !t.archived).length },
      ]}>
        <TabPanel value="notes"><TradeNotes account={account} /></TabPanel>
        <TabPanel value="daily"><DailyJournals account={account} /></TabPanel>
        {(["playbooks", "templates", "tags"] as const).map(s => (
          <TabPanel key={s} value={s}>
            <StateBoundary state={toAsyncState(library)} label="library" onRetry={retryRead(library.refresh)} loading={<LoadingState label="Loading the library" rows={4} />}>
              {data => s === "playbooks" ? <Playbooks strategies={data.strategies} checklists={data.checklists} />
                : s === "templates" ? <Templates checklists={data.checklists} strategies={data.strategies} />
                : <Tags tags={data.tags} />}
            </StateBoundary>
          </TabPanel>
        ))}
      </Tabs>
    </div>
  );
}

/* ---------- Trade notes ---------- */

function TradeNotes({ account }: { account: AccountViewModel }) {
  const navigate = useNavigate();
  const trades = useTrades(account.id);
  const summaries = useReviewSummaries(account.id);
  const entries = useJournalEntries(account.id);
  const [query, setQuery] = useState("");
  const notes = useMemo(() => {
    const byId = new Map((trades.data ?? []).map(t => [t.id, t]));
    const reviews = (summaries.data ?? []).filter(s => s.notes.trim() !== "" && byId.has(s.tradeId)).map(s => ({
      key: `r:${s.tradeId}`, trade: byId.get(s.tradeId)!, title: s.strategyName ?? "Trade review", body: s.notes, tags: s.tags, kind: "Review" as const,
    }));
    const linked = (entries.data ?? []).filter(e => e.tradeId && byId.has(e.tradeId)).map(e => ({
      key: `j:${e.id}`, trade: byId.get(e.tradeId!)!, title: e.title, body: e.body, tags: [], kind: "Journal entry" as const,
    }));
    const q = query.trim().toLowerCase();
    return [...reviews, ...linked]
      .filter(n => !q || `${n.title}\n${n.body}\n${n.trade.symbol}\n${n.tags.map(t => t.label).join(" ")}`.toLowerCase().includes(q))
      .sort((a, b) => (a.trade.entryAt < b.trade.entryAt ? 1 : -1));
  }, [trades.data, summaries.data, entries.data, query]);
  return (
    <StateBoundary state={toAsyncState(trades)} label="trade notes" onRetry={retryRead(trades.refresh)} loading={<LoadingState label="Loading trade notes" rows={4} />}
      empty={{ "no-records": <div className="ds-card"><EmptyState kind="no-records" title="No trades yet" description="Notes you write in a trade's review appear here." /></div> }}>
      {() => (
        <div className="jr-notes">
          <SearchField label="Search trade notes" value={query} onValueChange={setQuery} placeholder="Search notes, symbols and tags" />
          {notes.length === 0 ? (
            <div className="ds-card"><EmptyState kind={query ? "no-matches" : "no-records"} size="compact" title={query ? undefined : "No trade notes yet"} description={query ? "No notes match this search." : "Write a plan or reflection in a trade's review and it appears here."} /></div>
          ) : (
            <ul className="jr-note-list">
              {notes.map(n => (
                <li key={n.key} className="ds-card jr-note-item">
                  <div className="jr-note-head">
                    <Badge>{n.kind}</Badge>
                    <span className="ds-sym">{n.trade.symbol}</span>
                    <span className="ds-faint">{longDay(n.trade.tradingDay)}</span>
                    <NetPnl trade={n.trade} />
                    <Button size="sm" variant="ghost" onClick={() => navigate(tradePath(n.trade.id))}>Open trade</Button>
                  </div>
                  <strong>{n.title}</strong>
                  <p className="jr-excerpt">{n.body.length > 400 ? `${n.body.slice(0, 400)}…` : n.body}</p>
                  {n.tags.length > 0 && <TagList tags={n.tags} limit={6} />}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </StateBoundary>
  );
}

/* ---------- Daily journals: the account's daily reviews (Build 22) and earlier day notes ---------- */

type ReviewFilter = "all" | "draft" | "completed";

function DailyJournals({ account }: { account: AccountViewModel }) {
  const navigate = useNavigate();
  const index = useDailyReviewIndex(account.id);
  const entries = useJournalEntries(account.id);
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const open = (day: string) => navigate(dailyReviewPath(account.id, day));
  return (
    <div className="jr-notes">
      <StateBoundary state={toAsyncState(index)} label="daily reviews" onRetry={retryRead(index.refresh)} loading={<LoadingState label="Loading daily reviews" rows={3} />}>
        {data => {
          const reviews = data.reviews.filter(r => filter === "all" || r.status === filter);
          const drafts = data.reviews.filter(r => r.status === "draft").length;
          return (
            <>
              <div className="jr-days-bar">
                <SegmentedControl<ReviewFilter> label="Show" value={filter} onValueChange={setFilter} options={[
                  { value: "all", label: "All", count: data.reviews.length }, { value: "draft", label: "Drafts", count: drafts },
                  { value: "completed", label: "Completed", count: data.reviews.length - drafts },
                ]} />
                <div className="jr-row">
                  <Button size="sm" onClick={() => open(data.currentTradingDay)}>Review today</Button>
                  <DayChooser initial={data.currentTradingDay} label="Review a day" onChoose={open} />
                </div>
              </div>
              {reviews.length === 0 ? (
                <div className="ds-card"><EmptyState kind={data.reviews.length ? "no-matches" : "no-records"} size="compact"
                  title={data.reviews.length ? undefined : "No daily reviews yet"}
                  description={data.reviews.length ? "No reviews match this filter." : "Plan a session or review a day, with or without trades. Each review is kept per account and trading day."} /></div>
              ) : (
                <ul className="dr-list" aria-label="Daily reviews">
                  {reviews.map(r => {
                    const status = statusView(r);
                    return (
                      <li key={r.id} className="ds-card dr-list-item">
                        <div className="dr-list-head">
                          <strong>{longDay(r.tradingDay)}</strong>
                          <Badge tone={status.tone}>{status.label}</Badge>
                          {r.planTiming === "retrospective" && <Badge tone="warn">Plan written afterwards</Badge>}
                          {r.tradesChanged && <Badge tone="warn">Trades changed since</Badge>}
                          <span className="dr-spacer" />
                          {r.status === "draft"
                            ? <Button size="sm" variant="primary" onClick={() => open(r.tradingDay)} aria-label={`Resume draft, ${longDay(r.tradingDay)}`}>Resume draft</Button>
                            : <>
                                <Button size="sm" variant="ghost" onClick={() => open(r.tradingDay)} aria-label={`Open review, ${longDay(r.tradingDay)}`}>Open</Button>
                                <Button size="sm" onClick={() => open(r.tradingDay)} disabled={data.archived} disabledReason={data.archived ? "Archived accounts are read-only" : undefined} aria-label={`Edit review, ${longDay(r.tradingDay)}`}>Edit</Button>
                              </>}
                        </div>
                        <div className="dr-list-head ds-faint">
                          <span>{adherenceShort(r.adherence)}</span>
                          <span aria-hidden="true">·</span>
                          {r.outcome.trades === 0
                            ? <span>{r.noTradeDay ? "No-trade day" : "No trades recorded"}</span>
                            : <span>Closed trades <MoneyCell value={r.outcome.net} currency={account.currency} />{r.outcome.unknownPnl > 0 && ` (${r.outcome.unknownPnl} unknown P&L left out)`}</span>}
                        </div>
                        {r.keyLesson && <p className="jr-excerpt"><b>Key lesson:</b> {r.keyLesson.length > 300 ? `${r.keyLesson.slice(0, 300)}…` : r.keyLesson}</p>}
                      </li>
                    );
                  })}
                </ul>
              )}
              <LegacyNotes account={account} notes={data.legacyNotes} entries={entries.data ?? []} onOpenDay={open} />
            </>
          );
        }}
      </StateBoundary>
    </div>
  );
}

/** Journal entries without a trade written before daily reviews: kept as they are, never counted as reviews. */
function LegacyNotes({ account, notes, entries, onOpenDay }: {
  account: AccountViewModel; notes: readonly LegacyDayNote[]; entries: readonly { id: string; body: string; tags: readonly string[] }[]; onOpenDay: (day: string) => void;
}) {
  if (notes.length === 0) return null;
  return (
    <details className="ds-card dr-history">
      <summary>Earlier day notes ({notes.length})</summary>
      <p className="ds-faint">Notes written before daily reviews existed. They are kept unchanged and read only, and are not counted as reviews.</p>
      <ul className="jr-note-list">
        {notes.map(n => {
          const entry = entries.find(e => e.id === n.id);
          return (
            <li key={n.id} className="jr-note-item">
              <div className="jr-note-head">
                <Badge>Day note</Badge>
                <span className="ds-faint">{formatInstant(n.entryAt, { timeZone: account.timezone, year: true })} · trading day {n.tradingDay}</span>
                <Button size="sm" variant="ghost" onClick={() => onOpenDay(n.tradingDay)}>Open that day's review</Button>
              </div>
              <strong>{n.title}</strong>
              {entry && <p className="jr-excerpt">{entry.body}</p>}
              {entry && entry.tags.length > 0 && <span className="jr-tags">{entry.tags.map(t => <Badge key={t} variant="outline">{t}</Badge>)}</span>}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/* ---------- Shared library pieces ---------- */

const NOUNS: Record<LibraryChange["entity"], string> = { strategy: "playbook", tag: "tag", checklist: "checklist" };
type LibraryWrite = UncertainWrite & { canSubmit: boolean; submitted?: LibraryChange };
const isUncertain = (error: unknown) => (error as { category?: string } | null)?.category === "uncertain-outcome";
const LOCKED = "Check the result of the last library change first";

/**
 * What an uncertain library write is checked against: the item it sent as stored now (by id, or by name for a new
 * one), from a fresh read of the library. Stored values and fixed copy only.
 */
function LibraryWriteReview({ write, change }: { write: UncertainWrite; change: LibraryChange | undefined }) {
  const library = useLibrary();
  const lib = library.data;
  const noun = change ? NOUNS[change.entity] : "item";
  const wanted = change?.name?.trim().toLowerCase() ?? null;
  const pool: (Strategy | Tag | Checklist)[] = !lib || !change ? [] : change.entity === "strategy" ? lib.strategies : change.entity === "tag" ? lib.tags : lib.checklists;
  const found = pool.filter(item => (change?.id ? item.id === change.id : wanted !== null && item.name.trim().toLowerCase() === wanted));
  const details = (item: Strategy | Tag | Checklist) => [
    { label: "Name", value: item.name },
    { label: "Status", value: item.archived ? "Archived" : "Active" },
    ...("kind" in item ? [{ label: "Kind", value: TAG_KIND_LABELS[item.kind] }] : []),
    ...("items" in item ? [{ label: "Items", value: String(item.items.filter(i => !i.archived).length) }] : []),
    ...("description" in item && !("items" in item) ? [{ label: "Description", value: item.description?.trim() ? item.description : "None" }] : []),
  ];
  return (
    <UncertainOutcomeReview write={write} what="the library" reviewReady={lib !== undefined && !library.error} readReviewed={library.refresh}>
      {found.length
        ? found.map(item => <StatList key={item.id} label={change?.id ? `The ${noun} as saved now` : `Saved ${noun}s with this name`} items={details(item)} />)
        : <p>{change?.id || !change?.name ? `This ${noun} isn't in the library.` : `No ${noun} named “${change.name.trim()}” is in the library.`}</p>}
    </UncertainOutcomeReview>
  );
}

type ArchiveTarget = { entity: "strategy" | "tag" | "checklist"; id: string; archived: boolean; name: string };

/**
 * Archive (after a confirmation) or restore (at once) through the existing `set_archived` mutation. `request` starts
 * it; `dialog` must be rendered. Archiving only hides an item from new choices; nothing is deleted or untagged.
 */
function useArchive({ entity, id, archived, name }: ArchiveTarget, body?: ReactNode) {
  const set = useSetArchived();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const run = () => set.submit({ entity, id, archived: !archived }).then(() => toast.show({ tone: "success", title: archived ? `${name} restored` : `${name} archived` }));
  const locked = !set.canSubmit && !set.isPending;
  // An uncertain restore is checked at the top of the library, never reported as "nothing changed".
  const request = () => (archived ? void run().catch(error => { if (!isUncertain(error)) toast.show({ tone: "error", title: "Nothing changed", description: "Try again." }); }) : setConfirm(true));
  const dialog = (
    <ConfirmDialog open={confirm} onOpenChange={setConfirm} tone="neutral" title={`Archive ${name}?`} confirmLabel="Archive" onConfirm={async () => { await run(); setConfirm(false); }}
      describeError={error => (isUncertain(error)
        ? "No answer came back, so it may have been archived. Close this and check the library on this page; nothing is sent again."
        : "It wasn't archived. Try again.")}>
      {body ?? <p>It can't be chosen for new reviews. Reviews that use it keep it exactly as recorded, and you can restore it later. Nothing is deleted.</p>}
    </ConfirmDialog>
  );
  return { request, dialog, pending: set.isPending, locked };
}

function ArchiveButton(target: ArchiveTarget) {
  const archive = useArchive(target);
  return (
    <>
      <Button size="sm" variant="ghost" loading={archive.pending} disabled={archive.locked} disabledReason={archive.locked ? LOCKED : undefined} onClick={archive.request}>
        {target.archived ? "Restore" : "Archive"}
      </Button>
      {archive.dialog}
    </>
  );
}

function NameDialog({ title, open, onOpenChange, initial, onSave, kindChoice, description, write }: {
  title: string; open: boolean; onOpenChange: (o: boolean) => void; initial: { name: string; description?: string; kind?: TagKind };
  onSave: (v: { name: string; description: string; kind: TagKind }) => Promise<unknown>; kindChoice?: boolean; description?: boolean; write: LibraryWrite;
}) {
  const [name, setName] = useState(initial.name);
  const [text, setText] = useState(initial.description ?? "");
  const [kind, setKind] = useState<TagKind>(initial.kind ?? "setup");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError("Required"); return; }
    if (busy || !write.canSubmit) return;
    setBusy(true);
    onSave({ name: name.trim(), description: text, kind }).then(() => onOpenChange(false), (err: { category?: string; issues?: { message: string }[] }) => {
      if (isUncertain(err)) return; // Checked in LibraryWriteReview below; the entries stay.
      setError(err?.category === "conflict" ? "That name is already used" : err?.issues?.[0]?.message ?? "It wasn't saved. Try again.");
    }).finally(() => setBusy(false));
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} dismissible={!busy}
      footer={<><Button onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button><Button type="submit" form="jr-name-form" variant="primary" loading={busy}
        disabled={!busy && !write.canSubmit} disabledReason={!busy && !write.canSubmit ? LOCKED : undefined}>Save</Button></>}>
      <form id="jr-name-form" onSubmit={submit} noValidate className="jr-form">
        {write.outcome === "uncertain-outcome" && <LibraryWriteReview write={write} change={write.submitted} />}
        <TextField label="Name" required autoFocus value={name} onChange={e => { setName(e.target.value); setError(null); }} error={error} maxLength={kindChoice ? 40 : 80} />
        {kindChoice && <RadioGroup<TagKind> label="Kind" inline value={kind} onValueChange={setKind} options={tagKinds.map(k => ({ value: k, label: TAG_KIND_LABELS[k] }))} />}
        {description && <Textarea label="Description" optional rows={4} value={text} onChange={e => setText(e.target.value)} maxLength={20_000} placeholder="When you take it, how you manage it" />}
        {initial.name && <p className="ds-faint">Renaming doesn't change reviews already made: they keep the name they were reviewed under.</p>}
      </form>
    </Dialog>
  );
}

/* ---------- Playbooks (strategies) ---------- */

function Playbooks({ strategies, checklists }: { strategies: Strategy[]; checklists: Checklist[] }) {
  const save = useSaveStrategy();
  const [editing, setEditing] = useState<Strategy | "new" | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const shown = strategies.filter(s => showArchived || !s.archived);
  return (
    <div className="jr-lib-section">
      <div className="jr-lib-bar">
        <p className="ds-faint">A playbook is a strategy you trade. Choose one on a trade's review; link checklists to it in Templates.</p>
        <Button icon={<Plus size={16} aria-hidden="true" />} onClick={() => setEditing("new")}>New playbook</Button>
      </div>
      {shown.length === 0 ? (
        <div className="ds-card"><EmptyState kind="no-records" size="compact" title="No playbooks yet" description="Add the setups you trade so each review can name its strategy." /></div>
      ) : (
        <ul className="jr-lib-list">
          {shown.map(s => (
            <li key={s.id} className="ds-card jr-lib-item">
              <div className="jr-lib-head">
                <strong>{s.name}</strong>
                {s.archived && <Badge tone="warn">Archived</Badge>}
                <span className="ds-faint">{s.reviewCount} {s.reviewCount === 1 ? "review" : "reviews"} · {checklists.filter(c => c.strategyId === s.id && !c.archived).length} checklists</span>
                <span className="jr-lib-actions">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>Edit</Button>
                  <ArchiveButton entity="strategy" id={s.id} archived={s.archived} name={s.name} />
                </span>
              </div>
              {s.description && <p className="jr-excerpt">{s.description}</p>}
            </li>
          ))}
        </ul>
      )}
      {strategies.some(s => s.archived) && <Button size="sm" variant="ghost" onClick={() => setShowArchived(v => !v)}>{showArchived ? "Hide archived" : "Show archived"}</Button>}
      {editing && (
        <NameDialog title={editing === "new" ? "New playbook" : `Edit ${editing.name}`} open onOpenChange={o => !o && setEditing(null)} description
          initial={editing === "new" ? { name: "" } : { name: editing.name, description: editing.description ?? "" }} write={save}
          onSave={v => save.submit({ id: editing === "new" ? null : editing.id, input: { name: v.name, description: v.description.trim() || null } })} />
      )}
    </div>
  );
}

/* ---------- Templates (checklists) ---------- */

function Templates({ checklists, strategies }: { checklists: Checklist[]; strategies: Strategy[] }) {
  const [editing, setEditing] = useState<Checklist | "new" | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const shown = checklists.filter(c => showArchived || !c.archived);
  const strategyName = (id: string | null) => strategies.find(s => s.id === id)?.name;
  return (
    <div className="jr-lib-section">
      <div className="jr-lib-bar">
        <p className="ds-faint">Checklists are answered on a trade's review (trade checklists) or with the day (daily checklists, used by the daily review).</p>
        <Button icon={<Plus size={16} aria-hidden="true" />} onClick={() => setEditing("new")}>New checklist</Button>
      </div>
      {shown.length === 0 ? (
        <div className="ds-card"><EmptyState kind="no-records" size="compact" title="No checklists yet" description="Write the rules you check before and during a trade." /></div>
      ) : (
        <ul className="jr-lib-list">
          {shown.map(c => (
            <li key={c.id} className="ds-card jr-lib-item">
              <div className="jr-lib-head">
                <strong>{c.name}</strong>
                <Badge tone="flow" variant="outline">{c.scope === "trade" ? "Trade" : "Daily"}</Badge>
                {c.archived && <Badge tone="warn">Archived</Badge>}
                <span className="ds-faint">{strategyName(c.strategyId) ? `${strategyName(c.strategyId)} · ` : ""}{c.items.filter(i => !i.archived).length} items · {c.reviewCount} {c.reviewCount === 1 ? "review" : "reviews"}</span>
                <span className="jr-lib-actions">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>Edit</Button>
                  <ArchiveButton entity="checklist" id={c.id} archived={c.archived} name={c.name} />
                </span>
              </div>
              <ol className="jr-check-preview">{c.items.filter(i => !i.archived).map(i => <li key={i.id}>{i.label}</li>)}</ol>
            </li>
          ))}
        </ul>
      )}
      {checklists.some(c => c.archived) && <Button size="sm" variant="ghost" onClick={() => setShowArchived(v => !v)}>{showArchived ? "Hide archived" : "Show archived"}</Button>}
      {editing && <ChecklistDialog checklist={editing === "new" ? null : editing} strategies={strategies} onClose={() => setEditing(null)} />}
    </div>
  );
}

interface ItemDraft { key: string; id: string | null; label: string }

function ChecklistDialog({ checklist, strategies, onClose }: { checklist: Checklist | null; strategies: Strategy[]; onClose: () => void }) {
  const save = useSaveChecklist();
  const toast = useToast();
  const initial = useMemo(() => ({
    name: checklist?.name ?? "", description: checklist?.description ?? "", scope: checklist?.scope ?? "trade" as "trade" | "daily",
    strategyId: checklist?.strategyId ?? null as string | null,
    items: (checklist?.items ?? []).filter(i => !i.archived).map(i => ({ key: i.id, id: i.id as string | null, label: i.label })) as ItemDraft[],
  }), [checklist]);
  const [v, setV] = useState(initial);
  const [confirm, setConfirm] = useState(false);
  const [next, setNext] = useState(1);
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  const errors = fieldErrors(save.error);
  const archivedItems = (checklist?.items ?? []).filter(i => i.archived);
  const move = (i: number, d: -1 | 1) => setV(s => { const items = [...s.items]; [items[i], items[i + d]] = [items[i + d], items[i]]; return { ...s, items }; });
  const close = () => (dirty ? setConfirm(true) : onClose());
  const uncertain = save.outcome === "uncertain-outcome";
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!save.canSubmit) return;
    const input: ChecklistInput = {
      name: v.name.trim(), description: v.description.trim() || null, scope: v.scope, strategyId: v.scope === "trade" ? v.strategyId : null,
      items: v.items.filter(i => i.label.trim() !== "").map(i => ({ id: i.id, label: i.label.trim() })),
    };
    save.submit({ id: checklist?.id ?? null, input }).then(saved => { toast.show({ tone: "success", title: `${saved.name} saved` }); onClose(); }, () => {});
  };
  return (
    <>
      <Dialog open onOpenChange={o => !o && close()} size="lg" title={checklist ? `Edit ${checklist.name}` : "New checklist"} dismissible={!save.isPending}
        description="Renaming or removing an item never changes past reviews: their answers keep the label they were given under."
        footer={<><Button onClick={close} disabled={save.isPending}>Cancel</Button><Button type="submit" form="jr-checklist-form" variant="primary" loading={save.isPending}
          disabled={!save.isPending && !save.canSubmit} disabledReason={uncertain ? LOCKED : !save.isPending && !save.canSubmit ? "Saving isn't available right now" : undefined}>Save checklist</Button></>}>
        <form id="jr-checklist-form" onSubmit={submit} noValidate className="jr-form">
          {uncertain && <LibraryWriteReview write={save} change={save.submitted} />}
          {!uncertain && save.error && !Object.keys(errors).length && <InlineNotice tone="error">{save.error.category === "conflict" ? "It changed elsewhere. Close and reopen it." : "It wasn't saved. Try again."}</InlineNotice>}
          <TextField label="Name" required autoFocus value={v.name} onChange={e => setV(s => ({ ...s, name: e.target.value }))} error={errors.name} maxLength={80} />
          <RadioGroup<"trade" | "daily"> label="Used for" inline value={v.scope} onValueChange={scope => setV(s => ({ ...s, scope }))} error={errors.scope}
            options={[{ value: "trade", label: "Each trade" }, { value: "daily", label: "Each day" }]} disabled={(checklist?.reviewCount ?? 0) > 0} />
          {v.scope === "trade" && (
            <Select label="Playbook" placeholder="Any playbook" value={v.strategyId ?? "__none"} onValueChange={id => setV(s => ({ ...s, strategyId: id === "__none" ? null : id }))} error={errors.strategyId}
              options={[{ value: "__none", label: "Not tied to a playbook" }, ...strategies.filter(s => !s.archived || s.id === v.strategyId).map(s => ({ value: s.id, label: s.name }))]} />
          )}
          <Textarea label="Description" optional rows={2} value={v.description} onChange={e => setV(s => ({ ...s, description: e.target.value }))} maxLength={20_000} />
          <fieldset className="ds-fieldset">
            <legend className="ds-field-label">Items, in order</legend>
            <ol className="jr-item-editor">
              {v.items.map((item, i) => (
                <li key={item.key} className="jr-row">
                  <TextField label={`Item ${i + 1}`} hideLabel value={item.label} maxLength={200} error={errors[`items.${i}.label`]}
                    onChange={e => setV(s => ({ ...s, items: s.items.map((x, n) => (n === i ? { ...x, label: e.target.value } : x)) }))} />
                  <IconButton size="sm" variant="ghost" label={`Move item ${i + 1} up`} icon={<ArrowUp size={14} aria-hidden="true" />} disabled={i === 0} onClick={() => move(i, -1)} />
                  <IconButton size="sm" variant="ghost" label={`Move item ${i + 1} down`} icon={<ArrowDown size={14} aria-hidden="true" />} disabled={i === v.items.length - 1} onClick={() => move(i, 1)} />
                  <IconButton size="sm" variant="ghost" label={`Remove item ${i + 1}`} icon={<X size={14} aria-hidden="true" />} onClick={() => setV(s => ({ ...s, items: s.items.filter((_, n) => n !== i) }))} />
                </li>
              ))}
            </ol>
            <Button size="sm" icon={<Plus size={14} aria-hidden="true" />} disabled={v.items.length >= 50}
              onClick={() => { setV(s => ({ ...s, items: [...s.items, { key: `new-${next}`, id: null, label: "" }] })); setNext(n => n + 1); }}>Add item</Button>
            {archivedItems.length > 0 && (
              <details className="jr-archived-items">
                <summary>{archivedItems.length} removed {archivedItems.length === 1 ? "item" : "items"} (kept for past reviews)</summary>
                <ul>{archivedItems.map(i => (
                  <li key={i.id} className="jr-row"><span>{i.label}</span>
                    <Button size="sm" variant="ghost" disabled={v.items.some(x => x.id === i.id)} onClick={() => setV(s => ({ ...s, items: [...s.items, { key: i.id, id: i.id, label: i.label }] }))}>Bring back</Button>
                  </li>
                ))}</ul>
              </details>
            )}
          </fieldset>
        </form>
      </Dialog>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} tone="neutral" title="Discard your changes?" confirmLabel="Discard" onConfirm={async () => { setConfirm(false); onClose(); }}>
        <p>The checklist hasn't been saved.</p>
      </ConfirmDialog>
    </>
  );
}

/* ---------- Tags ---------- */

const usedIn = (n: number) => (n === 0 ? "Not used yet" : `Used in ${n.toLocaleString("en-US")} ${n === 1 ? "review" : "reviews"}`);

/** One tag as a pill with its own menu (P0-D12): Rename… and Archive… (or Restore), never an X. */
function TagPill({ tag, onRename }: { tag: Tag; onRename: () => void }) {
  const archive = useArchive({ entity: "tag", id: tag.id, archived: tag.archived, name: tag.name }, (
    <p>
      It won't be offered for new reviews.{" "}
      {tag.reviewCount > 0 ? `The ${tag.reviewCount === 1 ? "review" : `${tag.reviewCount.toLocaleString("en-US")} reviews`} already tagged with it keep it exactly as recorded` : "No review uses it yet"}
      : archiving doesn't remove it from any trade and deletes nothing. You can restore it later.
    </p>
  ));
  return (
    <li>
      <ActionPill
        label={tag.name}
        muted={tag.archived}
        badge={tag.archived ? <Badge tone="warn">Archived</Badge> : undefined}
        meta={usedIn(tag.reviewCount)}
        actionsLabel={`Actions for tag ${tag.name}`}
        actions={[
          { label: "Rename…", onSelect: onRename },
          // While an uncertain library change is unchecked, archive and restore wait (the check is at the top of the library).
          { label: tag.archived ? "Restore" : "Archive…", onSelect: archive.request, disabled: archive.pending || archive.locked },
        ]}
      />
      {archive.dialog}
    </li>
  );
}

function Tags({ tags }: { tags: Tag[] }) {
  const save = useSaveTag();
  const [editing, setEditing] = useState<Tag | { kind: TagKind } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  // The name dialog unmounts when it closes, so it can't return focus itself: send it back to what opened it (the
  // tag's menu button, which a menu action leaves focused, or Add).
  const opener = useRef<HTMLElement | null>(null);
  const edit = (target: Tag | { kind: TagKind }) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setEditing(target);
  };
  const closeEditor = () => {
    setEditing(null);
    requestAnimationFrame(() => { if (opener.current?.isConnected) opener.current.focus(); });
  };
  return (
    <div className="jr-lib-section">
      <p className="ds-faint">Setup, mistake, mindset and general tags are chosen on a trade's review. Renaming a tag keeps past reviews as they were tagged.</p>
      <div className="jr-tag-columns">
        {tagKinds.map(kind => {
          const list = tags.filter(t => t.kind === kind && (showArchived || !t.archived));
          return (
            <section key={kind} className="ds-card jr-tag-col" aria-labelledby={`jr-tags-${kind}`}>
              <div className="jr-lib-head">
                <h3 id={`jr-tags-${kind}`}>{TAG_KIND_LABELS[kind]}</h3>
                <Button size="sm" icon={<Plus size={14} aria-hidden="true" />} onClick={() => edit({ kind })}>Add</Button>
              </div>
              {list.length === 0 ? <p className="ds-faint">None yet.</p> : (
                <ul className="jr-tag-pills">
                  {list.map(t => <TagPill key={t.id} tag={t} onRename={() => edit(t)} />)}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      {tags.some(t => t.archived) && <Button size="sm" variant="ghost" onClick={() => setShowArchived(v => !v)}>{showArchived ? "Hide archived" : "Show archived"}</Button>}
      {editing && (
        <NameDialog title={"id" in editing ? `Rename ${editing.name}` : `New ${TAG_KIND_LABELS[editing.kind].toLowerCase()} tag`} open kindChoice
          onOpenChange={o => !o && closeEditor()}
          initial={"id" in editing ? { name: editing.name, kind: editing.kind } : { name: "", kind: editing.kind }} write={save}
          onSave={v => save.submit({ id: "id" in editing ? editing.id : null, input: { name: v.name, kind: v.kind } })} />
      )}
    </div>
  );
}
