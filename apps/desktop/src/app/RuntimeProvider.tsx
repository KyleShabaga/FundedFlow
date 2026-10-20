import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";

import { type RuntimeStatus, RuntimeGatewayError, type RuntimeGatewayErrorKind, runtimeGateway } from "../lib/data/runtime";

export const POLL_MS = 500;
export const SLOW_MS = 10_000;
export const MAX_CHECKS = 8;
export const MAX_POLL_MS = 8_000;
export const pollDelay = (index: number) => Math.min(POLL_MS * 2 ** index, MAX_POLL_MS);

type UnavailableReason = RuntimeGatewayErrorKind | "runtime-failed" | "initialization-pending";
export type RuntimeState =
  | { kind: "checking"; status: RuntimeStatus | null; since: number }
  | { kind: "recovering"; status: RuntimeStatus | null; since: number }
  | { kind: "ready"; status: RuntimeStatus }
  | { kind: "unavailable"; status: RuntimeStatus | null; reason: UnavailableReason; error?: string }
  | { kind: "unsupported-schema"; status: RuntimeStatus; error?: string };

interface RuntimeContextValue {
  state: RuntimeState;
  now: number;
  lastReadyAt: number | null;
  check: () => Promise<void>;
  retry: () => Promise<void>;
}
const RuntimeContext = createContext<RuntimeContextValue | null>(null);

/** One runtime owner; only explicit Retry may invoke the mutating initialization command. */
export function RuntimeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<RuntimeState>({ kind: "checking", status: null, since: Date.now() });
  const [lastReadyAt, setLastReadyAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const currentState = useRef(state);
  currentState.current = state;
  const mounted = useRef(false);
  const generation = useRef(0);
  const flight = useRef<Promise<void> | null>(null);
  const cancelDelay = useRef<(() => void) | null>(null);

  const run = useCallback((mode: "check" | "retry"): Promise<void> => {
    if (flight.current) return flight.current;
    if (!mounted.current || (mode === "retry" && currentState.current.kind === "unsupported-schema")) return Promise.resolve();
    const id = ++generation.current;
    const active = () => mounted.current && generation.current === id;
    const kind = mode === "retry" ? "recovering" : "checking";
    const update = (next: RuntimeState) => { currentState.current = next; setState(next); };
    const since = Date.now();
    setNow(since);
    // Revalidating a ready runtime stays ready until a reply says otherwise, so focus changes
    // never disable open content or announce an outage that has not happened.
    if (!(mode === "check" && currentState.current.kind === "ready")) update({ kind, status: null, since });
    const operation = (async () => {
      try {
        for (let index = 0; index < MAX_CHECKS; index++) {
          const status = await (index === 0 && mode === "retry" ? runtimeGateway.retry() : runtimeGateway.status());
          if (!active()) return;
          setNow(Date.now());
          if (status.state === "ready") { setLastReadyAt(Date.now()); update({ kind: "ready", status }); return; }
          if (status.state === "failed") {
            if (status.failure?.category === "newer_schema") update({ kind: "unsupported-schema", status });
            else update({ kind: "unavailable", status, reason: "runtime-failed" });
            return;
          }
          if (index === MAX_CHECKS - 1) {
            update({ kind: "unavailable", status, reason: "initialization-pending" });
            return;
          }
          update({ kind, status, since });
          await new Promise<void>(resolve => {
            const finish = () => { cancelDelay.current = null; resolve(); };
            const timer = setTimeout(finish, pollDelay(index));
            cancelDelay.current = () => { clearTimeout(timer); finish(); };
          });
          if (!active()) return;
        }
      } catch (error) {
        if (active()) update({
          kind: "unavailable", status: null,
          reason: error instanceof RuntimeGatewayError ? error.kind : "rejected",
          error: error instanceof RuntimeGatewayError ? error.message : "The local runtime could not be reached.",
        });
      } finally {
        if (generation.current === id) flight.current = null;
      }
    })();
    flight.current = operation;
    return operation;
  }, []);

  const check = useCallback(() => run("check"), [run]);
  const retry = useCallback(() => run("retry"), [run]);
  useEffect(() => {
    mounted.current = true;
    void check();
    // Revalidate when returning to a ready app; never run another perpetual polling loop.
    const onFocus = () => { if (currentState.current.kind === "ready") void check(); };
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      mounted.current = false;
      generation.current++;
      cancelDelay.current?.();
      flight.current = null;
    };
  }, [check]);

  return <RuntimeContext.Provider value={{ state, now, lastReadyAt, check, retry }}>{children}</RuntimeContext.Provider>;
}

export function useRuntime() {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error("useRuntime requires RuntimeProvider");
  return runtime;
}
