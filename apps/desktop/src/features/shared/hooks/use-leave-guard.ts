// Unsaved-edit protection shared by editors (rulebook drafts in Build 19, trade and review forms in Build 20).
// The app uses a HashRouter, which has no navigation blocker, so: in-app links are intercepted while the form is
// dirty (the page asks first, through `onLeaveRequest`), and closing the window asks through `beforeunload`.
// Buttons that navigate in code (Previous/Next trade, Manage accounts, Quick Import) use `useGuardedNavigate`, which
// asks the same guard, and the page's Leave button completes the navigation with `useLeave`.
// Back/Forward (TASK-022): popstate can't be cancelled, so one capture-phase popstate listener on window runs before
// the router's bubble-phase one, stops the event from reaching the router, returns to the editor's entry with
// `history.go(-delta)` (the editor stays mounted) and asks the guard. Leave then repeats the traversal once.
// Known gap: an entry without the router's `history.state.idx` gives no delta, so that popstate goes through unasked.
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

interface Guard { request: { current: (href: string) => void }; idx: number | null }
const active = new Set<Guard>();
/** The traversal the open leave request is about; Leave with the same href repeats it instead of pushing an entry. */
let pending: { href: string; delta: number; to: number } | null = null;
/** The index Leave is traversing to: that one popstate goes to the router unasked. */
let bypass: number | null = null;

const historyIdx = () => {
  const idx = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof idx === "number" ? idx : null;
};

function ask(guard: Guard, href: string) {
  pending = null;
  guard.request.current(href);
}

function onPopState(event: PopStateEvent) {
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

/** Navigates, unless a dirty form is on the page: then that form asks first, as for a link. */
export function useGuardedNavigate() {
  const navigate = useNavigate();
  return (href: string) => {
    const guard = [...active].pop();
    if (guard) ask(guard, href);
    else navigate(href);
  };
}

/** For the Leave button of a guarded editor: completes the navigation it was asked about. */
export function useLeave() {
  const navigate = useNavigate();
  return (href: string) => {
    const traversal = pending;
    pending = null;
    if (traversal && traversal.href === href) {
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
    if (active.size === 1) window.addEventListener("popstate", onPopState, { capture: true });
    return () => {
      active.delete(current);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onUnload);
      if (active.size > 0) return;
      window.removeEventListener("popstate", onPopState, { capture: true });
      pending = null;
      bypass = null;
    };
  }, [dirty]);
}
