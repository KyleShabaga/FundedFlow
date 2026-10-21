import { BookOpen, ChartNoAxesCombined, ChevronDown, House, PanelLeftClose, PanelLeftOpen, Settings, Upload, Wallet, Workflow, Zap } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";

import { RuntimeRecoveryNotice } from "../components/RuntimeGate";
import { AppFrame, BrandLogo, Button, DropdownMenu, Tooltip, useWindowFileDropGuard } from "../design-system";
import { AccountSwitcher } from "../features/accounts/components/AccountSwitcher";
import "./shell.css";

const routes = [
  { path: "/", label: "Today", icon: House },
  { path: "/journal", label: "Journal", icon: BookOpen },
  { path: "/insights", label: "Insights", icon: ChartNoAxesCombined },
  { path: "/accounts", label: "Accounts", icon: Wallet },
  { path: "/settings", label: "Settings", icon: Settings },
];
const normalizePath = (pathname: string) => pathname.replace(/\/+$/, "").toLowerCase() || "/";
/** The top-level section a path belongs to ("/accounts/abc" is in Accounts). */
const sectionOf = (path: string) => routes.find(route => route.path !== "/" && path.startsWith(`${route.path}/`))?.path ?? path;
/** Nested Journal pages: a trade's detail and a day's review. */
const isTradePath = (path: string) => /^\/journal\/trades\/[^/]+$/.test(path);
const isDayReviewPath = (path: string) => /^\/journal\/days\/[^/]+$/.test(path);
const preferenceKey = "fundedflow.sidebarCollapsed";
const narrowQuery = "(max-width: 759px)";

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
 * Collapse/expand control. AppFrame anchors it on the sidebar's right edge, level with the logo, outside the
 * sidebar's scroll area so it is never clipped and stays reachable in both widths.
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

export function SidebarNav({ collapsed }: { collapsed: boolean }) {
  const { pathname } = useLocation();
  const activePath = normalizePath(pathname);
  const developerRoute = import.meta.env.DEV && activePath === "/settings/developer";
  const item = (route: typeof routes[number]) => (
    <Link key={route.path} to={route.path}
      aria-current={activePath === route.path || (route.path === "/accounts" && sectionOf(activePath) === "/accounts") || (route.path === "/journal" && (isTradePath(activePath) || isDayReviewPath(activePath))) || (developerRoute && route.path === "/settings") ? "page" : undefined}
      className="shell-nav-link" aria-label={route.label} title={route.label}>
      <route.icon size={20} aria-hidden="true" />
      <span className={collapsed ? "ds-sr-only" : undefined}>{route.label}</span>
    </Link>
  );
  return (
    <>
      <div className="shell-brand">
        <BrandLogo showName={!collapsed} />
      </div>
      <nav id="primary-navigation" aria-label="Primary navigation" className="shell-nav">
        <div className="shell-nav-main">{routes.slice(0, 4).map(item)}</div>
        <div className="shell-nav-footer">
          {item(routes[4])}
          <p className="shell-local" title="Saved on this computer">
            <span aria-hidden="true">•</span>
            <span className={collapsed ? "ds-sr-only" : undefined}>Saved on this computer</span>
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
      <div className="shell-header-context">
        <h1 ref={heading} tabIndex={-1}>{title}</h1>
        {/* Account selector (Build 15). It reads accounts through the feature hooks only. */}
        <div className="shell-account-context"><AccountSwitcher /></div>
      </div>
      <div className="shell-import">
        {/* Quick import (Build 18.5) or the full wizard (Build 18); each shows its own runtime and account states. */}
        <DropdownMenu label="Import CSV" trigger={
          <Button variant="primary" aria-current={pathname === "/import" || pathname === "/import/quick" ? "page" : undefined}
            icon={<Upload size={16} aria-hidden="true" />}>Import CSV<ChevronDown size={14} aria-hidden="true" className="shell-import-caret" /></Button>
        } items={[
          { label: "Quick import: a file you've imported before", icon: <Zap size={16} aria-hidden="true" />, onSelect: () => navigate("/import/quick") },
          { label: "Full wizard: first-time or custom files", icon: <Workflow size={16} aria-hidden="true" />, onSelect: () => navigate("/import") },
        ]} />
      </div>
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
  // Import has no sidebar item: it opens from the header's Import CSV action.
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
          <RuntimeRecoveryNotice />
          <Outlet />
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
