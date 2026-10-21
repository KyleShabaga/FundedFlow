import { describe, expect, it } from "vitest";

import type { RuntimeState } from "../app/RuntimeProvider";
import { APP_VERSION, formatDiagnostics, newIncidentId, renderDiagnostics, runtimeDiagnostics, sectionOf } from "./diagnostics";

const SECRETS = ["Jane", "C:\Users", "/home/jane", "journal.db", "SELECT", "acct-7f3a", "sk-live", "revenge", "1,250", "ESZ6", "stack"];
const clean = (text: string) => { for (const s of SECRETS) expect(text, s).not.toContain(s); };
const at = new Date("2026-10-21T18:00:00.000Z");

describe("diagnostic summary allowlist", () => {
  it("keeps only typed runtime fields, never the native message or detail", () => {
    const state = {
      kind: "unavailable", reason: "runtime-failed",
      status: { state: "failed", stage: "migrate", schemaVersion: 19, supportedSchemaVersion: 20, created: false,
        failure: { category: "migration_failed", retryable: true, message: "Saved as journal.db for Jane", detail: "SELECT * FROM trades at C:\Users\Jane\journal.db",
          failedMigration: { version: 20, name: "source_fact_immutability", fromVersion: 18, reachedVersion: 19 } } },
    } as unknown as RuntimeState;
    const text = formatDiagnostics(runtimeDiagnostics(state, "FF-000000000001", at, "#/accounts/acct-7f3a?trade=ESZ6"));
    expect(text).toContain("Code: migration_failed");
    expect(text).toContain("Stage: migrate");
    expect(text).toContain("Journal version: 19");
    expect(text).toContain("Supported journal version: 20");
    expect(text).toContain("Failed upgrade step: step 20 (from 18, reached 19)");
    expect(text).toContain("Retry allowed: true");
    expect(text).toContain("Screen: accounts");
    expect(text).toContain(`FundedFlow version: ${APP_VERSION}`);
    expect(text).toContain("Time (UTC): 2026-10-21T18:00:00.000Z");
    clean(text);
  });

  it("marks what it doesn't know as unknown, and refuses values outside the allowlist", () => {
    const state = { kind: "unavailable", reason: "C:\Users\Jane\journal.db", status: null } as unknown as RuntimeState;
    const text = formatDiagnostics(runtimeDiagnostics(state, "FF-000000000002", at, "#/C:\Users\Jane"));
    expect(text).toContain("Code: unknown");
    expect(text).toContain("Stage: unknown");
    expect(text).toContain("Journal version: unknown");
    expect(text).toContain("Screen: unknown");
    clean(text);
  });

  it("reports only the built-in class of a render error, never its message, cause or stack", () => {
    class PrivateError extends Error { name = "Jane revenge ESZ6"; }
    const nested = Object.assign(new TypeError("Cannot read 'pnl' of ESZ6 for Jane at /home/jane/journal.db"), { cause: new Error("SELECT sk-live acct-7f3a") });
    const custom = new PrivateError("C:\Users\Jane\journal.db");
    expect(formatDiagnostics(renderDiagnostics(nested, "FF-1", at, "#/insights?accounts=acct-7f3a"))).toContain("Code: render_TypeError");
    const text = formatDiagnostics(renderDiagnostics(custom, "FF-2", at, "#/journal/trades/ESZ6"));
    expect(text).toContain("Code: render_Error");
    expect(text).toContain("Screen: journal");
    clean(formatDiagnostics(renderDiagnostics(nested, "FF-1", at, "#/insights?accounts=acct-7f3a")));
    clean(text);
    clean(formatDiagnostics(renderDiagnostics("a string thrown with Jane's journal.db", "FF-3", at, "#/")));
  });

  it("makes random, opaque incident ids and maps routes to sections only", () => {
    const ids = new Set(Array.from({ length: 50 }, newIncidentId));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^FF-[0-9A-F]{12}$/);
    expect(sectionOf("#/")).toBe("today");
    expect(sectionOf("#/settings/developer")).toBe("settings");
    expect(sectionOf("#/journal/days/2026-10-19")).toBe("journal");
  });
});
