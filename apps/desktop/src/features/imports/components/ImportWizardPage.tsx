// The CSV import wizard (Build 18): choose file and account, match columns, review
// every row, then import in one step. The Rust preview is the only authority for
// format, mapping, row classification, duplicates and P&L; the commit re-checks
// everything natively and its returned batch is what the trader sees. A preview is
// only used for the exact request it was made for, and a commit is never retried.
import { MAX_CSV_ROWS, type ColumnMapping } from "@fundedflow/domain";
import { FileText, History, ShieldCheck, Zap } from "lucide-react";
import { useEffect, useReducer, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import {
  Button,
  ConfirmDialog,
  EmptyState,
  FileDropzone,
  formatInstant,
  InlineNotice,
  LoadingState,
  MetricCard,
  Select,
  StatList,
  Stepper,
  TextField,
  UnavailableState,
  useToast,
} from "../../../design-system";
import { useActiveAccount } from "../../accounts/active-account";
import { useAccountLineage, useAccounts } from "../../accounts/hooks/accounts";
import type { AccountViewModel } from "../../accounts/view-models/account";
import { useRuntime } from "../../../app/RuntimeProvider";
import { dropHandoff, peekHandoff } from "../handoff";
import { useCommitCsvImport, useCsvPreview } from "../hooks/imports";
import { useCsvFileChoice } from "../hooks/use-csv-file";
import {
  buildRequest,
  fileProblemText,
  initialWizardState,
  mappingFromPreview,
  requestKey,
  wizardReducer,
  type CsvFormatChoice,
  type DateFormatChoice,
  type WizardState,
} from "../wizard-state";
import { ColumnMappingTable } from "./ColumnMappingTable";
import { assessTarget, ImportTargetPicker, useDestinationRecheck } from "./ImportTarget";
import { RowsTable } from "./RowsTable";
import { DATE_ORDER_LABELS, FORMAT_LABELS, fileSize } from "./presentation";
import "./imports.css";

const STEPS = [{ label: "Choose file" }, { label: "Match columns" }, { label: "Review rows" }, { label: "Import" }];
type Preview = NonNullable<ReturnType<typeof useCsvPreview>["data"]>;

function localZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function Summary({ preview }: { preview: Preview }) {
  const p = preview.preview;
  return (
    <div className="imp-kpis">
      <MetricCard label="Will import" value={{ kind: "count", value: p.newCount }} sub={p.restoreCount > 0 ? `Includes ${p.restoreCount} restored ${p.restoreCount === 1 ? "trade" : "trades"}` : "New trades"} />
      <MetricCard label="Duplicates · skipped" value={{ kind: "count", value: p.duplicateCount }} sub="Already saved, or repeated in the file" />
      <MetricCard label="Errors · left out" value={{ kind: "count", value: p.invalidCount }} sub={p.invalidCount ? "Fix in the file and import again" : "None"} />
      <MetricCard label="Warnings" value={{ kind: "count", value: p.warningCount }} sub="Imported, worth a look" />
      <MetricCard label="Rows in file" value={{ kind: "count", value: p.rowCount }} sub={p.blankCount ? `${p.blankCount} blank ${p.blankCount === 1 ? "row" : "rows"} ignored` : `Up to ${MAX_CSV_ROWS.toLocaleString("en-US")} per file`} />
    </div>
  );
}

/* ---------- Page ---------- */

export function ImportWizardPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { state: runtime } = useRuntime();
  const accounts = useAccounts("all");
  const active = useActiveAccount();
  const navState = location.state as { accountId?: string; handoff?: string } | null;
  const requested = navState?.accountId ?? null;
  // Choices carried over from Quick Import: the file and safe selections, never a confirmation.
  const [handoff] = useState(() => peekHandoff(navState?.handoff));
  useEffect(() => dropHandoff(navState?.handoff), [navState?.handoff]);
  const [state, dispatch] = useReducer(wizardReducer, null, () => {
    const initial = initialWizardState(handoff?.accountId ?? requested, handoff?.timezone ?? localZone());
    return handoff ? { ...initial, file: handoff.file, format: handoff.format, dateFormat: handoff.dateFormat } : initial;
  });
  const [zoneTouched, setZoneTouched] = useState(handoff?.timezoneChosen ?? false);
  const [previewFor, setPreviewFor] = useState<string | null>(null);
  const [previewContext, setPreviewContext] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const preview = useCsvPreview();
  const commit = useCommitCsvImport(state.accountId ?? "");
  const lineage = useAccountLineage(state.accountId);
  const recheck = useDestinationRecheck(state.accountId);

  const all = accounts.data ?? [];
  const account: AccountViewModel | undefined = all.find(a => a.id === state.accountId);

  // Default to the active account (or the one the trader came from), once it is known.
  useEffect(() => {
    if (state.accountId === null && active.state.kind === "selected") dispatch({ type: "account", accountId: active.state.account.id });
  }, [state.accountId, active.state]);
  // Timestamps without an offset are read in the account's zone unless the trader chose another.
  useEffect(() => {
    if (account && !zoneTouched) dispatch({ type: "timezone", timezone: account.timezone });
  }, [account, zoneTouched]);

  const key = requestKey(state);
  // The request the page shows now; a preview that returns for an earlier one never moves the wizard on.
  const latestKey = useRef(key);
  latestKey.current = key;
  // Session settings and lineage changes also invalidate the preview/confirmation.
  const context = JSON.stringify([account, lineage.data?.map(a => [a.accountId, a.resetToNext])]);
  const previousContext = useRef(context);
  useEffect(() => {
    if (previousContext.current !== context) {
      previousContext.current = context;
      setPreviewFor(null);
      dispatch({ type: "confirm-target", key: null });
    }
  }, [context]);
  const fresh = preview.data !== undefined && previewFor !== null && previewFor === key && previewContext === context;
  const current = fresh ? preview.data : undefined;
  const p = current?.preview;
  const assessment = assessTarget(account, p?.targetAssessment);
  const confirmationKey = p ? JSON.stringify([key, p.targetAssessment.previewToken]) : null;
  const confirmed = confirmationKey !== null && state.confirmedTargetFor === confirmationKey;
  const targetReady = !assessment.blocked && (assessment.confirmations.length === 0 || confirmed);
  // The last preview checked for this file, so Match columns stays on screen while a changed mapping is checked
  // again (P0-D09). Its statuses describe that earlier request, so the table hides them until Rust answers.
  const lastChecked = useRef<{ file: number; preview: Preview } | null>(null);
  if (current && state.file) lastChecked.current = { file: state.file.version, preview: current };
  const shown = current ?? (state.file && lastChecked.current?.file === state.file.version ? lastChecked.current.preview : undefined);
  const columns: ColumnMapping | null = shown && shown.preview.format === "generic" ? (state.columns ?? mappingFromPreview(shown.preview.mapping)) : null;
  // Rust's statuses are the only mapping check: an error always has a blocking `columns.*` file issue.
  const mappingBlocked = Boolean(p?.mapping.some(m => m.status === "error"));
  const issueFor = (prefix: string) => p?.fileIssues.find(i => i.field === prefix)?.message;
  const dateAmbiguous = Boolean(p?.fileIssues.some(i => i.field === "dateFormat"));
  const committing = commit.isPending;
  const outcome = commit.outcome;
  const finished = outcome === "confirmed-success" || outcome === "confirmed-failure";

  const runPreview = (then?: (checked: Preview["preview"]) => void, from: WizardState = state) => {
    const request = buildRequest(from);
    const k = requestKey(from);
    if (!request || !k) return;
    dispatch({ type: "confirm-target", key: null });
    preview
      .preview(request)
      .then(result => {
        if (latestKey.current !== k) return;
        setPreviewFor(k);
        setPreviewContext(context);
        then?.(result.value.preview);
      })
      .catch(() => {});
  };

  // Dropped and browsed files take the same path. A new file drops the old preview, mapping, date order and
  // confirmation, and stops a check still running for the old one.
  const fileChoice = useCsvFileChoice(read => {
    preview.reset();
    setPreviewFor(null);
    if ("content" in read) dispatch({ type: "file", file: read });
    else dispatch({ type: "file-problem", problem: read });
  });

  const startOver = () => {
    fileChoice.cancel();
    dispatch({ type: "reset", keep: { accountId: state.accountId, timezone: account?.timezone ?? state.timezone } });
    setPreviewFor(null);
    preview.reset();
    commit.reset();
  };

  const doImport = async () => {
    const request = buildRequest(state);
    if (!request || !fresh || !account || !p || !targetReady) return;
    // Check the destination again: it may have been archived or changed since the preview.
    const problem = await recheck(account, p.targetAssessment);
    if (problem) {
      toast.show({ tone: "error", title: problem.title, description: problem.description });
      if (problem.changed) dispatch({ type: "step", step: 0 });
      return;
    }
    commit
      .submit({ ...request, targetAcknowledgement: { previewToken: p.targetAssessment.previewToken, historicalConfirmed: confirmed } })
      .then(batch => {
        if (batch.status === "committed") toast.show({ tone: "success", title: `Imported ${batch.importedCount} ${batch.importedCount === 1 ? "trade" : "trades"}`, description: `Into ${account.name}` });
      })
      .catch(() => {
        setPreviewFor(null);
        dispatch({ type: "confirm-target", key: null });
      });
  };

  /* Runtime and accounts gate */
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

  const canLeaveFileStep = Boolean(account && state.file && !assessment.blocked && state.timezone.trim());
  const blockingIssues = p ? p.fileIssues : [];
  const importable = p ? p.newCount : 0;

  /* Step bodies */
  const fileStep = (
    <div className="imp-grid">
      <section className="ds-card imp-panel" aria-labelledby="imp-file-h">
        <h2 id="imp-file-h" className="ds-title">File</h2>
        <FileDropzone
          label="Choose a CSV file"
          hint="CSV up to 10 MB and 50,000 rows. It's read on this computer and never uploaded."
          accept=".csv,text/csv"
          onFiles={files => void fileChoice.pick(files)}
          onTooMany={fileChoice.tooMany}
          disabled={committing}
          selected={state.file ? { name: state.file.name, size: state.file.size, detail: "read on this computer" } : null}
          selectedActions={state.file ? <Button size="sm" variant="ghost" onClick={() => { fileChoice.cancel(); preview.reset(); setPreviewFor(null); dispatch({ type: "clear-file" }); }}>Remove</Button> : undefined}
          error={state.fileProblem ? fileProblemText(state.fileProblem) : null}
        />
        <div className="imp-options">
          <TextField label="Times in the file are in" required value={state.timezone} onChange={e => { setZoneTouched(true); dispatch({ type: "timezone", timezone: e.target.value }); }}
            error={issueFor("timezone")} description={account ? `Used for timestamps without an offset. The account counts trading days in ${account.timezone}.` : "IANA zone such as America/New_York."} />
          <Select<CsvFormatChoice> label="File format" value={state.format} onValueChange={format => dispatch({ type: "format", format })}
            options={[{ value: "auto", label: "Detect from the headers" }, { value: "performance", label: FORMAT_LABELS.performance }, { value: "generic", label: FORMAT_LABELS.generic }]} />
          <Select<DateFormatChoice> label="Date order" value={state.dateFormat} onValueChange={dateFormat => dispatch({ type: "date-format", dateFormat })}
            description="Leave on detect unless the file's dates are ambiguous." options={(["auto", "ymd", "mdy", "dmy"] as const).map(v => ({ value: v, label: DATE_ORDER_LABELS[v] }))} />
        </div>
      </section>
      <section className="ds-card imp-panel" aria-labelledby="imp-acct-h">
        <h2 id="imp-acct-h" className="ds-title">Account</h2>
        <ImportTargetPicker accounts={all} value={state.accountId} onChange={id => { dispatch({ type: "account", accountId: id }); setZoneTouched(false); setPreviewFor(null); }}
          lineage={lineage.data} assessment={assessment} confirmed={confirmed} onConfirmedChange={c => dispatch({ type: "confirm-target", key: c ? confirmationKey : null })} showConfirm={false} />
      </section>
    </div>
  );

  const shownPreview = shown?.preview;
  const unchecked = current ? undefined : preview.isPending ? "pending" as const : "stale" as const;
  const mappingStep = shown && shownPreview && (
    <section className="ds-card imp-panel" aria-labelledby="imp-map-h">
      <div className="imp-panel-head">
        <h2 id="imp-map-h" className="ds-title">Match columns</h2>
        <span className="ds-faint">{shownPreview.headers.length} columns in {shown.fileName}</span>
      </div>
      <StatList bordered label="Detected" items={[
        { label: "Format", value: `${FORMAT_LABELS[shownPreview.format]} — ${shownPreview.formatReason}` },
        { label: "Date order", value: shownPreview.dateFormat ? `${DATE_ORDER_LABELS[shownPreview.dateFormat]} — ${shownPreview.dateFormatReason}` : shownPreview.fileIssues.some(i => i.field === "dateFormat") ? "Needs your choice: more than one order fits" : shownPreview.dateFormatReason || "Not needed" },
      ]} />
      {p && dateAmbiguous && (
        <InlineNotice tone="warning" live="polite" title="Choose the date order">
          {issueFor("dateFormat")} FundedFlow won't guess.
          <div className="imp-inline-field">
            <Select<DateFormatChoice> label="Date order" required value={state.dateFormat === "auto" ? undefined : state.dateFormat} placeholder="Choose the order"
              onValueChange={dateFormat => dispatch({ type: "date-format", dateFormat })} options={(["mdy", "dmy", "ymd"] as const).map(v => ({ value: v, label: DATE_ORDER_LABELS[v] }))} />
          </div>
        </InlineNotice>
      )}
      <p className="ds-faint imp-map-note">
        {shownPreview.format === "performance"
          ? "A recognized export: its columns are fixed. "
          : "Change a column to check the file again. "}
        Matched means the column was recognized, not that every row's values are valid; Review rows checks each row.
      </p>
      <ColumnMappingTable
        format={shownPreview.format}
        mapping={shownPreview.mapping}
        unchecked={unchecked}
        edit={columns ? {
          headers: shownPreview.headers,
          columns,
          disabled: committing,
          onChange: next => {
            const changed = { ...state, columns: next };
            dispatch({ type: "columns", columns: next });
            // Every edit is checked again by Rust, so each status always describes the mapping on screen.
            runPreview(undefined, changed);
          },
        } : undefined}
      />
      {p && p.ignoredHeaders.length > 0 && <p className="ds-faint">Not used: {p.ignoredHeaders.join(", ")}</p>}
      {p && blockingIssues.filter(i => !i.field.startsWith("columns.") && i.field !== "dateFormat").map((i, n) => (
        <InlineNotice key={n} tone="error" live="assertive">{i.message}</InlineNotice>
      ))}
      {p?.fileWarnings.map((w, n) => <InlineNotice key={n} tone="warning" live="off">{w.message}</InlineNotice>)}
    </section>
  );

  const reviewStep = p && (
    <>
      <Summary preview={current} />
      {p.filePreviouslyImported && <InlineNotice tone="info" live="off" title="This file was imported before">Rows already saved show as duplicates and are skipped.</InlineNotice>}
      {p.rowsOmitted > 0 && (
        <InlineNotice tone="info" live="off" title="Large file">
          {p.rowsOmitted.toLocaleString("en-US")} plain new rows aren't listed to keep this page fast. Every error, warning, duplicate and restore is listed, and the counts above cover the whole file.
        </InlineNotice>
      )}
      {blockingIssues.length > 0 && (
        <InlineNotice tone="error" live="assertive" title="Nothing can be imported yet">
          <ul className="imp-list">{blockingIssues.map((i, n) => <li key={n}>{i.message}</li>)}</ul>
        </InlineNotice>
      )}
      {blockingIssues.length === 0 && importable === 0 && (
        <InlineNotice tone="warning" live="polite" title="No new trades in this file">
          {p.invalidCount > 0 ? "Every trade row has an error. Fix the file and choose it again." : "Every trade is already saved in this account."}
        </InlineNotice>
      )}
      <RowsTable preview={current} timeZone={account?.timezone ?? state.timezone} />
    </>
  );

  const confirmStep = p && account && (
    <div className="imp-grid">
      <section className="ds-card imp-panel" aria-labelledby="imp-confirm-h">
        <h2 id="imp-confirm-h" className="ds-title">Import into {account.name}</h2>
        <StatList label="What will be imported" bordered items={[
          { label: "File", value: `${current.fileName} · ${state.file ? fileSize(state.file.size) : ""}` },
          { label: "Format", value: FORMAT_LABELS[p.format] },
          { label: "Times read in", value: state.timezone },
          { label: "Date order", value: p.dateFormat ? DATE_ORDER_LABELS[p.dateFormat] : "Not needed" },
          { label: "New trades", value: { kind: "count", value: p.newCount - p.restoreCount } },
          { label: "Restored trades", value: { kind: "count", value: p.restoreCount } },
          { label: "Duplicates skipped", value: { kind: "count", value: p.duplicateCount } },
          { label: "Errors left out", value: { kind: "count", value: p.invalidCount } },
          { label: "Blank rows", value: { kind: "count", value: p.blankCount } },
          { label: "Rows with warnings", value: { kind: "count", value: p.warningCount } },
          { label: "Will import", value: { kind: "count", value: p.newCount } },
        ]} />
      </section>
      <section className="ds-card imp-panel" aria-labelledby="imp-dest-h">
        <h2 id="imp-dest-h" className="ds-title">Destination</h2>
        <ImportTargetPicker accounts={all} value={state.accountId} onChange={() => {}} disabled lineage={lineage.data} assessment={assessment}
          confirmed={confirmed} onConfirmedChange={c => dispatch({ type: "confirm-target", key: c ? confirmationKey : null })} showConfirm />
      </section>
    </div>
  );

  const result = commit.data;
  const resultView = (
    <section className="ds-card imp-panel" aria-labelledby="imp-result-h">
      {outcome === "confirmed-success" && result && (
        <>
          <h2 id="imp-result-h" className="ds-title" tabIndex={-1}>Imported {result.importedCount} {result.importedCount === 1 ? "trade" : "trades"} into {account?.name}</h2>
          <StatList label="Import result" bordered items={[
            { label: "Imported", value: { kind: "count", value: result.importedCount } },
            { label: "Skipped (duplicates and blank rows)", value: { kind: "count", value: result.skippedCount } },
            { label: "Duplicates", value: { kind: "count", value: result.duplicateCount } },
            { label: "Errors left out", value: { kind: "count", value: result.failedCount } },
            { label: "Rows with warnings", value: { kind: "count", value: result.warningCount } },
            { label: "Finished", value: formatInstant(result.completedAt, { timeZone: account?.timezone, year: true, zoneName: true }) },
            { label: "Import reference", value: <span className="imp-fills">{result.id}</span> },
          ]} />
          {p && result.importedCount !== p.newCount && (
            <InlineNotice tone="info" live="polite" title="The final count differs from the preview">
              Trades were checked again when importing, so changes to the account since the preview are reflected. The numbers above are what was saved.
            </InlineNotice>
          )}
        </>
      )}
      {outcome === "confirmed-failure" && result && (
        <>
          <h2 id="imp-result-h" className="ds-title" tabIndex={-1}>The import didn't complete</h2>
          <InlineNotice tone="error" live="assertive">{result.failureMessage ?? "No trades were saved from this file."} The attempt is recorded in import history with its problem rows.</InlineNotice>
        </>
      )}
      <div className="imp-actions">
        {account && <Button onClick={() => navigate(`/accounts/${encodeURIComponent(account.id)}`)}>Open {account.name}</Button>}
        <Button icon={<History size={16} aria-hidden="true" />} onClick={() => navigate("/import/history", { state: { accountId: state.accountId } })}>Import history</Button>
        <Button variant="primary" onClick={startOver}>Import another file</Button>
      </div>
    </section>
  );

  const step = state.step;
  const nextDisabled =
    step === 0 ? !canLeaveFileStep || preview.isPending
      : step === 1 ? preview.isPending || mappingBlocked || (dateAmbiguous && state.dateFormat === "auto")
        : step === 2 ? !fresh || blockingIssues.length > 0 || importable === 0
          : true;

  const next = () => {
    if (step === 0) runPreview(() => dispatch({ type: "step", step: 1 }));
    // Rows are reviewed only for a mapping Rust has accepted: an "Action required" column keeps the trader here.
    else if (step === 1) (fresh ? dispatch({ type: "step", step: 2 }) : runPreview(checked => { if (!checked.mapping.some(m => m.status === "error")) dispatch({ type: "step", step: 2 }); }));
    else if (step === 2) dispatch({ type: "step", step: 3 });
  };

  // Moving back to a step whose preview is stale re-checks it there.
  const stale = state.step > 0 && !fresh && !preview.isPending;
  const showResult = finished || outcome === "uncertain-outcome";

  return (
    <div className="imp-page">
      <div className="imp-head">
        <p className="imp-sub">Full wizard: match columns, date order and time zone yourself, then check every row before anything is saved. The file stays on this computer.</p>
        {!showResult && (
          <div className="imp-actions">
            <Button variant="ghost" icon={<Zap size={16} aria-hidden="true" />} onClick={() => navigate("/import/quick", { state: { accountId: state.accountId } })} disabled={committing}>Quick import</Button>
            <Button variant="ghost" icon={<History size={16} aria-hidden="true" />} onClick={() => navigate("/import/history", { state: { accountId: state.accountId } })}>Import history</Button>
          </div>
        )}
      </div>
      {handoff && !showResult && state.step === 0 && (
        <InlineNotice tone="info" live="polite" title="Continued from Quick import">
          {handoff.reasons.length > 0 && <ul className="imp-list">{handoff.reasons.map(r => <li key={r}>{r}</li>)}</ul>}
          The file, account and choices you made are kept. Check the file again here; nothing has been imported.
        </InlineNotice>
      )}
      <Stepper label="Import steps" steps={STEPS} current={showResult ? 4 : step} />

      {preview.error && !preview.isPending && (
        <InlineNotice tone="error" live="assertive" title="The file couldn't be checked" actions={<Button size="sm" onClick={() => runPreview()}>Try again</Button>}>
          {preview.error.message} Nothing was saved.
        </InlineNotice>
      )}
      {preview.isPending && <LoadingState label="Checking the file" layout="inline" />}

      {showResult ? (
        outcome === "uncertain-outcome" ? (
          <section className="ds-card imp-panel" aria-labelledby="imp-unsure-h">
            <h2 id="imp-unsure-h" className="ds-title">Couldn't confirm the import finished</h2>
            <InlineNotice tone="warning" live="assertive">
              The import was sent but no answer came back. It may have been saved. Check the import history before importing this file again; FundedFlow won't retry it for you.
            </InlineNotice>
            <div className="imp-actions">
              <Button variant="primary" icon={<History size={16} aria-hidden="true" />} onClick={() => navigate("/import/history", { state: { accountId: state.accountId } })}>Check import history</Button>
              {commit.canAcknowledgeUncertainOutcome && (
                <Button onClick={() => void commit.acknowledgeUncertainOutcome({ recordsReviewed: true }).then(startOver)}>I've checked the history</Button>
              )}
            </div>
          </section>
        ) : resultView
      ) : (
        <>
          {step === 0 && fileStep}
          {step > 0 && stale && <InlineNotice tone="info" live="polite" title="Your choices changed" actions={<Button size="sm" onClick={() => runPreview()}>Check the file again</Button>}>The rows shown before no longer match these choices, so they need checking again.</InlineNotice>}
          {step === 1 && mappingStep}
          {step === 2 && reviewStep}
          {step === 3 && confirmStep}
          {outcome === "failed" && commit.error && (
            <InlineNotice tone="error" live="assertive" title="Nothing was imported">{commit.error.message}</InlineNotice>
          )}

          <div className="imp-bar" role="region" aria-label="Import actions">
            <span className="imp-bar-note"><ShieldCheck size={18} aria-hidden="true" />
              {step < 2 || !p
                ? "Checking a file never saves anything."
                : `Nothing is saved until you import.${importable === 1 ? "" : ` All ${importable.toLocaleString("en-US")} trades are written together, or none are.`}`}
            </span>
            <div className="imp-actions">
              <Button onClick={() => (state.file || step > 0 ? setConfirmCancel(true) : navigate("/accounts"))} disabled={committing}>Cancel</Button>
              {step > 0 && <Button onClick={() => dispatch({ type: "step", step: (step - 1) as 0 | 1 | 2 })} disabled={committing}>Back</Button>}
              {step < 3 ? (
                <Button variant="primary" onClick={next} disabled={nextDisabled} loading={preview.isPending}
                  disabledReason={step === 1 && mappingBlocked && !preview.isPending ? "Fix the columns marked Action required first" : undefined}>
                  {step === 0 ? "Check the file" : step === 1 ? "Review rows" : `Continue with ${importable.toLocaleString("en-US")} ${importable === 1 ? "trade" : "trades"}`}
                </Button>
              ) : (
                <Button variant="primary" icon={<FileText size={16} aria-hidden="true" />} onClick={() => void doImport()} loading={committing}
                  disabled={!fresh || !targetReady || blockingIssues.length > 0 || importable === 0 || (!commit.canSubmit && !committing)}
                  disabledReason={!targetReady ? "Confirm the destination first" : !fresh ? "Check the file again first" : undefined}>
                  {committing ? "Importing…" : `Import ${importable.toLocaleString("en-US")} ${importable === 1 ? "trade" : "trades"} into ${account?.name ?? "the account"}`}
                </Button>
              )}
            </div>
          </div>
        </>
      )}

      <ConfirmDialog open={confirmCancel} onOpenChange={setConfirmCancel} tone="neutral" title="Discard this import?" confirmLabel="Discard"
        onConfirm={async () => { startOver(); navigate("/accounts"); }}>
        <p>Nothing has been saved. The file and your choices will be cleared.</p>
      </ConfirmDialog>
      <p className="ds-faint imp-foot">Previous imports are in <Link to="/import/history" state={{ accountId: state.accountId }}>Import history</Link>. There is no undo for a whole import yet.</p>
    </div>
  );
}
