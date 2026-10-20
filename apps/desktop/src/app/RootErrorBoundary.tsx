import { Component, createRef, type ReactNode } from "react";

import { Button } from "../design-system";

/** Basic render containment only; diagnostic collection belongs to Build 26.5. */
export class RootErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  private heading = createRef<HTMLHeadingElement>();

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.heading.current?.focus();
  }

  private returnToApp = (path = "/") => {
    window.location.hash = path;
    this.setState({ failed: false });
  };

  render() {
    if (this.state.failed) {
      return (
        <main className="ds-surface app-foundation" data-theme="dark">
          <section role="alert" aria-labelledby="root-error-title">
            <h1 id="root-error-title" ref={this.heading} tabIndex={-1}>FundedFlow couldn't display this screen</h1>
            <p>Return to the app to check local data availability again.</p>
            <div className="ds-row">
              <Button onClick={() => this.returnToApp()}>Return to app</Button>
              <Button onClick={() => this.returnToApp("/settings")}>Open Settings</Button>
            </div>
          </section>
        </main>
      );
    }
    return <div className="ds-surface app-root" data-theme="dark">{this.props.children}</div>;
  }
}
