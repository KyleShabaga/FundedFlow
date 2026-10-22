import { BookOpen, ChartNoAxesCombined, ChevronDown, House, PanelLeftClose, PanelLeftOpen, Settings, Wallet, Workflow, Zap } from "lucide-react";
import { lazy, type RefObject, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";

import { RuntimeRecoveryNotice } from "../components/RuntimeGate";
import { AppFrame, BrandLogo, Button, ContentFrame, DropdownMenu, Tooltip, useWindowFileDropGuard } from "../design-system";
import { AccountSwitcher } from "../features/accounts/components/AccountSwitcher";
import "./shell.css";

const routes = [
  { path: "/", label: "Today", icon: House },
  { path: "/journal", label: "Journal", icon: BookOpen },
  { path: "/insights", label: "Insights", icon: ChartNoAxesCombined },
  { path: "/accounts", label: "Accounts", icon: Wallet },
  { path: "/settings", label: "Settings", icon: Settings },
];
/**
 * Sidebar submenus: only the views a section already serves at its own URL (Journal's ?view=, Insights' ?section=).
 * The first child is the section's default view. Insights' Tags view only exists when the account has tags, so it
 * stays a tab on the page rather than a sidebar entry.
 */
const subRoutes: Record<string, { param: string; items: { value: string; label: string }[] }> = {
  "/journal": { param: "view", items: [{ value: "day", label: "By day" }, { value: "log", label: "Trade log" }, { value: "library", label: "Library" }] },
  "/insights": { param: "section", items: [{ value: "overview", label: "Overview" }, { value: "calendar", label: "Calendar" }, { value: "breakdowns", label: "Breakdowns" }, { value: "attempts", label: "Attempts" }] },
};
const normalizePath = (pathname: string) => pathname.replace(/\/+$/, "").toLowerCase() || "/";
/** The top-level section a path belongs to ("/accounts/abc" is in Accounts). */
const sectionOf = (path: string) => routes.find(route => route.path !== "/" && path.startsWith(`${route.path}/`))?.path ?? path;
/** Nested Journal pages: a trade's detail and a day's review. */
const isTradePath = (path: string) => /^\/journal\/trades\/[^/]+$/.test(path);
const isDayReviewPath = (path: string) => /^\/journal\/days\/[^/]+$/.test(path);
const preferenceKey = "fundedflow.sidebarCollapsed";
/** Build 26.9 developer actions (Add Fake Data, Reset All Data): development builds only, never bundled in production. */
const DevSidebarTools = import.meta.env.DEV ? lazy(() => import("./dev-tools/DevSidebarTools")) : null;
/**
 * Below 900 px of window the icon rail is enforced (Build 26.85): the expanded 248 px sidebar would leave the page less
 * than the 640 px main column the compact layout is built for. The sidebar belongs to the window, so this is the one
 * window-width query; pages respond to the main column (docs/design/window-support.md).
 */
const narrowQuery = "(max-width: 899px)";

function useSidebar() {
  const [preferredCollapsed, setPreferredCollapsed] = useState(() => {
    try { return localStorage.getItem(preferenceKey) === "true"; } catch { return false; }
  });
  const [narrow, setNarrow] = useState(() => window.matchMedia?.(narrowQuery).matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.(narrowQuery);
    if (!media) return;
    const update = () => setNarrow(media.matches);
    media.addEventListener("change", update);
    update();
    return () => media.removeEventListener("change", update);
  }, []);
  const toggle = useCallback(() => {
    if (narrow) return;
    setPreferredCollapsed(value => {
      try { localStorage.setItem(preferenceKey, String(!value)); } catch { /* A session preference still works. */ }
      return !value;
    });
  }, [narrow]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.closest("input, textarea, select") || target.isContentEditable)) return;
      if (event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && event.key.toLowerCase() === "b") {
        event.preventDefault();
        if (!event.repeat) toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);
  return { collapsed: narrow || preferredCollapsed, narrow, toggle };
}

/**
 * Collapse/expand control (P0-D08). AppFrame places it inside the sidebar header: beside the logo when expanded,
 * under the mark in the icon rail. It sits outside the sidebar's scroll area, so it stays visible in both widths.
 */
export function SidebarToggle({ collapsed, narrow, toggle }: { collapsed: boolean; narrow: boolean; toggle: () => void }) {
  const label = narrow ? "Sidebar collapsed for narrow window" : collapsed ? "Expand sidebar" : "Collapse sidebar";
  const button = (
    <button type="button" className="shell-toggle" onClick={toggle} disabled={narrow}
      aria-controls="primary-navigation" aria-expanded={!collapsed} aria-label={label} aria-keyshortcuts={narrow ? undefined : "Control+B"}>
      {collapsed ? <PanelLeftOpen size={16} aria-hidden="true" /> : <PanelLeftClose size={16} aria-hidden="true" />}
    </button>
  );
  // A disabled button can't show a tooltip; the narrow label says why instead.
  return narrow ? button : <Tooltip content={`${label} (Ctrl+B)`} side="right">{button}</Tooltip>;
}

/**
 * The selected route's background and left accent, drawn once for the whole nav so a route change slides it from
 * the old item to the new one. It follows the active route only (never hover). Its position is measured from the
 * DOM on every route, width and submenu change, so fast navigation can't leave it on a stale item. It appears in
 * place, without sliding, when the previous page had no sidebar item (Import, not found).
 */
function useActiveIndicator(nav: RefObject<HTMLElement | null>, layoutKey: string) {
  const [box, setBox] = useState<{ top: number; height: number; slide: boolean } | null>(null);
  const measure = useCallback(() => {
    const root = nav.current;
    const active = root?.querySelector<HTMLElement>('.shell-nav-link[aria-current="page"]');
    if (!root || !active) { setBox(null); return; }
    const top = active.getBoundingClientRect().top - root.getBoundingClientRect().top;
    const height = active.offsetHeight;
    setBox(previous => previous && previous.top === top && previous.height === height ? previous : { top, height, slide: previous !== null });
  }, [nav]);
  // layoutKey changes whenever the active item or the items above it may have moved.
  useLayoutEffect(measure, [measure, layoutKey]);
  useEffect(() => {
    const root = nav.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [nav, measure]);
  return box;
}

export function SidebarNav({ collapsed }: { collapsed: boolean }) {
  const { pathname, search } = useLocation();
  const activePath = normalizePath(pathname);
  const developerRoute = import.meta.env.DEV && activePath === "/settings/developer";
  const isActive = (path: string) => activePath === path || (path === "/accounts" && sectionOf(activePath) === "/accounts") || (path === "/journal" && (isTradePath(activePath) || isDayReviewPath(activePath))) || (developerRoute && path === "/settings");
  // A section's submenu opens while you are in it; its chevron overrides that until you next enter the section.
  const [openOverride, setOpenOverride] = useState<Record<string, boolean>>({});
  const activeSection = routes.find(route => isActive(route.path))?.path;
  useEffect(() => {
    if (!activeSection) return;
    setOpenOverride(value => {
      if (!(activeSection in value)) return value;
      const next = { ...value };
      delete next[activeSection];
      return next;
    });
  }, [activeSection]);
  const isOpen = (path: string) => !collapsed && (openOverride[path] ?? path === activeSection);
  const nav = useRef<HTMLElement>(null);
  const indicator = useActiveIndicator(nav, `${pathname}|${collapsed}|${Object.keys(subRoutes).map(isOpen).join()}`);

  const link = (route: typeof routes[number]) => (
    <Link key={route.path} to={route.path} aria-current={isActive(route.path) ? "page" : undefined}
      className="shell-nav-link" aria-label={route.label} title={route.label}>
      <route.icon size={20} aria-hidden="true" />
      <span className={collapsed ? "ds-sr-only" : "shell-nav-label"}>{route.label}</span>
    </Link>
  );
  const item = (route: typeof routes[number]) => {
    const sub = subRoutes[route.path];
    if (!sub || collapsed) return link(route);
    const open = isOpen(route.path);
    const listId = `shell-subnav-${route.path.slice(1)}`;
    const current = new URLSearchParams(search).get(sub.param);
    const selected = activePath === route.path ? (sub.items.some(i => i.value === current) ? current : current === null ? sub.items[0].value : null) : null;
    return (
      <div key={route.path} className="shell-nav-group">
        <div className="shell-nav-row">
          {link(route)}
          <button type="button" className="shell-nav-expand" aria-expanded={open} aria-controls={listId} aria-label={`${route.label} views`}
            onClick={() => setOpenOverride(value => ({ ...value, [route.path]: !open }))}>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
        </div>
        {open && (
          <ul id={listId} className="shell-subnav" aria-label={`${route.label} views`}>
            {sub.items.map((child, index) => (
              <li key={child.value}>
                {/* "true", not "page": the section link above stays the page-level current item. */}
                <Link to={index === 0 ? route.path : `${route.path}?${sub.param}=${child.value}`} className="shell-subnav-link"
                  aria-current={selected === child.value ? "true" : undefined}>{child.label}</Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };
  return (
    <>
      <div className="shell-brand">
        <BrandLogo showName={!collapsed} />
      </div>
      <nav ref={nav} id="primary-navigation" aria-label="Primary navigation" className={`shell-nav${indicator ? " has-indicator" : ""}`}>
        {indicator && <span aria-hidden="true" className={`shell-nav-indicator${indicator.slide ? " is-sliding" : ""}`}
          style={{ transform: `translateY(${indicator.top}px)`, height: indicator.height }} />}
        <div className="shell-nav-main">{routes.slice(0, 4).map(item)}</div>
        <div className="shell-nav-footer">
          {DevSidebarTools && <Suspense fallback={null}><DevSidebarTools collapsed={collapsed} /></Suspense>}
          {link(routes[4])}
          <p className="shell-local" title="Saved on this computer">
            <span aria-hidden="true">•</span>
            <span className={collapsed ? "ds-sr-only" : "shell-nav-label"}>Saved on this computer</span>
          </p>
        </div>
      </nav>
    </>
  );
}

export function PageHeader({ title }: { title: string }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const previousPath = useRef(pathname);
  useEffect(() => {
    if (previousPath.current !== pathname) heading.current?.focus();
    previousPath.current = pathname;
  }, [pathname]);
  return (
    <header className="shell-header">
      {/* Same frame as the page body (P0-D29), so Import ends where the content ends. */}
      <ContentFrame className="shell-header-frame">
        <div className="shell-header-context">
          <h1 ref={heading} tabIndex={-1}>{title}</h1>
          {/* Account selector (Build 15). It reads accounts through the feature hooks only. */}
          <div className="shell-account-context"><AccountSwitcher /></div>
        </div>
        <div className="shell-import">
          {/* Quick import (Build 18.5) or the full wizard (Build 18); each shows its own runtime and account states. */}
          <DropdownMenu label="Import" trigger={
            <Button variant="ghost" aria-current={pathname === "/import" || pathname === "/import/quick" ? "page" : undefined}>Import</Button>
          } items={[
            { label: "Quick import: check and import a CSV in one step", icon: <Zap size={16} aria-hidden="true" />, onSelect: () => navigate("/import/quick") },
            { label: "Full wizard: first-time or custom files", icon: <Workflow size={16} aria-hidden="true" />, onSelect: () => navigate("/import") },
          ]} />
        </div>
      </ContentFrame>
    </header>
  );
}

export function AppShell() {
  const sidebar = useSidebar();
  // A CSV dropped anywhere but an import drop zone must never open in the window.
  useWindowFileDropGuard();
  const { pathname } = useLocation();
  const normalizedPath = normalizePath(pathname);
  // Accounts (account detail) and Journal (trade detail, daily review) have nested pages; other unknown sub-paths stay "Page not found".
  // Import has no sidebar item: it opens from the header's Import menu.
  const title = import.meta.env.DEV && normalizedPath === "/settings/developer"
    ? "Developer tools"
    : normalizedPath === "/import" ? "Import trades"
    : normalizedPath === "/import/quick" ? "Quick import"
    : normalizedPath === "/import/history" ? "Import history"
    : isTradePath(normalizedPath) ? "Trade"
    : isDayReviewPath(normalizedPath) ? "Daily review"
    : routes.find(route => route.path === normalizedPath || (route.path === "/accounts" && sectionOf(normalizedPath) === "/accounts"))?.label ?? "Page not found";
  return (
    <>
      <a className="shell-skip" href="#main-content" onClick={event => {
        event.preventDefault();
        document.getElementById("main-content")?.focus();
      }}>Skip to main content</a>
      <AppFrame collapsed={sidebar.collapsed} sidebar={<SidebarNav collapsed={sidebar.collapsed} />} sidebarEdge={<SidebarToggle {...sidebar} />}
        header={<PageHeader title={title} />}>
        <main id="main-content" tabIndex={-1} className="shell-content">
          <ContentFrame>
            <RuntimeRecoveryNotice />
            <Outlet />
          </ContentFrame>
        </main>
      </AppFrame>
    </>
  );
}

export function RoutePlaceholder({ name }: { name: string }) {
  return (
    <section className="ds-card shell-placeholder" aria-label={`${name} not built`}>
      <h2>{name} is not built yet</h2>
      <p>This feature is not available yet. No trading data is shown here.</p>
    </section>
  );
}

export function NotFound() {
  return <section className="ds-card shell-placeholder">
    <h2>This page doesn't exist</h2>
    <p>Choose a page in the sidebar or return to Today.</p>
    <Link to="/">Go to Today</Link>
  </section>;
}
