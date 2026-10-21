// Account-scoped rulebook overview (Build 19 block A): the version governing this attempt today,
// where it comes from and how far it can be trusted, its rules, every version and draft, the
// assignment history, the audit log and what has (not) been calculated. Empty, Unknown,
// unavailable and unsupported are distinct states.
import type { AccountRulebookAssignment, RulebookEvent, RulebookVersionDetail } from "@fundedflow/domain";
import { ArrowLeft } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  Badge, Button, type DataColumn, DataTable, EmptyState, formatInstant, InlineNotice, RulebookLine, StateBoundary, StatList, StatusIndicator,
  TabPanel, Tabs,
} from "../../../design-system";
import { accountLabel } from "../../accounts/components/presentation";
import { PROP_ACCOUNT_TYPES, verificationOf } from "../../accounts/setup";
import { useRulebookVersion, useRulebookVersions } from "../../references/hooks/references";
import type { ReadReceipt } from "../../shared/contracts";
import { featureKeys } from "../../shared/query-keys";
import { retryRead, toAsyncState } from "../../shared/presentation";
import { useRulebookEvents } from "../hooks/rulebooks";
import { ruleLabel } from "../view-models/compare";
import { applicabilityText, assignableVersions, versionState } from "../view-models/versions";
import { AssignDialog } from "./AssignDialog";
import { CalculationExplanation } from "./CalculationExplanation";
import { useAccountRulebookContext, type AccountRulebookContext } from "./context";
import { RuleSources, RuleSummaryBadge } from "./RuleCard";
import { StartDraftDialog } from "./StartDraftDialog";
import "./rulebooks.css";

const ACTIONS: Record<RulebookEvent["action"], string> = {
  draft_created: "Draft started",
  draft_saved: "Draft saved",
  draft_discarded: "Draft discarded",
  published: "Published",
  verified: "Verified",
  assigned: "Assigned to the account",
  conflict_flagged: "Source conflict recorded",
};
const actor = (a: string) => (a === "local_user" ? "You (on this computer)" : a);

function VersionName({ id }: { id: string }) {
  const v = useRulebookVersion(id);
  if (!v.data) return <span className="ds-faint">{v.error ? "Unreadable version" : "…"}</span>;
  return <span>{v.data.rulebook.displayName} · v{v.data.version.versionNumber} <Badge tone={versionState(v.data).tone}>{versionState(v.data).label}</Badge></span>;
}

function CurrentRulebook({ ctx, onStart, onAssign }: { ctx: AccountRulebookContext; onStart: (source: RulebookVersionDetail | null) => void; onAssign: () => void }) {
  const account = ctx.account.data!;
  const tz = account.timezone;
  const archived = account.archivedAt !== null;
  return (
    <StateBoundary state={toAsyncState(ctx.assignments)} label="rulebook assignment" onRetry={retryRead(ctx.assignments.refresh)}
      empty={{ "no-records": (
        <EmptyState kind="not-configured" title="No rulebook assigned"
          description={PROP_ACCOUNT_TYPES.has(account.accountType)
            ? "Limits and room left stay Unknown until a rulebook governs this account. Journaling and imports work without one."
            : "Personal, demo and other accounts don't need a rulebook, but you can keep your own rules."}
          action={archived ? undefined : <div className="rb-actions"><Button onClick={() => onStart(null)}>Write my own rules</Button><Button variant="primary" onClick={onAssign}>Assign a version…</Button></div>} />
      ) }}>
      {() => {
        const a = ctx.current;
        if (!a) {
          return (
            <InlineNotice tone="info" live="off" title="No rulebook in force today" actions={archived ? undefined : <Button size="sm" onClick={onAssign}>Assign a version…</Button>}>
              This account has assignments, but none covers today ({tz}). See the assignment history below.
            </InlineNotice>
          );
        }
        return (
          <StateBoundary state={toAsyncState(ctx.currentVersion)} label="rulebook version" onRetry={retryRead(ctx.currentVersion.refresh)}>
            {v => {
              const state = versionState(v);
              const phase = ctx.names.phase(a.programmePhaseId);
              const lastReview = v.version.verifiedAt ?? v.version.userConfirmedAt;
              return (
                <section className="ds-card rb-panel" aria-labelledby="rb-current">
                  <div className="rb-panel-head">
                    <h2 id="rb-current" className="ds-title">In force today</h2>
                    <RulebookLine name={v.rulebook.displayName} version={v.version.versionNumber} verification={verificationOf(v)} />
                  </div>
                  <p className="ds-faint">{state.detail}</p>
                  {v.version.verificationStatus === "stale" && <InlineNotice tone="warning" live="off" title="Stale: a source contradicts this version">Results based on it stay Unknown where the conflict matters. Start a draft to correct it.</InlineNotice>}
                  <StatList label="Rulebook in force" items={[
                    { label: "Provider", value: ctx.names.provider(v.rulebook.providerId) ?? (v.rulebook.providerId ? <span className="ds-faint">{ctx.catalogueUnavailable ? "Catalogue unavailable" : "Not in the catalogue"}</span> : <span className="ds-faint">None (your own rules)</span>) },
                    { label: "Programme", value: phase?.programme ?? <span className="ds-faint">Not tied to a programme</span> },
                    { label: "Phase", value: phase?.phase ?? <span className="ds-faint">Not tied to a phase</span> },
                    { label: "Path", value: ctx.names.path(a.phasePathId) ?? <span className="ds-faint">None</span> },
                    { label: "Version", value: <Link to={`versions/${encodeURIComponent(v.version.id)}`}>v{v.version.versionNumber}</Link> },
                    { label: "State", value: <Badge tone={state.tone}>{state.label}</Badge> },
                    { label: "In force from", value: `${a.effectiveFrom} (trading day, ${tz})` },
                    { label: "Until", value: a.effectiveTo ?? "Still in force" },
                    { label: "Provider-stated from", value: v.version.effectiveFrom ? formatInstant(v.version.effectiveFrom, { timeZone: tz, year: true }) : <span className="ds-faint">Not stated</span> },
                    { label: "Last reviewed", value: lastReview ? formatInstant(lastReview, { timeZone: tz, year: true }) : <span className="ds-faint">Never reviewed</span> },
                    { label: "Assigned", value: formatInstant(a.assignedAt, { timeZone: tz, year: true }) },
                  ]} />
                  <DataTable label="Rules in force" rows={v.rules} getRowId={r => r.id} columns={[
                    { id: "rule", header: "Rule", rowHeader: true, cell: r => ruleLabel(r) },
                    { id: "state", header: "State", cell: r => <RuleSummaryBadge rule={r} /> },
                    { id: "sources", header: "Sources", cell: r => <RuleSources claims={v.claims.filter(c => c.ruleDefinitionId === r.id)} names={ctx.names} /> },
                  ]} fallback={v.rules.length === 0 ? <EmptyState kind="no-records" size="compact" title="No rules in this version" /> : undefined} />
                  {!archived && <div className="rb-actions"><Button onClick={() => onStart(v)}>Start a draft from v{v.version.versionNumber}</Button></div>}
                </section>
              );
            }}
          </StateBoundary>
        );
      }}
    </StateBoundary>
  );
}

function RulebookVersions({ rulebookId, accountId, inUseId }: { rulebookId: string; accountId: string; inUseId: string | null }) {
  const versions = useRulebookVersions(rulebookId);
  const navigate = useNavigate();
  const columns: DataColumn<RulebookVersionDetail>[] = [
    { id: "v", header: "Version", rowHeader: true, cell: d => <span className="acct-cell-title">v{d.version.versionNumber}{d.version.id === inUseId && <span className="acct-active-pill">In use</span>}</span> },
    { id: "state", header: "State", cell: d => <Badge tone={versionState(d).tone}>{versionState(d).label}</Badge> },
    { id: "rules", header: "Rules", align: "end", cell: d => d.rules.length.toLocaleString("en-US") },
    { id: "reason", header: "Reason", cell: d => d.version.changeReason ?? <span className="ds-faint">None given</span> },
    { id: "saved", header: "Last saved", cell: d => formatInstant(d.version.updatedAt, { year: true }) },
  ];
  return (
    <StateBoundary state={toAsyncState(versions)} label="versions" onRetry={retryRead(versions.refresh)}>
      {rows => (
        <DataTable label={`Versions of ${rows[0]?.rulebook.displayName ?? "the rulebook"}`} rows={rows} getRowId={d => d.version.id} columns={columns}
          onRowClick={d => navigate(`/accounts/${encodeURIComponent(accountId)}/rulebook/versions/${encodeURIComponent(d.version.id)}`)} activeRowId={inUseId} />
      )}
    </StateBoundary>
  );
}

function AssignmentHistory({ ctx }: { ctx: AccountRulebookContext }) {
  const columns: DataColumn<AccountRulebookAssignment>[] = [
    { id: "version", header: "Version", rowHeader: true, cell: a => <VersionName id={a.rulebookVersionId} /> },
    { id: "from", header: "From", cell: a => a.effectiveFrom },
    { id: "to", header: "Until", cell: a => a.effectiveTo ?? <span className="ds-faint">Still in force</span> },
    { id: "where", header: "Applies to", cell: a => applicabilityText(ctx.names, a.programmePhaseId, a.phasePathId) },
    { id: "at", header: "Assigned", cell: a => formatInstant(a.assignedAt, { timeZone: ctx.timeZone, year: true }) },
  ];
  return (
    <StateBoundary state={toAsyncState(ctx.assignments)} label="assignments" onRetry={retryRead(ctx.assignments.refresh)}
      empty={{ "no-records": <EmptyState kind="no-records" size="compact" title="Never assigned" description="Assignments appear here with the trading day each one started." /> }}>
      {rows => (
        <>
          <DataTable label="Assignment history" rows={[...rows].reverse()} getRowId={a => a.id} columns={columns} />
          <p className="ds-faint rb-footnote">Assignments are history: a new one ends the previous one, nothing is moved or rewritten, and a newer version is never switched in on its own.</p>
        </>
      )}
    </StateBoundary>
  );
}

function AuditLog({ accountId, timeZone }: { accountId: string; timeZone: string }) {
  const events = useRulebookEvents(accountId);
  return (
    <StateBoundary state={toAsyncState(events)} label="rulebook activity" onRetry={retryRead(events.refresh)}
      empty={{ "no-records": <EmptyState kind="no-records" size="compact" title="No recorded activity yet" description="Drafts, publishing and assignments made from this version of FundedFlow appear here with who and why. Earlier changes keep only their own dates." /> }}>
      {rows => (
        <ol className="acct-timeline" aria-label="Rulebook activity, newest first">
          {[...rows].reverse().map(e => (
            <li key={e.id}>
              <span className="acct-event-head"><b>{ACTIONS[e.action]}</b><span className="ds-faint">{formatInstant(e.occurredAt, { timeZone, year: true, zoneName: true })}</span></span>
              <span><VersionName id={e.rulebookVersionId} /></span>
              {e.reason && <span>{e.reason}</span>}
              <span className="ds-faint acct-event-meta">By {actor(e.actor)}</span>
            </li>
          ))}
        </ol>
      )}
    </StateBoundary>
  );
}

export function RulebookPage() {
  const { accountId = "" } = useParams();
  const ctx = useAccountRulebookContext(accountId || null);
  const navigate = useNavigate();
  const [start, setStart] = useState<{ source: RulebookVersionDetail | null } | null>(null);
  const client = useQueryClient();
  // Candidates are taken from the versions this page has loaded when the dialog opens.
  const [assigning, setAssigning] = useState<RulebookVersionDetail[] | null>(null);
  const openAssign = () => setAssigning(assignableVersions((ctx.rulebooks.data ?? []).flatMap(r =>
    client.getQueryData<ReadReceipt<RulebookVersionDetail[]>>(featureKeys.rulebookVersions(r.id))?.value ?? []), accountId));
  const currentRulebookId = ctx.currentVersion.data?.rulebook.id ?? null;
  const shown = [...new Set([currentRulebookId, ctx.privateRulebook?.id ?? null].filter((x): x is string => x !== null))];
  return (
    <div className="acct-page rb-page">
      <Link to={`/accounts/${encodeURIComponent(accountId)}`} className="acct-back"><ArrowLeft size={16} aria-hidden="true" />Account</Link>
      <StateBoundary state={toAsyncState(ctx.account)} label="account" scope="route" onRetry={retryRead(ctx.account.refresh)}>
        {account => (
          <>
            <header className="rb-head">
              <div>
                <h2 className="rb-title">Rulebook · {accountLabel(account)}</h2>
                <p className="acct-sub">Which rules govern this attempt, from when, and how far they can be trusted. Every version is kept; changes are new versions.</p>
              </div>
              {account.archivedAt === null && (
                <div className="acct-head-actions">
                  <Button onClick={() => setStart({ source: null })}>
                    {ctx.privateRulebook ? "New draft of my rules" : "Write my own rules"}
                  </Button>
                  <Button variant="primary" onClick={openAssign} disabled={!ctx.assignments.data}>Assign a version…</Button>
                </div>
              )}
            </header>
            {account.archivedAt !== null && <InlineNotice tone="info" live="off" title="Archived: read-only">Restore the account to change its rulebook.</InlineNotice>}
            <CurrentRulebook ctx={ctx} onStart={source => setStart({ source })} onAssign={openAssign} />
            <Tabs label="Rulebook sections" defaultValue="versions" items={[
              { value: "versions", label: "Versions and drafts" },
              { value: "assignments", label: "Assignment history", count: ctx.assignments.data?.length },
              { value: "activity", label: "Activity" },
              { value: "calculation", label: "Calculation" },
            ]}>
              <TabPanel value="versions" keepMounted>
                {shown.length === 0 && <p className="ds-faint">No rulebook yet: write your own rules or assign a verified catalogue version.</p>}
                {shown.map(id => (
                  <RulebookVersions key={id} rulebookId={id} accountId={account.id} inUseId={ctx.currentVersion.data?.version.id ?? null} />
                ))}
                <CatalogueChoices ctx={ctx} />
              </TabPanel>
              <TabPanel value="assignments"><AssignmentHistory ctx={ctx} /></TabPanel>
              <TabPanel value="activity"><AuditLog accountId={account.id} timeZone={account.timezone} /></TabPanel>
              <TabPanel value="calculation">
                <CalculationExplanation accountId={account.id} current={ctx.currentVersion.data ?? null} timeZone={account.timezone} />
                <p className="ds-faint rb-footnote">
                  <StatusIndicator status="unknown" variant="inline" label="Estimates only" /> Verify with your firm's dashboard. Changing a version never rewrites a stored calculation.
                </p>
              </TabPanel>
            </Tabs>
            {start && (
              <StartDraftDialog open onOpenChange={o => !o && setStart(null)} account={account} source={start.source} privateRulebook={ctx.privateRulebook}
                onCreated={d => { setStart(null); navigate(`versions/${encodeURIComponent(d.version.id)}`); }} />
            )}
            {assigning && ctx.assignments.data && (
              <AssignDialog open onOpenChange={o => !o && setAssigning(null)} account={account} assignments={ctx.assignments.data} candidates={assigning} names={ctx.names} />
            )}
          </>
        )}
      </StateBoundary>
    </div>
  );
}

/**
 * Verified catalogue rulebooks this account could use, so they can be compared, copied or assigned.
 * Versions load per rulebook; nothing is matched to the account by name.
 */
function CatalogueChoices({ ctx }: { ctx: AccountRulebookContext }) {
  const catalogue = (ctx.rulebooks.data ?? []).filter(r => r.ownerAccountId === null && r.recordStatus === "active" && r.id !== ctx.currentVersion.data?.rulebook.id);
  if (!ctx.rulebooks.data) return null;
  if (catalogue.length === 0) return null;
  return (
    <section className="rb-catalogue" aria-labelledby="rb-catalogue-title">
      <h3 id="rb-catalogue-title" className="ds-title">Other catalogue rulebooks</h3>
      <p className="ds-faint">Only verified versions can be assigned. Copy one into your own rules to keep personal limits.</p>
      {catalogue.map(r => <RulebookVersions key={r.id} rulebookId={r.id} accountId={ctx.account.data!.id} inUseId={null} />)}
    </section>
  );
}
