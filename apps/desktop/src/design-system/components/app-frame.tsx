import type { HTMLAttributes, ReactNode } from "react";

import { cx } from "./cx";

/**
 * Host-independent shell layout. Navigation, routing and runtime behavior are supplied by the host.
 * The column beside the sidebar is the `ds-main` size container: page layouts and the content frame's gutters respond
 * to the width left for content there, never to the monitor or the whole window.
 */
export function AppFrame({ collapsed, sidebar, sidebarHeader, sidebarEdge, header, children }: {
  collapsed: boolean;
  sidebar: ReactNode;
  /**
   * The sidebar's header row (the brand). It sits above the sidebar's scroll area, so a scrollbar appearing in a short
   * window never narrows it and the wordmark keeps its full width.
   */
  sidebarHeader?: ReactNode;
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
        {sidebarHeader != null && <div className="ds-app-sidebar-header">{sidebarHeader}</div>}
        {/* Before the links in the DOM so keyboard order matches what is seen: the toggle sits beside the logo, above the links. */}
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

/**
 * The shared content frame (P0-D29): the page header and the page body each wrap their content in one, so title,
 * account selector, header actions and body share the same left and right edges. It is centred in the main column
 * (beside the sidebar, not in the window), grows to `--frame-max` and then stops; its gutters step down with the
 * column's width. Inner caps for text and forms stay with the content (docs/design/window-support.md).
 */
export function ContentFrame({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} className={cx("ds-content-frame", className)}>{children}</div>;
}
