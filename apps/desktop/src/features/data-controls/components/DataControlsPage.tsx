// Settings → Your data (Build 25). Export, restore and permanent deletion over
// the Build 24 native commands. Export and restore never upload anything; the
// last export outcome is remembered without its path.
import { statusLabels, type DataExportResult } from "@fundedflow/domain";
import { Download, Eraser, FileUp, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { useRuntime } from "../../../app/RuntimeProvider";
import { Button, Checkbox, formatBytes, formatInstant, FormSection, InlineNotice, RadioGroup, Select, StatList, useToast } from "../../../design-system";
import { useAccounts } from "../../accounts/hooks/accounts";
import { accountLabel } from "../../accounts/components/presentation";
import { PrivacyLegalSection } from "../../legal/components/PrivacyLegalSection";
import { useSetSetting, useSetting } from "../../settings/hooks/settings";
import * as api from "../api/data-controls";
import { useDataControlOperation } from "../hooks/data-controls";
import { DeletionDialog, type DeletionTarget } from "./DeletionDialog";
import { RestoreArchiveDialog } from "./RestoreArchiveDialog";
import "./data-controls.css";

const ALL = "__all__";

export interface DataControlsPageProps {
  /** The native file chooser; tests pass a fake. */
  picker?: api.FilePicker;
}

export function DataControlsPage({ picker = api.tauriFilePicker }: DataControlsPageProps) {
  const op = useDataControlOperation();
  const runtime = useRuntime();
  const toast = useToast();
  const accounts = useAccounts("all");
  const list = accounts.data ?? [];
  const lastSetting = useSetting(api.LAST_EXPORT_SETTING);
  const saveLast = useSetSetting(api.LAST_EXPORT_SETTING);
  const stored = api.lastExportSchema.safeParse(lastSetting.data?.value);
  const [sessionLast, setSessionLast] = useState<api.LastExport | null>(null);
  const last = sessionLast ?? (stored.success ? stored.data : null);

  const [kind, setKind] = useState<api.ExportKind>("archive");
  const [csvScope, setCsvScope] = useState<string>(ALL);
  const [acknowledged, setAcknowledged] = useState(false);
  const [exportProblem, setExportProblem] = useState<string | null>(null);
  const [exported, setExported] = useState<{ file: string; result: DataExportResult } | null>(null);

  const [restoreSource, setRestoreSource] = useState<string | null>(null);
  const [restoreProblem, setRestoreProblem] = useState<string | null>(null);

  const [deleteAccountId, setDeleteAccountId] = useState<string | undefined>(undefined);
  const [deletion, setDeletion] = useState<DeletionTarget | null>(null);

  const supportedSchema = runtime.state.kind === "ready" ? runtime.state.status.supportedSchemaVersion : null;
  const disabled = !op.canStart;

  const runExport = async () => {
    setExportProblem(null);
    setExported(null);
    if (!acknowledged) {
      setExportProblem("Confirm that you understand the file is not encrypted.");
      return;
    }
    let destination: string | null;
    try {
      destination = await picker.save(kind, api.suggestedName(kind));
    } catch (error) {
      setExportProblem(api.describeProblem(error));
      return;
    }
    if (destination === null) return; // Cancelled in the file chooser: nothing happened.
    const accountId = kind === "csv" && csvScope !== ALL ? csvScope : null;
    try {
      const result = await op.run("export", () => (kind === "archive" ? api.exportArchive(destination) : api.exportCsv(destination, accountId)));
      const account = accountId ? list.find(a => a.id === accountId) : undefined;
      const record: api.LastExport = {
        kind,
        scope: kind === "archive" ? "journal" : accountId ? "account" : "all-accounts",
        accountName: account ? accountLabel(account) : null,
        completedAt: new Date().toISOString(),
        bytes: result.bytes,
        sha256: result.sha256,
      };
      setExported({ file: api.fileName(destination), result });
      setSessionLast(record);
      saveLast.submit(record).catch(() => {}); // The export already succeeded; remembering it is best effort.
      toast.show({ tone: "success", title: kind === "archive" ? "Full backup saved" : "Trade CSV saved", description: api.fileName(destination) });
    } catch (error) {
      setExportProblem(api.describeProblem(error));
    }
  };

  const chooseArchive = async () => {
    setRestoreProblem(null);
    try {
      const source = await picker.open();
      if (source !== null) setRestoreSource(source);
    } catch (error) {
      setRestoreProblem(api.describeProblem(error));
    }
  };

  const selectedAccount = list.find(a => a.id === deleteAccountId);
  const working = op.busy === "export" ? "Exporting…" : op.busy === "restore" ? "Preparing restore…" : op.busy === "delete" ? "Deleting…" : op.busy === "cleanup" ? "Cleaning up files…" : null;

  return (
    <div className="dc-page">
      {!op.ready && (
        <InlineNotice tone="warning" title="Local data isn't open">
          Export, restore and deletion are available once the journal is open. Use the recovery banner above.
        </InlineNotice>
      )}
      {working && <p role="status" className="dc-working">{working} Other data actions wait until this finishes.</p>}

      <FormSection headingLevel={2} title="Your data on this computer" description="Where your journal lives and what is backed up. Nothing leaves this computer: see Privacy & legal below.">
        <StatList bordered items={[
          { label: "Stored", value: "In FundedFlow's app-data folder for your Windows user account" },
          { label: "Journal version", value: runtime.state.kind === "ready" ? `${runtime.state.status.schemaVersion ?? "Unknown"} (backup format 1)` : null },
          { label: "Automatic backups", value: "Only before an upgrade. FundedFlow saves a copy of your journal in the same folder before upgrading its format. That copy isn't a substitute for exporting a full backup." },
          { label: "Backup protection", value: "Not encrypted. Anyone who can open the file can read your trades, notes and screenshots." },
          { label: "Last export from this journal", value: last
            ? `${last.kind === "archive" ? "Full backup" : last.scope === "account" ? `Trade CSV · ${last.accountName ?? "one account"}` : "Trade CSV · all accounts"} · ${formatInstant(last.completedAt, { year: true })} · ${formatBytes(last.bytes)}`
            : "No export yet" },
        ]} />
      </FormSection>

      {/* P0-D20: one column in reading order: choose the format, acknowledge the file is unencrypted, then export.
          Feedback for the export sits directly under its button. */}
      <FormSection headingLevel={2} title="Export" description="Save a copy of your data to a location you choose." className="dc-export">
        <RadioGroup<api.ExportKind>
          label="What to export"
          cards
          value={kind}
          onValueChange={next => { setKind(next); setExported(null); }}
          disabled={disabled}
          options={[
            { value: "archive", label: "Full backup (.ffj.zip)", description: "Everything in the journal: accounts including archived and failed attempts, reset history, trades, original import rows, notes, reviews, rulebooks and screenshots. This is the file you restore from." },
            { value: "csv", label: "Trade CSV", description: "A spreadsheet of trades for reading or sharing. It can't be restored and isn't a backup." },
          ]}
        />
        {kind === "csv" && (
          <div className="dc-export-scope">
            <Select
              label="Accounts"
              value={csvScope}
              onValueChange={setCsvScope}
              disabled={disabled}
              options={[{ value: ALL, label: "All accounts" }, ...list.map(a => ({ value: a.id, label: `${accountLabel(a)}${a.archivedAt ? " (archived)" : ""}` }))]}
            />
          </div>
        )}
        <div className="dc-privacy">
          <Checkbox
            label="I understand this file is not encrypted"
            description="Keep it somewhere only you can open. FundedFlow never overwrites an existing file."
            checked={acknowledged}
            onChange={event => setAcknowledged(event.target.checked)}
            disabled={disabled}
          />
        </div>
        <div className="dc-export-action">
          <div className="dc-actions">
            <Button variant="primary" icon={<Download size={16} aria-hidden="true" />} onClick={() => void runExport()} loading={op.busy === "export"} disabled={disabled}>
              {op.busy === "export" ? "Exporting…" : "Choose location and export…"}
            </Button>
          </div>
          {exportProblem && <InlineNotice tone="error" title="Nothing was exported">{exportProblem}</InlineNotice>}
          {exported && (
            <InlineNotice tone="success" title={`Saved ${exported.file}`}>
              {formatBytes(exported.result.bytes)} · SHA-256 <code className="dc-id">{exported.result.sha256}</code>
            </InlineNotice>
          )}
        </div>
      </FormSection>

      <FormSection headingLevel={2} title="Restore from a full backup" description="Replace this journal with a full backup made on this or another computer. FundedFlow checks the file before anything is replaced.">
        {restoreProblem && <InlineNotice tone="error" title="No archive was opened">{restoreProblem}</InlineNotice>}
        <div className="dc-actions">
          <Button icon={<FileUp size={16} aria-hidden="true" />} onClick={() => void chooseArchive()} disabled={disabled}>Choose backup to restore…</Button>
        </div>
      </FormSection>

      <FormSection headingLevel={2} title="Delete data permanently" description="Failing or archiving an account keeps its history. Deleting removes it for good.">
        <div className="dc-danger">
          <div className="dc-danger-row">
            <div>
              <h3 className="dc-subhead">Delete one trading account</h3>
              <p className="dc-note">Removes one account or attempt and its trades, imports, notes, reviews and screenshots. Other accounts and shared data stay.</p>
              <Select
                label="Account"
                placeholder={list.length ? "Choose an account…" : "No accounts"}
                value={deleteAccountId}
                onValueChange={setDeleteAccountId}
                disabled={disabled || list.length === 0}
                options={list.map(a => ({ value: a.id, label: `${accountLabel(a)} · ${statusLabels[a.status]}${a.archivedAt ? " · archived" : ""}` }))}
              />
            </div>
            <Button variant="danger" icon={<Trash2 size={16} aria-hidden="true" />} disabled={disabled || !selectedAccount}
              onClick={() => selectedAccount && setDeletion({ kind: "account", accountId: selectedAccount.id, accountLabel: accountLabel(selectedAccount), status: statusLabels[selectedAccount.status], archived: selectedAccount.archivedAt !== null })}
            >
              Delete account permanently…
            </Button>
          </div>
          <div className="dc-danger-row">
            <div>
              <h3 className="dc-subhead">Erase the entire local journal</h3>
              <p className="dc-note">Removes every account and all data in this journal, and FundedFlow's own recovery copies. Backups you exported yourself are not touched.</p>
            </div>
            <Button variant="danger" icon={<Eraser size={16} aria-hidden="true" />} disabled={disabled} onClick={() => setDeletion({ kind: "journal" })}>
              Erase entire journal…
            </Button>
          </div>
        </div>
      </FormSection>

      <PrivacyLegalSection />

      {import.meta.env.DEV && <p><Link to="/settings/developer">Developer tools</Link></p>}

      {restoreSource && (
        <RestoreArchiveDialog open source={restoreSource} supportedSchema={supportedSchema} onOpenChange={next => !next && setRestoreSource(null)} />
      )}
      {deletion && (
        <DeletionDialog
          open
          target={deletion}
          onOpenChange={next => !next && setDeletion(null)}
          onDeleted={() => { if (deletion.kind === "account") setDeleteAccountId(undefined); }}
        />
      )}
    </div>
  );
}
