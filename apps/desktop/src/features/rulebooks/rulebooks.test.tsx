// @vitest-environment jsdom
// Build 19 journeys through the real rulebook pages, Build 13 components and Build 14 hooks. The repository is
// an in-memory store that follows the Rust rules (test-store.ts); native persistence is tested in Rust.
import type { RuleDefinitionInput } from "@fundedflow/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeState } from "../../app/RuntimeProvider";
import { ToastProvider } from "../../design-system";
import { makeAccount } from "../accounts/test-store";
import { RulebookPage } from "./components/RulebookPage";
import { RulebookVersionPage } from "./components/RulebookVersionPage";
import { catalogueRules, closedTrade, createRulebookStore, PROVIDER } from "./test-store";

const runtime = vi.hoisted(() => ({ state: { kind: "ready" } as unknown as RuntimeState, check: vi.fn() }));
const holder = vi.hoisted(() => ({ store: null as unknown as ReturnType<typeof createRulebookStore> }));
vi.mock("../../app/RuntimeProvider", () => ({ useRuntime: () => runtime }));
vi.mock("../../lib/data/api", () => ({ get repository() { return holder.store.repository; } }));

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});

let client: QueryClient;
let location = "";
function Where() {
  location = useLocation().pathname;
  return null;
}
function renderAt(path: string) {
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Where />
          <Routes>
            <Route path="/accounts/:accountId" element={<p>Account page</p>} />
            <Route path="/accounts/:accountId/rulebook" element={<RulebookPage />} />
            <Route path="/accounts/:accountId/rulebook/versions/:versionId" element={<RulebookVersionPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const A = "acct-a";
const B = "acct-b";
beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-10-21T15:00:00Z"), shouldAdvanceTime: true, toFake: ["Date"] });
  runtime.state = { kind: "ready", status: { state: "ready", stage: "ready", schemaVersion: 15, supportedSchemaVersion: 15, created: false, failure: null } } as unknown as RuntimeState;
  runtime.check.mockReset().mockResolvedValue(undefined);
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  holder.store = createRulebookStore([makeAccount({ id: A, name: "Eval A", propFirm: "Example" }), makeAccount({ id: B, name: "Eval B" })]);
  try { sessionStorage.clear(); } catch { /* jsdom always has it */ }
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Replaces a field's value in one paste (Build 26.7): typed dates cost ~200 ms each in jsdom under load. */
async function pasteInto(user: ReturnType<typeof userEvent.setup>, field: HTMLElement, text: string) {
  await user.clear(field);
  await user.click(field);
  await user.paste(text);
}

async function chooseOption(user: ReturnType<typeof userEvent.setup>, label: RegExp | string, option: RegExp | string, scope: HTMLElement = document.body) {
  await user.click(within(scope).getByRole("combobox", { name: label }));
  await user.click(await screen.findByRole("option", { name: option }));
}

/** Assigns the store's verified catalogue version to an account from a Monday. */
async function assignCatalogue(accountId = A) {
  await holder.store.repository.rulebooks.assign(
    { accountId, rulebookVersionId: holder.store.verifiedVersionId, effectiveFrom: "2026-10-19", programmePhaseId: null, phasePathId: null, accountPhaseEventId: null },
    { expectedOpenAssignmentId: null, actor: "local_user", reason: "Start" },
  );
}

/** From the overview, copies the version in use into the account's own rules and opens the draft. */
async function startOwnDraft(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: /Start a draft from v1/ }));
  const dialog = await screen.findByRole("dialog", { name: /Start a draft from Example 50K v1/ });
  await user.click(within(dialog).getByRole("radio", { name: /My own rules for this account/ }));
  await user.click(within(dialog).getByRole("button", { name: "Create draft" }));
  await screen.findByRole("heading", { name: /Eval A rules · v1/ });
}

describe("rulebook overview", () => {
  it("distinguishes no rulebook from an assigned, verified one and keeps manual rules out of calculations", async () => {
    const user = userEvent.setup();
    const { unmount } = renderAt(`/accounts/${A}/rulebook`);
    expect(await screen.findByText("No rulebook assigned")).toBeTruthy();
    unmount();
    await assignCatalogue();
    client.clear();
    renderAt(`/accounts/${A}/rulebook`);
    const current = await screen.findByRole("region", { name: "In force today" });
    expect(within(current).getByText("Rulebook Example 50K · v1")).toBeTruthy();
    expect(within(current).getAllByText("Verified").length).toBeGreaterThan(0);
    expect(within(current).getByText(/2026-10-19 \(trading day, America\/New_York\)/)).toBeTruthy();
    expect(within(current).getByText("Manual check")).toBeTruthy();
    expect(within(current).getByText("Needs setup")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "Calculation" }));
    expect(await screen.findByText("No calculation recorded")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Not part of any calculation" })).toBeTruthy();
  });

  it("assigns from an explicit weekday with a reason, refusing weekends, and keeps the history", async () => {
    const user = userEvent.setup();
    renderAt(`/accounts/${A}/rulebook`);
    await screen.findByText("No rulebook assigned");
    // Load the catalogue versions the dialog offers.
    expect(await screen.findByRole("table", { name: "Versions of Example 50K" })).toBeTruthy();
    await user.click(screen.getAllByRole("button", { name: "Assign a version…" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "Assign a rulebook version" });
    const day = within(dialog).getByLabelText(/First trading day/);
    await pasteInto(user, day, "2026-10-18");
    await user.click(within(dialog).getByRole("button", { name: /Assign from 2026-10-18/ }));
    expect(await within(dialog).findByText(/Trading days run Monday to Friday/)).toBeTruthy();
    expect(holder.store.writes).toEqual(["assign"].slice(0, 0));
    await pasteInto(user, day, "2026-10-19");
    await user.type(within(dialog).getByRole("textbox", { name: /Reason/ }), "Evaluation started");
    await user.click(within(dialog).getByRole("button", { name: /Assign from 2026-10-19/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(holder.store.assignments).toHaveLength(1);
    expect(holder.store.events[holder.store.events.length - 1]).toMatchObject({ action: "assigned", reason: "Evaluation started", actor: "local_user" });
    expect(await screen.findByRole("region", { name: "In force today" })).toBeTruthy();
  });

  it("refuses an assignment made from a stale view instead of silently ending another one", async () => {
    const user = userEvent.setup();
    renderAt(`/accounts/${A}/rulebook`);
    await screen.findByRole("table", { name: "Versions of Example 50K" });
    await user.click(screen.getAllByRole("button", { name: "Assign a version…" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "Assign a rulebook version" });
    // Another window assigns meanwhile.
    await assignCatalogue();
    const day = within(dialog).getByLabelText(/First trading day/);
    await pasteInto(user, day, "2026-10-20");
    await user.click(within(dialog).getByRole("button", { name: /Assign from 2026-10-20/ }));
    expect(await within(dialog).findByText(/changed this account's rulebook in another window/)).toBeTruthy();
    expect(holder.store.assignments).toHaveLength(1);
    expect(holder.store.assignments[0].effectiveTo).toBeNull();
  });

  it("does not show one attempt's rulebook on another", async () => {
    await assignCatalogue(A);
    renderAt(`/accounts/${B}/rulebook`);
    expect(await screen.findByText("No rulebook assigned")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "In force today" })).toBeNull();
  });

  it("opens the assign dialog from the keyboard and returns focus on Escape", async () => {
    const user = userEvent.setup();
    renderAt(`/accounts/${A}/rulebook`);
    await screen.findByRole("table", { name: "Versions of Example 50K" });
    const button = screen.getAllByRole("button", { name: "Assign a version…" })[0];
    button.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("dialog", { name: "Assign a rulebook version" })).toBeTruthy();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(button));
  });
});

describe("draft, compare, preview, publish and assign", () => {
  // One journey in two tests (Build 26): as a single test it took ~1.7 s locally and timed out at 5 s on a busy
  // Windows CI runner. Nothing hung; it was ~17 jsdom interactions in a row. The second half starts from the
  // saved draft the first half produces, built through the same repository calls.
  it("edits, compares and previews a draft without writing, then saves it, without changing the version it started from", async () => {
    await assignCatalogue();
    const before = structuredClone(holder.store.versions.get(holder.store.verifiedVersionId));
    const user = userEvent.setup();
    renderAt(`/accounts/${A}/rulebook`);
    await startOwnDraft(user);
    expect(location).toMatch(/\/rulebook\/versions\//);

    // Edit: lower the target.
    const target = screen.getByRole("textbox", { name: "Target" });
    await user.clear(target);
    await user.type(target, "2500");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();

    // Compare includes the unsaved edit, in words.
    await user.click(screen.getByRole("tab", { name: "Compare" }));
    const targetTable = await screen.findByRole("table", { name: /Profit Target \(changed\)/ });
    const row = within(targetTable).getByRole("row", { name: /Target/ });
    expect(within(row).getByText("$3,000.00")).toBeTruthy();
    expect(within(row).getByText("$2,500.00")).toBeTruthy();
    expect(within(row).getByText("Changed")).toBeTruthy();

    // Preview: a labelled simulation of the unsaved edit through the engine, with no write.
    const writesBefore = [...holder.store.writes];
    await user.click(screen.getByRole("tab", { name: "Preview" }));
    expect(await screen.findByText("Simulation: not this account's status")).toBeTruthy();
    expect(await screen.findByText(/^Simulated: /)).toBeTruthy();
    expect(holder.store.evidenceCalls).toEqual([A]);
    expect(holder.store.writes).toEqual(writesBefore);
    expect(holder.store.snapshots).toHaveLength(0);

    // The edit survived the tab switches; save it.
    await user.click(screen.getByRole("tab", { name: "Edit rules" }));
    expect((screen.getByRole("textbox", { name: "Target" }) as HTMLInputElement).value).toBe("2500");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText("All changes saved")).toBeTruthy();
    const mine = [...holder.store.versions.values()].find(v => v.rulebook.ownerAccountId === A)!;
    expect(mine.rules.find(r => r.ruleKey === "profit_target")?.parameters).toMatchObject({ amount: { state: "value", value: "2500" } });
    expect(holder.store.versions.get(holder.store.verifiedVersionId)).toEqual(before);
    expect(holder.store.events.map(e => e.action)).toEqual(["assigned", "draft_created", "draft_saved"]);
  });

  it("publishes a saved draft with explicit confirmation and assigns it, without changing the version it started from", async () => {
    await assignCatalogue();
    const before = structuredClone(holder.store.versions.get(holder.store.verifiedVersionId));
    const rules = catalogueRules().map(r => r.ruleKey === "profit_target" ? { ...r, parameters: { ...r.parameters, amount: { state: "value" as const, value: "2500" } } } as RuleDefinitionInput : r);
    const draft = await holder.store.repository.rulebooks.createDraft({
      rulebookId: null, newRulebook: { providerId: PROVIDER, ownerAccountId: A, slug: "account-accta", displayName: "Eval A rules", description: null },
      supersedesVersionId: null, changeReason: "Copied from Example 50K v1", capturedAt: "2026-10-01T00:00:00.000Z", effectiveFrom: null, effectiveTo: null,
      rules: catalogueRules(), applicability: [],
    }, { actor: "local_user", reason: null });
    await holder.store.repository.rulebooks.updateDraft(draft.version.id, draft.version.updatedAt, {
      changeReason: draft.version.changeReason, capturedAt: draft.version.capturedAt, effectiveFrom: null, effectiveTo: null, rules, applicability: [],
    }, { actor: "local_user", reason: null });
    const user = userEvent.setup();
    renderAt(`/accounts/${A}/rulebook/versions/${draft.version.id}`);
    await screen.findByRole("heading", { name: /Eval A rules · v1/ });

    // Review and publish with explicit confirmation.
    await user.click(screen.getByRole("tab", { name: "Review and publish" }));
    expect(await screen.findByText("The saved draft passes every publish check.")).toBeTruthy();
    const publish = screen.getByRole("button", { name: "Publish…" });
    expect(publish.getAttribute("aria-disabled") === "true" || (publish as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("checkbox", { name: /can't be edited after it is published/ }));
    await user.click(screen.getByRole("button", { name: "Publish…" }));
    const confirm = await screen.findByRole("alertdialog", { name: /Publish Eval A rules v1/ });
    await user.click(within(confirm).getByRole("button", { name: "Publish" }));

    // Then assign it from a later weekday.
    const assign = await screen.findByRole("dialog", { name: "Assign a rulebook version" });
    const day = within(assign).getByLabelText(/First trading day/);
    await pasteInto(user, day, "2026-10-21");
    await user.click(within(assign).getByRole("button", { name: /Assign from 2026-10-21/ }));
    await waitFor(() => expect(location).toBe(`/accounts/${A}/rulebook`));

    expect(holder.store.assignments.map(a => [a.effectiveFrom, a.effectiveTo])).toEqual([["2026-10-19", "2026-10-21"], ["2026-10-21", null]]);
    expect(holder.store.versions.get(holder.store.verifiedVersionId)).toEqual(before);
    expect(holder.store.events.map(e => e.action)).toEqual(["assigned", "draft_created", "draft_saved", "published", "assigned"]);
    // The published version is read-only now.
    cleanup();
    renderAt(`/accounts/${A}/rulebook/versions/${draft.version.id}`);
    expect(await screen.findByText("Account rules (private)")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
    expect(screen.getByRole("button", { name: "Start a draft from this version" })).toBeTruthy();
  });

  it("validates before saving and writes nothing when a value is unknown on a supported rule", async () => {
    await assignCatalogue();
    const user = userEvent.setup();
    renderAt(`/accounts/${A}/rulebook`);
    await startOwnDraft(user);
    const writes = holder.store.writes.length;
    await chooseOption(user, /^Support/, "Can be calculated", screen.getByRole("region", { name: "Max Drawdown" }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    const summary = await screen.findByRole("alert");
    expect(within(summary).getByText(/Unknown method: mark the rule needs_setup/)).toBeTruthy();
    expect(holder.store.writes.length).toBe(writes);
  });

  it("keeps the edits and offers a reload when the draft was saved elsewhere", async () => {
    await assignCatalogue();
    const user = userEvent.setup();
    renderAt(`/accounts/${A}/rulebook`);
    await startOwnDraft(user);
    const draft = [...holder.store.versions.values()].find(v => v.rulebook.ownerAccountId === A)!;
    // Another window saves first.
    await holder.store.repository.rulebooks.updateDraft(draft.version.id, draft.version.updatedAt,
      { changeReason: "Other window", capturedAt: draft.version.capturedAt, effectiveFrom: null, effectiveTo: null, rules: draft.rules.map(({ id: _i, rulebookVersionId: _v, ...r }) => r), applicability: [] },
      { actor: "local_user", reason: "Other window" });
    const target = screen.getByRole("textbox", { name: "Target" });
    await user.clear(target);
    await user.type(target, "2400");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText("This draft changed somewhere else")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Target" }) as HTMLInputElement).value).toBe("2400");
    expect(holder.store.versions.get(draft.version.id)!.version.changeReason).toBe("Other window");
    await user.click(screen.getByRole("button", { name: /Load the saved draft/ }));
    await waitFor(() => expect((screen.getByRole("textbox", { name: "Target" }) as HTMLInputElement).value).toBe("3000"));
  });

  it("asks before leaving with unsaved edits and offers them back", async () => {
    await assignCatalogue();
    const user = userEvent.setup();
    renderAt(`/accounts/${A}/rulebook`);
    await startOwnDraft(user);
    const target = screen.getByRole("textbox", { name: "Target" });
    await user.clear(target);
    await user.type(target, "2222");
    await user.click(screen.getByRole("link", { name: /Rulebook overview/ }));
    const ask = await screen.findByRole("alertdialog", { name: "Leave without saving?" });
    expect(location).toMatch(/\/versions\//);
    await user.click(within(ask).getByRole("button", { name: "Leave" }));
    await waitFor(() => expect(location).toBe(`/accounts/${A}/rulebook`));
    // Reopen the draft: the edits come back on request, not silently.
    await user.click(await screen.findByRole("row", { name: /v1 Draft/ }));
    expect(await screen.findByText("Unsaved edits from earlier")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Target" }) as HTMLInputElement).value).toBe("3000");
    await user.click(screen.getByRole("button", { name: "Restore them" }));
    expect((screen.getByRole("textbox", { name: "Target" }) as HTMLInputElement).value).toBe("2222");
  });

  it("refuses to publish a draft whose base was superseded meanwhile", async () => {
    await assignCatalogue();
    const user = userEvent.setup();
    renderAt(`/accounts/${A}/rulebook`);
    await startOwnDraft(user);
    const first = [...holder.store.versions.values()].find(v => v.rulebook.ownerAccountId === A)!;
    await holder.store.repository.rulebooks.publish(first.version.id, null, { expectedUpdatedAt: first.version.updatedAt, context: { actor: "local_user", reason: null } });
    const strip = (v: typeof first) => v.rules.map(({ id: _i, rulebookVersionId: _v, ...r }) => r);
    const input = { rulebookId: first.rulebook.id, newRulebook: null, supersedesVersionId: first.version.id, capturedAt: first.version.capturedAt, effectiveFrom: null, effectiveTo: null, rules: strip(first), applicability: [] };
    const a = await holder.store.repository.rulebooks.createDraft({ ...input, changeReason: "A" });
    const b = await holder.store.repository.rulebooks.createDraft({ ...input, changeReason: "B" });
    await holder.store.repository.rulebooks.publish(b.version.id, null);
    cleanup();
    client.clear();
    renderAt(`/accounts/${A}/rulebook/versions/${a.version.id}`);
    await user.click(await screen.findByRole("tab", { name: "Review and publish" }));
    await user.click(await screen.findByRole("checkbox", { name: /can't be edited after it is published/ }));
    await user.click(await screen.findByRole("button", { name: "Publish…" }));
    const confirm = await screen.findByRole("alertdialog", { name: /Publish/ });
    await user.click(within(confirm).getByRole("button", { name: "Publish" }));
    expect(await within(confirm).findByText(/a newer version was published/)).toBeTruthy();
    expect(holder.store.versions.get(a.version.id)!.version.verificationStatus).toBe("draft");
  });

  it("discards a draft with a reason and keeps it in the history", async () => {
    await assignCatalogue();
    const user = userEvent.setup();
    renderAt(`/accounts/${A}/rulebook`);
    await startOwnDraft(user);
    await user.click(screen.getByRole("tab", { name: "Review and publish" }));
    await user.click(await screen.findByRole("button", { name: "Discard draft…" }));
    const confirm = await screen.findByRole("alertdialog", { name: /Discard draft v1/ });
    await user.click(within(confirm).getByRole("button", { name: "Discard draft" }));
    expect(await within(confirm).findByText("Say why you're discarding it.")).toBeTruthy();
    await user.type(within(confirm).getByRole("textbox", { name: "Why" }), "Not needed");
    await user.click(within(confirm).getByRole("button", { name: "Discard draft" }));
    await waitFor(() => expect(location).toBe(`/accounts/${A}/rulebook`));
    expect(await screen.findByText("Discarded draft")).toBeTruthy();
    expect(holder.store.events[holder.store.events.length - 1]).toMatchObject({ action: "draft_discarded", reason: "Not needed" });
  });
});

describe("isolation and immutability", () => {
  it("never opens another account's private version", async () => {
    await assignCatalogue();
    const user = userEvent.setup();
    renderAt(`/accounts/${A}/rulebook`);
    await startOwnDraft(user);
    const mine = [...holder.store.versions.values()].find(v => v.rulebook.ownerAccountId === A)!;
    cleanup();
    renderAt(`/accounts/${B}/rulebook/versions/${mine.version.id}`);
    expect(await screen.findByText("This version belongs to another account")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Target" })).toBeNull();
  });

  it("shows a verified catalogue version read-only", async () => {
    renderAt(`/accounts/${A}/rulebook/versions/${holder.store.verifiedVersionId}`);
    expect(await screen.findByRole("heading", { name: "Example 50K · v1" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
    await act(async () => {});
    expect(screen.getByRole("button", { name: "Start a draft from this version" })).toBeTruthy();
  });
});

describe("calculation explanation", () => {
  it("shows a stored calculation as recorded and flags that it used another rulebook version", async () => {
    await assignCatalogue();
    const snapshot = {
      id: "s1", accountId: A, rulebookVersionId: "older-version", tradingDay: "2026-10-20", isEndOfDay: true, dataAsOf: "2026-10-20T21:00:00.000Z",
      dataSource: "csv_import", calculatedAt: "2026-10-21T09:00:00.000Z", engineVersion: "engine-test-1", inputsHash: "sha256:abc", feesIncluded: true,
      unrealizedIncluded: false, balance: "50125.5", realizedDayPnl: "125.5", unrealizedPnl: null, dailyLossLimit: null, dailyLossRemaining: null,
      drawdownMode: null, highWaterMark: null, drawdownFloor: null, drawdownHeadroom: null, drawdownLocked: false, profitTarget: null,
      tradingDaysCompleted: 1, tradingDaysRequired: null, status: "unknown", statusReasons: ["Drawdown method not verified"],
      explanation: { formula: "recorded by the engine", contributingTradeIds: ["t1", "t2"] },
    };
    holder.store.repository.snapshots.latest = async () => snapshot as never;
    const user = userEvent.setup();
    renderAt(`/accounts/${A}/rulebook`);
    await user.click(await screen.findByRole("tab", { name: "Calculation" }));
    expect(await screen.findByText("Calculated with a different rulebook version")).toBeTruthy();
    expect(screen.getByText("Recorded before the rules engine")).toBeTruthy();
    expect(screen.getByText(/Calculated for 2026-10-20, not today/)).toBeTruthy();
    expect(screen.getByText("Drawdown method not verified")).toBeTruthy();
    expect(screen.getByText("engine-test-1")).toBeTruthy();
    expect(screen.getByText("recorded by the engine")).toBeTruthy();
    expect(screen.getByText("t2")).toBeTruthy();
    // Data-as-of and calculated-at are separate facts.
    expect(screen.getByText("Data as of")).toBeTruthy();
    expect(screen.getByText("Calculated at")).toBeTruthy();
    expect(screen.queryByText(/Safe/)).toBeNull();
  });
});

/** Opens the preview settings and states complete history, USD amounts and touch-is-breach. */
async function stateEverything(user: ReturnType<typeof userEvent.setup>, scope: HTMLElement) {
  for (const label of [/All closed trades are imported/, /Fees are complete/, /Payouts, resets and corrections/]) await chooseOption(user, label, "Yes, complete", scope);
  await chooseOption(user, /Rule amounts are in/, /USD/, scope);
  await chooseOption(user, /A limit is breached when the balance/, "touches the limit", scope);
}

describe("engine integration", () => {
  it("previews unsaved edits with the engine's exact figures, labelled as a simulation, and writes nothing", async () => {
    await assignCatalogue();
    holder.store.trades.set(A, [closedTrade(A, 1, "-500")]);
    const user = userEvent.setup();
    renderAt(`/accounts/${A}/rulebook`);
    await startOwnDraft(user);
    // Make the drawdown calculable: static, realized, no lock.
    const dd = screen.getByRole("region", { name: "Max Drawdown" });
    await chooseOption(user, "Method", "Static", dd);
    await chooseOption(user, "Counts", "Realized P&L", dd);
    await chooseOption(user, /Trail lock: what the source says/, /None/, dd);
    await chooseOption(user, /^Support/, "Can be calculated", dd);
    const writes = [...holder.store.writes];
    await user.click(screen.getByRole("tab", { name: "Preview" }));
    const panel = screen.getByRole("tabpanel", { name: "Preview" });
    await stateEverything(user, panel);
    const outcome = await within(panel).findByRole("region", { name: "Max Drawdown" });
    // Opening 50,000 − 2,000 = floor 48,000; balance 49,500 → headroom 1,500 (engine figures, formatted).
    await waitFor(() => expect(within(outcome).getByText("Within limit")).toBeTruthy());
    expect(within(outcome).getAllByText("$48,000.00").length).toBeGreaterThan(0);
    expect(within(outcome).getByText("$1,500.00")).toBeTruthy();
    expect(within(outcome).getByText(/not confirmed or in use/)).toBeTruthy();
    // The manual rule keeps the whole result Unknown: never a false Safe.
    expect(within(panel).getByText("Simulated: Unknown")).toBeTruthy();
    expect(within(panel).getByText("Estimate from your own account rules, not the firm's verified terms.")).toBeTruthy();
    expect(holder.store.writes).toEqual(writes);
    expect(holder.store.snapshots).toHaveLength(0);
    expect(holder.store.assignments).toHaveLength(1);
  });

  it("an unstated currency leaves financial rules Unknown rather than assumed", async () => {
    await assignCatalogue();
    const user = userEvent.setup();
    renderAt(`/accounts/${A}/rulebook`);
    await startOwnDraft(user);
    await user.click(screen.getByRole("tab", { name: "Preview" }));
    const panel = screen.getByRole("tabpanel", { name: "Preview" });
    const target = await within(panel).findByRole("region", { name: "Profit Target" });
    expect(within(target).getByText("Unknown")).toBeTruthy();
    expect(within(target).getByText(/currency of the rule amounts isn't stated/)).toBeTruthy();
    expect(within(panel).getByText("Simulated: Unknown")).toBeTruthy();
  });

  it("does not borrow a catalogue phase: catalogue terms with no recorded phase stay Unknown", async () => {
    await assignCatalogue();
    const user = userEvent.setup();
    renderAt(`/accounts/${A}/rulebook/versions/${holder.store.verifiedVersionId}`);
    await user.click(await screen.findByRole("tab", { name: "Preview" }));
    const panel = screen.getByRole("tabpanel", { name: "Preview" });
    expect(await within(panel).findByText("Simulated: Unknown")).toBeTruthy();
    expect(within(panel).getAllByText(/programme phase or path isn't recorded/).length).toBeGreaterThan(0);
    expect(within(panel).getByText("The rules are not verified, so this is not a compliance result.")).toBeTruthy();
  });

  it("saves a calculation on request, shows it typed, and stops calling it current when its sources change", async () => {
    await assignCatalogue();
    holder.store.trades.set(A, [closedTrade(A, 1, "-500")]);
    const user = userEvent.setup();
    renderAt(`/accounts/${A}/rulebook`);
    await user.click(await screen.findByRole("tab", { name: "Calculation" }));
    const panel = screen.getByRole("tabpanel", { name: "Calculation" });
    expect(await within(panel).findByText("No calculation recorded")).toBeTruthy();
    const calc = within(panel).getByRole("region", { name: "Calculate now" });
    await stateEverything(user, calc);
    await user.click(within(calc).getByRole("button", { name: "Calculate and save" }));
    await waitFor(() => expect(holder.store.snapshots).toHaveLength(1));
    const saved = holder.store.snapshots[0]!;
    expect(saved.engineVersion).toBe("fundedflow-risk/1");
    // The catalogue terms aren't backed by verified currency claims in this store, so the engine says Unknown.
    expect(saved.status).toBe("unknown");
    expect(await within(panel).findByText("Sources unchanged for its cutoff")).toBeTruthy();
    expect(panel.querySelector('[aria-label="Calculation basis"]')).not.toBeNull();
    expect(within(panel).getAllByText("fundedflow-risk/1").length).toBeGreaterThan(0);
    // A trade correction (trade hooks invalidate the account's snapshot keys): the stored result is no longer current.
    holder.store.trades.set(A, [closedTrade(A, 1, "-700")]);
    await act(async () => { await client.invalidateQueries({ queryKey: ["fundedflow", "features", "account", A, "snapshots"] }); });
    expect(await within(panel).findByText("Sources changed since it was calculated")).toBeTruthy();
    // History is kept: recalculating adds a row.
    await user.click(within(calc).getByRole("button", { name: "Calculate and save" }));
    await waitFor(() => expect(holder.store.snapshots).toHaveLength(2));
    expect(holder.store.snapshots[0]).toEqual(saved);
    expect(holder.store.snapshots[1]!.inputsHash).not.toBe(saved.inputsHash);
  });

  it("your published account rules are confirmed by you and assigned from the day you choose", async () => {
    await assignCatalogue();
    holder.store.trades.set(A, [closedTrade(A, 1, "-500")]);
    const user = userEvent.setup();
    renderAt(`/accounts/${A}/rulebook`);
    await startOwnDraft(user);
    const dd = screen.getByRole("region", { name: "Max Drawdown" });
    await chooseOption(user, "Method", "Static", dd);
    await chooseOption(user, "Counts", "Realized P&L", dd);
    await chooseOption(user, /Trail lock: what the source says/, /None/, dd);
    await chooseOption(user, /^Support/, "Can be calculated", dd);
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await screen.findByText("All changes saved");
    await user.click(screen.getByRole("tab", { name: "Review and publish" }));
    await user.click(await screen.findByRole("checkbox", { name: /These are my rules for this account/ }));
    await user.click(screen.getByRole("button", { name: "Publish…" }));
    await user.click(within(await screen.findByRole("alertdialog", { name: /Publish/ })).getByRole("button", { name: "Publish" }));
    const assign = await screen.findByRole("dialog", { name: "Assign a rulebook version" });
    const day = within(assign).getByLabelText(/First trading day/);
    await pasteInto(user, day, "2026-10-20");
    await user.click(within(assign).getByRole("button", { name: /Assign from 2026-10-20/ }));
    await waitFor(() => expect(location).toBe(`/accounts/${A}/rulebook`));
    const mine = [...holder.store.versions.values()].find(v => v.rulebook.ownerAccountId === A)!;
    expect(mine.version.userConfirmedAt).not.toBeNull();
    expect(mine.rules.find(r => r.ruleKey === "max_drawdown")?.parameters).toEqual({ amount: { state: "value", value: "2000" }, method: "static", basis: "realized", lock: { state: "explicit_none" } });
    expect(holder.store.assignments.find(x => x.rulebookVersionId === mine.version.id)?.effectiveFrom).toBe("2026-10-20");
  });

  // Build 26.7: the second half of the journey above (as one test it took ~2.8 s). It starts from the rules that
  // test publishes and assigns, written through the same repository calls with the parameters the form saved.
  it("assigned account rules you published evaluate for real: recorded, not simulated, and never a false Safe", async () => {
    await assignCatalogue();
    holder.store.trades.set(A, [closedTrade(A, 1, "-500")]);
    const rules = catalogueRules().map(r => r.ruleKey === "max_drawdown"
      ? { ...r, supportStatus: "supported" as const, parameters: { amount: { state: "value", value: "2000" }, method: "static", basis: "realized", lock: { state: "explicit_none" } } } as RuleDefinitionInput
      : r);
    const draft = await holder.store.repository.rulebooks.createDraft({
      rulebookId: null, newRulebook: { providerId: PROVIDER, ownerAccountId: A, slug: "account-accta", displayName: "Eval A rules", description: null },
      supersedesVersionId: null, changeReason: "Copied from Example 50K v1", capturedAt: "2026-10-01T00:00:00.000Z", effectiveFrom: null, effectiveTo: null,
      rules, applicability: [],
    }, { actor: "local_user", reason: null });
    const published = await holder.store.repository.rulebooks.publish(draft.version.id, null, { expectedUpdatedAt: draft.version.updatedAt, context: { actor: "local_user", reason: null } });
    expect(published.version.userConfirmedAt).not.toBeNull();
    const open = holder.store.assignments.find(x => x.effectiveTo === null)!;
    await holder.store.repository.rulebooks.assign(
      { accountId: A, rulebookVersionId: draft.version.id, effectiveFrom: "2026-10-20", programmePhaseId: null, phasePathId: null, accountPhaseEventId: null },
      { expectedOpenAssignmentId: open.id, actor: "local_user", reason: null },
    );
    const user = userEvent.setup();
    renderAt(`/accounts/${A}/rulebook`);
    await user.click(await screen.findByRole("tab", { name: "Calculation" }));
    const panel = screen.getByRole("tabpanel", { name: "Calculation" });
    await stateEverything(user, within(panel).getByRole("region", { name: "Calculate now" }));
    await user.click(within(panel).getByRole("button", { name: "Calculate and save" }));
    await waitFor(() => expect(holder.store.snapshots).toHaveLength(1));
    const outcome = await within(panel).findByRole("region", { name: "Max Drawdown" });
    expect(within(outcome).getByText("Within limit")).toBeTruthy();
    expect(within(outcome).getByText("$1,500.00")).toBeTruthy();
    expect(within(panel).queryByText(/haven't been confirmed/)).toBeNull();
    // Recorded, not simulated; the manual rule keeps the overall status Unknown (never a false Safe).
    expect(within(panel).queryByText(/^Simulated/)).toBeNull();
    expect(holder.store.snapshots[0]!.status).toBe("unknown");
    expect(within(panel).getByText("Estimate from your own account rules, not the firm's verified terms.")).toBeTruthy();
  });
});
