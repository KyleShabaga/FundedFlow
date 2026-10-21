// Unsaved-edit protection shared by editors (rulebook drafts in Build 19, trade and review forms in Build 20).
// The app uses a HashRouter, which has no navigation blocker, so: in-app links are intercepted while the form is
// dirty (the page asks first, through `onLeaveRequest`), and closing the window asks through `beforeunload`.
import { useEffect, useRef } from "react";

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
