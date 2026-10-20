// Account history and lifecycle: status/archive filters, mark failed, start a
// new (reset) attempt, attempt lineage, archive/restore and the permanent-
// deletion preview. Reusable by the Accounts screen (docs/design/screens/02-accounts.md);
// it talks to the repository port only and never to SQLite.
//
// Meanings kept apart: the status badge is the account's result, "Archived" is
// a retention flag shown beside it, and a reset is a NEW linked account, which
// is not the account's trading-day reset time.

import * as Dialog from "@radix-ui/react-dialog";
import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from "react";

import { Badge, type Tone, formatMoney, zonedDay, zonedWallTime, zonedWallTimeToInstant } from "../design-system";
import { DataError, repository } from "../lib/data/api";
import {
  type Account,
  type AccountFilter,
  type AttemptSummary,
  type DeletionPreview,
  type ResetInput,
  type RulebookDecision,
  accountFilterLabels,
  accountFilters,
  filterAccounts,
  isHistorical,
  priorOutcomes,
  resetSources,
  statusLabels,
} from "../lib/data/schemas";
import { ConfirmDialog } from "./ConfirmDialog";
import "./AccountLifecycle.css";

// Effective times are entered and shown in the account's time zone, not the computer's.
const accountNow = (timeZone: string) => zonedWallTime(Date.now(), timeZone);
const errorText = (e: unknown) => (e instanceof DataError || e instanceof Error ? e.message : String(e));

const statusTone: Record<Account["status"], Tone> = {
  active: "flow",
  paused: "neutral",
  passed: "profit",
  failed: "loss",
  closed: "neutral",
};
const sourceLabels: Record<(typeof resetSources)[number], string> = {
  user_entered: "I entered it myself",
  provider_email: "Provider email",
  provider_dashboard: "Provider dashboard",
  other: "Other",
};

/** Result and retention shown side by side, never merged into one badge. */
export function AccountStatusBadges({ account }: { account: Pick<Account, "status" | "archivedAt"> }) {
  return (
    <span className="ff-badges">
      <Badge tone={statusTone[account.status]}>{statusLabels[account.status]}</Badge>
      {account.archivedAt && <Badge tone="neutral">Archived</Badge>}
    </span>
  );
}

function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="ff-dialog-overlay" />
        <Dialog.Content className="ff-dialog ff-dialog-wide">
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description asChild>
            <div>{children}</div>
          </Dialog.Description>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="ff-field">
      <span>{label}</span>
      {children}
      {hint && <small className="ff-hint">{hint}</small>}
    </label>
  );
}

function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  const issues = error instanceof DataError ? error.issues : [];
  return (
    <div className="ff-error" role="alert">
      {errorText(error)}
      {issues.length > 1 && (
        <ul>
          {issues.map((i) => (
            <li key={i.field + i.message}>
              {i.field}: {i.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Mark an account failed (or passed/closed) with the user's own time, cause and notes. Archives nothing. */
export function ChangeStatusDialog({
  account,
  onClose,
  onDone,
}: {
  account: Account;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [status, setStatus] = useState<Account["status"]>("failed");
  const [effectiveAt, setEffectiveAt] = useState(() => accountNow(account.timezone));
  const [cause, setCause] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await repository.accounts.changeStatus(account.id, {
        status,
        effectiveAt: zonedWallTimeToInstant(effectiveAt, account.timezone) || null,
        cause: cause.trim() || null,
        note: note.trim() || null,
      });
      await onDone();
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open title={`Change status of ${account.name}`} onClose={() => !busy && onClose()}>
      <form onSubmit={(e) => void submit(e)} className="ff-form">
        <p>
          The account keeps its trades, imports, journal and history, and is not archived or deleted. FundedFlow does
          not decide why an account failed: leave the cause empty if you do not know it.
        </p>
        <Field label="New status">
          <select value={status} onChange={(e) => setStatus(e.target.value as Account["status"])}>
            {(["failed", "passed", "closed", "paused", "active"] as const)
              .filter((s) => s !== account.status)
              .map((s) => (
                <option key={s} value={s}>
                  {statusLabels[s]}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Effective" hint={`When it took effect, in the account's time zone (${account.timezone}).`}>
          <input type="datetime-local" required value={effectiveAt} onChange={(e) => setEffectiveAt(e.target.value)} />
        </Field>
        <Field label="Cause (optional)" hint="Your own words. Empty means unknown.">
          <input value={cause} maxLength={500} onChange={(e) => setCause(e.target.value)} />
        </Field>
        <Field label="Notes or evidence (optional)">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <FormError error={error} />
        <div className="ff-row ff-dialog-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save status"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

interface RulebookOption {
  key: string;
  label: string;
  decision: RulebookDecision;
}

/** Verified catalogue versions that name the phase they apply to, so an assignment is never guessed. */
async function loadRulebookOptions(effectiveFrom: string): Promise<RulebookOption[]> {
  const rulebooks = await repository.rulebooks.list(null);
  const options: RulebookOption[] = [];
  for (const rb of rulebooks.filter((r) => r.ownerAccountId === null)) {
    for (const d of await repository.rulebooks.listVersions(rb.id)) {
      const where = d.applicability[0];
      if (d.version.verificationStatus !== "verified" || d.version.recordStatus !== "active" || !where) continue;
      options.push({
        key: d.version.id,
        label: `${rb.displayName} v${d.version.versionNumber} (verified)`,
        decision: {
          kind: "assign",
          rulebookVersionId: d.version.id,
          effectiveFrom,
          programmePhaseId: where.programmePhaseId,
          phasePathId: where.phasePathId ?? null,
        },
      });
    }
  }
  return options;
}

/**
 * Start the next evaluation attempt as a NEW linked account. Nothing is
 * pre-decided: the previous attempt's real outcome, the starting balance and
 * the rulebook choice must each be chosen. The previous attempt is preserved.
 */
export function ResetAttemptDialog({
  account,
  onClose,
  onDone,
}: {
  account: Account;
  onClose: () => void;
  onDone: (successor: Account) => Promise<void>;
}) {
  const [priorOutcome, setPriorOutcome] = useState<"" | (typeof priorOutcomes)[number]>("");
  const [effectiveAt, setEffectiveAt] = useState(() => accountNow(account.timezone));
  const [reason, setReason] = useState("");
  const [source, setSource] = useState<(typeof resetSources)[number]>("user_entered");
  const [name, setName] = useState("");
  const [externalRef, setExternalRef] = useState(account.externalRef ?? "");
  const [balance, setBalance] = useState("");
  const [rulebookKey, setRulebookKey] = useState("");
  const [options, setOptions] = useState<RulebookOption[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const effectiveDay = effectiveAt.slice(0, 10);
  useEffect(() => {
    let live = true;
    loadRulebookOptions(effectiveDay || accountNow(account.timezone).slice(0, 10))
      .then((o) => live && setOptions(o))
      .catch(() => live && setOptions([]));
    return () => {
      live = false;
    };
  }, [effectiveDay, account.timezone]);

  const ready = priorOutcome !== "" && name.trim() !== "" && balance.trim() !== "" && rulebookKey !== "" && effectiveAt !== "";

  const input = (): ResetInput => ({
    predecessorAccountId: account.id,
    priorOutcome: priorOutcome as (typeof priorOutcomes)[number],
    effectiveAt: zonedWallTimeToInstant(effectiveAt, account.timezone),
    reason: reason.trim() || null,
    source,
    name: name.trim(),
    externalRef: externalRef.trim() || null,
    startingBalance: balance.trim(),
    rulebook: rulebookKey === "later" ? { kind: "decideLater" } : (options.find((o) => o.key === rulebookKey)?.decision as RulebookDecision),
  });

  const commit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await repository.accounts.resetAttempt(input());
      await onDone(result.successor);
      onClose();
    } catch (err) {
      setConfirming(false);
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open title={`Start a new attempt after ${account.name}`} onClose={() => !busy && onClose()}>
      {!confirming ? (
        <form
          className="ff-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) setConfirming(true);
          }}
        >
          <p>
            This creates a <strong>new linked account</strong> with a clean balance, risk baseline, trade history and
            imports. <strong>{account.name}</strong> is kept exactly as it is and stays in your history. A reset is not a
            way to change past trades, and it is separate from the trading-day reset time.
          </p>
          <Field label="What was the previous attempt's outcome?" hint="Required. FundedFlow does not assume it failed.">
            <select value={priorOutcome} onChange={(e) => setPriorOutcome(e.target.value as typeof priorOutcome)}>
              <option value="">Choose…</option>
              {priorOutcomes.map((o) => (
                <option key={o} value={o}>
                  {statusLabels[o]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Reset effective" hint={`In the account's time zone (${account.timezone}).`}>
            <input type="datetime-local" required value={effectiveAt} onChange={(e) => setEffectiveAt(e.target.value)} />
          </Field>
          <Field label="Reason (optional)">
            <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Field label="Where did you learn of the reset?">
            <select value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
              {resetSources.map((s) => (
                <option key={s} value={s}>
                  {sourceLabels[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="New attempt name">
            <input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field
            label="Provider account number (optional)"
            hint="Providers often reuse the number. It is only checked against other active accounts."
          >
            <input value={externalRef} maxLength={100} onChange={(e) => setExternalRef(e.target.value)} />
          </Field>
          <Field label={`Starting balance (${account.currency})`} hint="Required. It is never carried over from the old attempt.">
            <input inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} />
          </Field>
          <Field label="Rulebook for the new attempt" hint="Choose explicitly. Without one, the attempt shows no rule meter.">
            <select value={rulebookKey} onChange={(e) => setRulebookKey(e.target.value)}>
              <option value="">Choose…</option>
              <option value="later">Decide later (no rulebook yet)</option>
              {options.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <FormError error={error} />
          <div className="ff-row ff-dialog-actions">
            <button type="button" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" disabled={!ready || busy}>
              Review
            </button>
          </div>
        </form>
      ) : (
        <div className="ff-form">
          <p>Please confirm. This will:</p>
          <ul>
            <li>
              record <strong>{account.name}</strong> as <strong>{priorOutcome && statusLabels[priorOutcome]}</strong> from{" "}
              {effectiveDay} and keep all its trades, imports and journal;
            </li>
            <li>
              create <strong>{name.trim()}</strong> (Attempt 2 after {account.name}) with a starting balance of{" "}
              {account.currency} {balance.trim()} and no trades;
            </li>
            <li>link the two so you can compare attempts.</li>
          </ul>
          <FormError error={error} />
          <div className="ff-row ff-dialog-actions">
            <button type="button" disabled={busy} onClick={() => setConfirming(false)}>
              Back
            </button>
            <button type="button" disabled={busy} onClick={() => void commit()}>
              {busy ? "Creating…" : "Create new attempt"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Attempt 1 → Attempt 2 → …, with plain per-attempt figures. Unknown results are shown as "—", never 0. */
export function AttemptLineage({
  attempts,
  currentId,
  timeZone,
}: {
  attempts: AttemptSummary[];
  currentId?: string;
  /** The account's IANA zone, for reset dates. Attempts in a chain share it. */
  timeZone: string;
}) {
  if (attempts.length < 2) return <p className="ff-hint">This account has no linked attempts.</p>;
  return (
    <table aria-label="Attempts">
      <thead>
        <tr>
          <th>Attempt</th>
          <th>Account</th>
          <th>Status</th>
          <th>Trades</th>
          <th>Trading days</th>
          <th>Net P&amp;L</th>
          <th>Imports</th>
        </tr>
      </thead>
      <tbody>
        {attempts.map((a) => (
          <tr key={a.accountId} aria-current={a.accountId === currentId ? "true" : undefined}>
            <td>{a.attemptNumber}</td>
            <td>
              {a.name}
              {a.externalRef && <small className="ff-hint"> · #{a.externalRef}</small>}
              {a.resetToNext && (
                <small className="ff-hint">
                  {" "}
                  · reset {zonedDay(a.resetToNext.effectiveAt, timeZone)}
                  {a.resetToNext.reason ? ` (${a.resetToNext.reason})` : ""}
                </small>
              )}
            </td>
            <td>
              <AccountStatusBadges account={a} />
            </td>
            <td>{a.tradeCount}</td>
            <td>{a.firstTradingDay ? `${a.firstTradingDay} – ${a.lastTradingDay}` : "—"}</td>
            <td>
              {formatMoney(a.netPnl, { symbol: "" })}
              {a.tradesWithUnknownPnl > 0 && <small className="ff-hint"> ({a.tradesWithUnknownPnl} without a result)</small>}
            </td>
            <td>{a.importCount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DeletionPreviewDialog({ preview, onClose }: { preview: DeletionPreview; onClose: () => void }) {
  const rows: [string, number][] = [
    ["Trades", preview.trades],
    ["Trades you deleted earlier", preview.deletedTrades],
    ["Journal entries", preview.journalEntries],
    ["CSV imports", preview.importBatches],
    ["Status history entries", preview.statusEvents],
    ["Rulebook assignments", preview.rulebookAssignments],
    ["Private rulebooks", preview.privateRulebooks],
    ["Account snapshots", preview.snapshots],
  ];
  return (
    <Modal open title={`Permanently deleting ${preview.accountName}`} onClose={onClose}>
      <p>
        <strong>Nothing has been deleted.</strong> This is only what deleting this one account would remove. Provider
        catalogue records and your other attempts are never part of it.
      </p>
      <ul>
        {rows.map(([label, n]) => (
          <li key={label}>
            {label}: {n}
          </li>
        ))}
      </ul>
      {preview.linkedAttempts.length > 0 && (
        <p>Linked attempts that would stay: {preview.linkedAttempts.length}.</p>
      )}
      <div role="note" className="ff-error">
        <strong>Not available yet:</strong>
        <ul>
          {preview.blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      </div>
      <div className="ff-row ff-dialog-actions">
        <button type="button" onClick={onClose} autoFocus>
          Close
        </button>
      </div>
    </Modal>
  );
}

type Action =
  | { kind: "status"; account: Account }
  | { kind: "reset"; account: Account }
  | { kind: "archive"; account: Account }
  | { kind: "restore"; account: Account }
  | { kind: "deletion"; preview: DeletionPreview };

/**
 * History view over every account (archived included) with the default
 * "Live" filter. `onChanged` runs after each successful change so the caller
 * can refresh its own lists and active-account selection.
 */
export function AccountLifecyclePanel({
  onChanged,
  onOpenAccount,
}: {
  onChanged?: (focus?: Account) => void | Promise<void>;
  onOpenAccount?: (account: Account) => void;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [filter, setFilter] = useState<AccountFilter>("live");
  const [action, setAction] = useState<Action | null>(null);
  const [lineage, setLineage] = useState<{ accountId: string; attempts: AttemptSummary[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      setAccounts(await repository.accounts.list({ includeArchived: true }));
    } catch (e) {
      setError(e);
    }
  }, []);
  useEffect(() => void load(), [load]);

  const changed = async (focus?: Account) => {
    await load();
    setLineage(null);
    await onChanged?.(focus);
  };
  const guard = async (work: () => Promise<void>) => {
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e);
    }
  };

  const shown = filterAccounts(accounts, filter);
  const showLineage = (a: Account) =>
    guard(async () => setLineage({ accountId: a.id, attempts: await repository.accounts.lineage(a.id) }));
  const showDeletion = (a: Account) =>
    guard(async () => setAction({ kind: "deletion", preview: await repository.accounts.previewDeletion(a.id) }));

  return (
    <fieldset className="ff-lifecycle">
      <legend>Account history</legend>
      <div className="ff-row" role="group" aria-label="Account filter">
        {accountFilters.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            className={filter === f ? "ff-chip ff-chip-on" : "ff-chip"}
            onClick={() => setFilter(f)}
          >
            {accountFilterLabels[f]} ({filterAccounts(accounts, f).length})
          </button>
        ))}
      </div>
      <FormError error={error} />
      <div role="status" aria-live="polite" className="ff-status">
        {notice}
      </div>
      {shown.length === 0 ? (
        <p className="ff-hint">No {accountFilterLabels[filter].toLowerCase()} accounts.</p>
      ) : (
        <ul className="ff-lifecycle-list">
          {shown.map((a) => (
            <li key={a.id} className={isHistorical(a) ? "ff-historical" : undefined}>
              <div className="ff-row">
                <strong>{a.name}</strong>
                <AccountStatusBadges account={a} />
                {isHistorical(a) && <small className="ff-hint">Historical: not available for live trading or risk.</small>}
                {(a.predecessorAccountId || a.successorAccountId) && <small className="ff-hint">Linked attempts</small>}
              </div>
              <div className="ff-row">
                {onOpenAccount && (
                  <button type="button" onClick={() => onOpenAccount(a)}>
                    {a.archivedAt ? "View (read-only)" : "Open"}
                  </button>
                )}
                {!a.archivedAt && (
                  <button type="button" onClick={() => setAction({ kind: "status", account: a })}>
                    {a.status === "failed" ? "Change status…" : "Mark failed or closed…"}
                  </button>
                )}
                {!a.archivedAt && !a.successorAccountId && (
                  <button type="button" onClick={() => setAction({ kind: "reset", account: a })}>
                    Start new attempt…
                  </button>
                )}
                {(a.predecessorAccountId || a.successorAccountId) && (
                  <button type="button" onClick={() => void showLineage(a)}>
                    Attempts
                  </button>
                )}
                {a.archivedAt ? (
                  <button type="button" onClick={() => setAction({ kind: "restore", account: a })}>
                    Restore…
                  </button>
                ) : (
                  <button type="button" onClick={() => setAction({ kind: "archive", account: a })}>
                    Archive…
                  </button>
                )}
                <button type="button" onClick={() => void showDeletion(a)}>
                  Deletion preview
                </button>
              </div>
              {lineage?.accountId === a.id && <AttemptLineage attempts={lineage.attempts} currentId={a.id} timeZone={a.timezone} />}
            </li>
          ))}
        </ul>
      )}

      {action?.kind === "status" && (
        <ChangeStatusDialog
          account={action.account}
          onClose={() => setAction(null)}
          onDone={async () => {
            setNotice(`${action.account.name} updated. Nothing was archived or deleted.`);
            await changed(action.account);
          }}
        />
      )}
      {action?.kind === "reset" && (
        <ResetAttemptDialog
          account={action.account}
          onClose={() => setAction(null)}
          onDone={async (successor) => {
            setNotice(`${successor.name} created. ${action.account.name} was kept.`);
            await changed(successor);
          }}
        />
      )}
      {action?.kind === "deletion" && <DeletionPreviewDialog preview={action.preview} onClose={() => setAction(null)} />}
      <ConfirmDialog
        open={action?.kind === "archive" || action?.kind === "restore"}
        title={action?.kind === "restore" ? "Restore account?" : "Archive account?"}
        confirmLabel={action?.kind === "restore" ? "Restore" : "Archive"}
        tone="neutral"
        onClose={() => setAction(null)}
        onConfirm={async () => {
          if (action?.kind === "archive") {
            await repository.accounts.archive(action.account.id);
            setNotice(`${action.account.name} archived. Its data is kept and you can restore it.`);
            await changed();
          } else if (action?.kind === "restore") {
            const restored = await repository.accounts.restore(action.account.id);
            setNotice(`${restored.name} restored as ${statusLabels[restored.status]}.`);
            await changed(restored);
          }
        }}
      >
        {action?.kind === "restore" ? (
          <p>
            <strong>{action.account.name}</strong> comes back with its status unchanged
            {action.account.status !== "active" && ` (${statusLabels[action.account.status]}); it will not become active`}.
          </p>
        ) : action?.kind === "archive" ? (
          <p>
            <strong>{action.account.name}</strong> will be hidden from live views and become read-only. Its trades,
            imports, journal and history are kept, and its status stays {statusLabels[action.account.status]}. Nothing is
            deleted.
          </p>
        ) : null}
      </ConfirmDialog>
    </fieldset>
  );
}
