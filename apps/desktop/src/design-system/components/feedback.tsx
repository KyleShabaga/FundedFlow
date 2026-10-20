// Messages about what happened: InlineNotice (stays where the problem is),
// Toast (brief confirmation that goes away) and StatusIndicator (a labelled
// status with text, icon and tone, never colour alone).
//
// Which to use (docs/design-system.md has the full guide):
// - A blocking or recovery failure: InlineNotice or ErrorState, never only a toast.
// - A finished action the user can see the result of: Toast (success/info).
// - A risk or freshness status: StatusIndicator.

import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleHelp,
  Clock,
  HardDrive,
  Info,
  OctagonX,
  TriangleAlert,
  X,
} from "lucide-react";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { cx } from "./cx";

export type NoticeTone = "info" | "success" | "warning" | "error";

const NOTICE_ICON: Record<NoticeTone, typeof Info> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  error: CircleAlert,
};

/* ---------- InlineNotice ---------- */

export interface InlineNoticeProps {
  tone?: NoticeTone;
  /** Short bold line. */
  title?: ReactNode;
  children?: ReactNode;
  /** Buttons that resolve it ("Retry", "Open settings"). */
  actions?: ReactNode;
  /** Adds a close button. Leave out for problems that are still true. */
  onDismiss?: () => void;
  /**
   * Announcement. Default: "assertive" (role=alert) for error, "polite"
   * (role=status) for warning, none for info and success, which are usually
   * present when the view loads.
   */
  live?: "assertive" | "polite" | "off";
  className?: string;
}

/** A message inside the page, next to what it is about. Stays until its cause is gone or it is dismissed. */
export function InlineNotice({ tone = "info", title, children, actions, onDismiss, live, className }: InlineNoticeProps) {
  const Icon = NOTICE_ICON[tone];
  const mode = live ?? (tone === "error" ? "assertive" : tone === "warning" ? "polite" : "off");
  const role = mode === "assertive" ? "alert" : mode === "polite" ? "status" : undefined;
  return (
    <div role={role} className={cx("ds-notice", `ds-notice-${tone}`, className)}>
      <Icon size={18} className="ds-notice-icon" aria-hidden="true" />
      <div className="ds-notice-body">
        {title != null && <p className="ds-notice-title">{title}</p>}
        {children != null && <div className="ds-notice-text">{children}</div>}
        {actions != null && <div className="ds-notice-actions">{actions}</div>}
      </div>
      {onDismiss && (
        <button type="button" className="ds-icon-btn ds-icon-btn-ghost ds-icon-btn-sm" aria-label="Dismiss" onClick={onDismiss}>
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/* ---------- Toast ---------- */

export interface ToastInput {
  tone?: NoticeTone;
  title: string;
  description?: string;
  /** One action, e.g. "Undo" or "View". */
  action?: { label: string; onClick: () => void };
  /**
   * Milliseconds before it closes. Default 5000 for success/info; errors and
   * warnings stay until dismissed. Hover or focus pauses the timer.
   */
  durationMs?: number | null;
}

interface ToastItem extends ToastInput {
  id: number;
}

interface ToastApi {
  /** Shows a toast; returns its id. */
  show: (toast: ToastInput) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Toasts for the subtree. The app root mounts one; tests and the gallery mount their own. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);
  const show = useCallback((toast: ToastInput) => {
    const id = next.current++;
    // Newest last; keep at most four so the stack never covers the page.
    setToasts((all) => [...all, { ...toast, id }].slice(-4));
    return id;
  }, []);
  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <section className="ds-toasts" aria-label="Notifications">
        {/* Polite and assertive regions exist before any toast so screen readers announce additions. */}
        <div role="status" aria-live="polite" className="ds-toast-stack">
          {toasts.filter((t) => (t.tone ?? "info") !== "error").map((t) => (
            <ToastView key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
          ))}
        </div>
        <div role="alert" aria-live="assertive" className="ds-toast-stack">
          {toasts.filter((t) => t.tone === "error").map((t) => (
            <ToastView key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
          ))}
        </div>
      </section>
    </ToastContext.Provider>
  );
}

/** The toast API of the nearest ToastProvider. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast needs a ToastProvider above it");
  return api;
}

function ToastView({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const tone = toast.tone ?? "info";
  const Icon = NOTICE_ICON[tone];
  const duration = toast.durationMs !== undefined ? toast.durationMs : tone === "success" || tone === "info" ? 5000 : null;
  const [paused, setPaused] = useState(false);
  // The parent passes a new callback each render; the timer must not restart.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    if (duration == null || paused) return;
    const timer = window.setTimeout(() => dismissRef.current(), duration);
    return () => window.clearTimeout(timer);
  }, [duration, paused]);
  return (
    <div
      className={cx("ds-toast", `ds-notice-${tone}`)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon size={18} className="ds-notice-icon" aria-hidden="true" />
      <div className="ds-notice-body">
        <p className="ds-notice-title">{toast.title}</p>
        {toast.description && <p className="ds-notice-text">{toast.description}</p>}
      </div>
      {toast.action && (
        <button
          type="button"
          className="ds-btn ds-btn-ghost ds-btn-sm"
          onClick={() => {
            toast.action!.onClick();
            onDismiss();
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button type="button" className="ds-icon-btn ds-icon-btn-ghost ds-icon-btn-sm" aria-label="Dismiss notification" onClick={onDismiss}>
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

/* ---------- StatusIndicator ---------- */

/**
 * neutral: plain state. success: confirmed good. caution: approaching a limit.
 * danger: stop / breached. unknown: not enough data; never shown as safe.
 * local: saved on this computer / imported. stale: older than it should be.
 */
export type StatusKind = "neutral" | "success" | "caution" | "danger" | "unknown" | "local" | "stale";

const STATUS_ICON: Record<StatusKind, typeof Info> = {
  neutral: CircleDashed,
  success: CircleCheck,
  caution: TriangleAlert,
  danger: OctagonX,
  unknown: CircleHelp,
  local: HardDrive,
  stale: Clock,
};

export interface StatusIndicatorProps {
  status: StatusKind;
  /** Always visible text: "Caution", "Unknown", "Stale · 2 days". */
  label: string;
  /** Longer explanation for screen readers and the hover title ("Daily loss at 74% of limit"). */
  detail?: string;
  /** pill: badge-like chip. inline: icon and text in a sentence. */
  variant?: "pill" | "inline";
  className?: string;
}

/**
 * A status as text + icon + tone. The icon shape differs per status so it
 * reads without colour. Feature cards map their own states onto it (risk:
 * safe → success, caution, stop → danger, unknown/needs setup → unknown).
 */
export function StatusIndicator({ status, label, detail, variant = "pill", className }: StatusIndicatorProps) {
  const Icon = STATUS_ICON[status];
  return (
    <span className={cx("ds-status", `ds-status-${status}`, `ds-status-${variant}`, className)} title={detail}>
      <Icon size={14} aria-hidden="true" />
      <span>{label}</span>
      {detail && <span className="ds-sr-only">: {detail}</span>}
    </span>
  );
}
