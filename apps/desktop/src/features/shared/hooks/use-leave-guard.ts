// Unsaved-edit protection shared by editors (rulebook drafts in Build 19, trade and review forms in Build 20).
// The app uses a HashRouter, which has no navigation blocker, so: in-app links are intercepted while the form is
// dirty (the page asks first, through `onLeaveRequest`), and a page reload asks through `beforeunload`.
// Buttons that navigate in code (Previous/Next trade, Manage accounts, Quick Import) use `useGuardedNavigate`, which
// asks the same guard, and the page's Leave button completes the navigation with `useLeave`.
// Back/Forward (TASK-022): popstate can't be cancelled, so one popstate listener on window stops the event from
// reaching the router, returns to the editor's entry with `history.go(-delta)` (the editor stays mounted) and asks
// the guard. Leave then repeats the traversal once.
// Listener order matters. When window is the event's target, Chromium (WebView2) runs window's popstate listeners
// in the order they were added, whatever their capture flag, and HashRouter adds its own when it mounts. A capture
// listener added later, when a form became dirty, ran after the router had navigated and unmounted the editor, so
// mouse back and Alt+← left without asking. `installLeaveGuardHistory` therefore adds the one listener from main.tsx
// before the first render, and the listener does nothing while no guard is active. The router then sees only the
// return to the editor's entry (delta 0). jsdom runs capture listeners first whatever the order, which hid this.
// Known gap: an entry without the router's `history.state.idx` gives no delta, so that popstate goes through unasked.
// Window close (TASK-023): on the title-bar X and Alt+F4, Tauri closes the window natively and the page gets no
// `beforeunload`, unless the page listens for the close request. So while a guard is active the page listens through
// `onCloseRequested`, prevents the close and asks the guard with `WINDOW_CLOSE`; Leave then destroys the window.
// With no dirty form there is no listener, so a clean window (and the first-run Decline) closes at once.
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { type CloseRequestedEvent, getCurrentWindow } from "@tauri-apps/api/window";

interface Guard { request: { current: (href: string) => void }; idx: number | null }
const active = new Set<Guard>();
/** The traversal the open leave request is about; Leave with the same href repeats it instead of pushing an entry. */
let pending: { href: string; delta: number; to: number } | null = null;
/** The index Leave is traversing to: that one popstate goes to the router unasked. */
let bypass: number | null = null;

/** What a guarded editor's leave request carries when the window is being closed rather than navigated. */
export const WINDOW_CLOSE = "window:close";
export const isWindowClose = (href: string | null | undefined) => href === WINDOW_CLOSE;

const historyIdx = () => {
  const idx = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof idx === "number" ? idx : null;
};

function ask(guard: Guard, href: string) {
  pending = null;
  guard.request.current(href);
}

function onPopState(event: PopStateEvent) {
  if (active.size === 0) return;
  const idx = historyIdx();
  const skip = bypass;
  bypass = null;
  if (skip !== null && idx === skip) return;
  const guard = [...active].pop();
  // Known gap (TASK-022 step 3): without both indexes there is no delta to go back by, so the router takes it.
  if (!guard || idx === null || guard.idx === null) return;
  const delta = idx - guard.idx;
  // Zero: the return to the editor's entry. The router sees it, and nothing has changed for it.
  if (delta === 0) return;
  event.stopImmediatePropagation();
  window.history.go(-delta);
  const href = window.location.hash.slice(1) || "/";
  pending = { href, delta, to: idx };
  guard.request.current(href);
}

let installed = false;
/** Adds the history listener ahead of the router's own. Call once before the first render (see the header). */
export function installLeaveGuardHistory() {
  if (installed) return;
  installed = true;
  window.addEventListener("popstate", onPopState, { capture: true });
}

function onCloseRequested(event: CloseRequestedEvent) {
  const guard = [...active].pop();
  if (!guard) return;
  // Synchronously: the API destroys the window after this handler unless the close was prevented.
  event.preventDefault();
  ask(guard, WINDOW_CLOSE);
}

async function listenForClose(): Promise<(() => void) | null> {
  try {
    return await getCurrentWindow().onCloseRequested(onCloseRequested);
  } catch {
    return null; // Outside Tauri there is no window to guard.
  }
}

/** The close listener exists only while a guard is active, so a clean window closes natively. */
let closeListener: Promise<(() => void) | null> | null = null;
function syncCloseListener() {
  if (active.size > 0 && !closeListener) {
    closeListener = listenForClose();
  } else if (active.size === 0 && closeListener) {
    const listener = closeListener;
    closeListener = null;
    void listener.then(unlisten => unlisten?.());
  }
}

function destroyWindow() {
  try {
    void getCurrentWindow().destroy().catch(() => undefined);
  } catch {
    // Outside Tauri there is no window to close.
  }
}

/** Navigates, unless a dirty form is on the page: then that form asks first, as for a link. */
export function useGuardedNavigate() {
  const navigate = useNavigate();
  return (href: string) => {
    const guard = [...active].pop();
    if (guard) ask(guard, href);
    else navigate(href);
  };
}

/** For the Leave button of a guarded editor: completes the navigation, or the window close, it was asked about. */
export function useLeave() {
  const navigate = useNavigate();
  return (href: string) => {
    const traversal = pending;
    pending = null;
    if (isWindowClose(href)) {
      destroyWindow();
    } else if (traversal && traversal.href === href) {
      bypass = traversal.to;
      window.history.go(traversal.delta);
    } else {
      navigate(href);
    }
  };
}

export function useLeaveGuard(dirty: boolean, onLeaveRequest: (href: string) => void) {
  const request = useRef(onLeaveRequest);
  request.current = onLeaveRequest;
  const guard = useRef<Guard>({ request, idx: null });
  const location = useLocation();
  // The entry the editor is on, kept current as the editor's own URL changes.
  useEffect(() => { guard.current.idx = historyIdx(); }, [location]);
  useEffect(() => {
    if (!dirty) return;
    const current = guard.current;
    current.idx = historyIdx();
    active.add(current);
    syncCloseListener();
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      const href = link.getAttribute("href") ?? "";
      if (!href.startsWith("#/") && !href.startsWith("/")) return;
      event.preventDefault();
      event.stopPropagation();
      ask(current, href.startsWith("#") ? href.slice(1) : href);
    };
    const onUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      active.delete(current);
      syncCloseListener();
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onUnload);
      if (active.size > 0) return;
      pending = null;
      bypass = null;
    };
  }, [dirty]);
}
