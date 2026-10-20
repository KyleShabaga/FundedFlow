// Minimal panel that exercises the local data layer end to end: accounts,
// trades, journal entries and CSV import. Not the product UI.

import { type FormEvent, useCallback, useEffect, useState } from "react";

import { DataError, repository } from "../lib/data/api";
import { AccountLifecyclePanel } from "./AccountLifecycle";
import { ConfirmDialog } from "./ConfirmDialog";
import { CsvImportSection } from "./CsvImportSection";
import type { Account, ImportBatch, JournalEntry, Trade } from "../lib/data/schemas";
import "./DataModelPanel.css";

const DEFAULT_TZ = "America/New_York";

/** `<input type="datetime-local">` value → ISO instant in the computer's zone. */
const toInstant = (local: string) => (local ? new Date(local).toISOString() : null);
const blankToNull = (s: string) => (s.trim() ? s : null);
const shortTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");
const tradeLabel = (t: Trade) => `${t.tradingDay} ${t.symbol} ${t.side} ${t.quantity} @ ${t.entryPrice}`;
const excerpt = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);

function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const issues = error instanceof DataError ? error.issues : [];
  return (
    <div className="ff-error" role="alert">
      {error instanceof Error ? error.message : String(error)}
      {issues.length > 1 && (
        <ul>
          {issues.map((i) => (
            <li key={i.field + i.message}>
              <code>{i.field}</code>: {i.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DataModelPanel() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState("");
  const [trades, setTrades] = useState<Trade[]>([]);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [imports, setImports] = useState<ImportBatch[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  // The record a delete confirmation is open for.
  const [deletingTrade, setDeletingTrade] = useState<Trade | null>(null);
  const [deletingEntry, setDeletingEntry] = useState<JournalEntry | null>(null);

  const run = useCallback(async (action: () => Promise<unknown>) => {
    setError(null);
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(e);
    }
  }, []);

  const loadAccounts = useCallback(async () => {
    const list = await repository.accounts.list();
    setAccounts(list);
    setAccountId((current) => (list.some((a) => a.id === current) ? current : (list[0]?.id ?? "")));
  }, []);

  const loadAccountData = useCallback(async () => {
    if (!accountId) {
      setTrades([]);
      setEntries([]);
      setImports([]);
      return;
    }
    const [t, j, i] = await Promise.all([
      repository.trades.list(accountId),
      repository.journal.list(accountId),
      repository.imports.list(accountId),
    ]);
    setTrades(t);
    setEntries(j);
    setImports(i);
  }, [accountId]);

  useEffect(() => void run(loadAccounts), [run, loadAccounts]);
  useEffect(() => void run(loadAccountData), [run, loadAccountData]);

  const account = accounts.find((a) => a.id === accountId);

  // --- accounts -------------------------------------------------------------
  const [accountForm, setAccountForm] = useState({ name: "", propFirm: "", startingBalance: "50000" });
  const createAccount = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const a = await repository.accounts.create({
        name: accountForm.name,
        broker: null,
        propFirm: blankToNull(accountForm.propFirm),
        externalRef: null,
        accountType: "evaluation",
        status: "active",
        currency: "USD",
        startingBalance: accountForm.startingBalance,
        timezone: DEFAULT_TZ,
        tradingDayResetTime: "17:00",
        notes: null,
      });
      setAccountForm({ name: "", propFirm: "", startingBalance: "50000" });
      setAccountId(a.id);
      await loadAccounts();
    });
  };
  const archiveAccount = () => {
    if (!account || !window.confirm(`Archive "${account.name}"? It will be hidden; its trades and journal are kept.`)) return;
    void run(async () => {
      await repository.accounts.archive(account.id);
      await loadAccounts();
    });
  };

  // --- trades ---------------------------------------------------------------
  const emptyTrade = { symbol: "MESZ6", side: "long", quantity: "1", entryAt: "", entryPrice: "", exitAt: "", exitPrice: "", fees: "" };
  const [tradeForm, setTradeForm] = useState(emptyTrade);
  const setTrade = (k: keyof typeof emptyTrade) => (e: { target: { value: string } }) =>
    setTradeForm((f) => ({ ...f, [k]: e.target.value }));
  const createTrade = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await repository.trades.create({
        accountId,
        symbol: tradeForm.symbol,
        side: tradeForm.side as "long" | "short",
        quantity: tradeForm.quantity,
        entryAt: toInstant(tradeForm.entryAt) ?? "",
        entryPrice: tradeForm.entryPrice,
        exitAt: toInstant(tradeForm.exitAt),
        exitPrice: blankToNull(tradeForm.exitPrice),
        fees: blankToNull(tradeForm.fees),
        realizedPnl: null,
        notes: null,
      });
      setTradeForm(emptyTrade);
      await loadAccountData();
    });
  };

  // Deletion happens only from the confirmation dialog. A failed delete throws
  // so the dialog reports it; refreshing afterwards is separate, so a refresh
  // error is not mistaken for a failed delete.
  const deleteTrade = async (t: Trade) => {
    await repository.trades.remove(t.id);
    void run(loadAccountData).then(() => setNotice(`Deleted trade ${tradeLabel(t)}.`));
  };

  // --- journal --------------------------------------------------------------
  const [journalForm, setJournalForm] = useState({ title: "", body: "", tags: "", tradeId: "" });
  const createEntry = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await repository.journal.create({
        accountId,
        tradeId: blankToNull(journalForm.tradeId),
        entryAt: new Date().toISOString(),
        title: journalForm.title,
        body: journalForm.body,
        tags: journalForm.tags.split(","),
      });
      setJournalForm({ title: "", body: "", tags: "", tradeId: "" });
      await loadAccountData();
    });
  };
  const deleteEntry = async (j: JournalEntry) => {
    await repository.journal.remove(j.id);
    void run(loadAccountData).then(() => setNotice(`Deleted journal entry "${j.title}".`));
  };

  return (
    <section className="ff-panel">
      <h2>Local data (developer panel)</h2>
      <ErrorBox error={error} />
      <div role="status" aria-live="polite" className="ff-status">{notice}</div>

      <fieldset>
        <legend>Accounts</legend>
        <div className="ff-row">
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label="Account">
            {accounts.length === 0 && <option value="">No accounts yet</option>}
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.propFirm ?? "no firm"} · {a.status} · {a.currency} {a.startingBalance}
              </option>
            ))}
          </select>
          <button type="button" onClick={archiveAccount} disabled={!account}>
            Archive
          </button>
        </div>
        <form className="ff-row" onSubmit={createAccount}>
          <input placeholder="Account name" value={accountForm.name} onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })} />
          <input placeholder="Prop firm (optional)" value={accountForm.propFirm} onChange={(e) => setAccountForm({ ...accountForm, propFirm: e.target.value })} />
          <input placeholder="Starting balance" value={accountForm.startingBalance} onChange={(e) => setAccountForm({ ...accountForm, startingBalance: e.target.value })} />
          <button type="submit">Add account</button>
        </form>
      </fieldset>

      <AccountLifecyclePanel
        onChanged={async (focus) => {
          await loadAccounts();
          if (focus && !focus.archivedAt) setAccountId(focus.id);
        }}
      />

      {account && (
        <>
          <fieldset>
            <legend>Trades ({trades.length})</legend>
            <form className="ff-row" onSubmit={createTrade}>
              <input aria-label="Symbol" value={tradeForm.symbol} onChange={setTrade("symbol")} size={7} />
              <select aria-label="Side" value={tradeForm.side} onChange={setTrade("side")}>
                <option value="long">long</option>
                <option value="short">short</option>
              </select>
              <input aria-label="Quantity" value={tradeForm.quantity} onChange={setTrade("quantity")} size={3} />
              <input aria-label="Entry time" type="datetime-local" value={tradeForm.entryAt} onChange={setTrade("entryAt")} />
              <input aria-label="Entry price" placeholder="Entry" value={tradeForm.entryPrice} onChange={setTrade("entryPrice")} size={8} />
              <input aria-label="Exit time" type="datetime-local" value={tradeForm.exitAt} onChange={setTrade("exitAt")} />
              <input aria-label="Exit price" placeholder="Exit" value={tradeForm.exitPrice} onChange={setTrade("exitPrice")} size={8} />
              <input aria-label="Fees" placeholder="Fees" value={tradeForm.fees} onChange={setTrade("fees")} size={5} />
              <button type="submit">Add trade</button>
            </form>
            <table>
              <thead>
                <tr>
                  <th>Day</th><th>Symbol</th><th>Side</th><th>Qty</th><th>Entry</th><th>Exit</th><th>Fees</th><th>Net P&amp;L</th><th>Source</th><th />
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => (
                  <tr key={t.id}>
                    <td>{t.tradingDay}</td>
                    <td>{t.symbol}</td>
                    <td>{t.side}</td>
                    <td>{t.quantity}</td>
                    <td title={shortTime(t.entryAt)}>{t.entryPrice}</td>
                    <td title={shortTime(t.exitAt)}>{t.exitPrice ?? "—"}</td>
                    <td>{t.fees}</td>
                    <td title={t.pnlStatus}>{t.realizedPnl ?? t.pnlStatus}</td>
                    <td>{t.source}</td>
                    <td>
                      <button type="button" aria-label={`Delete trade ${tradeLabel(t)}`} onClick={() => setDeletingTrade(t)}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </fieldset>

          <fieldset>
            <legend>Journal ({entries.length})</legend>
            <form className="ff-row" onSubmit={createEntry}>
              <input placeholder="Title" value={journalForm.title} onChange={(e) => setJournalForm({ ...journalForm, title: e.target.value })} />
              <input placeholder="Body" value={journalForm.body} onChange={(e) => setJournalForm({ ...journalForm, body: e.target.value })} />
              <input placeholder="tags, comma separated" value={journalForm.tags} onChange={(e) => setJournalForm({ ...journalForm, tags: e.target.value })} />
              <select aria-label="Linked trade" value={journalForm.tradeId} onChange={(e) => setJournalForm({ ...journalForm, tradeId: e.target.value })}>
                <option value="">No trade</option>
                {trades.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.tradingDay} {t.symbol} {t.side} {t.realizedPnl ?? ""}
                  </option>
                ))}
              </select>
              <button type="submit">Add entry</button>
            </form>
            <ul>
              {entries.map((j) => (
                <li key={j.id}>
                  <strong>{j.title}</strong> · {shortTime(j.entryAt)}
                  {j.tradeId && " · linked trade"}
                  {j.tags.length > 0 && ` · #${j.tags.join(" #")}`}
                  {j.body && <div>{j.body}</div>}
                  <button type="button" aria-label={`Delete journal entry ${j.title}`} onClick={() => setDeletingEntry(j)}>×</button>
                </li>
              ))}
            </ul>
          </fieldset>

          <CsvImportSection accountId={accountId} imports={imports} onImported={loadAccountData} />
        </>
      )}

      <ConfirmDialog
        open={deletingTrade !== null}
        title="Delete this trade?"
        confirmLabel="Delete trade"
        onConfirm={() => deleteTrade(deletingTrade!)}
        onClose={() => setDeletingTrade(null)}
      >
        {deletingTrade && (
          <>
            <p>
              <strong>{deletingTrade.symbol}</strong> {deletingTrade.side} {deletingTrade.quantity} on trading day{" "}
              {deletingTrade.tradingDay}
            </p>
            <p className="ff-hint">
              Entry {deletingTrade.entryPrice} at {shortTime(deletingTrade.entryAt)} · Exit {deletingTrade.exitPrice ?? "—"}{" "}
              {deletingTrade.exitAt && `at ${shortTime(deletingTrade.exitAt)}`} · Net P&amp;L{" "}
              {deletingTrade.realizedPnl ?? deletingTrade.pnlStatus} · {deletingTrade.source}
            </p>
            <p className="ff-hint">Journal entries linked to it are kept and unlinked.</p>
          </>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={deletingEntry !== null}
        title="Delete this journal entry?"
        confirmLabel="Delete entry"
        onConfirm={() => deleteEntry(deletingEntry!)}
        onClose={() => setDeletingEntry(null)}
      >
        {deletingEntry && (
          <>
            <p>
              <strong>{deletingEntry.title}</strong> · {shortTime(deletingEntry.entryAt)}
            </p>
            {deletingEntry.body && <p className="ff-hint">{excerpt(deletingEntry.body)}</p>}
            <p className="ff-hint">Its notes and tags are deleted with it. This can't be undone.</p>
          </>
        )}
      </ConfirmDialog>
    </section>
  );
}
