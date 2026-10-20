import type { ReactNode } from "react";

/** Host-independent shell layout. Navigation, routing and runtime behavior are supplied by the host. */
export function AppFrame({ collapsed, sidebar, header, children }: {
  collapsed: boolean;
  sidebar: ReactNode;
  header: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`ds-app-frame${collapsed ? " is-collapsed" : ""}`}>
      <aside className="ds-app-sidebar">{sidebar}</aside>
      <div className="ds-app-column">
        {header}
        {children}
      </div>
    </div>
  );
}
