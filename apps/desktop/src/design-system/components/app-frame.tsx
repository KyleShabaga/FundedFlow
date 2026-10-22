import type { ReactNode } from "react";

/** Host-independent shell layout. Navigation, routing and runtime behavior are supplied by the host. */
export function AppFrame({ collapsed, sidebar, sidebarEdge, header, children }: {
  collapsed: boolean;
  sidebar: ReactNode;
  /**
   * A control inside the sidebar header (the collapse toggle): top-right beside the brand when expanded, centred under
   * the brand mark in the icon rail. It sits outside the sidebar's scroll area, so scrolling never hides it.
   */
  sidebarEdge?: ReactNode;
  header: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`ds-app-frame${collapsed ? " is-collapsed" : ""}`}>
      <aside className="ds-app-sidebar">
        {/* First in the DOM so keyboard order matches what is seen: the toggle sits beside the logo, above the links. */}
        {sidebarEdge != null && <div className="ds-app-sidebar-edge">{sidebarEdge}</div>}
        <div className="ds-app-sidebar-scroll">{sidebar}</div>
      </aside>
      <div className="ds-app-column">
        {header}
        {children}
      </div>
    </div>
  );
}
