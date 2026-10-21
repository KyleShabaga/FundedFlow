// @vitest-environment jsdom
// Build 13 + Build 14 integration: feature hooks drive design-system state components through the
// presentation adapter. Runtime and repository are test mocks; DTOs come from test-fixtures.
import { RepositoryError, type AccountInput, type TradeInput } from "@fundedflow/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type FormEvent, type ReactNode, useState } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeState } from "../../app/RuntimeProvider";
import { Button, type DataColumn, DataTable, MoneyCell, MutationFeedback, StateBoundary, TextField, ValidationSummary } from "../../design-system";
import { useAccounts, useCreateAccount } from "../accounts/hooks/accounts";
import type { AccountViewModel } from "../accounts/view-models/account";
import { useCreateTrade, useTrades } from "../trades/hooks/trades";
import type { TradeViewModel } from "../trades/view-models/trade";
import { FeatureDataError } from "./errors";
import { featureKeys as keys } from "./query-keys";
import { fieldErrors, issueSentence, retryRead, toAsyncState, toMutationState } from "./presentation";
import { account, deferred, trade, T } from "./test-fixtures";

const runtime = vi.hoisted(() => ({ state: { kind: "checking" } as unknown as RuntimeState, check: vi.fn() }));
const repo = vi.hoisted(() => ({ accounts: { list: vi.fn(), get: vi.fn(), create: vi.fn() }, trades: { list: vi.fn(), create: vi.fn() } }));
vi.mock("../../app/RuntimeProvider", () => ({ useRuntime: () => runtime }));
vi.mock("../../lib/data/api", () => ({ repository: repo }));

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});

let client: QueryClient;
const ready = () => {
  runtime.state = { kind: "ready", status: { state: "ready", stage: "ready", schemaVersion: 13, supportedSchemaVersion: 13, created: false, failure: null } } as unknown as RuntimeState;
};
function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  vi.resetAllMocks();
  ready();
  runtime.check.mockResolvedValue(undefined);
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity }, mutations: { gcTime: Infinity } } });
  repo.accounts.list.mockResolvedValue([account]);
  repo.accounts.get.mockResolvedValue(account);
  repo.accounts.create.mockResolvedValue(account);
  repo.trades.list.mockResolvedValue([trade]);
  repo.trades.create.mockResolvedValue(trade);
});
afterEach(() => {
  cleanup();
  client.clear();
});

const accountColumns: DataColumn<AccountViewModel>[] = [
  { id: "name", header: "Account", rowHeader: true, cell: (a) => a.name },
  { id: "start", header: "Starting balance", align: "end", cell: (a) => <MoneyCell value={a.startingBalance} signed={false} currency={a.currency} /> },
];

function AccountsScreen() {
  const q = useAccounts();
  return (
    <StateBoundary state={toAsyncState(q)} label="accounts" onRetry={retryRead(q.refresh)}>
      {(rows) => <DataTable label="Accounts" columns={accountColumns} rows={rows} getRowId={(a) => a.id} />}
    </StateBoundary>
  );
}

describe("queries into state components", () => {
  it("moves from loading to a typed table with exact money in the account currency", async () => {
    const response = deferred<unknown>();
    repo.accounts.list.mockReturnValue(response.promise);
    const { container } = render(<AccountsScreen />, { wrapper: Wrapper });
    expect(screen.getByText("Loading accounts")).toBeTruthy();
    expect(container.textContent).not.toMatch(/\$|€/);
    await act(async () => response.resolve([account, { ...account, id: "e", name: "Euro account", currency: "EUR", startingBalance: "100" }]));
    const table = await screen.findByRole("table", { name: "Accounts" });
    expect(within(table).getByText("$9,007,199,254,740.99")).toBeTruthy();
    expect(within(table).getByText("€100.00")).toBeTruthy();
    expect(container.querySelector(".ds-boundary > [role='status']")?.textContent).toBe("Accounts loaded");
  });

  it("renders a successful empty list as EmptyState", async () => {
    repo.accounts.list.mockResolvedValue([]);
    const { container } = render(<AccountsScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(container.querySelector("[data-empty-kind='no-records']")).toBeTruthy());
  });

  it("renders a rejected read as ErrorState, never EmptyState, without backend detail", async () => {
    repo.accounts.list.mockRejectedValue(new RepositoryError({ kind: "notFound", message: "SELECT * FROM private" }));
    const { container } = render(<AccountsScreen />, { wrapper: Wrapper });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("no longer available");
    expect(alert.textContent).not.toMatch(/SELECT|private/);
    expect(container.querySelector("[data-empty-kind]")).toBeNull();
  });

  it("shows startup checks as loading and an unavailable runtime as unavailable, never empty", () => {
    runtime.state = { kind: "checking", status: null, since: Date.now() } as unknown as RuntimeState;
    const { container, rerender } = render(<AccountsScreen />, { wrapper: Wrapper });
    expect(screen.getByText("Loading accounts")).toBeTruthy();
    runtime.state = { kind: "unavailable", status: null, reason: "rejected" } as unknown as RuntimeState;
    rerender(<AccountsScreen />);
    expect(screen.getByText("Not available")).toBeTruthy();
    runtime.state = { kind: "unsupported-schema", status: {} } as unknown as RuntimeState;
    rerender(<AccountsScreen />);
    expect(screen.getByText("Journal needs a newer FundedFlow")).toBeTruthy();
    expect(container.querySelector("[data-empty-kind]")).toBeNull();
    expect(repo.accounts.list).not.toHaveBeenCalled();
  });

  it("keeps data after a failed refresh, labelled stale with when it was last loaded", async () => {
    const { container } = render(<AccountsScreen />, { wrapper: Wrapper });
    await screen.findByRole("table", { name: "Accounts" });
    repo.accounts.list.mockRejectedValue(new RepositoryError({ kind: "conflict", message: "x" }));
    await act(async () => {
      await client.refetchQueries();
    });
    await waitFor(() => expect(screen.getByText(/Couldn't refresh\. Showing figures last loaded/)).toBeTruthy());
    expect(screen.getByRole("table", { name: "Accounts" })).toBeTruthy();
    expect(container.querySelector("[data-state='stale']")).toBeTruthy();
  });

  it("does not treat TanStack cache age as stale data", () => {
    const state = toAsyncState({ data: [1], error: null, queryError: null, runtimeKind: "ready", isInitialLoading: false, isRefreshing: false, isEmpty: false, observedAt: T });
    expect(state.status).toBe("success");
  });

  it("treats a disabled query with nothing chosen as not configured, and filtered empties as no matches", () => {
    expect(toAsyncState({ data: undefined, error: null, queryError: null, runtimeKind: "ready", isInitialLoading: false, isRefreshing: false, isEmpty: null, observedAt: null })).toEqual({ status: "empty", kind: "not-configured" });
    expect(toAsyncState({ data: [], error: null, queryError: null, runtimeKind: "ready", isInitialLoading: false, isRefreshing: false, isEmpty: true, observedAt: T }, { emptyKind: "no-matches" })).toEqual({ status: "empty", kind: "no-matches" });
  });

  it("keeps unknown P&L unknown in the trade table", async () => {
    function Trades() {
      const q = useTrades("a");
      const cols: DataColumn<TradeViewModel>[] = [
        { id: "sym", header: "Symbol", rowHeader: true, cell: (t) => t.symbol },
        { id: "pnl", header: "Net P&L", align: "end", cell: (t) => <MoneyCell value={t.realizedPnl} currency={t.currency} /> },
      ];
      return <StateBoundary state={toAsyncState(q)} label="trades">{(rows) => <DataTable label="Trades" columns={cols} rows={rows} getRowId={(t) => t.id} />}</StateBoundary>;
    }
    render(<Trades />, { wrapper: Wrapper });
    const table = await screen.findByRole("table", { name: "Trades" });
    expect(within(table).getAllByRole("cell")[0].textContent).toBe("—Unknown");
  });

  it("retries a read without an unhandled rejection", async () => {
    const refresh = vi.fn(() => Promise.reject(new FeatureDataError("unavailable")));
    retryRead(refresh)();
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

/* ---------- Forms and mutations ---------- */

const VALID: AccountInput = { name: "New account", accountType: "evaluation", status: "active", currency: "USD", startingBalance: "100", timezone: "America/New_York", tradingDayResetTime: "17:00" };
const LABELS: Record<string, string> = { name: "Name", currency: "Currency" };

function AccountForm({ input = VALID }: { input?: AccountInput }) {
  const m = useCreateAccount();
  const [name, setName] = useState(input.name);
  const errors = fieldErrors(m.error);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void m.submit({ ...input, name }).catch(() => {});
  };
  return (
    <form onSubmit={submit} aria-label="New account">
      <TextField id="acct-name" label="Name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} />
      <Button type="submit" variant="primary" loading={m.isPending} disabled={!m.canSubmit && !m.isPending}>
        Save
      </Button>
      <MutationFeedback
        state={toMutationState(m, { success: "Account saved.", fieldId: (f) => `acct-${f}`, fieldLabel: (f) => LABELS[f] })}
        onCheck={() => void client.invalidateQueries({ queryKey: keys.accounts })}
        actions={
          m.canAcknowledgeUncertainOutcome ? (
            <Button size="sm" onClick={() => void m.acknowledgeUncertainOutcome({ recordsReviewed: true })}>
              I've checked the records
            </Button>
          ) : null
        }
      />
    </form>
  );
}

describe("forms with mutations", () => {
  it("shows actionable field and summary messages without calling Rust", async () => {
    render(<AccountForm input={{ ...VALID, name: "" }} />, { wrapper: Wrapper });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const field = await screen.findByRole("textbox", { name: "Name" });
    await waitFor(() => expect(field.getAttribute("aria-invalid")).toBe("true"));
    expect(screen.getAllByText("Required").length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("link", { name: "Required" }));
    expect(document.activeElement).toBe(field);
    expect(repo.accounts.create).not.toHaveBeenCalled();
  });

  it("completes field-relative backend messages with the field label", () => {
    expect(issueSentence("quantity", "must be greater than zero", "Quantity")).toBe("Quantity must be greater than zero");
    expect(issueSentence("name", "Required", "Name")).toBe("Required");
    const error = new FeatureDataError("validation", "validation", [{ field: "quantity", message: "must be greater than zero" }]);
    expect(fieldErrors(error)).toEqual({ quantity: "Must be greater than zero" });
    const state = toMutationState({ outcome: "failed", error, data: undefined }, { success: "", fieldId: () => "qty", fieldLabel: () => "Quantity" });
    expect(state).toEqual({ status: "validation-error", issues: [{ fieldId: "qty", message: "Quantity must be greater than zero" }] });
    render(<ValidationSummary issues={state.status === "validation-error" ? state.issues : []} />);
    expect(screen.getByText("Quantity must be greater than zero")).toBeTruthy();
  });

  it("blocks duplicate submits from clicks and Enter while pending, then confirms success", async () => {
    const response = deferred<unknown>();
    repo.accounts.create.mockReturnValue(response.promise);
    render(<AccountForm />, { wrapper: Wrapper });
    const field = screen.getByRole("textbox", { name: "Name" });
    await userEvent.type(field, "{Enter}");
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" }).getAttribute("aria-busy")).toBe("true"));
    await userEvent.type(field, "{Enter}");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(repo.accounts.create).toHaveBeenCalledTimes(1);
    await act(async () => response.resolve(account));
    await waitFor(() => expect(screen.getByText("Account saved.")).toBeTruthy());
  });

  it("refreshes the account table after a confirmed write", async () => {
    render(
      <>
        <AccountsScreen />
        <AccountForm />
      </>,
      { wrapper: Wrapper },
    );
    await screen.findByRole("rowheader", { name: "Test account" });
    repo.accounts.list.mockResolvedValue([account, { ...account, id: "a2", name: "New account" }]);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("rowheader", { name: "New account" });
    expect(repo.accounts.list).toHaveBeenCalledTimes(2);
  });

  it("offers a check, never a retry, for an uncertain write, and unlocks only after review", async () => {
    repo.accounts.create.mockResolvedValue({ ...account, id: "" }); // malformed acknowledgement: may have saved
    render(<AccountForm />, { wrapper: Wrapper });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn't confirm it saved");
    expect(within(alert).getByRole("button", { name: "Check result" })).toBeTruthy();
    expect(within(alert).queryByRole("button", { name: /Try again/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(repo.accounts.create).toHaveBeenCalledTimes(1);
    await userEvent.click(within(alert).getByRole("button", { name: "I've checked the records" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    repo.accounts.create.mockResolvedValue(account);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(repo.accounts.create).toHaveBeenCalledTimes(2));
  });

  it("maps definite failures with Retry only when nothing changed", () => {
    const conflict = toMutationState({ outcome: "failed", error: new FeatureDataError("conflict"), data: undefined }, { success: "" });
    expect(conflict).toMatchObject({ status: "failed", nothingChanged: true });
    const unknown = toMutationState({ outcome: "failed", error: new FeatureDataError("unexpected"), data: undefined }, { success: "" });
    expect(unknown).toMatchObject({ status: "failed", nothingChanged: false });
    expect(toMutationState({ outcome: "confirmed-failure", error: null, data: { failureMessage: "Import not completed." } }, { success: "", confirmedFailure: (d) => d.failureMessage }))
      .toEqual({ status: "failed", message: "Import not completed.", nothingChanged: false });
  });

  it("invalidates only the written account's trade cache", async () => {
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useCreateTrade("a"), { wrapper: Wrapper });
    const input: TradeInput = { accountId: "a", symbol: "MES", side: "long", quantity: "1", entryAt: T, entryPrice: "5000" };
    await act(async () => {
      await result.current.submit(input);
    });
    const keysCalled = invalidate.mock.calls.map(([arg]) => arg?.queryKey);
    expect(keysCalled).toContainEqual(keys.tradesRoot("a"));
    expect(keysCalled).not.toContainEqual(keys.tradesRoot("b"));
  });
});
