import { InlineNotice } from "../../design-system";
import type { DevToolsStatus } from "./api";

/** The resolved test-journal directory both developer tools act on. */
export function TargetDirectory({ status }: { status: DevToolsStatus }) {
  return (
    <div className="dev-target">
      <span className="ds-field-label">Test journal directory</span>
      <code className="dev-path" data-testid="dev-target-dir">{status.dataDir ?? "No isolated test journal"}</code>
    </div>
  );
}

/** Why the tools are off, and how to turn them on. */
export function TestJournalRequired({ status }: { status: DevToolsStatus }) {
  return (
    <InlineNotice tone="warning" title="Isolated test journal required">
      {status.problem ? <p>{status.problem}.</p> : <p>FundedFlow is open on the per-user journal{status.defaultDataDir ? ` (${status.defaultDataDir})` : ""}, which developer tools never change.</p>}
      <p>Close FundedFlow and start it with <code>npm run dev:test-journal</code>, or set <code>{status.envVar}</code> to a separate <code>…/com.fundedflow.desktop</code> directory.</p>
    </InlineNotice>
  );
}
