// Overlays on Radix: Dialog, ConfirmDialog, Drawer, Popover, DropdownMenu and
// Tooltip. Radix supplies focus trapping (modal), Escape and outside-click
// dismissal, and focus return to the trigger. Surfaces use bg-100, a line-200
// border, radius-lg and shadow-pop, per docs/design/components.md (Popover).

import * as RadixDialog from "@radix-ui/react-dialog";
import * as RadixMenu from "@radix-ui/react-dropdown-menu";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import { Ellipsis, Info, X } from "lucide-react";
import { type ReactElement, type ReactNode, useEffect, useId, useRef, useState } from "react";

import { cx } from "./cx";
import { Button } from "./primitives";

/* ---------- Focus return ---------- */

const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Where focus goes when the element that opened an overlay is gone (a row
 * menu whose row was deleted or archived): the first tabbable control in the
 * nearest surviving container, or that container if it takes focus itself.
 */
function survivingFocusTarget(ancestors: readonly HTMLElement[]): HTMLElement | null {
  for (const ancestor of ancestors) {
    if (!ancestor.isConnected || ancestor === document.body) continue;
    const inside = Array.from(ancestor.querySelectorAll<HTMLElement>(TABBABLE)).find(el => !el.closest("[hidden], [aria-hidden='true'], [inert]"));
    if (inside) return inside;
    if (ancestor.hasAttribute("tabindex")) return ancestor;
  }
  return null;
}

/**
 * Radix returns focus to its own Trigger. Dialogs opened from elsewhere (a
 * menu item, a controlled `open`) would drop focus on the body, so remember
 * what had focus on open and put it back on close. If that element has been
 * removed meanwhile, focus a sensible surviving control near where it was.
 */
function useFocusReturn() {
  const returnTo = useRef<HTMLElement | null>(null);
  const ancestors = useRef<HTMLElement[]>([]);
  return {
    capture: () => {
      const el = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
      returnTo.current = el;
      ancestors.current = [];
      for (let at = el?.parentElement ?? null; at; at = at.parentElement) ancestors.current.push(at);
    },
    restore: (e: Event) => {
      const el = returnTo.current;
      const target = el?.isConnected ? el : survivingFocusTarget(ancestors.current);
      if (target) {
        e.preventDefault();
        target.focus();
      }
    },
  };
}

/* ---------- Dialog ---------- */

export interface DialogProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Element that opens the dialog (a Button). Omit when `open` is controlled from elsewhere. */
  trigger?: ReactElement;
  title: string;
  /** One sentence under the title; also the dialog's accessible description. */
  description?: ReactNode;
  children?: ReactNode;
  /** Buttons at the bottom right. Put Cancel first, the action last. */
  footer?: ReactNode;
  /** sm 400 px (confirmations), md 560 px (forms), lg 760 px. All shrink to the window. */
  size?: "sm" | "md" | "lg";
  /** Hide the close (×) button, e.g. while a write is in progress. */
  hideClose?: boolean;
  /** Blocks Escape and outside clicks, e.g. while a write is in progress. */
  dismissible?: boolean;
  className?: string;
}

/** Modal dialog. Focus moves in on open, is trapped, and returns to the trigger on close. */
export function Dialog({ open, defaultOpen, onOpenChange, trigger, title, description, children, footer, size = "md", hideClose, dismissible = true, className }: DialogProps) {
  const focus = useFocusReturn();
  return (
    <RadixDialog.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      {trigger && <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>}
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="ds-overlay" />
        <RadixDialog.Content
          className={cx("ds-dialog", `ds-dialog-${size}`, className)}
          onOpenAutoFocus={focus.capture}
          onCloseAutoFocus={focus.restore}
          onEscapeKeyDown={(e) => !dismissible && e.preventDefault()}
          onPointerDownOutside={(e) => !dismissible && e.preventDefault()}
          onInteractOutside={(e) => !dismissible && e.preventDefault()}
          {...(description == null ? { "aria-describedby": undefined } : {})}
        >
          <OverlayHead title={title} description={description} hideClose={hideClose || !dismissible} />
          {children != null && <div className="ds-dialog-body">{children}</div>}
          {footer != null && <div className="ds-dialog-foot">{footer}</div>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

function OverlayHead({ title, description, hideClose }: { title: string; description?: ReactNode; hideClose?: boolean }) {
  return (
    <div className="ds-dialog-head">
      <div className="ds-dialog-titles">
        <RadixDialog.Title className="ds-dialog-title">{title}</RadixDialog.Title>
        {description != null && <RadixDialog.Description className="ds-dialog-desc">{description}</RadixDialog.Description>}
      </div>
      {!hideClose && (
        <RadixDialog.Close asChild>
          <button type="button" className="ds-icon-btn ds-icon-btn-ghost ds-icon-btn-sm" aria-label="Close">
            <X size={16} aria-hidden="true" />
          </button>
        </RadixDialog.Close>
      )}
    </div>
  );
}

/* ---------- ConfirmDialog ---------- */

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Names exactly what will be affected ("Apex $100K · PA-48213 and its 67 trades"). */
  children: ReactNode;
  confirmLabel: string;
  /** Shown on the button while the action runs ("Deleting…"). */
  busyLabel?: string;
  /** danger: destructive (red button). neutral: reversible (archive, restore). */
  tone?: "danger" | "neutral";
  /**
   * Runs the action. Resolve to close; reject to stay open with the error.
   * It runs once per click and is never retried automatically.
   */
  onConfirm: () => Promise<void>;
  /**
   * Turns a rejection into safe text. The default never shows raw errors and
   * does not claim nothing changed, because the outcome may be unknown.
   */
  describeError?: (error: unknown) => string;
}

const DEFAULT_CONFIRM_ERROR = "It didn't finish. Check whether anything changed before trying again.";

/**
 * Confirmation before a consequential action. Cancel has focus first, so Enter
 * never confirms by accident. While the action runs the dialog cannot be
 * dismissed and the button cannot be pressed twice. The action itself
 * (backup, delete) belongs to the feature card.
 */
export function ConfirmDialog({ open, onOpenChange, title, children, confirmLabel, busyLabel = "Working…", tone = "danger", onConfirm, describeError }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const focus = useFocusReturn();
  const change = (next: boolean) => {
    if (busy) return;
    if (!next) setError(null);
    onOpenChange(next);
  };
  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      setBusy(false);
      onOpenChange(false);
    } catch (e) {
      setBusy(false);
      setError(describeError ? describeError(e) : DEFAULT_CONFIRM_ERROR);
    }
  };
  return (
    <RadixDialog.Root open={open} onOpenChange={change}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="ds-overlay" />
        <RadixDialog.Content
          role="alertdialog"
          className="ds-dialog ds-dialog-sm"
          onEscapeKeyDown={(e) => busy && e.preventDefault()}
          onInteractOutside={(e) => busy && e.preventDefault()}
          onCloseAutoFocus={focus.restore}
          onOpenAutoFocus={(e) => {
            focus.capture();
            e.preventDefault();
            (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>("[data-cancel]")?.focus();
          }}
        >
          <OverlayHead title={title} hideClose />
          <RadixDialog.Description asChild>
            <div className="ds-dialog-body">{children}</div>
          </RadixDialog.Description>
          {error && (
            <p role="alert" className="ds-notice ds-notice-error ds-dialog-error">
              {error}
            </p>
          )}
          <div className="ds-dialog-foot">
            <RadixDialog.Close asChild>
              <Button data-cancel disabled={busy}>
                Cancel
              </Button>
            </RadixDialog.Close>
            <Button variant={tone === "danger" ? "danger" : "primary"} loading={busy} onClick={() => void confirm()}>
              {busy ? busyLabel : confirmLabel}
            </Button>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/* ---------- Drawer ---------- */

export interface DrawerProps extends Omit<DialogProps, "size"> {
  /** Width on wide windows. The drawer takes the full width below 560 px. */
  width?: number;
  side?: "right" | "left";
}

/**
 * Side panel for detail that keeps the page in view: calculation breakdowns,
 * contributing trades. Modal (focus is trapped); the body scrolls on its own.
 */
export function Drawer({ open, defaultOpen, onOpenChange, trigger, title, description, children, footer, width = 480, side = "right", hideClose, dismissible = true, className }: DrawerProps) {
  const focus = useFocusReturn();
  return (
    <RadixDialog.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      {trigger && <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>}
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="ds-overlay" />
        <RadixDialog.Content
          className={cx("ds-drawer", `ds-drawer-${side}`, className)}
          style={{ ["--ds-drawer-w" as string]: `${width}px` }}
          onOpenAutoFocus={focus.capture}
          onCloseAutoFocus={focus.restore}
          onEscapeKeyDown={(e) => !dismissible && e.preventDefault()}
          onInteractOutside={(e) => !dismissible && e.preventDefault()}
          {...(description == null ? { "aria-describedby": undefined } : {})}
        >
          <OverlayHead title={title} description={description} hideClose={hideClose || !dismissible} />
          <div className="ds-drawer-body">{children}</div>
          {footer != null && <div className="ds-dialog-foot ds-drawer-foot">{footer}</div>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/* ---------- Popover ---------- */

export interface PopoverProps {
  /** The button that opens it. Gets aria-haspopup="dialog" and aria-expanded. */
  trigger: ReactElement;
  /** Accessible name of the popover ("Choose month and year"). */
  label: string;
  children: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Edge of the trigger the popover lines up with. */
  align?: "start" | "end";
  /** Fixed width in px; shrinks to the window. */
  width?: number;
  className?: string;
}

/**
 * Non-modal surface anchored under its trigger: month picker, column chooser,
 * timer resets. Escape and clicks outside close it and focus returns to the
 * trigger. Built on non-modal Radix Dialog without a portal, so it is
 * positioned by CSS against the wrapper and stays inside scroll containers.
 */
export function Popover({ trigger, label, children, open, defaultOpen, onOpenChange, align = "start", width, className }: PopoverProps) {
  return (
    <RadixDialog.Root modal={false} open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      <span className="ds-popover-anchor">
        <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>
        <RadixDialog.Content
          aria-label={label}
          aria-describedby={undefined}
          className={cx("ds-pop", "ds-popover", `ds-popover-${align}`, className)}
          style={width ? { width } : undefined}
        >
          <RadixDialog.Title className="ds-sr-only">{label}</RadixDialog.Title>
          {children}
        </RadixDialog.Content>
      </span>
    </RadixDialog.Root>
  );
}

/** Closes the nearest Popover, Dialog or Drawer: wrap a button inside one. */
export const OverlayClose = RadixDialog.Close;

/* ---------- DropdownMenu ---------- */

export type MenuEntry =
  | {
      type?: "item"; label: string; onSelect: () => void; icon?: ReactNode; disabled?: boolean; tone?: "danger"; shortcut?: string;
      /**
       * P0-D06: the current choice in a list of choices (the active account). Set on every choice item: consecutive
       * choices render as one radio group (`menuitemradio`, `aria-checked`), the checked one drawn with a filled ground
       * and an accent bar, not a checkmark, so `icon` stays free for a status. Choosing it again only closes the menu.
       */
      checked?: boolean;
      /** A second, quieter line under the label ("Fresh · import Oct 21, 16:58"). Part of the item's name. */
      description?: string;
    }
  | { type: "separator" }
  | { type: "label"; label: string }
  /** P0-D06: a short explanation inside the menu (what the dots mean). Not focusable; read with the menu. */
  | { type: "note"; text: string };

export interface DropdownMenuProps {
  /** The button that opens the menu (an IconButton for row menus, a Button "Columns"). */
  trigger: ReactElement;
  items: readonly MenuEntry[];
  align?: "start" | "end";
  /** Accessible name of the menu when the trigger's text does not describe it. */
  label?: string;
}

/**
 * Actions on one object (row menu, overflow). Arrow keys move, typing jumps,
 * Enter selects, Escape closes and returns focus to the trigger. Disabled
 * items are skipped by the keyboard and announced as unavailable.
 */
export function DropdownMenu({ trigger, items, align = "end", label }: DropdownMenuProps) {
  const pending = useRef<(() => void) | null>(null);
  return (
    <RadixMenu.Root>
      <RadixMenu.Trigger asChild>{trigger}</RadixMenu.Trigger>
      <RadixMenu.Portal>
        <RadixMenu.Content className="ds-pop ds-menu" align={align} sideOffset={4} collisionPadding={8} aria-label={label}
          // Radix calls this once the menu has unmounted, then focuses the trigger. The chosen action runs
          // right after that, so a Dialog it opens records the trigger as its focus-return target and never
          // sees the menu's focus return as "focus outside". (A fixed timer raced Radix's own timer.)
          onCloseAutoFocus={() => {
            const action = pending.current;
            pending.current = null;
            if (action) queueMicrotask(action);
          }}>
          {menuRuns(items).map(run => run.choices
            ? (
              // A run of choices is one radio group: the checked one is `aria-checked`, the others can be chosen.
              <RadixMenu.RadioGroup key={run.start} value={String(run.items.findIndex(c => c.checked))}>
                {run.items.map((it, j) => (
                  <RadixMenu.RadioItem
                    key={run.start + j}
                    value={String(j)}
                    className={cx("ds-menu-item", "is-choice", it.description && "has-description")}
                    disabled={it.disabled}
                    onSelect={() => { pending.current = it.checked ? null : it.onSelect; }}
                  >
                    {it.icon}
                    <MenuText label={it.label} description={it.description} />
                  </RadixMenu.RadioItem>
                ))}
              </RadixMenu.RadioGroup>
            )
            : run.items.map((it, j) => {
              const i = run.start + j;
              return it.type === "separator" ? (
                <RadixMenu.Separator key={i} className="ds-menu-sep" />
              ) : it.type === "note" ? (
                <RadixMenu.Label key={i} className="ds-menu-note">
                  {it.text}
                </RadixMenu.Label>
              ) : it.type === "label" ? (
                <RadixMenu.Label key={i} className="ds-menu-label">
                  {it.label}
                </RadixMenu.Label>
              ) : (
                <RadixMenu.Item
                  key={i}
                  className={cx("ds-menu-item", it.tone === "danger" && "is-danger", it.description && "has-description")}
                  disabled={it.disabled}
                  // Runs from onCloseAutoFocus above, after the menu has closed and returned focus to its trigger.
                  onSelect={() => { pending.current = it.onSelect; }}
                >
                  {it.icon}
                  <MenuText label={it.label} description={it.description} />
                  {it.shortcut && <span className="ds-menu-shortcut">{it.shortcut}</span>}
                </RadixMenu.Item>
              );
            }))}
        </RadixMenu.Content>
      </RadixMenu.Portal>
    </RadixMenu.Root>
  );
}

type MenuItemEntry = Extract<MenuEntry, { label: string; onSelect: () => void }>;
type MenuRun = { start: number; choices: true; items: MenuItemEntry[] } | { start: number; choices: false; items: MenuEntry[] };
const isChoice = (it: MenuEntry): it is MenuItemEntry => (it.type === undefined || it.type === "item") && (it as MenuItemEntry).checked !== undefined;

/** Consecutive choice items (those with `checked`) form one run, so each renders as one radio group. */
function menuRuns(items: readonly MenuEntry[]): MenuRun[] {
  const runs: MenuRun[] = [];
  items.forEach((it, i) => {
    const last = runs[runs.length - 1];
    const choice = isChoice(it);
    if (last && last.choices === choice) (last.items as MenuEntry[]).push(it);
    else runs.push(choice ? { start: i, choices: true, items: [it] } : { start: i, choices: false, items: [it] });
  });
  return runs;
}

function MenuText({ label, description }: { label: string; description?: string }) {
  if (!description) return <span className="ds-menu-text">{label}</span>;
  return (
    <span className="ds-menu-lines">
      <span className="ds-menu-text">{label}</span>
      <span className="ds-menu-description">{description}</span>
    </span>
  );
}

/* ---------- ActionPill ---------- */

export interface ActionPillProps {
  /** The item's name; long names wrap inside the pill. */
  label: ReactNode;
  /** Short facts after the name ("Used in 47 reviews"). */
  meta?: ReactNode;
  /** A state badge ("Archived"). */
  badge?: ReactNode;
  /** The item's own actions, in a DropdownMenu on the pill's menu button. */
  actions: readonly MenuEntry[];
  /** Names the menu button and the menu ("Actions for tag ORB"). */
  actionsLabel: string;
  /** Drawn quieter (an archived item). */
  muted?: boolean;
  className?: string;
}

/**
 * A named item in a managed list (a library tag) with its own overflow menu. The pill itself is not a button: its
 * one control is the menu button at its end, so actions are never nested in another control and every action is
 * reachable by keyboard and a single click. Archive or restore belong in the menu as words, not as an X, which
 * reads as "remove".
 */
export function ActionPill({ label, meta, badge, actions, actionsLabel, muted, className }: ActionPillProps) {
  return (
    <span className={cx("ds-action-pill", muted && "is-muted", className)}>
      <span className="ds-action-pill-text">
        <span className="ds-action-pill-label">{label}</span>
        {badge}
        {meta != null && <span className="ds-action-pill-meta">{meta}</span>}
      </span>
      <DropdownMenu
        label={actionsLabel}
        align="start"
        items={actions}
        trigger={
          <button type="button" className="ds-action-pill-menu" aria-label={actionsLabel}>
            <Ellipsis size={14} aria-hidden="true" />
          </button>
        }
      />
    </span>
  );
}

/* ---------- Tooltip ---------- */

export interface TooltipProps {
  /** Short text that names or explains the trigger. Never the only place for essential information. */
  content: ReactNode;
  /** A focusable element: it shows on hover and on keyboard focus. */
  children: ReactElement;
  side?: "top" | "bottom" | "left" | "right";
  delayMs?: number;
}

export function Tooltip({ content, children, side = "top", delayMs = 400 }: TooltipProps) {
  return (
    <RadixTooltip.Provider delayDuration={delayMs}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content side={side} sideOffset={6} collisionPadding={8} className="ds-tooltip">
            {content}
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}

/* ---------- InfoTip ---------- */

export interface InfoTipProps {
  /** Accessible name of the button and the popup ("About Net P&L"). */
  label: string;
  /** The explanation. Plain text or short paragraphs; never the only place for an unavailable-state reason. */
  children: ReactNode;
  /** Largest width in px; shorter text gives a narrower popup, and it shrinks to the window. Default 280. */
  width?: number;
}

const HOVER_OPEN_MS = 120;
const HOVER_CLOSE_MS = 200;

/**
 * A small "i" button that explains the thing it sits beside. Hover and keyboard focus show the explanation; a click
 * or tap pins it open until Escape, a click outside or another click on the button. The pointer can move into the
 * popup. Focus stays on the button, so closing never loses it. It opens toward the side of the window with more
 * room. Built on the same non-modal Radix Dialog as Popover, without a portal, so it scrolls with its card.
 */
export function InfoTip({ label, children, width = 280 }: InfoTipProps) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [align, setAlign] = useState<"start" | "end">("start");
  const trigger = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const contentId = useId();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const show = (pin: boolean) => {
    window.clearTimeout(timer.current);
    const box = trigger.current?.getBoundingClientRect();
    if (box) setAlign(box.left + width > window.innerWidth - 8 && box.right > width ? "end" : "start");
    setOpen(true);
    if (pin) setPinned(true);
  };
  const close = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
    setPinned(false);
  };
  const later = (fn: () => void, ms: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(fn, ms);
  };
  return (
    <RadixDialog.Root modal={false} open={open} onOpenChange={(next) => (next ? show(true) : close())}>
      <span
        className="ds-popover-anchor ds-infotip"
        onPointerEnter={(e) => {
          if (e.pointerType !== "mouse") return;
          // Back over the button or into the popup (across the gap between them): cancel a pending close.
          if (open) window.clearTimeout(timer.current);
          else later(() => show(false), HOVER_OPEN_MS);
        }}
        onPointerLeave={(e) => e.pointerType === "mouse" && !pinned && later(close, HOVER_CLOSE_MS)}
      >
        <button
          ref={trigger}
          type="button"
          className="ds-infotip-btn"
          aria-label={label}
          aria-expanded={open}
          aria-controls={open ? contentId : undefined}
          onClick={() => (open && pinned ? close() : show(true))}
          onFocus={(e) => e.currentTarget.matches(":focus-visible") && show(false)}
          onBlur={() => !pinned && close()}
        >
          <Info aria-hidden="true" />
        </button>
        <RadixDialog.Content
          id={contentId}
          aria-label={label}
          aria-describedby={undefined}
          className={cx("ds-pop", "ds-popover", `ds-popover-${align}`, "ds-infotip-pop")}
          style={{ maxWidth: `min(${width}px, calc(100vw - 32px))` }}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => trigger.current?.contains(e.target as Node) && e.preventDefault()}
          onFocusOutside={(e) => e.preventDefault()}
        >
          <RadixDialog.Title className="ds-sr-only">{label}</RadixDialog.Title>
          {children}
        </RadixDialog.Content>
      </span>
    </RadixDialog.Root>
  );
}
