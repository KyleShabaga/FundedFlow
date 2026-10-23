// @vitest-environment jsdom
// TASK-021: the reset dialog's rulebook day and the Accounts list's rulebook come from Rust's trading day
// (`list_account_freshness`), never from the calendar day. Freshness rows are fixed per `asOf` in the test boundary;
// nothing here computes a trading day.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeState } from "../../app/RuntimeProvider";
import { ToastProvider } from "../../design-system";
import { boundary, deferredFor, freshnessRow, resetBoundaries, type FreshnessEntry } from "../../test/boundaries";
import { createTodayStore } from "../today/test-store";
import type { AccountFreshnessInputs } from "../../lib/data/freshness";
import { AccountDetailPage } from "./components/AccountDetailPage";
import { AccountsPage } from "./components/AccountsPage";
import { makeAccount } from "./test-store";

const runtime = vi.hoisted(() => ({ state: { kind: "ready" } as unknown as RuntimeState, check: vi.fn() }));
const holder = vi.hoisted(() => ({ store: null as unknown as ReturnType<typeof createTodayStore> }));
vi.mock("../../app/RuntimeProvider", () => ({ useRuntime: () => runtime }));
vi.mock("../../lib/data/api", () => ({ get repository() { return holder.store.repository; } }));
vi.mock("../../lib/data/freshness", async importOriginal => ({ ...(await importOriginal<object>()), freshnessGateway: (await import("../../test/boundaries")).freshnessGatewayMock }));

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});

const A = "a";
/**
 * What Rust reports for this America/New_York account with a 17:00 reset, by instant: from each reset on, the next
 * trading day (Friday's reset opens Monday). Fixed rows, as `list_account_freshness` returns them.
 */
const DAYS: [from: string, day: string, next: string][] = [
  ["2026-10-16T21:00:00.000Z", "2026-10-19", "2026-10-19T21:00:00.000Z"],
  ["2026-10-19T21:00:00.000Z", "2026-10-20", "2026-10-20T21:00:00.000Z"],
  ["2026-10-20T21:00:00.000Z", "2026-10-21", "2026-10-21T21:00:00.000Z"],
  ["2026-10-21T21:00:00.000Z", "2026-10-22", "2026-10-22T21:00:00.000Z"],
  ["2026-10-22T21:00:00.000Z", "2026-10-23", "2026-10-23T21:00:00.000Z"],
  ["2026-10-23T21:00:00.000Z", "2026-10-26", "2026-10-26T21:00:00.000Z"],
];
const rustDays = (): FreshnessEntry[] => DAYS.map(([from, day, next]) => ({ from, answer: [freshnessRow(A, day, next)] }));

let client: QueryClient;
function renderAt(path: string) {
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/accounts/:accountId" element={<AccountDetailPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function fresh(now: string) {
  vi.useFakeTimers({ now: new Date(now), shouldAdvanceTime: true, toFake: ["Date"] });
  runtime.state = { kind: "ready", status: { state: "ready", stage: "ready", schemaVersion: 17, supportedSchemaVersion: 17, created: false, failure: null, cleanup: "clear" } } as unknown as RuntimeState;
  runtime.check.mockReset().mockResolvedValue(undefined);
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  resetBoundaries();
  boundary.freshness.table = rustDays();
  holder.store = createTodayStore([makeAccount({ id: A, name: "PA-48213", propFirm: "Example", externalRef: "48213" })]);
  // The verified catalogue version applies to one phase, so the reset dialog offers it.
  const books = holder.store.repository.rulebooks;
  const listVersions = books.listVersions.bind(books);
  vi.spyOn(books, "listVersions").mockImplementation(async id => (await listVersions(id)).map(v => ({
    ...v, applicability: [{ id: "01900000-0000-7000-8000-0000000000a1", rulebookVersionId: v.version.id, catalogueVersionId: "01900000-0000-7000-8000-0000000000a2", programmePhaseId: "01900000-0000-7000-8000-0000000000a3", phasePathId: null }],
  })) as never);
}
beforeEach(() => fresh("2026-10-21T15:00:00.000Z"));
afterEach(() => {
  cleanup();
  client.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const resetCalls = () => vi.spyOn(holder.store.repository.accounts, "resetAttempt");

async function openReset(user: ReturnType<typeof userEvent.setup>) {
  renderAt(`/accounts/${A}`);
  await user.click(await screen.findByRole("button", { name: "More account actions" }));
  await user.click(await screen.findByRole("menuitem", { name: "Start new attempt…" }));
  return screen.findByRole("dialog", { name: /Start a new attempt after PA-48213/ });
}
/** "Reset took effect" as a datetime-local wall time in the account's zone. */
const setEffective = (dialog: HTMLElement, local: string) => fireEvent.change(within(dialog).getByLabelText(/Reset took effect/), { target: { value: local } });
async function toRulebookStep(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
  await user.click(within(dialog).getByRole("radio", { name: "Failed" }));
  await user.click(within(dialog).getByRole("button", { name: "Next" }));
  await user.click(within(dialog).getByRole("textbox", { name: /Starting balance/ }));
  await user.paste("50000");
  await user.click(within(dialog).getByRole("button", { name: "Next" }));
}
const assignOption = (dialog: HTMLElement) => within(dialog).findByRole("radio", { name: /Example 50K v1/ });
async function backToStart(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
  while (!within(dialog).queryByLabelText(/Reset took effect/)) await user.click(within(dialog).getByRole("button", { name: "Back" }));
}
const startButton = (dialog: HTMLElement) => within(dialog).getByRole("button", { name: "Start new attempt" });
const sentDecision = (calls: ReturnType<typeof resetCalls>) => calls.mock.calls[0]?.[0].rulebook;

describe("reset dialog: the rulebook's first day is Rust's trading day for the chosen instant", () => {
  it("at Friday 22:30Z (after the 17:00 New York reset) defaults to Monday 2026-10-26, not the calendar day", async () => {
    fresh("2026-10-23T22:30:00.000Z");
    const calls = resetCalls();
    const user = userEvent.setup();
    const dialog = await openReset(user);
    await toRulebookStep(user, dialog);
    await user.click(await assignOption(dialog));
    expect(await within(dialog).findByText("From 2026-10-26")).toBeTruthy();
    expect(within(dialog).queryByText("From 2026-10-23")).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    await user.click(startButton(dialog));
    await screen.findByRole("dialog", { name: "New attempt started" });
    expect(sentDecision(calls)).toMatchObject({ kind: "assign", effectiveFrom: "2026-10-26" });
  });

  it("just before the reset it is still Friday 2026-10-23", async () => {
    fresh("2026-10-23T20:59:00.000Z");
    const calls = resetCalls();
    const user = userEvent.setup();
    const dialog = await openReset(user);
    await toRulebookStep(user, dialog);
    await user.click(await assignOption(dialog));
    expect(await within(dialog).findByText("From 2026-10-23")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    await user.click(startButton(dialog));
    await screen.findByRole("dialog", { name: "New attempt started" });
    expect(sentDecision(calls)).toMatchObject({ kind: "assign", effectiveFrom: "2026-10-23" });
  });

  it("backdated: sends Rust's day for the selected instant, read with that instant as asOf, not today's", async () => {
    const calls = resetCalls();
    const user = userEvent.setup();
    const dialog = await openReset(user);
    setEffective(dialog, "2026-10-19T10:00"); // Monday 14:00Z
    await toRulebookStep(user, dialog);
    await user.click(await assignOption(dialog));
    expect(await within(dialog).findByText("From 2026-10-19")).toBeTruthy();
    expect(boundary.freshness.calls).toContain("2026-10-19T14:00:00.000Z");
    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    await user.click(startButton(dialog));
    await screen.findByRole("dialog", { name: "New attempt started" });
    expect(sentDecision(calls)).toMatchObject({ kind: "assign", effectiveFrom: "2026-10-19" });
  });

  it("re-reads when the instant changes: after the reset it is the next day, and a Saturday is Monday", async () => {
    const calls = resetCalls();
    const user = userEvent.setup();
    const dialog = await openReset(user);
    setEffective(dialog, "2026-10-19T18:00"); // after Monday's 17:00 reset
    await toRulebookStep(user, dialog);
    await user.click(await assignOption(dialog));
    expect(await within(dialog).findByText("From 2026-10-20")).toBeTruthy();
    expect(boundary.freshness.calls).toContain("2026-10-19T22:00:00.000Z");

    await backToStart(user, dialog);
    setEffective(dialog, "2026-10-24T12:00"); // Saturday noon
    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    expect(await within(dialog).findByText("From 2026-10-26")).toBeTruthy();
    expect(boundary.freshness.calls).toContain("2026-10-24T16:00:00.000Z");
    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    await user.click(startButton(dialog));
    await screen.findByRole("dialog", { name: "New attempt started" });
    expect(sentDecision(calls)).toMatchObject({ kind: "assign", effectiveFrom: "2026-10-26" });
  });

  it("out of order: an answer for an earlier instant that arrives last never replaces the current one", async () => {
    const earlier = deferredFor<AccountFreshnessInputs[]>();
    const current = deferredFor<AccountFreshnessInputs[]>();
    boundary.freshness.table = [
      { from: "2026-10-19T00:00:00.000Z", answer: earlier.promise },
      { from: "2026-10-20T00:00:00.000Z", answer: current.promise },
    ];
    const calls = resetCalls();
    const user = userEvent.setup();
    const dialog = await openReset(user);
    setEffective(dialog, "2026-10-19T10:00");
    await waitFor(() => expect(boundary.freshness.calls).toContain("2026-10-19T14:00:00.000Z"));
    setEffective(dialog, "2026-10-20T10:00");
    await waitFor(() => expect(boundary.freshness.calls).toContain("2026-10-20T14:00:00.000Z"));
    await act(async () => { current.resolve([freshnessRow(A, "2026-10-20", "2026-10-20T21:00:00.000Z")]); });
    await act(async () => { earlier.resolve([freshnessRow(A, "2026-10-19", "2026-10-19T21:00:00.000Z")]); });
    await toRulebookStep(user, dialog);
    await user.click(await assignOption(dialog));
    expect(await within(dialog).findByText("From 2026-10-20")).toBeTruthy();
    expect(within(dialog).queryByText("From 2026-10-19")).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    await user.click(startButton(dialog));
    await screen.findByRole("dialog", { name: "New attempt started" });
    expect(sentDecision(calls)).toMatchObject({ kind: "assign", effectiveFrom: "2026-10-20" });
  });

  for (const [state, answer, reason] of [
    ["pending", () => deferredFor<AccountFreshnessInputs[]>().promise, /Reading the first trading day for this reset time/],
    ["an error", () => new Error("unavailable"), /The first trading day for this reset time couldn't be read/],
    ["no row for the account", () => [], /The first trading day for this reset time couldn't be read/],
  ] as const) {
    it(`blocks submitting an assignment while the day is ${state}, and says why`, async () => {
      boundary.freshness.table = [{ from: "2000-01-01T00:00:00.000Z", answer: answer() }];
      const calls = resetCalls();
      const user = userEvent.setup();
      const dialog = await openReset(user);
      await toRulebookStep(user, dialog);
      await user.click(await assignOption(dialog));
      expect(within(dialog).getByText("First trading day: Unknown")).toBeTruthy();
      await user.click(within(dialog).getByRole("button", { name: "Next" }));
      const start = startButton(dialog);
      expect(start.getAttribute("aria-disabled")).toBe("true");
      // An error is retried once before it counts as unreadable.
      await waitFor(() => expect(document.getElementById(start.getAttribute("aria-describedby")!)?.textContent).toMatch(reason));
      await user.click(start);
      expect(calls).not.toHaveBeenCalled();
      // No calendar-day fallback is shown as the rulebook's day: the calendar day here is 2026-10-21.
      expect(within(dialog).queryByText(/From 2026-10-21|2026-10-21 \(trading day\)/)).toBeNull();
      expect(within(dialog).getByText("Rulebook from").nextElementSibling?.textContent).toBe("Unknown");
    });
  }

  it("an outdated day blocks too: after the instant changes, the old answer is not used while the new one is read", async () => {
    const later = deferredFor<AccountFreshnessInputs[]>();
    boundary.freshness.table = [...rustDays(), { from: "2026-10-22T00:00:00.000Z", answer: later.promise }];
    const calls = resetCalls();
    const user = userEvent.setup();
    const dialog = await openReset(user);
    await toRulebookStep(user, dialog);
    await user.click(await assignOption(dialog));
    expect(await within(dialog).findByText("From 2026-10-21")).toBeTruthy();
    await backToStart(user, dialog);
    setEffective(dialog, "2026-10-22T10:00");
    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    expect(startButton(dialog).getAttribute("aria-disabled")).toBe("true");
    expect(within(dialog).queryByText(/2026-10-21 \(trading day\)/)).toBeNull();
    await user.click(startButton(dialog));
    expect(calls).not.toHaveBeenCalled();
  });

  it("Q1 = yes: Decide later stays submittable while the day is unresolved (it sends no date)", async () => {
    boundary.freshness.table = [{ from: "2000-01-01T00:00:00.000Z", answer: deferredFor<AccountFreshnessInputs[]>().promise }];
    const calls = resetCalls();
    const user = userEvent.setup();
    const dialog = await openReset(user);
    await toRulebookStep(user, dialog);
    await user.click(await within(dialog).findByRole("radio", { name: /Decide later/ }));
    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    expect(startButton(dialog).getAttribute("aria-disabled")).toBeNull();
    await user.click(startButton(dialog));
    await screen.findByRole("dialog", { name: "New attempt started" });
    expect(sentDecision(calls)).toEqual({ kind: "decideLater" });
  });
});

describe("Accounts list: the rulebook in force follows Rust's trading day", () => {
  async function assignFrom(day: string) {
    const v = (await holder.store.repository.rulebooks.listVersions("01900000-0000-7000-8000-000000000090"))[0];
    await holder.store.repository.rulebooks.assign(
      { accountId: A, rulebookVersionId: v.version.id, effectiveFrom: day, programmePhaseId: null, phasePathId: null, accountPhaseEventId: null },
      { expectedOpenAssignmentId: null, actor: "local_user", reason: null },
    );
  }

  it("Saturday noon: an assignment from Monday 2026-10-26 is in force (Rust's day), though the calendar day is earlier", async () => {
    fresh("2026-10-24T16:00:00.000Z");
    await assignFrom("2026-10-26");
    renderAt("/accounts");
    const table = await screen.findByRole("table");
    expect(await within(table).findByText(/Example 50K/)).toBeTruthy();
  });

  it("shows Unknown, never a calendar-day guess, when the trading day can't be read", async () => {
    boundary.freshness.table = [{ from: "2000-01-01T00:00:00.000Z", answer: new Error("unavailable") }];
    await assignFrom("2026-10-19");
    renderAt("/accounts");
    const table = await screen.findByRole("table");
    // The rulebook cell says why it is Unknown; the version the calendar day would pick (from 2026-10-19) is not named.
    expect(await within(table).findByText(/Today's trading day couldn't be read/, {}, { timeout: 3000 })).toBeTruthy();
    expect(within(table).queryByText(/Example 50K/)).toBeNull();
  });
});
