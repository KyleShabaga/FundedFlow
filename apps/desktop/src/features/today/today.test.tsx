// @vitest-environment jsdom
// Build 21 journeys through the real Today page, Build 13 components and Build 14/19 hooks. The repository is the
// in-memory store (test-store.ts) following the Rust rules; snapshots carry the real engine's inputs hash so the
// unchanged-inputs check is genuine, with the verdict as a fixture. Native persistence is tested in Rust.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useParams } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Account } from "@fundedflow/domain";
import type { RuntimeState } from "../../app/RuntimeProvider";
import { ToastProvider } from "../../design-system";
import { ACTIVE_ACCOUNT_SETTING } from "../accounts/active-account";
import { makeAccount } from "../accounts/test-store";
import { closedTrade } from "../rulebooks/test-store";
import { TodayPage } from "./components/TodayPage";
import { createTodayStore, drawdownOutcome } from "./test-store";

const runtime = vi.hoisted(() => ({ state: { kind: "ready" } as unknown as RuntimeState, check: vi.fn() }));
const holder = vi.hoisted(() => ({ store: null as unknown as ReturnType<typeof createTodayStore> }));
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
  const l = useLocation();
  location = `${l.pathname}${l.search}`;
  return null;
}
function TradeStub() {
  return <p>Trade page {useParams().tradeId}</p>;
}
function renderToday() {
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/"]}>
          <Where />
          <Routes>
            <Route path="/" element={<TodayPage />} />
            <Route path="/journal" element={<p>Journal page</p>} />
            <Route path="/journal/trades/:tradeId" element={<TradeStub />} />
            <Route path="/accounts" element={<p>Accounts page</p>} />
            <Route path="/accounts/:accountId" element={<p>Account page</p>} />
            <Route path="/accounts/:accountId/rulebook" element={<p>Rulebook page</p>} />
            <Route path="/import" element={<p>Import page</p>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const A = "acct-a";
const B = "acct-b";
const NOW = "2026-10-21T18:00:00.000Z";
const CUTOFF = "2026-10-21T17:00:00.000Z";

function seed(accounts: Account[], active: string | null = A) {
  holder.store = createTodayStore(accounts);
  if (active) holder.store.settings.set(ACTIVE_ACCOUNT_SETTING, active);
}
async function assign(accountId: string) {
  await holder.store.repository.rulebooks.assign(
    { accountId, rulebookVersionId: holder.store.verifiedVersionId, effectiveFrom: "2026-10-19", programmePhaseId: null, phasePathId: null, accountPhaseEventId: null },
    { expectedOpenAssignmentId: null, actor: "local_user", reason: "Start" },
  );
}
/** A saved estimate for `accountId` at the cutoff, with the engine verdict replaced by a Safe drawdown fixture. */
async function saveSafe(accountId = A, headroom: string | null = "2125.5", status: "Safe" | "Stop" = "Safe") {
  const ids = (holder.store.trades.get(accountId) ?? []).map(t => t.id);
  return holder.store.saveEstimate(accountId, CUTOFF, r => ({
    ...r, status, reasons: status === "Stop" ? ["loss_threshold_breached"] : [], balance: "52125.5",
    rules: [drawdownOutcome({ headroom, sourceReferences: ids, ...(status === "Stop" ? { state: "breached", reasonCode: "loss_threshold_breached" } : {}) })],
  }));
}
const riskSection = () => screen.getByRole("region", { name: "Risk estimate" });
const headlineText = async () => (await within(riskSection()).findByRole("status")).textContent ?? "";

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(NOW), shouldAdvanceTime: true, toFake: ["Date"] });
  runtime.state = { kind: "ready", status: { state: "ready", stage: "ready", schemaVersion: 17, supportedSchemaVersion: 17, created: false, failure: null } } as unknown as RuntimeState;
  runtime.check.mockReset().mockResolvedValue(undefined);
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  seed([makeAccount({ id: A, name: "Eval A", propFirm: "Example" }), makeAccount({ id: B, name: "Eval B" })]);
  holder.store.trades.set(A, [closedTrade(A, 1, "125.5", "2026-10-21"), closedTrade(A, 2, "-40", "2026-10-20")]);
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("empty and unset states", () => {
  it("with no account, asks for one and shows no figures", async () => {
    seed([], null);
    const user = userEvent.setup();
    renderToday();
    await screen.findByText("Add an account to see today's risk");
    expect(screen.queryByText(/\$/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Add account" }));
    expect(location).toBe("/accounts");
  });

  it("with no account chosen, lists the active accounts to choose from", async () => {
    seed([makeAccount({ id: A, name: "Eval A" }), makeAccount({ id: B, name: "Eval B" })], null);
    renderToday();
    await screen.findByText("Choose an account");
    const overview = screen.getByRole("region", { name: "Active accounts" });
    expect(within(overview).getAllByRole("article")).toHaveLength(2);
    expect(within(overview).queryByText(/all clear/i)).toBeNull();
  });
});

describe("the selected account", () => {
  it("with nothing calculated is Unknown, with no Safe and no figures, and freshness says what is missing", async () => {
    renderToday();
    await waitFor(async () => expect(await headlineText()).toContain("Unknown"));
    expect(within(riskSection()).getByText(/until then every figure is Unknown/)).toBeTruthy();
    expect(within(riskSection()).queryByText(/Safe \(estimate\)/)).toBeNull();
    expect(within(riskSection()).queryByRole("list", { name: "Estimated figures" })).toBeNull();
    const fresh = screen.getByRole("region", { name: "How fresh this is" });
    await within(fresh).findByText("No imports yet");
    expect(within(fresh).getByText("Never")).toBeTruthy();
    expect(within(fresh).getByText("None recorded")).toBeTruthy();
    await within(fresh).findByText("2026-10-21");
    // Setup is named, never treated as complete.
    expect(screen.getByText("Setup needed for limits")).toBeTruthy();
  });

  it("shows a current estimate with its figures; each opens its explanation and its trades link to the same account's Journal", async () => {
    await assign(A);
    await saveSafe();
    const user = userEvent.setup();
    renderToday();
    await waitFor(async () => expect(await headlineText()).toContain("Safe (estimate)"));
    const figures = within(riskSection()).getByRole("list", { name: "Estimated figures" });
    const headroom = within(figures).getByText("Drawdown headroom").closest(".ds-metric") as HTMLElement;
    expect(within(headroom).getByText("$2,125.50")).toBeTruthy();
    expect(within(headroom).queryByText("Not current")).toBeNull();
    // Open P&L is never inferred from closed trades.
    const equity = within(figures).getByText("Open P&L and live equity").closest(".ds-metric") as HTMLElement;
    expect(within(equity).getByText("Not supported")).toBeTruthy();

    await user.click(within(headroom).getByRole("button", { name: "How drawdown headroom is calculated" }));
    const drawer = await screen.findByRole("dialog", { name: /Drawdown headroom: how it's calculated/ });
    expect(within(drawer).getByText("Current estimate")).toBeTruthy();
    expect(within(drawer).getByText(/headroom = comparable balance - floor/)).toBeTruthy();
    expect(within(drawer).getByText("fundedflow-risk/1")).toBeTruthy();
    expect(within(drawer).getByText(/Example 50K v1/)).toBeTruthy();
    expect(within(drawer).getAllByText(/Verify with your firm's dashboard/).length).toBeGreaterThan(0);
    const trades = within(drawer).getAllByRole("link", { name: /ES long/ });
    expect(trades).toHaveLength(2);
    await user.click(trades[0]!);
    expect(location).toBe(`/journal/trades/${A}-t1`);
    expect(screen.getByText(`Trade page ${A}-t1`)).toBeTruthy();
  });

  it("a known zero headroom shows $0.00, distinct from Unknown", async () => {
    await assign(A);
    await saveSafe(A, "0");
    renderToday();
    const figures = await within(await screen.findByRole("region", { name: "Risk estimate" })).findByRole("list", { name: "Estimated figures" });
    const headroom = within(figures).getByText("Drawdown headroom").closest(".ds-metric") as HTMLElement;
    expect(within(headroom).getByText("$0.00")).toBeTruthy();
    expect(within(headroom).queryByText("Unknown")).toBeNull();
    // Daily loss has no rule here: shown as such, never $0.00.
    const daily = within(figures).getByText("Daily loss room left").closest(".ds-metric") as HTMLElement;
    expect(within(daily).getByText("No rule")).toBeTruthy();
    expect(within(daily).queryByText("$0.00")).toBeNull();
  });

  it("a trade dated after the cutoff makes the old Safe not current: Unknown, figures marked Not current", async () => {
    await assign(A);
    await saveSafe();
    const user = userEvent.setup();
    renderToday();
    await waitFor(async () => expect(await headlineText()).toContain("Safe (estimate)"));
    holder.store.trades.get(A)!.push({ ...closedTrade(A, 7, "-900", "2026-10-21"), entryAt: "2026-10-21T17:20:00.000Z", exitAt: "2026-10-21T17:40:00.000Z" });
    await act(async () => { await client.invalidateQueries(); });
    await user.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(async () => expect(await headlineText()).toMatch(/^Unknown/));
    expect(within(riskSection()).getByText(/Records dated after its cutoff exist/)).toBeTruthy();
    expect(within(riskSection()).getByText(/Last saved estimate: Safe \(estimate\) for trading day 2026-10-21/)).toBeTruthy();
    expect(within(riskSection()).getAllByText("Not current").length).toBeGreaterThan(0);
  });

  it("a corrected, deleted or restored trade before the cutoff marks the estimate changed, and restoring the same data makes it current again", async () => {
    await assign(A);
    await saveSafe();
    renderToday();
    await waitFor(async () => expect(await headlineText()).toContain("Safe (estimate)"));
    const list = holder.store.trades.get(A)!;
    const removed = list.splice(1, 1)[0]!;
    await act(async () => { await client.invalidateQueries(); });
    await waitFor(async () => expect(await headlineText()).toMatch(/^Unknown/));
    expect(within(riskSection()).getByText(/have changed since it was calculated/)).toBeTruthy();
    list.push(removed);
    await act(async () => { await client.invalidateQueries(); });
    await waitFor(async () => expect(await headlineText()).toContain("Safe (estimate)"));
    list[0] = { ...list[0]!, realizedPnl: "99", grossPnl: "99", reportedPnl: "99", updatedAt: "2026-10-21T17:50:00.000Z" };
    await act(async () => { await client.invalidateQueries(); });
    await waitFor(async () => expect(await headlineText()).toMatch(/^Unknown/));
  });

  it("the next trading day makes yesterday's Safe not current; a recorded Stop stays Stop", async () => {
    await assign(A);
    await saveSafe(A, "0", "Stop");
    vi.setSystemTime(new Date("2026-10-22T18:00:00.000Z"));
    renderToday();
    await waitFor(async () => expect(await headlineText()).toContain("Stop (last saved, not current)"));
    expect(within(riskSection()).getByText(/calculated for an earlier trading day/)).toBeTruthy();
    const fresh = screen.getByRole("region", { name: "How fresh this is" });
    await within(fresh).findByText("Last estimate is for 2026-10-21");
  });

  it("a failed read of the saved calculation never leaves a Safe on screen", async () => {
    await assign(A);
    await saveSafe();
    renderToday();
    await waitFor(async () => expect(await headlineText()).toContain("Safe (estimate)"));
    holder.store.failing.add("latest");
    await act(async () => { await client.invalidateQueries(); });
    await waitFor(async () => expect(await headlineText()).toMatch(/^Unknown/));
    expect(screen.getByText("The last estimate couldn't be read")).toBeTruthy();
    expect(within(riskSection()).queryByText(/Safe \(estimate\)/)).toBeNull();
    holder.store.failing.delete("latest");
    await act(async () => { await client.invalidateQueries(); });
    await waitFor(async () => expect(await headlineText()).toContain("Safe (estimate)"));
  });

  it("a failed check of the sources is Unknown, not the saved status", async () => {
    await assign(A);
    await saveSafe();
    holder.store.failing.add("inputs");
    renderToday();
    await waitFor(async () => expect(await headlineText()).toMatch(/^Unknown/));
    expect(within(riskSection()).getByText(/Its sources couldn't be checked again/)).toBeTruthy();
  });
});

describe("account switching and attempts", () => {
  it("switching to another account never shows the previous account's estimate", async () => {
    await assign(A);
    await saveSafe();
    const user = userEvent.setup();
    renderToday();
    await waitFor(async () => expect(await headlineText()).toContain("Safe (estimate)"));
    const overview = screen.getByRole("region", { name: "Active accounts" });
    await user.click(within(overview).getByRole("button", { name: "Show Eval B" }));
    await screen.findByRole("heading", { name: "Eval B", level: 2 });
    await waitFor(async () => expect(await headlineText()).toContain("Unknown"));
    expect(within(riskSection()).queryByText(/Safe \(estimate\)/)).toBeNull();
    expect(within(riskSection()).queryByText("$2,125.50")).toBeNull();
    expect(holder.store.settings.get(ACTIVE_ACCOUNT_SETTING)).toBe(B);
    // A's own card still shows A's own estimate, labelled as A's.
    const cardA = within(screen.getByRole("region", { name: "Active accounts" })).getByRole("article", { name: "Example · Eval A" });
    expect(within(cardA).getByText("Safe (estimate)")).toBeTruthy();
  });

  it("while the next account's calculation is still loading, nothing of the previous account is shown", async () => {
    await assign(A);
    await saveSafe();
    let release: () => void = () => {};
    const latest = holder.store.repository.snapshots.latest;
    holder.store.repository.snapshots.latest = async (accountId: string) => {
      if (accountId === B) await new Promise<void>(resolve => { release = resolve; });
      return latest(accountId);
    };
    const user = userEvent.setup();
    renderToday();
    await waitFor(async () => expect(await headlineText()).toContain("Safe (estimate)"));
    await user.click(within(screen.getByRole("region", { name: "Active accounts" })).getByRole("button", { name: "Show Eval B" }));
    await screen.findByRole("heading", { name: "Eval B", level: 2 });
    expect(await headlineText()).toContain("Checking");
    expect(within(riskSection()).queryByText(/Safe \(estimate\)/)).toBeNull();
    expect(within(riskSection()).queryByRole("list", { name: "Estimated figures" })).toBeNull();
    await act(async () => { release(); });
    await waitFor(async () => expect(await headlineText()).toContain("Unknown"));
  });

  it("a failed attempt is history; its reset successor starts Unknown with nothing carried over", async () => {
    seed([
      makeAccount({ id: A, name: "Eval A", status: "failed", successorAccountId: "acct-s" }),
      makeAccount({ id: "acct-s", name: "Eval A (2)", predecessorAccountId: A }),
    ], A);
    holder.store.trades.set(A, [closedTrade(A, 1, "125.5", "2026-10-21")]);
    await assign(A);
    await saveSafe();
    const user = userEvent.setup();
    renderToday();
    await screen.findByText("Not in today's risk", { selector: "span" });
    expect(screen.queryByText(/Safe \(estimate\)/)).toBeNull();
    expect(screen.getByText(/a failure or reset recorded for it is not undone/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Show the new attempt (Eval A (2))" }));
    await screen.findByText("New attempt after a reset");
    await waitFor(async () => expect(await headlineText()).toContain("Unknown"));
    expect(screen.queryByText(/Safe \(estimate\)/)).toBeNull();
    expect(screen.queryByText("$2,125.50")).toBeNull();
    expect(screen.getByRole("link", { name: "Earlier attempt (history only)" }).getAttribute("href")).toBe(`/accounts/${A}`);
    const history = screen.getByText(/Not in today's risk \(1\)/);
    expect(history).toBeTruthy();
  });
});

describe("freshness, imports and checkpoints", () => {
  it("names a duplicate-only import and keeps import, checkpoint and calculation times apart", async () => {
    await assign(A);
    await saveSafe();
    holder.store.imports.set(A, [{
      id: "batch-1", accountId: A, fileName: "fills.csv", fileSha256: "a".repeat(64), fileSize: 10, sourceFormat: "performance", status: "committed",
      rowCount: 3, importedCount: 0, skippedCount: 3, duplicateCount: 3, failedCount: 0, warningCount: 0, errorSummary: null,
      createdAt: "2026-10-21T17:30:00.000Z", completedAt: "2026-10-21T17:30:01.000Z",
    } as never]);
    renderToday();
    const fresh = await screen.findByRole("region", { name: "How fresh this is" });
    await within(fresh).findByText("No new trades (3 duplicates)");
    expect(within(fresh).getByText(/fills\.csv/)).toBeTruthy();
    await within(fresh).findByText(/cutoff Oct 21, 2026, 13:00 EDT/);
    expect(fresh.textContent).toContain("Stated complete for the last estimate");
  });

  // Build 26.7: one journey as two tests (it took ~2 s and timed out at 5 s under CPU contention). The second
  // starts from the checkpoint the first records, written through the same repository call. Values are pasted:
  // per-keystroke input behaviour is the design system's tests' job, not this flow's.
  const enter = async (user: ReturnType<typeof userEvent.setup>, field: HTMLElement, text: string) => {
    await user.clear(field);
    await user.click(field);
    await user.paste(text);
  };
  function seedNoOpening() {
    holder.store = createTodayStore([makeAccount({ id: A, name: "Eval A" })], { syntheticOpening: false });
    holder.store.settings.set(ACTIVE_ACCOUNT_SETTING, A);
    holder.store.trades.set(A, [closedTrade(A, 1, "125.5", "2026-10-21")]);
  }

  it("records a confirmed opening balance, refusing a missing amount and source, without adjusting anything", async () => {
    seedNoOpening();
    const user = userEvent.setup();
    renderToday();
    await user.click(await screen.findByRole("button", { name: "Verify balance" }));
    const dialog = await screen.findByRole("dialog", { name: "Verify balance against your firm's dashboard" });
    expect(within(dialog).getByRole("radio", { name: /Opening balance/ })).toHaveProperty("checked", true);
    // Validation: amount and source are required; nothing is written.
    await user.click(within(dialog).getByRole("button", { name: "Save checkpoint" }));
    expect((await within(dialog).findAllByText(/Enter the amount exactly/)).length).toBeGreaterThan(0);
    expect(holder.store.observations).toHaveLength(0);

    await enter(user, within(dialog).getByRole("textbox", { name: /Amount/ }), "50000");
    await enter(user, within(dialog).getByLabelText(/When you read it/), "2026-10-20T08:00");
    await enter(user, within(dialog).getByRole("textbox", { name: /Where you read it/ }), "Firm dashboard");
    await user.click(within(dialog).getByRole("checkbox", { name: /confirm it/ }));
    await user.click(within(dialog).getByRole("button", { name: "Save checkpoint" }));
    await within(dialog).findByText("Checkpoint saved");
    expect(holder.store.observations[0]).toMatchObject({ kind: "opening_balance", value: "50000", observedAt: "2026-10-20T12:00:00.000Z", confirmation: "user_confirmed", confidence: "user_reported" });
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    const fresh = screen.getByRole("region", { name: "How fresh this is" });
    await within(fresh).findByText("Confirmed by you");
    expect(holder.store.trades.get(A)).toHaveLength(1);
  });

  it("records a current balance against the confirmed opening one, then compares them exactly without adjusting anything", async () => {
    seedNoOpening();
    // The opening checkpoint the previous test records through the dialog.
    await holder.store.repository.evidence.create({
      accountId: A, kind: "opening_balance", value: "50000", currency: "USD", basis: "balance", observedAt: "2026-10-20T12:00:00.000Z",
      sourceCategory: "firm_dashboard", sourceReference: "Firm dashboard", confirmation: "user_confirmed", confidence: "user_reported",
      validUntil: null, actor: "local_user", note: null,
    } as never);
    const user = userEvent.setup();
    renderToday();
    await within(await screen.findByRole("region", { name: "How fresh this is" })).findByText("Confirmed by you");
    await user.click(screen.getByRole("button", { name: "Verify balance" }));
    const dialog = await screen.findByRole("dialog", { name: "Verify balance against your firm's dashboard" });
    expect(within(dialog).getByRole("radio", { name: /Current balance/ })).toHaveProperty("checked", true);
    await enter(user, within(dialog).getByRole("textbox", { name: /Amount/ }), "50125.5");
    await enter(user, within(dialog).getByRole("textbox", { name: /Where you read it/ }), "Firm dashboard");
    await user.click(within(dialog).getByRole("checkbox", { name: /confirm it/ }));
    await user.click(within(dialog).getByRole("button", { name: "Save checkpoint" }));
    await within(dialog).findByText("Compare with your records");
    await user.click(within(dialog).getByRole("button", { name: "Compare" }));
    const outcome = await within(dialog).findByRole("status", { name: /Comparison/ });
    // The trader didn't state completeness, so Rust reports what's missing instead of a verdict.
    expect(within(outcome).getByText("incomplete")).toBeTruthy();
    expect(within(outcome).getByText(/Nothing was changed or balanced/)).toBeTruthy();
    expect(holder.store.reconciliations).toHaveLength(1);
    expect(holder.store.trades.get(A)).toHaveLength(1);
  });
});

describe("actions and accessibility", () => {
  it("connects every action to a real route, and Review session opens the selected account's current trading day", async () => {
    const user = userEvent.setup();
    renderToday();
    const actions = await screen.findByRole("region", { name: "Next steps" });
    const review = await within(actions).findByRole("button", { name: "Review session" });
    await waitFor(() => expect(review.getAttribute("aria-disabled")).not.toBe("true"));
    await user.click(review);
    // The day is Rust's current trading day for this account (the store's), never the browser's date.
    expect(location).toBe(`/journal/days/2026-10-21?account=${A}`);
  });

  it("links Review rulebook to the account's rulebook", async () => {
    const user = userEvent.setup();
    renderToday();
    const actions = await screen.findByRole("region", { name: "Next steps" });
    await user.click(within(actions).getByRole("button", { name: "Review rulebook" }));
    expect(location).toBe(`/accounts/${A}/rulebook`);
  });

  it("offers to continue today's draft review, and opening it never touches the saved estimate", async () => {
    await holder.store.repository.dailyReviews.save({
      accountId: A, tradingDay: "2026-10-21", expectedRevision: null, plan: { focus: "A+ only" }, reflection: {}, noTradeDay: false, answers: [], action: "save",
    });
    const user = userEvent.setup();
    renderToday();
    const actions = await screen.findByRole("region", { name: "Next steps" });
    const review = await within(actions).findByRole("button", { name: "Continue review" });
    const before = { writes: holder.store.writes.length, snapshots: holder.store.snapshots.length };
    await user.click(review);
    expect(location).toBe(`/journal/days/2026-10-21?account=${A}`);
    expect({ writes: holder.store.writes.length, snapshots: holder.store.snapshots.length }).toEqual(before);
  });

  it("keeps Review session unavailable, with its reason, while the trading day can't be read", async () => {
    holder.store.daily.failing.add("list");
    renderToday();
    const actions = await screen.findByRole("region", { name: "Next steps" });
    const review = within(actions).getByRole("button", { name: "Review session" });
    await waitFor(() => expect(review.getAttribute("aria-disabled")).toBe("true"));
    await waitFor(() => expect(review.getAttribute("title")).toMatch(/couldn.t be read/));
  });

  it.each([
    ["Import CSV", "/import"],
    ["View trades", "/journal?view=log"],
    ["Add account", "/accounts"],
  ])("%s goes to %s", async (name, path) => {
    const user = userEvent.setup();
    renderToday();
    const actions = await screen.findByRole("region", { name: "Next steps" });
    await user.click(within(actions).getByRole("button", { name }));
    expect(location).toBe(path);
  });

  it("explanations open and close from the keyboard and return focus", async () => {
    await assign(A);
    await saveSafe();
    const user = userEvent.setup();
    renderToday();
    const figures = await within(await screen.findByRole("region", { name: "Risk estimate" })).findByRole("list", { name: "Estimated figures" });
    const explain = within(figures).getByRole("button", { name: "How drawdown headroom is calculated" });
    explain.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("dialog", { name: /Drawdown headroom/ });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(explain);
  });

  it("the status is text and an icon, not colour alone", async () => {
    await assign(A);
    await saveSafe();
    renderToday();
    await waitFor(async () => expect(await headlineText()).toContain("Safe (estimate)"));
    const status = within(riskSection()).getByText("Safe (estimate)").closest(".ds-status") as HTMLElement;
    expect(status.querySelector("svg")).toBeTruthy();
    expect(screen.getAllByText(/Estimate\. Verify with your firm's dashboard\./).length).toBeGreaterThan(0);
  });
});
