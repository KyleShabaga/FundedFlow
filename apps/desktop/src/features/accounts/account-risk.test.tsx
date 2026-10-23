// @vitest-environment jsdom
// NA-4: the account detail page's Risk section and the Accounts "Current balance" KPI, through the real pages and
// hooks on the Today in-memory store (real engine inputs hash, freshness check and canonical records). The detail
// page and the card read one model, so for the same attempt they must name the same state and figures. Synthetic
// data only.
import type { Account } from "@fundedflow/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeState } from "../../app/RuntimeProvider";
import { ToastProvider } from "../../design-system";
import { expectNoAxeViolations } from "../../test/axe";
import { boundary, freshnessRow, resetBoundaries } from "../../test/boundaries";
import { closedTrade } from "../rulebooks/test-store";
import { createTodayStore, drawdownOutcome } from "../today/test-store";
import { ACTIVE_ACCOUNT_SETTING } from "./active-account";
import { AccountDetailPage } from "./components/AccountDetailPage";
import { AccountsPage } from "./components/AccountsPage";
import { makeAccount } from "./test-store";

const runtime = vi.hoisted(() => ({ state: { kind: "ready" } as unknown as RuntimeState, check: vi.fn() }));
const holder = vi.hoisted(() => ({ store: null as unknown as ReturnType<typeof createTodayStore> }));
vi.mock("../../app/RuntimeProvider", () => ({ useRuntime: () => runtime }));
vi.mock("../../lib/data/api", () => ({ get repository() { return holder.store.repository; } }));
// TASK-021: today's trading day comes from Rust (`list_account_freshness`), answered here from fixed rows.
vi.mock("../../lib/data/freshness", async importOriginal => ({ ...(await importOriginal<object>()), freshnessGateway: (await import("../../test/boundaries")).freshnessGatewayMock }));

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});

const A = "acct-a";
const B = "acct-b";
const NOW = "2026-10-21T18:00:00.000Z";
const CUTOFF = "2026-10-21T17:00:00.000Z";
let client: QueryClient;
let where = "";
function Where() {
  where = useLocation().pathname;
  return null;
}

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
/** One closed trade and a rulebook in force. Prepare every account before saving: a rulebook write can make results stale. */
async function prepare(id: string) {
  holder.store.trades.set(id, [closedTrade(id, 1, "125.5", "2026-10-21")]);
  await assign(id);
}
/** A current Safe estimate for `id` with the given balance and headroom (engine values, passed through). */
async function estimate(id: string, balance = "52125.5", headroom = "2125.5", options: { historyOnly?: boolean; prepared?: boolean } = {}) {
  if (!options.prepared) await prepare(id);
  const ids = holder.store.trades.get(id)!.map(t => t.id);
  await holder.store.saveEstimate(id, CUTOFF, r => ({ ...r, status: "Safe", reasons: [], balance, rules: [drawdownOutcome({ headroom, sourceReferences: ids })] }), {}, options);
}
function renderAt(path: string) {
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Where />
          <main>
          <Routes>
            <Route path="/" element={<p>Today page</p>} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/accounts/:accountId" element={<AccountDetailPage />} />
          </Routes>
          </main>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}
async function riskOf(id: string) {
  renderAt(`/accounts/${id}`);
  return screen.findByRole("region", { name: "Risk" });
}
const NEVER_SAFE = "Without a current calculation this account is never shown as safe.";

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(NOW), shouldAdvanceTime: true, toFake: ["Date"] });
  runtime.state = { kind: "ready", status: { state: "ready", stage: "ready", schemaVersion: 17, supportedSchemaVersion: 17, created: false, failure: null } } as unknown as RuntimeState;
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  // Wednesday 2026-10-21 is each account's trading day until the 17:00 New York reset (fixed rows; Rust computes them).
  resetBoundaries();
  boundary.freshness.table = [{ from: "2000-01-01T00:00:00.000Z", answer: [A, B].map(id => freshnessRow(id, "2026-10-21", "2026-10-21T21:00:00.000Z")) }];
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("account detail Risk section", () => {
  it("current: Today's status, the engine's headroom, floor and balance with their as-of in the account zone", async () => {
    seed([makeAccount({ id: A, name: "Eval A", timezone: "America/New_York" })]);
    await estimate(A);
    const risk = await riskOf(A);
    await waitFor(() => expect(within(risk).getByText("Safe (estimate)")).toBeTruthy());
    expect(within(risk).getByText("$2,125.50")).toBeTruthy();
    expect(within(risk).getByText("Current estimate")).toBeTruthy();
    expect(within(risk).getByText("$48,000.00")).toBeTruthy();
    expect(within(risk).getByText("$52,125.50")).toBeTruthy();
    expect(within(risk).getByText("From your records")).toBeTruthy();
    // 17:00 UTC is 13:00 in New York (EDT).
    expect(within(risk).getAllByText(/As of .*13:00.*EDT/).length).toBeGreaterThan(0);
    expect(within(risk).getByRole("meter", { name: "Drawdown headroom" })).toBeTruthy();
    expect(within(risk).queryByText(NEVER_SAFE)).toBeNull();
    expect(within(risk).getByRole("button", { name: "Calculate estimate" })).toBeTruthy();
    expect(within(risk).getByRole("link", { name: "Open Today" }).getAttribute("href")).toBe("/");
    expect(screen.queryByText("Not calculated yet")).toBeNull();
    await expectNoAxeViolations();
  });

  it("agrees with the account's card: same state word and figures for the same attempt", async () => {
    seed([makeAccount({ id: A, name: "Eval A" })]);
    await estimate(A);
    const user = userEvent.setup();
    renderAt("/accounts");
    await user.click(await screen.findByRole("button", { name: "Cards" }));
    const card = screen.getByRole("article", { name: /Eval A/ });
    await waitFor(() => expect(within(card).getByText("$2,125.50")).toBeTruthy());
    const cardWords = ["Current estimate", "$2,125.50", "$52,125.50", "From your records"].map(t => within(card).getByText(t).textContent);
    await user.click(within(card).getByRole("button", { name: /View details of Eval A/ }));
    const risk = await screen.findByRole("region", { name: "Risk" });
    await waitFor(() => expect(within(risk).getByText("$2,125.50")).toBeTruthy());
    expect(["Current estimate", "$2,125.50", "$52,125.50", "From your records"].map(t => within(risk).getByText(t).textContent)).toEqual(cardWords);
  });

  it("stale: Not current, every reason, what was last saved, and never Safe", async () => {
    seed([makeAccount({ id: A, name: "Eval A" })]);
    await estimate(A);
    // A trade closed after the saved cutoff: the estimate can't be current any more.
    holder.store.trades.set(A, [...holder.store.trades.get(A)!, { ...closedTrade(A, 2, "-40", "2026-10-21"), exitAt: "2026-10-21T17:30:00.000Z" }]);
    const risk = await riskOf(A);
    await waitFor(() => expect(within(risk).getAllByText("Not current").length).toBeGreaterThan(0));
    expect(within(risk).getByText("The last saved estimate isn't current.")).toBeTruthy();
    expect(within(within(risk).getByRole("list", { name: "Why it isn't current" })).getByText(/Records dated after its cutoff/)).toBeTruthy();
    expect(within(risk).getByText(/^Last saved estimate: Safe \(estimate\) for trading day 2026-10-21\. Its cutoff was/)).toBeTruthy();
    expect(within(risk).getByText(NEVER_SAFE)).toBeTruthy();
    expect(within(risk).queryByText("$2,125.50")).toBeNull();
    expect(within(risk).queryByText(/^Safe/)).toBeNull();
    expect(within(risk).getByRole("button", { name: "Calculate estimate" })).toBeTruthy();
  });

  it("not promoted after upgrade (P0-02): stored history is Not current with that reason", async () => {
    seed([makeAccount({ id: A, name: "Eval A" })]);
    await estimate(A, undefined, undefined, { historyOnly: true });
    const risk = await riskOf(A);
    await waitFor(() => expect(within(risk).getAllByText(/without being confirmed as the current result/).length).toBeGreaterThan(0));
    expect(within(risk).getAllByText("Not current").length).toBeGreaterThan(0);
    expect(within(risk).getByText(NEVER_SAFE)).toBeTruthy();
  });

  it("Unknown: the saved calculation can't be read; figures are —, never zero", async () => {
    seed([makeAccount({ id: A, name: "Eval A" })]);
    await estimate(A);
    holder.store.failing.add("latest");
    const risk = await riskOf(A);
    await waitFor(() => expect(within(risk).getAllByText("The saved calculation couldn't be read.").length).toBeGreaterThan(0));
    expect(within(risk).getAllByText("Unknown").length).toBeGreaterThan(0);
    expect(within(risk).getAllByTitle("Unavailable: The saved calculation couldn't be read.")).toHaveLength(2);
    expect(within(risk).queryByText("$0.00")).toBeNull();
    expect(within(risk).getByText(NEVER_SAFE)).toBeTruthy();
  });

  it("No rule: a current result without a drawdown outcome says No rule on the figure", async () => {
    seed([makeAccount({ id: A, name: "Eval A" })]);
    holder.store.trades.set(A, [closedTrade(A, 1, "125.5", "2026-10-21")]);
    await assign(A);
    await holder.store.saveEstimate(A, CUTOFF, r => ({ ...r, status: "Safe", reasons: [], balance: "52125.5", rules: [] }));
    const risk = await riskOf(A);
    await waitFor(() => expect(within(risk).getByText("No rule")).toBeTruthy());
    expect(within(risk).getByText("$52,125.50")).toBeTruthy();
  });

  it("Not calculated: says so, offers Calculate, and opens the existing Calculate dialog", async () => {
    seed([makeAccount({ id: A, name: "Eval A" })]);
    await assign(A);
    const risk = await riskOf(A);
    await waitFor(() => expect(within(risk).getAllByText("Not calculated").length).toBeGreaterThan(0));
    expect(within(risk).getByText(NEVER_SAFE)).toBeTruthy();
    const user = userEvent.setup();
    await user.click(within(risk).getByRole("button", { name: "Calculate estimate" }));
    expect(await screen.findByRole("dialog", { name: "Calculate estimate" })).toBeTruthy();
  });

  it("History only: a failed attempt isn't today's risk; no guarantee line, nothing to calculate", async () => {
    seed([makeAccount({ id: A, name: "Eval A", status: "failed" })]);
    const risk = await riskOf(A);
    await waitFor(() => expect(within(risk).getAllByText("History only").length).toBeGreaterThan(0));
    expect(within(risk).queryByText(NEVER_SAFE)).toBeNull();
    expect(within(risk).queryByRole("button", { name: "Calculate estimate" })).toBeNull();
  });

  it("opens Today for an attempt that isn't active by making it active first", async () => {
    seed([makeAccount({ id: A, name: "Eval A" }), makeAccount({ id: B, name: "Eval B" })]);
    const risk = await riskOf(B);
    const user = userEvent.setup();
    await user.click(await within(risk).findByRole("button", { name: "Use as active and open Today" }));
    await waitFor(() => expect(where).toBe("/"));
    expect(holder.store.settings.get(ACTIVE_ACCOUNT_SETTING)).toBe(B);
  });
});

describe("Accounts Current balance KPI", () => {
  // The KPI card, not the table's Current balance column header.
  const kpi = () => screen.getAllByText("Current balance").map(e => e.closest(".ds-metric")).find(Boolean) as HTMLElement;

  it("none current: — with how many live accounts were looked at, never a starting balance or 0", async () => {
    seed([makeAccount({ id: A, name: "Eval A" }), makeAccount({ id: B, name: "Eval B" })]);
    renderAt("/accounts");
    await screen.findByRole("table", { name: "Accounts" });
    await waitFor(() => expect(within(kpi()).getAllByText(/None of the 2 live accounts has a current estimate/).length).toBeGreaterThan(0));
    expect(within(kpi()).queryByText(/\$/)).toBeNull();
  });

  it("one currency, mixed current and not current: totals only the current one and names the count", async () => {
    seed([makeAccount({ id: A, name: "Eval A" }), makeAccount({ id: B, name: "Eval B" })]);
    await estimate(A);
    renderAt("/accounts");
    await waitFor(() => expect(within(kpi()).getByText("$52,125.50")).toBeTruthy());
    expect(within(kpi()).getByText("1 of 2 live accounts · current estimates")).toBeTruthy();
  });

  it("one currency, several current: the exact sum", async () => {
    seed([makeAccount({ id: A, name: "Eval A" }), makeAccount({ id: B, name: "Eval B" })]);
    await prepare(A);
    await prepare(B);
    // Canonical decimal text, as Rust records it.
    await estimate(A, "50000.1", undefined, { prepared: true });
    await estimate(B, "25000.25", undefined, { prepared: true });
    renderAt("/accounts");
    await waitFor(() => expect(within(kpi()).getByText("$75,000.35")).toBeTruthy());
    expect(within(kpi()).getByText("2 of 2 live accounts · current estimates")).toBeTruthy();
  });

  it("several currencies: one total each, never added together", async () => {
    seed([makeAccount({ id: A, name: "Eval A" }), makeAccount({ id: B, name: "Euro B", currency: "EUR" })]);
    await prepare(A);
    await prepare(B);
    await estimate(A, "50000", undefined, { prepared: true });
    await estimate(B, "12480.55", undefined, { prepared: true });
    renderAt("/accounts");
    await waitFor(() => expect(within(kpi()).getByText("€12,480.55 · $50,000.00")).toBeTruthy());
    expect(within(kpi()).getByText("2 of 2 live accounts · each currency totalled on its own")).toBeTruthy();
  });
});
