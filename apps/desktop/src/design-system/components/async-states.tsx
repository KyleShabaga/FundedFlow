// Presentation of asynchronous data and writes. Each view takes one
// discriminated state instead of loose isLoading/isError flags, so a screen
// cannot show "loading" and "error" at once, and a failed request can never
// fall through to "no records". These components only display states they
// are given: Build 14 hooks produce them, and nothing here fetches, retries
// on its own, or replays a write.
//
// The states, and what each means to the trader:
//   loading      Nothing to show yet. Skeletons only: no numbers, no $0.00.
//   success      Confirmed data.
//   refreshing   Confirmed data, a background check for newer data is running.
//   stale        Old data is still shown, but newer data could not be confirmed.
//   empty        The request worked and there is nothing (no records, no matches, not set up).
//   error        The request failed. Never shown as empty.
//   unavailable  A known dependency or feature is unavailable, with a way to resolve it.

import { CircleAlert, Inbox, LoaderCircle, RefreshCw, SearchX, Settings2, Unplug } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import { formatInstant } from "../format";
import { cx } from "./cx";
import { StatusIndicator } from "./feedback";
import { type ValidationIssue, ValidationSummary } from "./forms";
import { Button } from "./primitives";

/* ---------- State types ---------- */

/** no-records: nothing saved yet. no-matches: filters hide everything. not-configured: needs setup first. */
export type EmptyKind = "no-records" | "no-matches" | "not-configured";

/**
 * An error already turned into safe, human text by the data layer. Never
 * put raw Rust, SQL, file paths or stack traces here.
 */
export interface DisplayError {
  title?: string;
  message: string;
}

export type StaleCause = "refresh-failed" | "offline" | "outdated";
/**
 * What `asOf` means: "data" when the backend says when the figures were
 * calculated or stored; "loaded" when it is only when this screen last
 * received them (a client receipt time).
 */
export type AsOfBasis = "data" | "loaded";

export type AsyncState<T> =
  | { status: "loading" }
  | { status: "success"; data: T; asOf?: string | null }
  | { status: "refreshing"; data: T; asOf?: string | null }
  | { status: "stale"; data: T; asOf: string | null; cause: StaleCause; asOfBasis?: AsOfBasis }
  | { status: "empty"; kind: EmptyKind }
  | { status: "error"; error: DisplayError }
  | { status: "unavailable"; reason: string; title?: string };

export type AsyncStatus = AsyncState<unknown>["status"];

/** True when the state carries data to show (success, refreshing or stale). */
export function hasData<T>(state: AsyncState<T>): state is Extract<AsyncState<T>, { data: T }> {
  return state.status === "success" || state.status === "refreshing" || state.status === "stale";
}

/* ---------- Skeleton ---------- */

export interface SkeletonProps {
  /** CSS width: 120, "60%". Default 100%. */
  width?: number | string;
  /** px. Default 14 (a text line). */
  height?: number;
  shape?: "text" | "block" | "circle";
  className?: string;
}

/** Placeholder block. Decorative: the surrounding LoadingState carries the accessible label. */
export function Skeleton({ width = "100%", height = 14, shape = "text", className }: SkeletonProps) {
  return <span aria-hidden="true" className={cx("ds-skel", `ds-skel-${shape}`, className)} style={{ width, height }} />;
}

/* ---------- LoadingState ---------- */

export interface LoadingStateProps {
  /** Announced and shown to screen readers: "Loading accounts". */
  label: string;
  /** Skeleton layout that matches the content it stands in for, so nothing jumps when data arrives. */
  layout?: "lines" | "metrics" | "table" | "panel" | "inline";
  /** Lines, tiles or table rows. */
  rows?: number;
  className?: string;
}

/**
 * First load: nothing is known yet. Shows skeleton shapes, never example or
 * zero values. For a refresh of data already on screen use RefreshingIndicator.
 */
export function LoadingState({ label, layout = "lines", rows = 3, className }: LoadingStateProps) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={cx("ds-loading", `ds-loading-${layout}`, className)}>
      <span className="ds-sr-only">{label}</span>
      {layout === "inline" && (
        <span className="ds-loading-inline" aria-hidden="true">
          <LoaderCircle size={16} className="ds-spin" />
          {label}
        </span>
      )}
      {layout === "lines" &&
        Array.from({ length: rows }, (_, i) => <Skeleton key={i} width={i === rows - 1 ? "60%" : "100%"} />)}
      {layout === "metrics" && (
        <div className="ds-loading-metrics" aria-hidden="true">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="ds-card ds-loading-tile">
              <Skeleton width="45%" height={12} />
              <Skeleton width="70%" height={24} />
              <Skeleton width="55%" height={12} />
            </div>
          ))}
        </div>
      )}
      {layout === "table" && (
        <div className="ds-loading-table" aria-hidden="true">
          <Skeleton height={32} shape="block" />
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="ds-loading-row">
              <Skeleton width="18%" />
              <Skeleton width="30%" />
              <Skeleton width="20%" />
              <Skeleton width="14%" />
            </div>
          ))}
        </div>
      )}
      {layout === "panel" && (
        <div className="ds-loading-panel" aria-hidden="true">
          <Skeleton width="35%" height={18} />
          <Skeleton height={160} shape="block" />
        </div>
      )}
    </div>
  );
}

/* ---------- EmptyState ---------- */

const EMPTY_DEFAULTS: Record<EmptyKind, { icon: typeof Inbox; title: string; description: string }> = {
  "no-records": { icon: Inbox, title: "Nothing here yet", description: "Records you add or import will show here." },
  "no-matches": { icon: SearchX, title: "No matches", description: "Nothing matches these filters. Change or clear them to see more." },
  "not-configured": { icon: Settings2, title: "Not set up yet", description: "Finish setting this up to see it here." },
};

export interface EmptyStateProps {
  kind: EmptyKind;
  /** Specific copy beats the default: "Add your first account". */
  title?: string;
  description?: ReactNode;
  /** The next step: "Add account", "Clear filters", "Set up rules". */
  action?: ReactNode;
  /** compact: inside a table or small card. */
  size?: "panel" | "compact";
  className?: string;
}

/** A successful answer with nothing in it. Only render it from an `empty` state, never after a failure. */
export function EmptyState({ kind, title, description, action, size = "panel", className }: EmptyStateProps) {
  const d = EMPTY_DEFAULTS[kind];
  const Icon = d.icon;
  return (
    <div className={cx("ds-state", "ds-empty", `ds-state-${size}`, className)} data-empty-kind={kind}>
      <span className="ds-state-mark" aria-hidden="true">
        <Icon size={20} />
      </span>
      <p className="ds-state-title">{title ?? d.title}</p>
      <div className="ds-state-text">{description ?? d.description}</div>
      {action != null && <div className="ds-state-actions">{action}</div>}
    </div>
  );
}

/* ---------- ErrorState ---------- */

export interface ErrorStateProps {
  /** Default: the error's title, else "Couldn't load this". */
  title?: string;
  /** Safe explanation of what happened and what is still true ("Your trades are unchanged"). */
  message: ReactNode;
  /** Shows "Try again". Reads are safe to retry; for writes use MutationFeedback. */
  onRetry?: () => void;
  retryLabel?: string;
  /** A retry is in progress: the button is busy and cannot be pressed twice. */
  retrying?: boolean;
  /** Other ways out: "Open settings", "Go to Today". */
  actions?: ReactNode;
  /**
   * operation: one action failed, inline. card: one panel could not load.
   * route: the whole view could not load.
   */
  scope?: "operation" | "card" | "route";
  /** Move focus to the heading on mount (after the user asked for this view). Default: route scope only. */
  autoFocus?: boolean;
  /** role="alert". Default true; turn off for errors present on first paint among many cards. */
  announce?: boolean;
  className?: string;
}

export function ErrorState({ title = "Couldn't load this", message, onRetry, retryLabel = "Try again", retrying, actions, scope = "card", autoFocus, announce = true, className }: ErrorStateProps) {
  const heading = useRef<HTMLParagraphElement>(null);
  const focus = autoFocus ?? scope === "route";
  useEffect(() => {
    if (focus) heading.current?.focus();
  }, [focus]);
  return (
    <div role={announce ? "alert" : undefined} className={cx("ds-state", "ds-error-state", `ds-state-${scope === "operation" ? "compact" : "panel"}`, `ds-error-${scope}`, className)}>
      <span className="ds-state-mark" aria-hidden="true">
        <CircleAlert size={20} />
      </span>
      <p ref={heading} tabIndex={-1} className="ds-state-title">
        {title}
      </p>
      <div className="ds-state-text">{message}</div>
      {(onRetry || actions != null) && (
        <div className="ds-state-actions">
          {onRetry && (
            <Button icon={<RefreshCw size={16} aria-hidden="true" />} onClick={onRetry} loading={retrying}>
              {retryLabel}
            </Button>
          )}
          {actions}
        </div>
      )}
    </div>
  );
}

/* ---------- UnavailableState ---------- */

export interface UnavailableStateProps {
  title?: string;
  /** What is unavailable and why, in plain words. */
  reason: ReactNode;
  /** The specific way to resolve it ("Open backup settings"). */
  action?: ReactNode;
  size?: "panel" | "compact";
  className?: string;
}

/**
 * A known dependency or feature is unavailable (no rulebook for the account,
 * a calculation that needs setup). Not a failure and not empty. App-wide
 * runtime recovery belongs to the shell (Build 12).
 */
export function UnavailableState({ title = "Not available", reason, action, size = "panel", className }: UnavailableStateProps) {
  return (
    <div className={cx("ds-state", "ds-unavailable", `ds-state-${size}`, className)}>
      <span className="ds-state-mark" aria-hidden="true">
        <Unplug size={20} />
      </span>
      <p className="ds-state-title">{title}</p>
      <div className="ds-state-text">{reason}</div>
      {action != null && <div className="ds-state-actions">{action}</div>}
    </div>
  );
}

/* ---------- StaleDataNotice ---------- */

export interface StaleDataNoticeProps {
  /** When the shown data was last confirmed (ISO instant). null: unknown, said so. */
  asOf: string | null;
  cause: StaleCause;
  /** Whether `asOf` is when the data was calculated or only when it was last loaded. Default "data". */
  asOfBasis?: AsOfBasis;
  /** Account zone for the timestamp. */
  timeZone?: string;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}

/** Bar above data that is still shown but not confirmed current. Never says "live" or "up to date". */
export function StaleDataNotice({ asOf, cause, asOfBasis = "data", timeZone, onRetry, retrying, className }: StaleDataNoticeProps) {
  const when = asOf ? formatInstant(asOf, { timeZone, zoneName: true }) : null;
  let text: string;
  if (asOfBasis === "loaded") {
    const loaded = when ? `last loaded ${when}` : "last loaded at an unknown time";
    text =
      cause === "refresh-failed"
        ? `Couldn't refresh. Showing figures ${loaded}; they may be out of date.`
        : cause === "offline"
          ? `Showing figures ${loaded}. Newer data can't be checked right now.`
          : `Showing figures ${loaded}; they haven't been confirmed since.`;
  } else {
    const from = when ? `from ${when}` : "from an unknown time";
    text =
      cause === "refresh-failed"
        ? `Couldn't refresh. Showing figures ${from}; they may be out of date.`
        : cause === "offline"
          ? `Showing saved figures ${from}. Newer data can't be checked right now.`
          : `These figures are ${from} and haven't been confirmed since.`;
  }
  return (
    <div role="status" className={cx("ds-stale", className)}>
      <StatusIndicator status="stale" label="Not current" />
      <span className="ds-stale-text">{text}</span>
      {onRetry && (
        <Button size="sm" variant="ghost" onClick={onRetry} loading={retrying} icon={<RefreshCw size={14} aria-hidden="true" />}>
          Refresh
        </Button>
      )}
    </div>
  );
}

/* ---------- RefreshingIndicator ---------- */

export interface RefreshingIndicatorProps {
  /** Visible text. Default "Updating". */
  label?: string;
  /**
   * Announce to screen readers. Off by default: background refreshes happen
   * often and should not interrupt.
   */
  announce?: boolean;
  className?: string;
}

/** Small "Updating" mark beside data that stays on screen during a background refresh. */
export function RefreshingIndicator({ label = "Updating", announce = false, className }: RefreshingIndicatorProps) {
  return (
    <span className={cx("ds-refreshing", className)} role={announce ? "status" : undefined}>
      <RefreshCw size={14} className="ds-spin" aria-hidden="true" />
      {label}
    </span>
  );
}

/* ---------- MutationFeedback ---------- */

/**
 * A write as the user sees it. `uncertain` means the request was sent but the
 * outcome is unknown (timeout, lost connection): it might have saved. `failed`
 * says whether the data layer knows nothing changed.
 */
export type MutationState =
  | { status: "idle" }
  | { status: "validating"; message?: string }
  | { status: "submitting"; message?: string }
  | { status: "success"; message: string }
  | { status: "validation-error"; issues: readonly ValidationIssue[] }
  | { status: "uncertain"; message?: string }
  | { status: "failed"; message: string; nothingChanged: boolean };

/** Disable the submit while true, so one click is one write. */
export function isMutationBusy(state: MutationState): boolean {
  return state.status === "validating" || state.status === "submitting";
}

export interface MutationFeedbackProps {
  state: MutationState;
  /** Shown only for `failed` with nothingChanged: retrying cannot double-write. */
  onRetry?: () => void;
  /** For `uncertain`: look up whether the write landed (e.g. reload the record). Never a blind retry. */
  onCheck?: () => void;
  /**
   * Extra buttons for `uncertain` and `failed`, after the built-in one: for
   * example "I've checked the records", which releases a write lock once the
   * user has reviewed what was saved.
   */
  actions?: ReactNode;
  className?: string;
}

/**
 * Status line for a save, import or delete. It shows the state it is given and
 * never resubmits: an uncertain outcome offers "Check result", not "Retry".
 */
export function MutationFeedback({ state, onRetry, onCheck, actions, className }: MutationFeedbackProps) {
  switch (state.status) {
    case "idle":
      return null;
    case "validating":
    case "submitting":
      return (
        <p role="status" className={cx("ds-mutation", "ds-mutation-busy", className)}>
          <LoaderCircle size={16} className="ds-spin" aria-hidden="true" />
          {state.message ?? (state.status === "validating" ? "Checking…" : "Saving…")}
        </p>
      );
    case "success":
      return (
        <p role="status" className={cx("ds-mutation", "ds-mutation-success", className)}>
          {state.message}
        </p>
      );
    case "validation-error":
      return <ValidationSummary issues={state.issues} className={className} />;
    case "uncertain":
      return (
        <div role="alert" className={cx("ds-notice", "ds-notice-warning", "ds-mutation-notice", className)}>
          <CircleAlert size={18} className="ds-notice-icon" aria-hidden="true" />
          <div className="ds-notice-body">
            <p className="ds-notice-title">Couldn't confirm it saved</p>
            <p className="ds-notice-text">{state.message ?? "The request was sent but no answer came back. It may have saved. Check before trying again."}</p>
            {(onCheck || actions != null) && (
              <div className="ds-notice-actions">
                {onCheck && (
                  <Button size="sm" onClick={onCheck}>
                    Check result
                  </Button>
                )}
                {actions}
              </div>
            )}
          </div>
        </div>
      );
    case "failed":
      return (
        <div role="alert" className={cx("ds-notice", "ds-notice-error", "ds-mutation-notice", className)}>
          <CircleAlert size={18} className="ds-notice-icon" aria-hidden="true" />
          <div className="ds-notice-body">
            <p className="ds-notice-title">{state.nothingChanged ? "Not saved" : "It may not have finished"}</p>
            <p className="ds-notice-text">
              {state.message} {state.nothingChanged ? "Nothing was changed." : "Check what changed before trying again."}
            </p>
            {((state.nothingChanged && onRetry) || (!state.nothingChanged && onCheck) || actions != null) && (
              <div className="ds-notice-actions">
                {state.nothingChanged && onRetry && (
                  <Button size="sm" onClick={onRetry}>
                    Try again
                  </Button>
                )}
                {!state.nothingChanged && onCheck && (
                  <Button size="sm" onClick={onCheck}>
                    Check result
                  </Button>
                )}
                {actions}
              </div>
            )}
          </div>
        </div>
      );
  }
}

/* ---------- StateBoundary ---------- */

export interface StateBoundaryProps<T> {
  state: AsyncState<T>;
  /** What this shows, lower case: "accounts", "today's risk". Used for announcements. */
  label: string;
  /** Renders confirmed (or stale) data. */
  children: (data: T, meta: { status: "success" | "refreshing" | "stale"; asOf: string | null }) => ReactNode;
  /** Replaces the default LoadingState (pass a skeleton shaped like the content). */
  loading?: ReactNode;
  /** Replaces the default EmptyState for a kind. */
  empty?: Partial<Record<EmptyKind, ReactNode>>;
  /** Default ErrorState scope. */
  scope?: ErrorStateProps["scope"];
  /** Retry for reads (error and stale). */
  onRetry?: () => void;
  /** Resolution action for `unavailable`. */
  unavailableAction?: ReactNode;
  /** Account zone for stale timestamps. */
  timeZone?: string;
  className?: string;
}

/**
 * Picks the view for an AsyncState. The switch is exhaustive, so adding a
 * status is a compile error until it has a view. Announcements: one polite
 * message when a first load finishes; errors announce themselves; background
 * refreshes are silent. Focus moves to the error heading when a load the user
 * is waiting for fails (route scope, or any scope after a loading state).
 */
export function StateBoundary<T>({ state, label, children, loading, empty, scope = "card", onRetry, unavailableAction, timeZone, className }: StateBoundaryProps<T>) {
  const previous = useRef<AsyncStatus | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const liveId = useId();
  const wasLoading = previous.current === "loading";
  useEffect(() => {
    if (previous.current === "loading" && state.status !== "loading") {
      setAnnouncement(state.status === "empty" ? `No ${label} to show` : state.status === "error" ? "" : `${capitalise(label)} loaded`);
    }
    previous.current = state.status;
  }, [state.status, label]);

  let body: ReactNode;
  switch (state.status) {
    case "loading":
      body = loading ?? <LoadingState label={`Loading ${label}`} />;
      break;
    case "success":
    case "refreshing":
      body = (
        <>
          {state.status === "refreshing" && (
            <div className="ds-boundary-bar">
              <RefreshingIndicator />
            </div>
          )}
          {children(state.data, { status: state.status, asOf: state.asOf ?? null })}
        </>
      );
      break;
    case "stale":
      body = (
        <>
          <StaleDataNotice asOf={state.asOf} cause={state.cause} asOfBasis={state.asOfBasis} timeZone={timeZone} onRetry={onRetry} />
          {children(state.data, { status: "stale", asOf: state.asOf })}
        </>
      );
      break;
    case "empty":
      body = empty?.[state.kind] ?? <EmptyState kind={state.kind} />;
      break;
    case "error":
      body = <ErrorState title={state.error.title} message={state.error.message} onRetry={onRetry} scope={scope} autoFocus={scope === "route" || wasLoading} />;
      break;
    case "unavailable":
      body = <UnavailableState title={state.title} reason={state.reason} action={unavailableAction} />;
      break;
    default: {
      const unreachable: never = state;
      body = unreachable;
    }
  }
  return (
    <div className={cx("ds-boundary", className)} aria-busy={state.status === "loading" || state.status === "refreshing" || undefined} data-state={state.status}>
      <span id={liveId} role="status" className="ds-sr-only">
        {announcement}
      </span>
      {body}
    </div>
  );
}

function capitalise(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
