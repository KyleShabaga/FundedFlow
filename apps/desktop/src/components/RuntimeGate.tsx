import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import { SLOW_MS, useRuntime } from "../app/RuntimeProvider";
import { Button, DiagnosticDetails } from "../design-system";
import type { RuntimeFailure, RuntimeStatus } from "../lib/data/runtime";
import { formatDiagnostics, newIncidentId, runtimeDiagnostics } from "../lib/diagnostics";
import "./RuntimeGate.css";

const TITLES: Record<RuntimeFailure["category"], string> = {
  data_directory: "FundedFlow can't reach its data folder",
  open_failed: "Your journal couldn't be opened",
  backup_failed: "Your journal wasn't upgraded",
  migration_failed: "Your journal upgrade didn't finish",
  newer_schema: "This journal needs a newer FundedFlow",
};
const GUIDANCE: Record<RuntimeFailure["category"], string> = {
  data_directory: "Check access to your user data folder, then retry. Keep existing files in place.",
  open_failed: "Close other apps using your journal and check file permissions, then retry. Do not delete or replace your journal.",
  backup_failed: "Check free disk space and folder permissions, then retry. Keep your journal and existing backups in place.",
  migration_failed: "Keep your journal and pre-upgrade backup in place. Retry, or contact support if the upgrade still fails. Do not overwrite or restore files here.",
  newer_schema: "Install a FundedFlow version that supports this journal. Keep the journal in place; do not downgrade or replace it.",
};
const STAGE_TEXT: Record<RuntimeStatus["stage"], string> = {
  data_directory: "Opening your journal…",
  open: "Opening your journal…",
  backup: "Saving a backup before upgrading your journal…",
  migrate: "Upgrading your journal…",
  ready: "Opening your journal…",
};
function versions(status: RuntimeStatus): string {
  return `Journal version ${status.schemaVersion ?? "unknown"}; this app supports ${status.supportedSchemaVersion}. Stage: ${status.stage}.`;
}

/**
 * One incident per distinct problem: the id and time stay the same while the same failure is shown (polls
 * re-create the state object), and a new one starts when the problem changes or after recovery.
 */
function useIncident(key: string | null, ready: boolean) {
  const current = useRef<{ key: string; id: string; at: Date } | null>(null);
  if (ready) current.current = null; // Recovered: the next problem is a new incident.
  else if (key !== null && current.current?.key !== key) current.current = { key, id: newIncidentId(), at: new Date() };
  return current.current;
}

/** Shell-level status, outside gated data content so navigation and recovery remain usable. */
export function RuntimeRecoveryNotice() {
  const { state, now, retry, lastReadyAt } = useRuntime();
  const titleId = useId();
  const ready = state.kind === "ready";
  const busy = state.kind === "checking" || state.kind === "recovering";
  const pending = state.kind === "unavailable" && state.reason === "initialization-pending";
  const commandPending = state.kind === "unavailable" && state.reason === "pending";
  const failure = state.status?.failure;
  const retryable = !busy && !ready && state.kind !== "unsupported-schema" && (failure?.retryable ?? true);
  const error = "error" in state ? state.error : undefined;
  const retryRequested = useRef(false);
  const retryButton = useRef<HTMLButtonElement>(null);
  const showDetails = !busy && !ready && Boolean(failure || error || pending || state.kind === "unsupported-schema");
  const incident = useIncident(showDetails ? `${state.kind}|${"reason" in state ? state.reason : ""}|${failure?.category ?? ""}|${failure?.failedMigration?.version ?? ""}` : null, ready);
  useEffect(() => {
    if (busy || !retryRequested.current) return;
    retryRequested.current = false;
    // Do not steal focus if the user navigated elsewhere during recovery.
    if (document.activeElement === document.body) {
      (ready ? document.getElementById("main-content") : retryButton.current)?.focus();
    }
  }, [busy, ready, state]);
  const doRetry = () => {
    retryRequested.current = true;
    void retry();
  };
  return (
    <section className={ready ? "ds-sr-only" : "ff-gate ds-card"}
      role={busy || ready ? "status" : "alert"} aria-live={busy || ready ? "polite" : "assertive"}
      aria-atomic="true" aria-labelledby={ready ? undefined : titleId}>
      {ready ? <p>Local data is available.</p> : <>
        <h2 id={titleId}>{busy
          ? state.kind === "recovering" ? "Retrying local data" : "Checking local data"
          : pending ? "Local data is still initializing"
          : commandPending ? "A local data request is still pending"
          : failure ? TITLES[failure.category] : "FundedFlow couldn't start its local data service"}</h2>
        {busy ? <>
          <p>{STAGE_TEXT[state.status?.stage ?? "open"]}</p>
          {now - state.since >= SLOW_MS && <p>This is taking a while. Large journals can take a few minutes to upgrade; keep FundedFlow open.</p>}
        </> : <>
          <p>{pending
            ? "Automatic checks have paused. Initialization may still be running. Keep FundedFlow open and retry to check its progress."
            : commandPending ? "The previous command has not answered. Wait for any initialization to finish before reopening FundedFlow."
            : failure?.message ?? "The app didn't get a valid answer from its local data service. This does not mean your journal is empty."}</p>
          {!pending && <p>{failure ? GUIDANCE[failure.category]
            : "Keep your journal and backups in place. Retry to check local data; no reset, replacement or restore is performed by this screen."}</p>}
        </>}
        {lastReadyAt !== null && <p className="ff-stale">Local data is unavailable. Previously shown data may be out of date. Unsaved changes remain on this screen; saving is disabled.</p>}
        {retryable && <Button ref={retryButton} onClick={doRetry}>Retry</Button>}
        {state.kind === "recovering" && <Button disabled>Retrying…</Button>}
        {showDetails && state.status && <p>{versions(state.status)}</p>}
        {/* Allowlisted fields only: the native detail and error text can hold paths, so they are never shown. */}
        {showDetails && incident && <DiagnosticDetails text={formatDiagnostics(runtimeDiagnostics(state, incident.id, incident.at, window.location.hash))} />}
      </>}
    </section>
  );
}

/** Mount data content only after readiness; retain its local state through later runtime loss.
 * The host shell renders one notice and passes showStatus=false to its data gates.
 * Future feature queries must also use state.kind === "ready" as their enabled condition (Build 14).
 */
export function RuntimeGate({ children, showStatus = true }: { children: ReactNode; showStatus?: boolean }) {
  const { state } = useRuntime();
  const ready = state.kind === "ready";
  const [hasBeenReady, setHasBeenReady] = useState(ready);
  useEffect(() => { if (ready) setHasBeenReady(true); }, [ready]);
  return <>
    {showStatus && <RuntimeRecoveryNotice />}
    {(ready || hasBeenReady) && <fieldset className="ff-runtime-content" disabled={!ready}
      aria-label="Local data content" aria-busy={state.kind === "checking" || state.kind === "recovering"}
      data-runtime-access={ready ? "ready" : "unavailable"}>
      <div inert={!ready}>{children}</div>
    </fieldset>}
  </>;
}

/**
 * Recovery inside a modal form (Build 26.5). A modal hides the shell's recovery notice, so a form that is
 * open when local data becomes unavailable shows this instead: its values stay, saving stays disabled, and
 * Retry runs the same single explicit recovery as the shell's notice (never a save).
 */
export function RuntimeInlineRecovery() {
  const { state, retry } = useRuntime();
  if (state.kind === "ready") return null;
  const busy = state.kind === "checking" || state.kind === "recovering";
  const retryable = !busy && state.kind !== "unsupported-schema" && (state.status?.failure?.retryable ?? true);
  return (
    <div role="status" aria-live="polite" className="ds-notice ds-notice-warning">
      <div className="ds-notice-body">
        <p className="ds-notice-title">{busy ? "Checking local data…" : "Local data isn't available"}</p>
        <p>Your entries here are kept, but saving is paused until the journal is open again.</p>
        {retryable && <Button size="sm" onClick={() => void retry()}>Retry</Button>}
      </div>
    </div>
  );
}
