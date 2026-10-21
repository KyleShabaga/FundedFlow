// Quick Import (Build 18.5): the short path for a familiar CSV. The trader picks the exact account attempt and one
// file; the same Rust preview the wizard uses checks it straight away (a preview never writes), and the page shows
// what would happen in one compact summary. Only when Rust settled everything itself — a recognised platform
// export, no file issues, dates read without guessing, times in the account's own zone — can the trader confirm
// the import here, explicitly. Anything that needs a decision goes to the full wizard in one click with the safe
// choices kept and no confirmation carried over. The commit is the wizard's: same scope, same native transaction
// and duplicate checks, one request per click, never retried.
import { History, ListChecks, ShieldCheck, Workflow } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import {
  Button,
  EmptyState,
  FileDropzone,
  formatInstant,
  InlineNotice,
  LoadingState,
  StatList,
  UnavailableState,
  useToast,
} from "../../../design-system";
import { useActiveAccount } from "../../accounts/active-account";
import { useAccountLineage, useAccounts } from "../../accounts/hooks/accounts";
import type { AccountViewModel } from "../../accounts/view-models/account";
import { useRuntime } from "../../../app/RuntimeProvider";
import { putHandoff } from "../handoff";
import { useCommitCsvImport, useCsvPreview } from "../hooks/imports";
import { useCsvFileChoice } from "../hooks/use-csv-file";
import { buildRequest, fileProblemText, initialWizardState, requestKey, type FileProblem, type LoadedFile, type WizardState } from "../wizard-state";
import { assessTarget, ImportTargetPicker, useDestinationRecheck } from "./ImportTarget";
import { DATE_ORDER_LABELS, FORMAT_LABELS, fileSize } from "./presentation";
import { RowsTable, type Preview } from "./RowsTable";
import "./imports.css";

/**
 * Why a previewed file can't be imported from Quick Import. Every reason is a decision Rust did not make on its own
 * (or a problem it reported); none is a guess made here.
 */
export function quickImportBlockers(preview: Preview["preview"]): string[] {
  const reasons: string[] = [];
  for (const issue of preview.fileIssues) {
    if (issue.field === "dateFormat") reasons.push("The dates fit more than one order (month/day or day/month). Choose the order in the full wizard.");
    else if (issue.field === "timezone") reasons.push(`Time zone: ${issue.message}`);
    else if (issue.field.startsWith("columns.")) reasons.push(`Columns: ${issue.message}`);
    else reasons.push(issue.message);
  }
  if (preview.format === "generic" && preview.fileIssues.length === 0)
    reasons.push("This isn't a recognised platform export, so its columns were matched by name. Check the matches in the full wizard before importing.");
  return reasons;
}

export function QuickImportPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { state: runtime } = useRuntime();
  const accounts = useAccounts("all");
  const active = useActiveAccount();
  const requested = (location.state as { accountId?: string } | null)?.accountId ?? null;
  const [accountId, setAccountId] = useState<string | null>(requested);
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [problem, setProblem] = useState<FileProblem | null>(null);
  const [previewFor, setPreviewFor] = useState<string | null>(null);
  const [confirmedFor, setConfirmedFor] = useState<string | null>(null);
  const [showRows, setShowRows] = useState(false);
  const preview = useCsvPreview();
  const commit = useCommitCsvImport(accountId ?? "");
  const lineage = useAccountLineage(accountId);
  const recheck = useDestinationRecheck(accountId);

  const all = accounts.data ?? [];
  const account: AccountViewModel | undefined = all.find(a => a.id === accountId);

  useEffect(() => {
    if (accountId === null && active.state.kind === "selected" && !active.state.account.archivedAt) setAccountId(active.state.account.id);
  }, [accountId, active.state]);

  // Quick Import never asks for format, date order or zone: Rust detects the first two and refuses to guess, and
  // times without an offset are read in the account's own zone (its saved, validated setting).
  const wizardState: WizardState | null = account && file ? { ...initialWizardState(account.id, account.timezone), file } : null;
  const request = wizardState ? buildRequest(wizardState) : null;
  // The request plus the account's settings and reset lineage: a change to any of them makes the preview stale
  // (the same rule the wizard applies).
  const context = JSON.stringify([account, lineage.data?.map(a => [a.accountId, a.resetToNext])]);
  const requestOnly = wizardState ? requestKey(wizardState) : null;
  const key = requestOnly ? JSON.stringify([requestOnly, context]) : null;
  const latestKey = useRef(key);
  latestKey.current = key;
  const fresh = preview.data !== undefined && previewFor !== null && previewFor === key;
  const current = fresh ? preview.data : undefined;
  const p = current?.preview;
  // Rust assesses the destination against the exact attempt interval for the whole file; a tick only ever applies
  // to that preview's token.
  const assessment = assessTarget(account, p?.targetAssessment);
  const confirmationKey = p ? JSON.stringify([key, p.targetAssessment.previewToken]) : null;
  const confirmed = confirmationKey !== null && confirmedFor === confirmationKey;
  const targetReady = !assessment.blocked && (assessment.confirmations.length === 0 || confirmed);
  const blockers = p ? quickImportBlockers(p) : [];
  const importable = p && blockers.length === 0 ? p.newCount : 0;
  const committing = commit.isPending;
  const outcome = commit.outcome;

  const runPreview = () => {
    if (!request || !key || assessment.blocked) return;
    preview
      .preview(request)
      .then(() => {
        if (latestKey.current === key) setPreviewFor(key);
      })
      .catch(() => {});
  };

  // A preview only reads, so it runs as soon as the destination and file are known, and again whenever either
  // changes. The result is only shown for the exact request it was made for. (runPreview reads the same key.)
  useEffect(() => {
    // Waits for the lineage so the preview is made once, for the context it will be judged against.
    const lineageKnown = lineage.data !== undefined || Boolean(lineage.error);
    if (key && lineageKnown && !assessment.blocked && previewFor !== key && runtime.kind === "ready" && !preview.isPending && !preview.error) runPreview();
  }, [key, assessment.blocked, runtime.kind, previewFor]);

  const fileChoice = useCsvFileChoice(read => {
    preview.reset();
    setPreviewFor(null);
    setConfirmedFor(null);
    setShowRows(false);
    if ("content" in read) {
      setFile(read);
      setProblem(null);
    } else {
      setFile(null);
      setProblem(read);
    }
  });

  const chooseAccount = (id: string) => {
    if (id === accountId) return;
    preview.reset();
    setPreviewFor(null);
    setConfirmedFor(null);
    setShowRows(false);
    setAccountId(id);
  };

  const startOver = () => {
    fileChoice.cancel();
    preview.reset();
    commit.reset();
    setFile(null);
    setProblem(null);
    setPreviewFor(null);
    setConfirmedFor(null);
    setShowRows(false);
  };

  const toWizard = () => {
    const state: { accountId: string | null; handoff?: string } = { accountId };
    if (account && file) {
      state.handoff = putHandoff({
        accountId: account.id, file, timezone: account.timezone, timezoneChosen: false, format: "auto", dateFormat: "auto",
        reasons: blockers,
      });
    }
    navigate("/import", { state });
  };

  const doImport = async () => {
    if (!request || !fresh || !account || !p || blockers.length > 0 || !targetReady || !commit.canSubmit) return;
    const issue = await recheck(account, p.targetAssessment);
    if (issue) {
      toast.show({ tone: "error", title: issue.title, description: issue.description });
      if (issue.changed) {
        setPreviewFor(null);
        setConfirmedFor(null);
      }
      return;
    }
    commit
      .submit({ ...request, targetAcknowledgement: { previewToken: p.targetAssessment.previewToken, historicalConfirmed: confirmed } })
      .then(batch => {
        if (batch.status === "committed") toast.show({ tone: "success", title: `Imported ${batch.importedCount} ${batch.importedCount === 1 ? "trade" : "trades"}`, description: `Into ${account.name}` });
      })
      .catch(() => {
        // A refused or failed commit needs a fresh preview and confirmation; nothing is retried.
        setPreviewFor(null);
        setConfirmedFor(null);
      });
  };

  /* Runtime and accounts gate (same as the wizard) */
  if (runtime.kind === "unsupported-schema") return <UnavailableState title="Import isn't available" reason="This journal needs a newer FundedFlow." />;
  if (accounts.data === undefined) {
    return accounts.error && !accounts.isRuntimePending
      ? <UnavailableState title="Accounts couldn't be read" reason="Import needs the list of accounts. Use the recovery controls above, then try again." />
      : <LoadingState label="Loading accounts" layout="panel" />;
  }
  if (all.filter(a => !a.archivedAt).length === 0) {
    return (
      <div className="ds-card">
        <EmptyState kind="not-configured" title="Add an account first" description="Trades are imported into an account, so add the one you trade before importing its CSV."
          action={<Button variant="primary" onClick={() => navigate("/accounts")}>Go to Accounts</Button>} />
      </div>
    );
  }

  const history = () => navigate("/import/history", { state: { accountId } });
  const result = commit.data;
  const head = (
    <div className="imp-head">
      <p className="imp-sub">Quick import: for a file you've imported before. Choose the account and the CSV, check the summary, then confirm. Files that need a decision open in the full wizard.</p>
      <div className="imp-actions">
        <Button variant="ghost" icon={<Workflow size={16} aria-hidden="true" />} onClick={toWizard} disabled={committing}>Full wizard</Button>
        <Button variant="ghost" icon={<History size={16} aria-hidden="true" />} onClick={history}>Import history</Button>
      </div>
    </div>
  );

  if (outcome === "uncertain-outcome") {
    return (
      <div className="imp-page imp-quick">
        {head}
        <section className="ds-card imp-panel" aria-labelledby="qi-unsure-h">
          <h2 id="qi-unsure-h" className="ds-title">Couldn't confirm the import finished</h2>
          <InlineNotice tone="warning" live="assertive">
            The import was sent but no answer came back. It may have been saved. Verify the outcome in import history before importing this file again; FundedFlow won't retry it for you.
          </InlineNotice>
          <div className="imp-actions">
            <Button variant="primary" icon={<History size={16} aria-hidden="true" />} onClick={history}>Verify in import history</Button>
            {commit.canAcknowledgeUncertainOutcome && (
              <Button onClick={() => void commit.acknowledgeUncertainOutcome({ recordsReviewed: true }).then(startOver)}>I've checked the history</Button>
            )}
          </div>
        </section>
      </div>
    );
  }

  if ((outcome === "confirmed-success" || outcome === "confirmed-failure") && result) {
    return (
      <div className="imp-page imp-quick">
        {head}
        <section className="ds-card imp-panel" aria-labelledby="qi-result-h">
          {outcome === "confirmed-success" ? (
            <>
              <h2 id="qi-result-h" className="ds-title">Imported {result.importedCount} {result.importedCount === 1 ? "trade" : "trades"} into {account?.name}</h2>
              <StatList label="Import result" bordered items={[
                { label: "Imported", value: { kind: "count", value: result.importedCount } },
                { label: "Duplicates", value: { kind: "count", value: result.duplicateCount } },
                { label: "Errors left out", value: { kind: "count", value: result.failedCount } },
                { label: "Rows with warnings", value: { kind: "count", value: result.warningCount } },
                { label: "Finished", value: formatInstant(result.completedAt, { timeZone: account?.timezone, year: true, zoneName: true }) },
              ]} />
              {p && result.importedCount !== p.newCount && (
                <InlineNotice tone="info" live="polite" title="The final count differs from the preview">
                  Trades were checked again when importing, so changes to the account since the preview are reflected. The numbers above are what was saved.
                </InlineNotice>
              )}
            </>
          ) : (
            <>
              <h2 id="qi-result-h" className="ds-title">The import didn't complete</h2>
              <InlineNotice tone="error" live="assertive">{result.failureMessage ?? "No trades were saved from this file."} The attempt is recorded in import history with its problem rows.</InlineNotice>
            </>
          )}
          <div className="imp-actions">
            {account && <Button onClick={() => navigate(`/accounts/${encodeURIComponent(account.id)}`)}>Open {account.name}</Button>}
            <Button icon={<History size={16} aria-hidden="true" />} onClick={history}>Import history</Button>
            <Button variant="primary" onClick={startOver}>Import another file</Button>
          </div>
        </section>
      </div>
    );
  }

  const checking = preview.isPending;
  const disabledReason = !account ? "Choose the account first"
    : !file ? "Choose a CSV file first"
    : checking ? "Checking the file"
    : !fresh ? "The file needs checking first"
    : blockers.length > 0 ? "This file needs the full wizard"
    : importable === 0 ? "Nothing new to import"
    : assessment.blocked ? "This attempt can't take these trades"
    : !targetReady ? "Confirm the destination first"
    : undefined;

  return (
    <div className="imp-page imp-quick">
      {head}

      <div className="imp-grid">
        <section className="ds-card imp-panel" aria-labelledby="qi-dest-h">
          <h2 id="qi-dest-h" className="ds-title">Account attempt</h2>
          <ImportTargetPicker accounts={all} value={accountId} onChange={chooseAccount} disabled={committing} lineage={lineage.data} assessment={assessment}
            confirmed={confirmed} onConfirmedChange={c => setConfirmedFor(c ? confirmationKey : null)} showConfirm={Boolean(fresh && blockers.length === 0 && importable > 0)} />
        </section>
        <section className="ds-card imp-panel" aria-labelledby="qi-file-h">
          <h2 id="qi-file-h" className="ds-title">File</h2>
          <FileDropzone
            label="Choose a CSV file"
            hint="One CSV up to 10 MB and 50,000 rows. It's read on this computer and never uploaded."
            accept=".csv,text/csv"
            disabled={committing}
            onFiles={files => void fileChoice.pick(files)}
            onTooMany={fileChoice.tooMany}
            selected={file ? { name: file.name, size: file.size, detail: "read on this computer" } : null}
            selectedActions={file ? <Button size="sm" variant="ghost" onClick={startOver} disabled={committing}>Remove</Button> : undefined}
            error={problem ? fileProblemText(problem) : null}
          />
        </section>
      </div>

      {checking && <LoadingState label="Checking the file" layout="inline" />}
      {preview.error && !checking && (
        <InlineNotice tone="error" live="assertive" title="The file couldn't be checked" actions={<Button size="sm" onClick={runPreview}>Try again</Button>}>
          {preview.error.message} Nothing was saved.
        </InlineNotice>
      )}

      {p && current && account && file && (
        <section className="ds-card imp-panel" aria-labelledby="qi-sum-h">
          <div className="imp-panel-head">
            <h2 id="qi-sum-h" className="ds-title">What would be imported</h2>
            <span className="ds-faint">Checked by FundedFlow on this computer. Nothing is saved yet.</span>
          </div>
          <div className="imp-quick-summary">
            <StatList label="File and settings" bordered items={[
              { label: "File", value: `${current.fileName} · ${fileSize(file.size)}` },
              { label: "Into", value: `${account.propFirm ? `${account.propFirm} · ` : ""}${account.name}${account.externalRef ? ` (${account.externalRef})` : ""}` },
              { label: "Format", value: `${FORMAT_LABELS[p.format]} — ${p.formatReason}` },
              { label: "Times read in", value: `${account.timezone} (the account's zone)` },
              { label: "Date order", value: p.dateFormat ? `${DATE_ORDER_LABELS[p.dateFormat]} — ${p.dateFormatReason}` : p.fileIssues.some(i => i.field === "dateFormat") ? "Needs your choice: more than one order fits" : p.dateFormatReason || "Not needed" },
            ]} />
            <StatList label="Rows" bordered items={[
              { label: "Will import", value: { kind: "count", value: blockers.length ? null : p.newCount } },
              { label: "Of which restores", value: { kind: "count", value: p.restoreCount } },
              { label: "Duplicates skipped", value: { kind: "count", value: p.duplicateCount } },
              { label: "Errors left out", value: { kind: "count", value: p.invalidCount } },
              { label: "Blank rows ignored", value: { kind: "count", value: p.blankCount } },
              { label: "Rows with warnings", value: { kind: "count", value: p.warningCount } },
            ]} />
          </div>
          {p.filePreviouslyImported && <InlineNotice tone="info" live="off" title="This file was imported before">Rows already saved show as duplicates and are skipped.</InlineNotice>}
          {p.fileWarnings.map((w, n) => <InlineNotice key={n} tone="warning" live="off">{w.message}</InlineNotice>)}
          {blockers.length > 0 ? (
            <InlineNotice tone="warning" live="polite" title="This file needs the full wizard"
              actions={<Button size="sm" variant="primary" icon={<Workflow size={16} aria-hidden="true" />} onClick={toWizard}>Continue in full wizard</Button>}>
              <ul className="imp-list">{blockers.map(b => <li key={b}>{b}</li>)}</ul>
              Your account and file are kept. Nothing has been imported.
            </InlineNotice>
          ) : importable === 0 ? (
            <InlineNotice tone="warning" live="polite" title="No new trades in this file">
              {p.invalidCount > 0 ? "Every trade row has an error. Fix the file and choose it again." : "Every trade is already saved in this account."}
            </InlineNotice>
          ) : null}
          <div className="imp-actions">
            <Button size="sm" icon={<ListChecks size={16} aria-hidden="true" />} aria-expanded={showRows} onClick={() => setShowRows(v => !v)}>
              {showRows ? "Hide rows and issues" : "View all rows and issues"}
            </Button>
          </div>
          {showRows && <RowsTable preview={current} timeZone={account.timezone} />}
        </section>
      )}

      {outcome === "failed" && commit.error && <InlineNotice tone="error" live="assertive" title="Nothing was imported">{commit.error.message}</InlineNotice>}

      <div className="imp-bar" role="region" aria-label="Import actions">
        <span className="imp-bar-note"><ShieldCheck size={18} aria-hidden="true" />
          {p && importable > 0 ? `Nothing is saved until you confirm.${importable === 1 ? "" : ` All ${importable.toLocaleString("en-US")} trades are written together, or none are.`}` : "Checking a file never saves anything."}
        </span>
        <div className="imp-actions">
          <Button onClick={() => navigate("/accounts")} disabled={committing}>Cancel</Button>
          {p && blockers.length > 0 && <Button onClick={toWizard}>Continue in full wizard</Button>}
          <Button variant="primary" onClick={() => void doImport()} loading={committing}
            disabled={Boolean(disabledReason) || (!commit.canSubmit && !committing)} disabledReason={disabledReason}>
            {committing ? "Importing…" : importable > 0 ? `Confirm import of ${importable.toLocaleString("en-US")} ${importable === 1 ? "trade" : "trades"}` : "Confirm import"}
          </Button>
        </div>
      </div>
      <p className="ds-faint imp-foot">First time with this platform, or a custom CSV? Use the <Link to="/import" state={{ accountId }}>full wizard</Link> to match columns and dates yourself.</p>
    </div>
  );
}
