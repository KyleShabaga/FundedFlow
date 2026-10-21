// Build 26.9: Add Fake Data. Seeds deterministic synthetic accounts and trades into the isolated test
// journal through the native seeder, then refreshes every journal read without reloading the page.
import { useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useState } from "react";

import { Button, Dialog, InlineNotice, RadioGroup, TextField, useToast } from "../../design-system";
import { featureKeys } from "../../features/shared/query-keys";
import { devTools, presetLabels, presets, type DevToolsStatus, type Preset, type SeedReport } from "./api";
import { TargetDirectory, TestJournalRequired } from "./TargetDirectory";

const STATUS_LABEL: Record<string, string> = { active: "Active", passed: "Passed", failed: "Failed", closed: "Closed" };

function errorText(e: unknown) {
  return e instanceof Error ? e.message : "Add Fake Data failed.";
}

export function AddFakeDataDialog({ open, onOpenChange, status }: { open: boolean; onOpenChange: (open: boolean) => void; status: UseQueryResult<DevToolsStatus> }) {
  const client = useQueryClient();
  const toast = useToast();
  const [preset, setPreset] = useState<Preset>("ui_smoke");
  const [seed, setSeed] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<SeedReport | null>(null);
  const info = status.data;
  const seedValue = seed.trim() === "" ? info?.defaultSeed ?? 2609 : Number(seed);
  const seedInvalid = !Number.isInteger(seedValue) || seedValue < 0 || seedValue > 4_294_967_295;

  const change = (next: boolean) => {
    if (busy) return;
    if (!next) {
      setError(null);
      setReport(null);
    }
    onOpenChange(next);
  };

  const generate = async () => {
    if (busy || seedInvalid) return;
    setBusy(true);
    setError(null);
    try {
      const result = await devTools.seed({ preset, seed: seedValue });
      setReport(result);
      // Every screen re-reads from the journal (Today, Accounts, Calendar, Journal, Insights).
      await client.invalidateQueries({ queryKey: featureKeys.root });
      toast.show({ tone: "success", title: "Fake data added", description: `${result.totalAccounts} accounts and ${result.totalTrades} trades.` });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const footer = report ? (
    <Button variant="primary" onClick={() => change(false)}>Done</Button>
  ) : (
    <>
      <Button onClick={() => change(false)} disabled={busy}>Cancel</Button>
      <Button variant="primary" onClick={() => void generate()} loading={busy}
        disabled={!info?.isolated || seedInvalid} disabledReason={!info?.isolated ? "Start FundedFlow on the test journal first" : seedInvalid ? "Use a whole-number seed" : undefined}>
        {busy ? "Generating…" : "Generate"}
      </Button>
    </>
  );

  return (
    <Dialog open={open} onOpenChange={change} title="Add Fake Data" size="md" dismissible={!busy} hideClose={busy}
      description="Developer tool: adds clearly labeled DEMO / TEST DATA to the isolated test journal." footer={footer}>
      <div className="dev-dialog-stack">
        {status.isPending ? <p role="status">Checking the test journal…</p> : info ? <TargetDirectory status={info} /> : <InlineNotice tone="error">{errorText(status.error)}</InlineNotice>}
        {info && !info.isolated && <TestJournalRequired status={info} />}
        {report ? (
          <InlineNotice tone="success" title={`Created ${report.totalAccounts} accounts and ${report.totalTrades} trades`} live="polite">
            <p>Preset {presetLabels[report.preset].label}, seed {report.seed}, history ending {report.anchorDay}. Run it again with the same seed and day to get the same data.</p>
            {report.skipped.length > 0 && <p>Already in this journal, left unchanged: {report.skipped.join(", ")}.</p>}
            <ul className="dev-report-list">
              {report.accounts.map(a => (
                <li key={a.accountId}>
                  <span className="dev-report-name" title={a.name}>{a.name}</span>
                  <span className="ds-faint"> · {STATUS_LABEL[a.status] ?? a.status}{a.archived ? ", archived" : ""} · {a.trades} trades</span>
                </li>
              ))}
            </ul>
          </InlineNotice>
        ) : (
          <>
            <RadioGroup label="Preset" name="dev-seed-preset" value={preset} onValueChange={setPreset} disabled={busy}
              options={presets.map(id => ({ value: id, label: presetLabels[id].label, description: presetLabels[id].description }))} />
            <TextField label="Seed" optional numeric inputMode="numeric" value={seed} placeholder={String(info?.defaultSeed ?? 2609)}
              onChange={e => setSeed(e.target.value)} disabled={busy} error={seedInvalid ? "Use a whole number from 0 to 4294967295" : undefined}
              description="The same seed (and day) always produces the same accounts, trades and totals." />
            <p className="ds-faint">Accounts, firms and rules are fictional and are not any firm's policy. Scenarios already in the journal are skipped, never duplicated. If anything fails, the journal is restored to how it was.</p>
          </>
        )}
        {busy && <p role="status" className="dev-progress">Generating accounts, rules, trades, imports and reviews… This can take a few seconds.</p>}
        {error && <InlineNotice tone="error" title="Nothing was added">{error}</InlineNotice>}
      </div>
    </Dialog>
  );
}
