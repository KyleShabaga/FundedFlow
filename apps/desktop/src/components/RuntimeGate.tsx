import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { type RuntimeFailure, runtimeGateway } from "../lib/data/runtime";
import "./RuntimeGate.css";

type GateState =
  | { kind: "checking" }
  | { kind: "ready" }
  | { kind: "recovering" }
  // `failure` is null when the runtime could not be reached at all (timeout,
  // rejected or malformed response). Never treated as "no data".
  | { kind: "unavailable"; failure: RuntimeFailure | null; error?: string };

const TITLES: Record<RuntimeFailure["category"], string> = {
  data_directory: "FundedFlow can't reach its data folder",
  open_failed: "Your journal couldn't be opened",
  backup_failed: "Your journal wasn't upgraded",
  migration_failed: "Your journal upgrade didn't finish",
  newer_schema: "This journal needs a newer FundedFlow",
};

/**
 * Renders `children` only once the local database is ready. Otherwise shows
 * a recovery screen with a Retry that re-runs the real initialization path.
 */
export function RuntimeGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ kind: "checking" });
  const busy = useRef(false);

  const run = useCallback(async (kind: "checking" | "recovering", request: typeof runtimeGateway.status) => {
    if (busy.current) return; // never overlap checks or retries
    busy.current = true;
    setState({ kind });
    try {
      const s = await request();
      setState(s.state === "ready" ? { kind: "ready" } : { kind: "unavailable", failure: s.failure });
    } catch (e) {
      setState({ kind: "unavailable", failure: null, error: e instanceof Error ? e.message : String(e) });
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    void run("checking", runtimeGateway.status);
  }, [run]);

  if (state.kind === "ready") return <>{children}</>;

  if (state.kind === "checking" || state.kind === "recovering") {
    return (
      <section className="ff-gate" role="status" aria-live="polite">
        <p>{state.kind === "checking" ? "Opening your journal…" : "Retrying…"}</p>
      </section>
    );
  }

  const { failure, error } = state;
  const retryable = failure?.retryable ?? true;
  return (
    <section className="ff-gate" role="alert">
      <h2>{failure ? TITLES[failure.category] : "FundedFlow couldn't start its local data service"}</h2>
      <p>{failure?.message ?? "The app didn't get a valid answer from its local data service. Your data has not been changed."}</p>
      {retryable && (
        <button type="button" onClick={() => void run("recovering", runtimeGateway.retry)} autoFocus>
          Retry
        </button>
      )}
      {(failure?.detail || error) && (
        <details>
          <summary>Technical details</summary>
          <code>{failure?.detail ?? error}</code>
        </details>
      )}
    </section>
  );
}
