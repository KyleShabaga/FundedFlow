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
import { featureKeys } from "../shared/query-keys";
import { TodayPage } from "./components/TodayPage";
import { TODAY_ACCOUNTS_VIEW_SETTING } from "./components/AccountsOverview";
import { SESSION_SKIPS_SETTING } from "./view-models/session-prompt";
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
  runtime.state = { kind: "ready", status: { state: "ready", stage: "ready", schemaVersion: 17, supportedSchemaVersion: 17, created: false, failure: null, cleanup: "clear" } } as unknown as RuntimeState;
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
    // P0-D21: the general estimate note is the page's last element, once, with its wording intact; Check again stays
    // above the freshness panel, and figure-specific states stay in their sections.
    const page = fresh.closest(".td-page")!;
    const note = screen.getByText(/Today reads only what is saved on this computer/).closest("footer")!;
    expect(page.lastElementChild).toBe(note);
    expect(note.textContent).toBe("Estimate. Verify with your firm's dashboard. Today reads only what is saved on this computer; it is not connected to your broker or firm.");
    expect(screen.getAllByText(/Today reads only what is saved on this computer/)).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Check again" }).compareDocumentPosition(fresh) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
    // P0-02: the current result and its sources are read together natively, so a failed source read fails that
    // read as a whole: nothing from it is shown, never the saved Safe.
    expect(within(riskSection()).queryByText(/Safe \(estimate\)/)).toBeNull();
    expect(screen.getByText("The last estimate couldn't be read")).toBeTruthy();
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

describe("P0-02: the current result", () => {
  it("a trade recorded after the Safe was promoted makes it not current, so the Safe is not shown", async () => {
    await assign(A);
    await saveSafe();
    expect(holder.store.promotions).toHaveLength(1);
    renderToday();
    await waitFor(async () => expect(await headlineText()).toContain("Safe (estimate)"));
    holder.store.trades.set(A, [...holder.store.trades.get(A)!, closedTrade(A, 3, "-900", "2026-10-21")]);
    await act(async () => { await client.invalidateQueries(); });
    await waitFor(async () => expect(await headlineText()).toMatch(/^Unknown/));
    // The old Safe is only listed as labelled history, never as the headline.
    expect(await headlineText()).toMatch(/^Unknown(?!.*Stop)/);
    expect(within(riskSection()).getByText(/Last saved estimate: Safe \(estimate\)/)).toBeTruthy();
    expect(within(riskSection()).getByText(/Trades, checkpoints, ledger or rules it used have changed/)).toBeTruthy();
  });

  it("a cached current answer is re-verified when Today checks again, never trusted as newly verified", async () => {
    await assign(A);
    await saveSafe();
    const user = userEvent.setup();
    renderToday();
    await waitFor(async () => expect(await headlineText()).toContain("Safe (estimate)"));
    // Another window records a trade; nothing here invalidated the cached answer.
    holder.store.trades.set(A, [...holder.store.trades.get(A)!, closedTrade(A, 3, "-900", "2026-10-21")]);
    vi.setSystemTime(new Date(Date.parse(NOW) + 2 * 60_000));
    await user.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(async () => expect(await headlineText()).toMatch(/^Unknown/));
    expect(await headlineText()).toMatch(/^Unknown(?!.*Stop)/);
  });

  it("history stored before promotion existed is shown as not current; a recorded Stop stays Stop", async () => {
    await assign(A);
    const ids = (holder.store.trades.get(A) ?? []).map(t => t.id);
    await holder.store.saveEstimate(A, CUTOFF, r => ({ ...r, status: "Safe", reasons: [], balance: "52125.5",
      rules: [drawdownOutcome({ headroom: "2125.5", sourceReferences: ids })] }), {}, { historyOnly: true });
    expect(holder.store.promotions).toHaveLength(0);
    const first = renderToday();
    await waitFor(async () => expect(await headlineText()).toMatch(/^Unknown/));
    expect(within(riskSection()).getByText(/stored without being confirmed as the current result/)).toBeTruthy();
    expect(await headlineText()).toMatch(/^Unknown(?!.*Stop)/);
    first.unmount();
    client.clear();
    await holder.store.saveEstimate(A, CUTOFF, r => ({ ...r, status: "Stop", reasons: ["loss_threshold_breached"], balance: "52125.5",
      rules: [drawdownOutcome({ headroom: "0", sourceReferences: ids, state: "breached", reasonCode: "loss_threshold_breached" })] }), {}, { historyOnly: true });
    renderToday();
    await waitFor(async () => expect(await headlineText()).toContain("Stop (last saved, not current)"));
  });

  it("a promoted Stop is carried into the next calculation's prior breaches", async () => {
    await assign(A);
    await saveSafe(A, "0", "Stop");
    const captured = await (holder.store.repository.evidence as unknown as { capture: (q: unknown) => Promise<{ priorBreaches: unknown[] }> })
      .capture({ accountId: A, asOf: NOW, coverage: { baseline: "available", eodHistory: "available", closedTrades: "available", fees: "available", ledger: "available",
        openPositions: "unsupported", intradayHistory: "unsupported", sourceReference: "test" } });
    expect(captured.priorBreaches).toHaveLength(1);
    renderToday();
    await waitFor(async () => expect(await headlineText()).toContain("Stop"));
  });
});

describe("session plan / review prompt (P0-D27)", () => {
  const savePlan = (accountId: string, extra: Record<string, unknown> = {}) => holder.store.repository.dailyReviews.save({
    accountId, tradingDay: "2026-10-21", expectedRevision: null, plan: { focus: "A+ setups only" }, reflection: {}, noTradeDay: false, answers: [], action: "save", ...extra,
  });
  /** What a manual trade write or a committed import does (trades and imports hooks): the day's queries are read again. */
  const tradesChanged = (accountId: string) => act(async () => { await client.invalidateQueries({ queryKey: featureKeys.dailyReviewsRoot(accountId) }); });

  it("comes first on the page, and with no trade on the current day offers the before-session plan for that account and day", async () => {
    holder.store.trades.set(A, [closedTrade(A, 2, "-40", "2026-10-20")]);
    const user = userEvent.setup();
    renderToday();
    const card = await screen.findByRole("region", { name: "Before-session plan" });
    expect(card.parentElement!.firstElementChild).toBe(card);
    expect(within(card).getByText("Example · Eval A · trading day Wed Oct 21")).toBeTruthy();
    expect(within(card).getByText(/No trades are recorded for this trading day yet/)).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Skip for now" })).toBeTruthy();
    const writes = holder.store.writes.length;
    await user.click(within(card).getByRole("button", { name: "Start plan" }));
    expect(location).toBe(`/journal/days/2026-10-21?account=${A}`);
    expect(holder.store.writes.length).toBe(writes);
  });

  it("a trade on the current day offers the after-session review, and keeps the saved plan reachable", async () => {
    await savePlan(A);
    const user = userEvent.setup();
    renderToday();
    const card = await screen.findByRole("region", { name: "After-session review" });
    expect(within(card).getByText(/^1 trade recorded for this trading day\. .*doesn't end the session or complete the review\.$/)).toBeTruthy();
    expect(within(card).queryByText("Completed")).toBeNull();
    await user.click(within(card).getByRole("button", { name: "View plan" }));
    expect(location).toBe(`/journal/days/2026-10-21?account=${A}`);
    expect((await holder.store.repository.dailyReviews.getDay(A, "2026-10-21")).review!.plan.focus).toBe("A+ setups only");
  });

  it("switches from plan to review when a trade for the day is recorded, and only then", async () => {
    holder.store.trades.set(A, []);
    await savePlan(A);
    renderToday();
    const card = await screen.findByRole("region", { name: "Before-session plan" });
    expect(within(card).getByText("Plan saved")).toBeTruthy();
    expect(within(card).getByRole("button", { name: "View or edit plan" })).toBeTruthy();
    // A historical-only import leaves the day as it was (a duplicate-only, failed or cancelled one adds no trade at all).
    holder.store.trades.set(A, [closedTrade(A, 2, "-40", "2026-10-20")]);
    await tradesChanged(A);
    expect(await screen.findByRole("region", { name: "Before-session plan" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "After-session review" })).toBeNull();
    // A trade attributed to the current trading day does.
    holder.store.trades.set(A, [closedTrade(A, 2, "-40", "2026-10-20"), closedTrade(A, 3, "60", "2026-10-21")]);
    await tradesChanged(A);
    const review = await screen.findByRole("region", { name: "After-session review" });
    expect(within(review).getByRole("button", { name: "Start after-session review" })).toBeTruthy();
    // Removing it again recomputes the stage; the plan is kept.
    holder.store.trades.set(A, [closedTrade(A, 2, "-40", "2026-10-20")]);
    await tradesChanged(A);
    const back = await screen.findByRole("region", { name: "Before-session plan" });
    expect(within(back).getByText("Plan saved")).toBeTruthy();
  });

  it("continues a started review and shows a completed one as completed, from the saved status alone", async () => {
    await savePlan(A, { reflection: { wentWell: "Waited for the setup" } });
    renderToday();
    const draft = await screen.findByRole("region", { name: "After-session review" });
    expect(within(draft).getByText("Draft")).toBeTruthy();
    expect(within(draft).getByRole("button", { name: "Continue after-session review" })).toBeTruthy();
    const saved = (await holder.store.repository.dailyReviews.getDay(A, "2026-10-21")).review!;
    await holder.store.repository.dailyReviews.save({
      accountId: A, tradingDay: "2026-10-21", expectedRevision: saved.revision, plan: { focus: "A+ setups only" }, reflection: { wentWell: "Waited for the setup" },
      noTradeDay: false, answers: [], action: "complete",
    });
    await tradesChanged(A);
    const done = await screen.findByRole("region", { name: "Daily review" });
    expect(within(done).getByText("Completed")).toBeTruthy();
    expect(within(done).getByRole("button", { name: "Open completed review" })).toBeTruthy();
    expect(within(done).queryByRole("button", { name: "Skip for now" })).toBeNull();
  });

  it("skips a stage for this account and day only, never as done, and brings it back on request", async () => {
    holder.store.trades.set(A, []);
    const user = userEvent.setup();
    renderToday();
    await user.click(within(await screen.findByRole("region", { name: "Before-session plan" })).getByRole("button", { name: "Skip for now" }));
    const compact = await screen.findByRole("region", { name: "Session plan / review" });
    expect(within(compact).getByText("Before-session plan skipped for Example · Eval A · trading day Wed Oct 21.")).toBeTruthy();
    await waitFor(() => expect(holder.store.settings.get(SESSION_SKIPS_SETTING)).toEqual([{ accountId: A, tradingDay: "2026-10-21", stage: "plan" }]));
    expect((await holder.store.repository.dailyReviews.getDay(A, "2026-10-21")).review).toBeNull();
    // Skipping the plan doesn't skip the review: a trade brings the review prompt.
    holder.store.trades.set(A, [closedTrade(A, 3, "60", "2026-10-21")]);
    await tradesChanged(A);
    await user.click(within(await screen.findByRole("region", { name: "After-session review" })).getByRole("button", { name: "Skip for now" }));
    await waitFor(() => expect(holder.store.settings.get(SESSION_SKIPS_SETTING)).toHaveLength(2));
    await user.click(within(await screen.findByRole("region", { name: "Session plan / review" })).getByRole("button", { name: "Session plan / review" }));
    expect(await screen.findByRole("region", { name: "After-session review" })).toBeTruthy();
    await waitFor(() => expect(holder.store.settings.get(SESSION_SKIPS_SETTING)).toEqual([{ accountId: A, tradingDay: "2026-10-21", stage: "plan" }]));
  });

  it("a skip on one account leaves another account's prompt, and a switch never shows the previous account's", async () => {
    holder.store.settings.set(SESSION_SKIPS_SETTING, [{ accountId: A, tradingDay: "2026-10-21", stage: "review" }]);
    let release: () => void = () => {};
    const getDay = holder.store.repository.dailyReviews.getDay;
    holder.store.repository.dailyReviews.getDay = async (accountId: string, day: string) => {
      if (accountId === B) await new Promise<void>(resolve => { release = resolve; });
      return getDay(accountId, day);
    };
    const user = userEvent.setup();
    renderToday();
    expect(await screen.findByText(/After-session review skipped for Example · Eval A/)).toBeTruthy();
    await user.click(within(screen.getByRole("region", { name: "Active accounts" })).getByRole("button", { name: "Show Eval B" }));
    await screen.findByRole("heading", { name: "Eval B", level: 2 });
    expect(await screen.findByText("Checking today's trading day…")).toBeTruthy();
    expect(screen.queryByText(/Eval A · trading day/)).toBeNull();
    await act(async () => { release(); });
    const card = await screen.findByRole("region", { name: "Before-session plan" });
    expect(within(card).getByText("Eval B · trading day Wed Oct 21")).toBeTruthy();
  });

  it("while the day is read it says so, and an unreadable day shows no prompt rather than guessing", async () => {
    let fail: () => void = () => {};
    const gate = new Promise<void>(resolve => { fail = resolve; });
    holder.store.repository.dailyReviews.getDay = async () => { await gate; throw new Error("getDay failed"); };
    renderToday();
    expect(await screen.findByText("Checking today's trading day…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start plan" })).toBeNull();
    await act(async () => { fail(); });
    expect(await screen.findByText("Session plan / review unavailable")).toBeTruthy();
    expect(screen.queryByRole("region", { name: /Before-session plan|After-session review/ })).toBeNull();
  });

  it("a new trading day gets its own prompt when Today checks again; the previous day's skip doesn't carry over", async () => {
    holder.store.settings.set(SESSION_SKIPS_SETTING, [{ accountId: A, tradingDay: "2026-10-21", stage: "review" }]);
    const user = userEvent.setup();
    renderToday();
    expect(await screen.findByText(/After-session review skipped for Example · Eval A · trading day Wed Oct 21/)).toBeTruthy();
    holder.store.day.current = "2026-10-22";
    vi.setSystemTime(new Date("2026-10-22T14:00:00.000Z"));
    await user.click(screen.getByRole("button", { name: "Check again" }));
    const card = await screen.findByRole("region", { name: "Before-session plan" });
    expect(within(card).getByText("Example · Eval A · trading day Thu Oct 22")).toBeTruthy();
  });

  it("is not shown when no account is chosen", async () => {
    seed([makeAccount({ id: A, name: "Eval A" }), makeAccount({ id: B, name: "Eval B" })], null);
    renderToday();
    await screen.findByText("Choose an account");
    expect(screen.queryByText("Checking today's trading day…")).toBeNull();
    expect(screen.queryByRole("region", { name: /Before-session plan|After-session review|Session plan/ })).toBeNull();
  });
});

describe("Cards / List (P0-D23)", () => {
  const overview = () => screen.getByRole("region", { name: "Active accounts" });
  const layout = () => within(overview()).getByRole("group", { name: "Active accounts layout" });
  const entries = () => within(overview()).getAllByRole("article");
  const isList = () => entries().every(e => e.classList.contains("td-row") && e.closest("ul")!.classList.contains("td-rows"));

  it("defaults to Cards, and List shows the same accounts, in the same order, with the same facts and actions", async () => {
    await assign(A);
    await saveSafe();
    const user = userEvent.setup();
    renderToday();
    await waitFor(async () => expect(await headlineText()).toContain("Safe (estimate)"));
    expect(within(layout()).getByRole("button", { name: "Cards" }).getAttribute("aria-pressed")).toBe("true");
    expect(entries().some(e => e.classList.contains("td-row"))).toBe(false);
    await waitFor(() => expect(within(entries()[1]).getByText("Unknown")).toBeTruthy());
    const cards = entries().map(e => ({ name: e.getAttribute("aria-labelledby"), text: e.textContent }));

    await user.click(within(layout()).getByRole("button", { name: "List" }));
    expect(within(layout()).getByRole("button", { name: "List" }).getAttribute("aria-pressed")).toBe("true");
    expect(isList()).toBe(true);
    expect(entries().map(e => ({ name: e.getAttribute("aria-labelledby"), text: e.textContent }))).toEqual(cards);
    // Each row keeps its own status: A's Safe is A's, B stays Unknown (never Safe because of the layout).
    expect(within(entries()[0]).getByText("Safe (estimate)")).toBeTruthy();
    expect(within(entries()[1]).getByText("Unknown")).toBeTruthy();
    expect(within(entries()[1]).queryByText(/Safe/)).toBeNull();
    expect(within(overview()).getByText("Each account is estimated on its own; there is no combined status.")).toBeTruthy();
    expect(within(overview()).queryByText(/all clear/i)).toBeNull();
  });

  it("switching never changes the selected account or the details below", async () => {
    await assign(A);
    await saveSafe();
    const user = userEvent.setup();
    renderToday();
    await waitFor(async () => expect(await headlineText()).toContain("Safe (estimate)"));
    const details = screen.getByRole("region", { name: "Example · Eval A" });
    await user.click(within(layout()).getByRole("button", { name: "List" }));
    const [a, b] = entries();
    expect(a.getAttribute("aria-current")).toBe("true");
    expect(a.classList.contains("is-selected")).toBe(true);
    expect(within(a).getByText("Shown below")).toBeTruthy();
    expect(b.getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("region", { name: "Example · Eval A" })).toBe(details);
    expect(await headlineText()).toContain("Safe (estimate)");
    expect(holder.store.settings.get(ACTIVE_ACCOUNT_SETTING)).toBe(A);
    await user.click(within(layout()).getByRole("button", { name: "Cards" }));
    expect(entries()[0].getAttribute("aria-current")).toBe("true");
    expect(holder.store.settings.get(ACTIVE_ACCOUNT_SETTING)).toBe(A);
  });

  it("names every repeated action after its account, in both views, and Show still switches from a row", async () => {
    const user = userEvent.setup();
    renderToday();
    await screen.findByRole("region", { name: "Active accounts" });
    for (const view of ["Cards", "List"]) {
      await user.click(within(layout()).getByRole("button", { name: view }));
      expect(within(overview()).getByRole("link", { name: "Account: Example · Eval A" }).getAttribute("href")).toBe(`/accounts/${A}`);
      expect(within(overview()).getByRole("link", { name: "Account: Eval B" }).getAttribute("href")).toBe(`/accounts/${B}`);
      expect(within(overview()).getByRole("button", { name: "Show Eval B" })).toBeTruthy();
      expect(within(overview()).queryByRole("button", { name: "Show Example · Eval A" })).toBeNull();
    }
    await user.click(within(overview()).getByRole("button", { name: "Show Eval B" }));
    await screen.findByRole("heading", { name: "Eval B", level: 2 });
    expect(isList()).toBe(true);
    expect(entries()[1].getAttribute("aria-current")).toBe("true");
  });

  it("saves the choice and opens in it next time, without touching the account choice", async () => {
    const user = userEvent.setup();
    renderToday();
    await screen.findByRole("region", { name: "Active accounts" });
    await user.click(within(layout()).getByRole("button", { name: "List" }));
    await waitFor(() => expect(holder.store.settings.get(TODAY_ACCOUNTS_VIEW_SETTING)).toBe("list"));
    expect(holder.store.settings.get(ACTIVE_ACCOUNT_SETTING)).toBe(A);
    // A restart: a new query cache over the same saved settings.
    cleanup();
    client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    renderToday();
    await screen.findByRole("region", { name: "Active accounts" });
    await waitFor(() => expect(isList()).toBe(true));
    expect(within(layout()).getByRole("button", { name: "List" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("an unknown saved value falls back to Cards", async () => {
    holder.store.settings.set(TODAY_ACCOUNTS_VIEW_SETTING, "grid");
    renderToday();
    await screen.findByRole("region", { name: "Active accounts" });
    expect(within(layout()).getByRole("button", { name: "Cards" }).getAttribute("aria-pressed")).toBe("true");
    expect(entries().some(e => e.classList.contains("td-row"))).toBe(false);
  });

  it("if the choice can't be saved, it still applies and says so", async () => {
    holder.store.repository.settings.set = async () => { throw new Error("disk full"); };
    const user = userEvent.setup();
    renderToday();
    await screen.findByRole("region", { name: "Active accounts" });
    await user.click(within(layout()).getByRole("button", { name: "List" }));
    expect(isList()).toBe(true);
    expect(await screen.findByText("The layout wasn't saved")).toBeTruthy();
  });

  it("keeps a long name readable and every setup state in a row", async () => {
    const long = "Evaluation attempt with an unusually long descriptive name that keeps going";
    seed([makeAccount({ id: A, name: "Eval A" }), makeAccount({ id: B, name: long })]);
    await assign(A);
    const user = userEvent.setup();
    renderToday();
    await screen.findByRole("region", { name: "Active accounts" });
    await user.click(within(layout()).getByRole("button", { name: "List" }));
    const row = within(overview()).getByRole("article", { name: long });
    expect(within(row).getByRole("heading", { name: long, level: 3 }).textContent).toBe(long);
    await waitFor(() => expect(within(row).getByText("Not set up")).toBeTruthy());
    expect(within(row).getByText("Needs setup")).toBeTruthy();
    expect(within(row).getByText("No estimate saved")).toBeTruthy();
  });
});

describe("layout (P0-D29)", () => {
  const follows = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

  it("keeps freshness first, then all accounts, then the selected account, as siblings the wide grid can place", async () => {
    renderToday();
    const fresh = await screen.findByRole("region", { name: "How fresh this is" });
    const overview = screen.getByRole("region", { name: "Active accounts" });
    const summary = screen.getByRole("region", { name: "Example · Eval A" });
    // today.css places the panel right after freshness beside it; DOM, reading and Tab order never change.
    expect(fresh.classList.contains("td-fresh")).toBe(true);
    expect(fresh.parentElement!.classList.contains("td-page")).toBe(true);
    expect(fresh.nextElementSibling).toBe(overview);
    expect(overview.nextElementSibling).toBe(summary);
    expect(summary.nextElementSibling).toBe(riskSection());
    expect(riskSection().classList.contains("td-risk")).toBe(true);
  });

  it("with one active account, freshness is followed by the summary and then the risk estimate", async () => {
    seed([makeAccount({ id: A, name: "Eval A", propFirm: "Example" })]);
    renderToday();
    const fresh = await screen.findByRole("region", { name: "How fresh this is" });
    expect(screen.queryByRole("region", { name: "Active accounts" })).toBeNull();
    const summary = screen.getByRole("region", { name: "Example · Eval A" });
    expect(fresh.nextElementSibling).toBe(summary);
    expect(summary.classList.contains("td-account")).toBe(true);
    expect(summary.nextElementSibling).toBe(riskSection());
  });

  it("with no account chosen, the overview is not placed beside anything", async () => {
    seed([makeAccount({ id: A, name: "Eval A" }), makeAccount({ id: B, name: "Eval B" })], null);
    renderToday();
    await screen.findByText("Choose an account");
    expect(screen.queryByRole("region", { name: "How fresh this is" })).toBeNull();
    expect(follows(screen.getByText("Choose an account"), screen.getByRole("region", { name: "Active accounts" }))).toBe(true);
  });
});
