import { Component, createRef, type ReactNode } from "react";

import { Button, DiagnosticDetails } from "../design-system";
import { formatDiagnostics, newIncidentId, renderDiagnostics } from "../lib/diagnostics";

interface State {
  failed: boolean;
  /** Allowlisted summary of the failure; the error's message and stack are never kept. */
  diagnostics: string | null;
}

/**
 * Render containment with a safe, copyable diagnostic summary (Build 26.5). It sits inside AppProviders,
 * whose QueryClient is created above it, so returning to the app keeps the cache and any unconfirmed
 * (uncertain) write locks: nothing is replayed and no lock is silently released. The router, runtime owner
 * and screens remount, so unsaved edits on the crashed screen are not preserved.
 */
export class RootErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false, diagnostics: null };
  private heading = createRef<HTMLHeadingElement>();

  static getDerivedStateFromError(error: unknown): State {
    return { failed: true, diagnostics: formatDiagnostics(renderDiagnostics(error, newIncidentId(), new Date(), window.location.hash)) };
  }

  componentDidCatch() {
    this.heading.current?.focus();
  }

  private returnToApp = (path = "/") => {
    window.location.hash = path;
    this.setState({ failed: false, diagnostics: null });
  };

  render() {
    if (this.state.failed) {
      return (
        <main className="ds-surface app-foundation">
          <section role="alert" aria-labelledby="root-error-title">
            <h1 id="root-error-title" ref={this.heading} tabIndex={-1}>FundedFlow couldn't display this screen</h1>
            <p>Return to the app to check local data availability again. Unsaved changes on this screen may be lost; your saved journal isn't changed.</p>
            <p>A save that hadn't been confirmed stays marked as unconfirmed until you check it.</p>
            <div className="ds-row">
              <Button onClick={() => this.returnToApp()}>Return to app</Button>
              <Button onClick={() => this.returnToApp("/settings")}>Open Settings</Button>
            </div>
            {this.state.diagnostics && <DiagnosticDetails text={this.state.diagnostics} />}
          </section>
        </main>
      );
    }
    // The theme follows Windows live (Build 26.85): no data-theme here, so tokens.css picks light or dark from
    // prefers-color-scheme, and portalled dialogs and menus match the page. There is no in-app theme setting in V1.
    return <div className="ds-surface app-root">{this.props.children}</div>;
  }
}
