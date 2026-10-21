// Unsaved-edit protection for the draft editor (Build 19). The app uses a HashRouter, which has no
// navigation blocker, so: in-app links are intercepted while the form is dirty (the page asks
// first), closing the window asks through `beforeunload`, and the edits are kept in session storage
// against the revision they started from, so a navigation the page cannot intercept (a header
// button) loses nothing: reopening the draft offers them back. Storage is a per-window convenience:
// every access is guarded and the editor works without it.
import { useEffect, useRef } from "react";
import type { DraftForm } from "../view-models/draft-form";

export function useLeaveGuard(dirty: boolean, onLeaveRequest: (href: string) => void) {
  const request = useRef(onLeaveRequest);
  request.current = onLeaveRequest;
  useEffect(() => {
    if (!dirty) return;
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      const href = link.getAttribute("href") ?? "";
      if (!href.startsWith("#/") && !href.startsWith("/")) return;
      event.preventDefault();
      event.stopPropagation();
      request.current(href.startsWith("#") ? href.slice(1) : href);
    };
    const onUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [dirty]);
}

interface Kept { base: string; keptAt: string; form: DraftForm }
const key = (versionId: string) => `fundedflow.rulebookDraft.${versionId}`;

export function keepEdits(versionId: string, base: string, form: DraftForm) {
  try { sessionStorage.setItem(key(versionId), JSON.stringify({ base, keptAt: new Date().toISOString(), form } satisfies Kept)); } catch { /* Edits stay in the page. */ }
}
export function forgetEdits(versionId: string) {
  try { sessionStorage.removeItem(key(versionId)); } catch { /* Nothing kept. */ }
}
/** Kept edits for the draft, and whether they started from the revision now stored. */
export function keptEdits(versionId: string, currentRevision: string): { form: DraftForm; keptAt: string; sameRevision: boolean } | null {
  try {
    const raw = sessionStorage.getItem(key(versionId));
    if (!raw) return null;
    const kept = JSON.parse(raw) as Kept;
    if (!kept || typeof kept.base !== "string" || !kept.form || !Array.isArray(kept.form.rules)) return null;
    return { form: kept.form, keptAt: kept.keptAt, sameRevision: kept.base === currentRevision };
  } catch {
    return null;
  }
}
