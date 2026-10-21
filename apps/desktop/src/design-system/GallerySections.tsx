// Gallery sections for the Build 13 components: forms, overlays, feedback,
// async states and data display. Example data only, labelled as such; nothing
// here reads or writes the journal.

import { toMicros } from "@fundedflow/domain";
import { Columns3, Ellipsis, Plus } from "lucide-react";
import { type FormEvent, type ReactNode, useMemo, useRef, useState } from "react";

import {
  type AsyncState,
  Badge,
  Button,
  ChartPanel,
  Checkbox,
  compareMoney,
  ConfirmDialog,
  type DataColumn,
  DataTable,
  Dialog,
  Drawer,
  DropdownMenu,
  EmptyState,
  EquityCurve,
  ErrorState,
  FieldGroup,
  AccountOverviewCard,
  FileDropzone,
  ProgressMeter,
  focusFirstInvalid,
  FormSection,
  IconButton,
  InlineNotice,
  LabeledValue,
  LoadingState,
  MetricCard,
  MiniMeter,
  MoneyCell,
  MonthYearPicker,
  MutationFeedback,
  type MutationState,
  Pnl,
  Popover,
  RadioGroup,
  ChipGroup,
  RuleMeter,
  RulebookLine,
  RuleStateBadge,
  SearchField,
  SegmentedControl,
  Select,
  type SortState,
  StateBoundary,
  StatList,
  StatusIndicator,
  Stepper,
  Switch,
  Textarea,
  TextField,
  Tooltip,
  useToast,
  type ValidationIssue,
  ValidationSummary,
  type YearMonth,
} from ".";

export function Section({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <section className="dsg-section">
      <header>
        <h2 className="ds-title">{title}</h2>
        <p className="ds-faint">{note}</p>
      </header>
      {children}
    </section>
  );
}

/* ---------- Forms ---------- */

function ValidationDemo() {
  const form = useRef<HTMLFormElement>(null);
  const [name, setName] = useState("");
  const [balance, setBalance] = useState("");
  const [zone, setZone] = useState<string | undefined>(undefined);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [saved, setSaved] = useState<MutationState>({ status: "idle" });
  const err = (id: string) => issues.find((i) => i.fieldId === id)?.message;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: ValidationIssue[] = [];
    if (!name.trim()) next.push({ fieldId: "dsg-name", message: "Enter an account name" });
    if (toMicros(balance) == null || toMicros(balance)! <= 0n) next.push({ fieldId: "dsg-balance", message: "Enter a starting balance greater than 0" });
    if (!zone) next.push({ fieldId: "dsg-zone", message: "Choose the account's time zone" });
    setIssues(next);
    setSaved(next.length ? { status: "idle" } : { status: "success", message: "Example only: nothing was saved." });
    queueMicrotask(() => focusFirstInvalid(form.current));
  };
  return (
    <form ref={form} className="ds-card dsg-stack" onSubmit={submit} noValidate aria-label="Example account form">
      <ValidationSummary issues={issues} />
      <FormSection title="Account details" description="Example form. Submit it empty to see validation and focus move to the first problem.">
        <TextField id="dsg-name" label="Account name" required value={name} onChange={(e) => setName(e.target.value)} error={err("dsg-name")} placeholder="Apex $100K · PA-48213" />
        <TextField id="dsg-balance" label="Starting balance" required numeric inputMode="decimal" suffix="USD" value={balance} onChange={(e) => setBalance(e.target.value)} error={err("dsg-balance")} description="From your firm's dashboard." />
        <Select id="dsg-zone" label="Time zone" required placeholder="Choose a time zone" value={zone} onValueChange={setZone} error={err("dsg-zone")} options={[{ value: "America/New_York", label: "New York (ET)" }, { value: "America/Chicago", label: "Chicago (CT)" }, { value: "Europe/London", label: "London" }]} />
        <TextField label="Firm account ID" optional description="Optional: helps match imports." />
      </FormSection>
      <div className="dsg-row">
        <Button type="submit" variant="primary">Save account</Button>
        <MutationFeedback state={saved} />
      </div>
    </form>
  );
}

export function FormsSection() {
  const [q, setQ] = useState("");
  const [side, setSide] = useState<"long" | "short">("long");
  const [setups, setSetups] = useState<string[]>(["orb"]);
  const [mistakes, setMistakes] = useState<string[]>([]);
  const [file, setFile] = useState<{ name: string; size: number } | null>(null);
  return (
    <Section title="Form controls" note="Native inputs and Radix Select with labels, descriptions, errors and required/optional markers wired to aria-describedby.">
      <div className="dsg-grid-2">
        <div className="ds-card dsg-stack">
          <TextField label="Entry price" numeric defaultValue="21412.25" />
          <TextField label="Quantity" numeric defaultValue="0" error="Quantity must be greater than 0" />
          <TextField label="Account ID" value="PA-48213" readOnly description="Read-only: set when the account was created." />
          <TextField label="Disabled field" disabled defaultValue="Locked while importing" />
          <Textarea label="Post-session review" placeholder="What went well, what to change tomorrow" />
          <SearchField label="Search accounts" value={q} onValueChange={setQ} placeholder="Search name, firm or ID" />
        </div>
        <div className="ds-card dsg-stack">
          <FieldGroup label="Notifications" description="Example settings; nothing is saved.">
            <Checkbox label="Warn at 70% of a limit" defaultChecked />
            <Checkbox label="Select all (mixed)" indeterminate />
            <Checkbox label="Disabled option" disabled />
            <Checkbox label="Accept the import" error="Confirm before importing" />
          </FieldGroup>
          <Switch label="Follow the OS theme" description="Applies at once." defaultChecked />
          <RadioGroup label="Side" inline value={side} onValueChange={setSide} options={[{ value: "long", label: "Long" }, { value: "short", label: "Short" }]} />
          <ChipGroup label="Setup" value={setups} onValueChange={setSetups} options={[{ value: "orb", label: "Opening range" }, { value: "vwap", label: "VWAP pullback" }, { value: "old", label: "Retired setup", note: "Archived: kept on past reviews", disabled: true }]} />
          <ChipGroup label="Mistakes" tone="warn" value={mistakes} onValueChange={setMistakes} options={[{ value: "chased", label: "Chased entry" }, { value: "stop", label: "Moved stop" }]} empty="No mistake tags yet." />
          <Select label="Import into" placeholder="Choose an account" options={[{ value: "a", label: "Apex $100K · Example" }, { value: "b", label: "Topstep $50K · Example (archived)", disabled: true }, { value: "c", label: "A very long account name that has to truncate inside the trigger without pushing anything" }]} />
          <FileDropzone
            label="Choose a CSV file"
            hint="CSV up to 10 MB. The file stays on this computer."
            accept=".csv,text/csv"
            onFiles={(files) => setFile({ name: files[0].name, size: files[0].size })}
            selected={file}
            selectedActions={file && <Button size="sm" variant="ghost" onClick={() => setFile(null)}>Remove</Button>}
          />
        </div>
      </div>
      <ValidationDemo />
    </Section>
  );
}

/* ---------- Buttons and overlays ---------- */

export function OverlaysSection() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [fail, setFail] = useState(false);
  const toast = useToast();
  return (
    <Section title="Buttons, dialogs and menus" note="Focus moves into overlays, Escape closes them and focus returns to what opened them. ConfirmDialog focuses Cancel first and blocks double submits.">
      <div className="dsg-row">
        <Button variant="primary" loading>Saving…</Button>
        <Button disabled disabledReason="Choose an account first">Import</Button>
        <IconButton label="Previous month" icon={<span aria-hidden="true">‹</span>} />
        <IconButton label="Row actions" variant="ghost" icon={<Ellipsis size={16} aria-hidden="true" />} />
        <SegmentedControl label="Layout" value="table" onValueChange={() => {}} options={[{ value: "table", label: "Table" }, { value: "cards", label: "Cards" }]} />
      </div>
      <div className="dsg-row">
        <Dialog
          trigger={<Button>Open dialog</Button>}
          title="Edit account"
          description="Example dialog; nothing is saved."
          footer={
            <>
              <Button>Cancel</Button>
              <Button variant="primary">Save</Button>
            </>
          }
        >
          <div className="dsg-stack">
            <TextField label="Account name" defaultValue="Apex $100K · Example" />
            <Textarea label="Notes" />
          </div>
        </Dialog>
        <Button variant="danger" onClick={() => setConfirmOpen(true)}>Delete account…</Button>
        <Checkbox label="Make the example delete fail" checked={fail} onChange={(e) => setFail(e.target.checked)} />
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="Delete Apex $100K?"
          confirmLabel="Delete account"
          busyLabel="Deleting…"
          onConfirm={() => new Promise((resolve, reject) => setTimeout(() => (fail ? reject(new Error("example")) : resolve()), 900))}
        >
          <p>Example only. In the app this names the account, its trades and what cannot be undone.</p>
        </ConfirmDialog>
        <Drawer trigger={<Button>Open drawer</Button>} title="How this was calculated" description="Example breakdown.">
          <StatList items={[{ label: "Starting balance", value: { kind: "money", amount: "100000", signed: false } }, { label: "Realized P&L", value: { kind: "money", amount: "5100" } }, { label: "Open P&L", value: null }]} bordered />
        </Drawer>
        <Popover label="Example popover" trigger={<Button icon={<Columns3 size={16} aria-hidden="true" />}>Columns</Button>} align="start">
          <div className="dsg-stack">
            <Checkbox label="Platform" defaultChecked />
            <Checkbox label="Rulebook" defaultChecked />
            <Checkbox label="Last import" />
          </div>
        </Popover>
        <DropdownMenu
          trigger={<Button>Row menu</Button>}
          items={[
            { label: "Edit", onSelect: () => toast.show({ title: "Edit chosen", description: "Example only." }) },
            { label: "Export CSV", onSelect: () => {}, disabled: true },
            { type: "separator" },
            { label: "Delete…", tone: "danger", onSelect: () => setConfirmOpen(true) },
          ]}
        />
        <Tooltip content="Resets at 17:00 New York time">
          <Button variant="ghost">Hover or focus me</Button>
        </Tooltip>
      </div>
    </Section>
  );
}

/* ---------- Feedback ---------- */

export function FeedbackSection() {
  const toast = useToast();
  return (
    <Section title="Notices, toasts and status" note="Blocking problems stay inline; toasts confirm finished actions. Status always pairs text and icon with colour; Unknown is never Safe.">
      <div className="dsg-grid-2">
        <InlineNotice tone="info" title="Saved on this computer">Your journal is stored locally. Nothing is sent anywhere.</InlineNotice>
        <InlineNotice tone="success">Imported 64 trades into Apex $100K (example).</InlineNotice>
        <InlineNotice tone="warning" title="2 rows need a look">They were imported, but their fees look unusual.</InlineNotice>
        <InlineNotice tone="error" title="Couldn't read the file" actions={<Button size="sm">Choose another file</Button>} live="off">
          The file isn't a CSV export. Nothing was imported.
        </InlineNotice>
      </div>
      <div className="dsg-row">
        <Button onClick={() => toast.show({ tone: "success", title: "Account archived", description: "Example toast.", action: { label: "Undo", onClick: () => {} } })}>Success toast</Button>
        <Button onClick={() => toast.show({ tone: "info", title: "Backup started" })}>Info toast</Button>
        <Button onClick={() => toast.show({ tone: "error", title: "Couldn't export", description: "Error toasts stay until dismissed." })}>Error toast</Button>
      </div>
      <div className="dsg-row">
        <StatusIndicator status="success" label="Safe" detail="Example: all limits under 70%" />
        <StatusIndicator status="caution" label="Caution" detail="Example: daily loss at 74% of limit" />
        <StatusIndicator status="danger" label="Stop" detail="Example: daily loss limit reached" />
        <StatusIndicator status="unknown" label="Unknown" detail="No rulebook for this account" />
        <StatusIndicator status="local" label="Imported" />
        <StatusIndicator status="stale" label="Stale · 2 days" />
        <StatusIndicator status="neutral" label="Paused" variant="inline" />
      </div>
    </Section>
  );
}

/* ---------- Async states ---------- */

type DemoStatus = AsyncState<unknown>["status"] | "no-matches" | "not-configured";
const DEMO_STATUSES: { value: DemoStatus; label: string }[] = [
  { value: "loading", label: "Loading" },
  { value: "success", label: "Success" },
  { value: "refreshing", label: "Refreshing" },
  { value: "stale", label: "Stale" },
  { value: "empty", label: "No records" },
  { value: "no-matches", label: "No matches" },
  { value: "not-configured", label: "Not set up" },
  { value: "error", label: "Error" },
  { value: "unavailable", label: "Unavailable" },
];
type DemoRow = { name: string; pnl: string | null };
const DEMO_ROWS: DemoRow[] = [{ name: "Apex $100K · Example", pnl: "5100" }, { name: "Topstep $50K · Example", pnl: "-2090" }, { name: "Personal · Example", pnl: null }];

function demoState(s: DemoStatus): AsyncState<DemoRow[]> {
  switch (s) {
    case "loading": return { status: "loading" };
    case "success": return { status: "success", data: DEMO_ROWS, asOf: "2026-10-19T20:12:00Z" };
    case "refreshing": return { status: "refreshing", data: DEMO_ROWS };
    case "stale": return { status: "stale", data: DEMO_ROWS, asOf: "2026-10-17T20:12:00Z", cause: "refresh-failed" };
    case "empty": return { status: "empty", kind: "no-records" };
    case "no-matches": return { status: "empty", kind: "no-matches" };
    case "not-configured": return { status: "empty", kind: "not-configured" };
    case "error": return { status: "error", error: { title: "Couldn't load accounts", message: "The journal couldn't be read. Your data is unchanged." } };
    case "unavailable": return { status: "unavailable", title: "Risk not available", reason: "This account has no rulebook yet, so room left can't be calculated." };
  }
}

const MUTATIONS: { value: MutationState["status"]; label: string; state: MutationState }[] = [
  { value: "idle", label: "Idle", state: { status: "idle" } },
  { value: "validating", label: "Validating", state: { status: "validating", message: "Checking 67 rows…" } },
  { value: "submitting", label: "Submitting", state: { status: "submitting", message: "Importing 64 trades…" } },
  { value: "success", label: "Success", state: { status: "success", message: "Imported 64 trades (example)." } },
  { value: "validation-error", label: "Invalid", state: { status: "validation-error", issues: [{ message: "Row 12: qty must be greater than 0" }, { message: "Row 40: date doesn't match month/day/year" }] } },
  { value: "uncertain", label: "Uncertain", state: { status: "uncertain" } },
  { value: "failed", label: "Failed", state: { status: "failed", message: "The file couldn't be read.", nothingChanged: true } },
];

export function AsyncSection() {
  const [status, setStatus] = useState<DemoStatus>("loading");
  const [mutation, setMutation] = useState<MutationState["status"]>("uncertain");
  const toast = useToast();
  const state = demoState(status);
  return (
    <Section title="Async states" note="One discriminated state drives StateBoundary. Loading shows no numbers, a failure is never empty, stale data says when it is from, refreshes are silent.">
      <SegmentedControl label="Example state" value={status} onValueChange={setStatus} options={DEMO_STATUSES} />
      <div className="ds-card">
        <StateBoundary
          state={state}
          label="accounts"
          timeZone="America/New_York"
          onRetry={() => toast.show({ title: "Retry requested", description: "Example only." })}
          loading={<LoadingState label="Loading accounts" layout="table" rows={3} />}
          empty={{
            "no-records": <EmptyState kind="no-records" title="Add your first account" description="Accounts you add show their rules and room left here." action={<Button variant="primary" icon={<Plus size={16} aria-hidden="true" />}>Add account</Button>} />,
            "no-matches": <EmptyState kind="no-matches" action={<Button>Clear filters</Button>} />,
            "not-configured": <EmptyState kind="not-configured" title="Set up rules first" description="Choose a rulebook to see this account's limits." action={<Button>Choose a rulebook</Button>} />,
          }}
          unavailableAction={<Button>Choose a rulebook</Button>}
        >
          {(rows) => <StatList items={rows.map((r) => ({ label: r.name, value: { kind: "money", amount: r.pnl } }))} />}
        </StateBoundary>
      </div>
      <div className="dsg-grid-2">
        <div className="ds-card dsg-stack">
          <SegmentedControl label="Example mutation" value={mutation} onValueChange={setMutation} options={MUTATIONS.map(({ value, label }) => ({ value, label }))} />
          <MutationFeedback state={MUTATIONS.find((m) => m.value === mutation)!.state} onCheck={() => {}} onRetry={() => {}} />
        </div>
        <div className="ds-card dsg-stack">
          <ErrorState scope="operation" title="Couldn't export" message="Choose another folder and try again." onRetry={() => {}} announce={false} />
        </div>
      </div>
    </Section>
  );
}

/* ---------- Data ---------- */

type AcctRow = { id: string; name: string; status: "Evaluation" | "Funded" | "Paused"; balance: string | null; pnl: string | null; ddUsed: string; ddLimit: string; trades: number };
const ACCOUNTS: AcctRow[] = [
  { id: "a1", name: "Apex $100K · Example", status: "Evaluation", balance: "105100", pnl: "5100", ddUsed: "2200", ddLimit: "3000", trades: 67 },
  { id: "a2", name: "Topstep $50K · Example with a long name that should not clip the row actions", status: "Funded", balance: "51357.2", pnl: "1357.2", ddUsed: "600", ddLimit: "2000", trades: 41 },
  { id: "a3", name: "Personal · Example", status: "Paused", balance: null, pnl: null, ddUsed: "0", ddLimit: "0", trades: 0 },
  { id: "a4", name: "MFF $25K · Example", status: "Evaluation", balance: "23910", pnl: "-1090", ddUsed: "1090", ddLimit: "1250", trades: 22 },
];

/* ---------- Account overview (Build 18.5) ---------- */

export function AccountOverviewSection() {
  const sample = (over: Partial<Parameters<typeof AccountOverviewCard>[0]>) => (
    <AccountOverviewCard
      titleId={`dsg-aoc-${over.title}`}
      mark="E"
      eyebrow="Example firm"
      title="Example account"
      reference="••••1234"
      meta="Evaluation · Phase 1"
      badges={<Badge tone="flow">Active</Badge>}
      primary={{ label: "Drawdown headroom", value: { kind: "money", amount: "1500", signed: false }, provenance: { label: "Current estimate", tone: "flow" }, note: "As of 21 Oct 2026, 13:00 EDT" }}
      figures={[
        { label: "Estimated balance", value: { kind: "money", amount: "50000", signed: false }, provenance: { label: "From your records", tone: "flow" } },
        { label: "Drawdown floor", value: { kind: "money", amount: "48500", signed: false }, note: "Minimum balance the rule allows" },
      ]}
      meters={<ProgressMeter label="Drawdown headroom" value="1500" max="2000" valueText="$1,500.00 of $2,000.00 left" note="Floor $48,500.00" />}
      rules={[{ label: "Max drawdown", value: "$2,000.00 · End-of-day trailing" }, { label: "Started with", value: "$50,000.00", muted: true }]}
      activity="Last traded 21 Oct 2026, 11:15 EDT"
      actions={<Button size="sm">View details</Button>}
      {...over}
    />
  );
  return (
    <Section title="AccountOverviewCard and ProgressMeter (Build 18.5)" note="Identity and status, then the figure to act on with its provenance, at most two bars, rule lines and an explicit details action. Narrow cards fold to identity, status, primary figure and actions. Example values only.">
      <div className="dsg-aoc-grid">
        {sample({ title: "Known estimate" })}
        {sample({
          title: "Nothing calculated", meters: undefined,
          primary: { label: "Drawdown headroom", value: { kind: "unavailable", reason: "Nothing calculated yet" }, provenance: { label: "Not calculated", tone: "neutral" }, note: "Nothing has been calculated for this attempt yet." },
          figures: [{ label: "Balance", value: { kind: "unavailable", reason: "No checkpoint" }, provenance: { label: "Not available", tone: "neutral" } }],
          activity: "No imported trades",
        })}
        {sample({ title: "Failed attempt", tint: "loss", badges: <><Badge tone="loss">Failed</Badge><Badge>Archived</Badge></>, meters: undefined,
          primary: { label: "Drawdown headroom", value: { kind: "unavailable", reason: "History only" }, provenance: { label: "History only", tone: "neutral" } } })}
      </div>
    </Section>
  );
}

export function DataSection() {
  const [sort, setSort] = useState<SortState | null>({ columnId: "balance", direction: "descending" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all" | AcctRow["status"]>("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [month, setMonth] = useState<YearMonth>({ year: 2026, month: 10 });
  const rows = useMemo(() => {
    const visible = ACCOUNTS.filter((a) => (filter === "all" || a.status === filter) && a.name.toLowerCase().includes(q.toLowerCase()));
    if (!sort) return visible;
    const dir = sort.direction === "ascending" ? 1 : -1;
    return [...visible].sort((a, b) => {
      if (sort.columnId === "name") return a.name.localeCompare(b.name) * dir;
      if (sort.columnId === "balance") return compareMoney(a.balance, b.balance, sort.direction);
      return (a.trades - b.trades) * dir;
    });
  }, [sort, filter, q]);
  const columns: DataColumn<AcctRow>[] = [
    { id: "name", header: "Account", rowHeader: true, sortable: true, cell: (r) => r.name },
    { id: "status", header: "Status", cell: (r) => <Badge tone={r.status === "Funded" ? "profit" : r.status === "Paused" ? "neutral" : "flow"}>{r.status}</Badge> },
    { id: "balance", header: "Balance", align: "end", sortable: true, firstDirection: "descending", cell: (r) => <MoneyCell value={r.balance} signed={false} /> },
    { id: "pnl", header: "P&L", align: "end", cell: (r) => <MoneyCell value={r.pnl} /> },
    { id: "dd", header: "Drawdown used", cell: (r) => (r.ddLimit === "0" ? <RuleStateBadge presence="explicit_none" support="supported" /> : <MiniMeter label={`${r.name} drawdown`} used={r.ddUsed} limit={r.ddLimit} />) },
    { id: "trades", header: "Trades", align: "end", sortable: true, firstDirection: "descending", cell: (r) => r.trades },
    { id: "menu", header: "Actions", hideHeader: true, cell: (r) => <DropdownMenu trigger={<IconButton size="sm" variant="ghost" label={`Actions for ${r.name}`} icon={<Ellipsis size={16} aria-hidden="true" />} />} items={[{ label: "Open", onSelect: () => {} }, { label: "Archive", onSelect: () => {} }]} /> },
  ];
  const counts = (s: AcctRow["status"]) => ACCOUNTS.filter((a) => a.status === s).length;
  return (
    <Section title="Data display" note="DataTable sorting, filtering and paging are controlled by the screen; the table shows the affordances. Unknown values show a dash, never $0.00.">
      <DataTable
        label="Example accounts"
        columns={columns}
        rows={rows.slice((page - 1) * pageSize, page * pageSize)}
        getRowId={(r) => r.id}
        getRowLabel={(r) => r.name}
        sort={sort}
        onSortChange={setSort}
        selection={{ selected, onChange: setSelected }}
        toolbar={
          <>
            <SearchField label="Search accounts" value={q} onValueChange={(v) => { setQ(v); setPage(1); }} placeholder="Search name, firm or ID" />
            <SegmentedControl
              label="Status"
              value={filter}
              onValueChange={(v) => { setFilter(v); setPage(1); }}
              options={[{ value: "all", label: "All", count: ACCOUNTS.length }, { value: "Evaluation", label: "Evaluation", count: counts("Evaluation") }, { value: "Funded", label: "Funded", count: counts("Funded") }, { value: "Paused", label: "Paused", count: counts("Paused") }]}
            />
          </>
        }
        actions={<Button size="sm" icon={<Columns3 size={16} aria-hidden="true" />}>Columns</Button>}
        bulkActions={() => (
          <>
            <Button size="sm">Archive</Button>
            <Button size="sm">Export CSV</Button>
          </>
        )}
        fallback={rows.length === 0 ? <EmptyState kind="no-matches" size="compact" action={<Button size="sm" onClick={() => { setQ(""); setFilter("all"); }}>Clear filters</Button>} /> : undefined}
        pagination={{ page, pageSize, total: rows.length, onPageChange: setPage, onPageSizeChange: (n) => { setPageSize(n); setPage(1); } }}
        footer="Example data"
      />
      <div className="dsg-grid-4">
        <MetricCard label="Net P&L" value={{ kind: "money", amount: "1792.68" }} sub="36 trades · example" basis="Realized · all time" asOf="2026-10-19T20:12:00Z" timeZone="America/New_York" />
        <MetricCard label="Room left today" value={{ kind: "unavailable", reason: "No rulebook for this account" }} basis="Daily loss limit" />
        <MetricCard label="Balance" value={{ kind: "money", amount: "-1234567.89" }} sub="Large negative example" stale asOf="2026-10-17T20:12:00Z" timeZone="America/New_York" />
        <MetricCard label="Open P&L" value={{ kind: "money", amount: null }} sub="Unknown, not $0.00" />
        <MetricCard label="Net P&L (EUR account)" value={{ kind: "money", amount: "-412.5", currency: "EUR" }} sub="Currency comes from the account" />
      </div>
      <div className="dsg-grid-2">
        <div className="ds-card dsg-stack">
          <Stepper label="Import steps" current={2} steps={[{ label: "Choose file" }, { label: "Match columns" }, { label: "Review rows" }, { label: "Import" }]} />
          <div className="dsg-row">
            <LabeledValue label="Format" value="Performance export (example)" />
            <LabeledValue label="Fees" value={{ kind: "money", amount: "125.4", signed: false }} />
            <LabeledValue label="Win rate" value={{ kind: "percent", value: null }} />
          </div>
          <RulebookLine name="Apex 100K" version={3} verification="needs_review" />
          <div className="dsg-row">
            <RuleStateBadge presence="unknown" support="supported" setupAction={<Button size="sm" variant="ghost">Add limit</Button>} />
            <RuleStateBadge presence="explicit_none" support="supported" />
            <RuleStateBadge presence="disabled" support="supported" />
            <RuleStateBadge presence="value" support="manual_only" />
            <RuleStateBadge presence="value" support="unsupported" />
          </div>
          <RuleStateBadge presence="value" support="supported" meter={<RuleMeter label="Daily loss limit (example)" used="1120" limit="5000" />} />
        </div>
        <div className="ds-card dsg-stack">
          <MonthYearPicker
            value={month}
            onChange={setMonth}
            today={{ year: 2026, month: 10 }}
            months={{ "2026-07": { pnl: "-420", trades: 18 }, "2026-08": { pnl: "1310.5", trades: 31 }, "2026-09": { pnl: "2210", trades: 40 }, "2026-10": { pnl: "1792.68", trades: 36 }, "2025-11": { pnl: null, trades: 4 } }}
          />
          <StatList
            label="Selected day (example)"
            bordered
            items={[
              { label: "Net P&L", value: { kind: "money", amount: "75.05" } },
              { label: "Trades", value: { kind: "count", value: 4 } },
              { label: "Fees", value: { kind: "money", amount: "0", signed: false } },
              { label: "Open P&L", value: null },
            ]}
          />
          <p className="ds-faint">
            Day total <Pnl value="75.05" size="s" />; open P&amp;L unknown is shown as a dash, fees of zero as $0.00.
          </p>
        </div>
      </div>
      <ChartPanel
        title="Balance"
        subtitle="Example balance with drawdown floor"
        timeZone="America/New_York"
        state={{ status: "success", data: ["100000", "100250", "99800", "101400", "102300", "103900", "105100"], asOf: "2026-10-19T20:12:00Z" }}
      >
        {(points) => <EquityCurve points={points} floor="97000" label="Example balance curve" />}
      </ChartPanel>
    </Section>
  );
}
