import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { type RuntimeFailure, type RuntimeStatus, runtimeGateway } from "../lib/data/runtime";
import "./RuntimeGate.css";

/** How often to ask while the journal is being opened or upgraded. */
export const POLL_MS = 500;
/** After this long, say that an upgrade can take a while (it keeps running). */
export const SLOW_MS = 10_000;

type GateState =
  | { kind: "starting"; status: RuntimeStatus | null; since: number }
  | { kind: "ready" }
  // `failure` is null when the runtime could not be reached at all (timeout,
  // rejected or malformed response). Never treated as "no data".
  | { kind: "unavailable"; status: RuntimeStatus | null; error?: string };

const TITLES: Record<RuntimeFailure["category"], string> = {
  data_directory: "FundedFlow can't reach its data folder",
  open_failed: "Your journal couldn't be opened",
  backup_failed: "Your journal wasn't upgraded",
  migration_failed: "Your journal upgrade didn't finish",
  newer_schema: "This journal needs a newer FundedFlow",
};

const STAGE_TEXT: Record<RuntimeStatus["stage"], string> = {
  data_directory: "Opening your journal…",
  open: "Opening your journal…",
  backup: "Saving a backup before upgrading your journal…",
  migrate: "Upgrading your journal…",
  ready: "Opening your journal…",
};

function versions(s: RuntimeStatus): string {
  const known = s.schemaVersion === null ? "unknown" : String(s.schemaVersion);
  return `Journal version ${known}; this app supports ${s.supportedSchemaVersion}. Stage: ${s.stage}.`;
}

/**
 * Renders `children` only once the local database is ready. While it is
 * being opened or upgraded (in the background) it shows progress and keeps
 * polling; on failure it shows a recovery screen whose Retry starts the real
 * initialization path again.
 */
export function RuntimeGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ kind: "starting", status: null, since: Date.now() });
  const [now, setNow] = useState(() => Date.now());
  const busy = useRef(false);
  const since = useRef(Date.now());

  const run = useCallback(async (request: typeof runtimeGateway.status) => {
    if (busy.current) return; // never overlap checks or retries
    busy.current = true;
    try {
      const s = await request();
      if (s.state === "ready") setState({ kind: "ready" });
      else if (s.state === "initializing") setState({ kind: "starting", status: s, since: since.current });
      else setState({ kind: "unavailable", status: s });
    } catch (e) {
      setState({ kind: "unavailable", status: null, error: e instanceof Error ? e.message : String(e) });
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    void run(runtimeGateway.status);
  }, [run]);

  // Poll while initializing; the backend reports progress through the stage.
  const starting = state.kind === "starting";
  useEffect(() => {
    if (!starting) return;
    const timer = setInterval(() => {
      setNow(Date.now());
      void run(runtimeGateway.status);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [starting, run]);

  const retry = () => {
    since.current = Date.now();
    setState({ kind: "starting", status: null, since: since.current });
    void run(runtimeGateway.retry);
  };

  if (state.kind === "ready") return <>{children}</>;

  if (state.kind === "starting") {
    const slow = now - state.since >= SLOW_MS;
    return (
      <section className="ff-gate" role="status" aria-live="polite">
        <p>{STAGE_TEXT[state.status?.stage ?? "open"]}</p>
        {slow && (
          <p className="ff-hint">
            This is taking a while. Large journals can take a few minutes to upgrade; keep FundedFlow open.
          </p>
        )}
      </section>
    );
  }

  const { status, error } = state;
  const failure = status?.failure ?? null;
  const retryable = failure?.retryable ?? true;
  return (
    <section className="ff-gate" role="alert">
      <h2>{failure ? TITLES[failure.category] : "FundedFlow couldn't start its local data service"}</h2>
      <p>{failure?.message ?? "The app didn't get a valid answer from its local data service. Your data has not been changed."}</p>
      {retryable && (
        <button type="button" onClick={retry} autoFocus>
          Retry
        </button>
      )}
      {(failure || error) && (
        <details>
          <summary>Technical details</summary>
          {status && <p>{versions(status)}</p>}
          <code>{failure?.detail ?? error}</code>
        </details>
      )}
    </section>
  );
}
