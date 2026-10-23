// @vitest-environment jsdom
// Build 18.5 account overview cards through the real Accounts page and hooks, on the Today in-memory store (real
// engine inputs hash, freshness check and canonical records). Synthetic data only.
import type { Account } from "@fundedflow/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeState } from "../../app/RuntimeProvider";
import { ToastProvider } from "../../design-system";
import { closedTrade } from "../rulebooks/test-store";
import { createTodayStore, drawdownOutcome } from "../today/test-store";
import { ACTIVE_ACCOUNT_SETTING } from "./active-account";
import { AccountsPage } from "./components/AccountsPage";
import { makeAccount } from "./test-store";

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

const A = "acct-a";
const B = "acct-b";
const NOW = "2026-10-21T18:00:00.000Z";
const CUTOFF = "2026-10-21T17:00:00.000Z";
let client: QueryClient;
let where = "";
let state: unknown = null;
function Where() {
  const loc = useLocation();
  where = loc.pathname;
  state = loc.state;
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
function renderCards() {
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/accounts"]}>
          <Where />
          <Routes>
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/accounts/:accountId" element={<p>Account detail</p>} />
            <Route path="/import/quick" element={<p>Quick import page</p>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}
async function showCards(user: ReturnType<typeof userEvent.setup>) {
  renderCards();
  await user.click(await screen.findByRole("button", { name: "Cards" }));
  return screen.findByRole("list", { name: "Accounts" });
}
const card = (name: RegExp | string) => screen.getByRole("article", { name });

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(NOW), shouldAdvanceTime: true, toFake: ["Date"] });
  runtime.state = { kind: "ready", status: { state: "ready", stage: "ready", schemaVersion: 17, supportedSchemaVersion: 17, created: false, failure: null, cleanup: "clear" } } as unknown as RuntimeState;
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("account overview cards", () => {
  it("shows a current engine estimate with its headroom first, and View details opens that exact attempt", async () => {
    seed([makeAccount({ id: A, name: "Eval A", propFirm: "Example", externalRef: "EX-99881234" }), makeAccount({ id: B, name: "Eval B" })]);
    holder.store.trades.set(A, [closedTrade(A, 1, "125.5", "2026-10-21")]);
    await assign(A);
    const ids = holder.store.trades.get(A)!.map(t => t.id);
    await holder.store.saveEstimate(A, CUTOFF, r => ({ ...r, status: "Safe", reasons: [], balance: "52125.5", rules: [drawdownOutcome({ headroom: "2125.5", sourceReferences: ids })] }));
    const user = userEvent.setup();
    await showCards(user);
    const a = card(/Eval A/);
    expect(within(a).getByText("Example")).toBeTruthy();
    expect(within(a).getByText("••••1234")).toBeTruthy();
    expect(within(a).queryByText(A)).toBeNull();
    await waitFor(() => expect(within(a).getByText("$2,125.50")).toBeTruthy());
    expect(within(a).getByText("Current estimate")).toBeTruthy();
    expect(within(a).getByText("$52,125.50")).toBeTruthy();
    expect(within(a).getByText("From your records")).toBeTruthy();
    expect(within(a).getByRole("meter", { name: "Drawdown headroom" })).toBeTruthy();
    expect(within(a).getByText("Active in FundedFlow")).toBeTruthy();
    expect(within(a).getByText(/^Last traded /)).toBeTruthy();
    // The other attempt has nothing calculated: Unknown, never a figure or Safe.
    const b = card(/Eval B/);
    await waitFor(() => expect(within(b).getByText("No imported trades")).toBeTruthy());
    expect(within(b).queryByText(/Safe/)).toBeNull();
    expect(within(b).queryByRole("meter")).toBeNull();
    await user.click(within(a).getByRole("button", { name: /View details of Eval A/ }));
    expect(where).toBe(`/accounts/${A}`);
  });

  it("shows the card's balance in the table's Current balance column: a current estimate, else the latest checkpoint", async () => {
    seed([makeAccount({ id: A, name: "Eval A" }), makeAccount({ id: B, name: "Eval B", currency: "EUR", startingBalance: "12480.55" })]);
    holder.store.trades.set(A, [closedTrade(A, 1, "125.5", "2026-10-21")]);
    await assign(A);
    const ids = holder.store.trades.get(A)!.map(t => t.id);
    await holder.store.saveEstimate(A, CUTOFF, r => ({ ...r, status: "Safe", reasons: [], balance: "52125.5", rules: [drawdownOutcome({ headroom: "2125.5", sourceReferences: ids })] }));
    renderCards();
    const table = await screen.findByRole("table", { name: "Accounts" });
    const rowOf = (name: string) => within(table).getByRole("rowheader", { name: new RegExp(name) }).closest("tr") as HTMLElement;
    // Not sortable: amounts read per row (estimate or checkpoint, maybe unknown or in another currency) aren't ordered here.
    expect(within(within(table).getByRole("columnheader", { name: "Current balance" })).queryByRole("button")).toBeNull();
    await waitFor(() => expect(within(rowOf("Eval A")).getByText("$52,125.50")).toBeTruthy());
    expect(within(rowOf("Eval A")).getByText(/^From your records · /)).toBeTruthy();
    expect(within(rowOf("Eval A")).getByText(/Estimated balance · From your records · As of /)).toBeTruthy();
    // B has nothing calculated: its latest checkpoint (the store's confirmed opening one), labelled as a checkpoint
    // with its time and in B's own currency, never added to A's.
    await waitFor(() => expect(within(rowOf("Eval B")).getByText("€12,480.55")).toBeTruthy());
    expect(within(rowOf("Eval B")).getByText(/^Confirmed by you · /)).toBeTruthy();
    expect(within(rowOf("Eval B")).getByText(/^Last confirmed balance · Confirmed by you · from the firm's dashboard, /)).toBeTruthy();
    // A's starting balance is not the balance shown.
    expect(within(rowOf("Eval A")).queryByText("$50,000.00")).toBeNull();
  });

  it("puts the status filter and search on one toolbar row, search last", async () => {
    seed([makeAccount({ id: A, name: "Eval A" })]);
    renderCards();
    const table = await screen.findByRole("table", { name: "Accounts" });
    const toolbar = table.closest(".ds-dt-card")!.querySelector(".ds-dt-toolbar")!;
    const [left, right] = Array.from(toolbar.children);
    expect(within(left as HTMLElement).getByRole("group", { name: "Show" })).toBeTruthy();
    expect(within(right as HTMLElement).getByRole("searchbox", { name: "Search accounts" })).toBeTruthy();
  });

  it("offers Quick import for that attempt from the card menu, but not for an archived one", async () => {
    seed([makeAccount({ id: A, name: "Eval A" }), makeAccount({ id: B, name: "Old B", archivedAt: "2026-10-01T00:00:00.000Z" })]);
    const user = userEvent.setup();
    await showCards(user);
    await user.click(within(card(/Eval A/)).getByRole("button", { name: "More actions for Eval A" }));
    await user.click(await screen.findByRole("menuitem", { name: "Quick import into this attempt" }));
    // The menu navigates as it closes, after the click resolves; under CPU load a check made at once raced it.
    await waitFor(() => expect(where).toBe("/import/quick"));
    expect(state).toEqual({ accountId: A });
  });

  it("keeps the dense table as an option and filters the cards with the same controls", async () => {
    seed([makeAccount({ id: A, name: "Eval A" }), makeAccount({ id: B, name: "Failed B", status: "failed" })]);
    const user = userEvent.setup();
    const list = await showCards(user);
    // Live (the default) leaves the failed attempt in history; All shows both.
    expect(within(list).getAllByRole("article")).toHaveLength(1);
    await user.click(within(screen.getByRole("group", { name: "Show" })).getByRole("button", { name: /^All/ }));
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Accounts" })).getAllByRole("article")).toHaveLength(2));
    await user.type(screen.getByRole("searchbox", { name: "Search accounts" }), "Failed");
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Accounts" })).getAllByRole("article")).toHaveLength(1));
    expect(within(card(/Failed B/)).getByText("Failed")).toBeTruthy();
    expect(within(card(/Failed B/)).getByText("History only")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Table" }));
    expect(await screen.findByRole("table", { name: "Accounts" })).toBeTruthy();
  });

  it("is reachable by keyboard: View details is a button in tab order", async () => {
    seed([makeAccount({ id: A, name: "Eval A" })]);
    const user = userEvent.setup();
    await showCards(user);
    const details = within(card(/Eval A/)).getByRole("button", { name: /View details of Eval A/ });
    details.focus();
    await user.keyboard("{Enter}");
    expect(where).toBe(`/accounts/${A}`);
  });
});
