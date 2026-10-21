// Shared account presentation: labels, status badges and per-account facts read
// through the Build 14 hooks. Lifecycle status, archived, setup and rulebook are
// separate badges so one never stands in for another.
import { statusLabels, type AccountRulebookAssignment } from "@fundedflow/domain";
import { Archive } from "lucide-react";

import { Badge, formatInstant, RulebookLine, StatusIndicator, type Tone } from "../../../design-system";
import { useImportHistory } from "../../imports/hooks/imports";
import { useAccountRulebookAssignments, useRulebookVersion } from "../../references/hooks/references";
import { useAccountLineage } from "../hooks/accounts";
import { currentAssignment, setupItems, verificationOf, type RulebookStatus, type SetupItem } from "../setup";
import type { AccountViewModel } from "../view-models/account";

export const ACCOUNT_TYPE_LABELS: Record<AccountViewModel["accountType"], string> = {
  evaluation: "Evaluation",
  sim_funded: "Sim funded",
  live_funded: "Live funded",
  personal: "Personal",
  demo: "Demo",
  other: "Other",
};

const STATUS_TONE: Record<AccountViewModel["status"], Tone> = {
  active: "flow",
  passed: "profit",
  failed: "loss",
  paused: "neutral",
  closed: "neutral",
};

/** Lifecycle status, plus Archived beside it (never instead of it). */
export function AccountStatus({ account }: { account: Pick<AccountViewModel, "status" | "archivedAt"> }) {
  return (
    <span className="acct-badges">
      <Badge tone={STATUS_TONE[account.status]}>{statusLabels[account.status]}</Badge>
      {account.archivedAt && (
        <Badge>
          <Archive size={11} aria-hidden="true" className="acct-badge-icon" />
          Archived
        </Badge>
      )}
    </span>
  );
}

/** The account's firm and name the way a trader recognises it: "Apex · PA-48213", or the name alone. */
export function accountLabel(account: Pick<AccountViewModel, "name" | "propFirm">): string {
  return account.propFirm ? `${account.propFirm} · ${account.name}` : account.name;
}

export function AccountMark({ account }: { account: Pick<AccountViewModel, "name" | "propFirm"> }) {
  return (
    <span className="acct-mark" aria-hidden="true">
      {(account.propFirm || account.name).trim().slice(0, 1).toUpperCase()}
    </span>
  );
}

export interface AccountFacts {
  rulebook: RulebookStatus;
  /** The rulebook version in force, when assigned and readable. */
  rulebookVersion: ReturnType<typeof useRulebookVersion>["data"];
  setup: SetupItem[] | null;
  /** This attempt's summary from Rust (trade and import counts, known net P&L). Undefined while loading or unreadable. */
  summary: NonNullable<ReturnType<typeof useAccountLineage>["data"]>[number] | undefined;
  /** Completion time of the newest import, null when there has been none, undefined when unknown. */
  lastImportAt: string | null | undefined;
}

/** Everything the list and detail views show about one account, from existing commands only. */
export function useAccountFacts(account: AccountViewModel): AccountFacts {
  const assignments = useAccountRulebookAssignments(account.id);
  const current: AccountRulebookAssignment | null = assignments.data ? currentAssignment(assignments.data, account.timezone) : null;
  const version = useRulebookVersion(current?.rulebookVersionId ?? null);
  const lineage = useAccountLineage(account.id);
  const imports = useImportHistory(account.id);
  const rulebook: RulebookStatus = assignments.data
    ? current ? { kind: "assigned", assignment: current } : { kind: "none" }
    : assignments.error ? { kind: "unknown" } : { kind: "loading" };
  const lastImportAt = imports.data
    ? imports.data.reduce<string | null>((latest, b) => (latest === null || b.completedAt > latest ? b.completedAt : latest), null)
    : undefined;
  return {
    rulebook,
    rulebookVersion: version.data,
    setup: setupItems(account, rulebook),
    summary: lineage.data?.find(a => a.accountId === account.id),
    lastImportAt,
  };
}

/** Rulebook column: name, version and verification, or a truthful Not set up / Unknown. */
export function RulebookSummary({ facts }: { facts: Pick<AccountFacts, "rulebook" | "rulebookVersion"> }) {
  if (facts.rulebook.kind === "loading") return <span className="ds-faint">Checking…</span>;
  if (facts.rulebook.kind === "unknown") return <StatusIndicator status="unknown" label="Unknown" variant="inline" detail="The rulebook assignment couldn't be read" />;
  if (facts.rulebook.kind === "none") return <span className="ds-faint">Not set up</span>;
  const v = facts.rulebookVersion;
  if (!v) return <span className="ds-faint">Assigned</span>;
  return <RulebookLine name={v.rulebook.displayName} version={v.version.versionNumber} verification={verificationOf(v)} />;
}

/** Setup state: Needs setup with what is missing, Complete, or nothing while unknown. */
export function SetupBadge({ items }: { items: SetupItem[] | null }) {
  if (items === null) return null;
  if (items.length === 0) return null;
  return <Badge tone="warn">Needs setup</Badge>;
}

export function LastImport({ at, timeZone }: { at: string | null | undefined; timeZone: string }) {
  if (at === undefined) return <span className="ds-faint">—</span>;
  if (at === null) return <span className="ds-faint">None yet</span>;
  return <span className="ds-faint">{formatInstant(at, { timeZone })}</span>;
}
