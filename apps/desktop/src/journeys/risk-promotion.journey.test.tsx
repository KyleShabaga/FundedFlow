// @vitest-environment jsdom
// P0-02 journeys through the real <App /> (Today's Calculate estimate): a calculation whose sources changed before it
// was saved is a definite refusal (nothing saved, nothing locked, statements kept, no automatic retry), and the P0-03
// uncertain-write review tells a stored calculation from the current result. Native atomicity is proven in Rust.
import { RepositoryError } from "@fundedflow/domain";
import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../test/boundaries")).tauriCoreMock);
vi.mock("../lib/data/api", async () => (await import("../test/boundaries")).apiMock);
vi.mock("@tauri-apps/plugin-dialog", async () => (await import("../test/boundaries")).dialogPluginMock);

import { createAppStore, makeAccount, makeTrade, type AppStore } from "../test/app-store";
import { installBrowserShims, renderApp, resetHarness, warmUpApp } from "../test/harness";

beforeAll(installBrowserShims);
beforeAll(warmUpApp);
beforeEach(() => { vi.useFakeTimers({ now: new Date("2026-10-20T14:00:00.000Z"), shouldAdvanceTime: true, toFake: ["Date"] }); });
afterEach(resetHarness);

const A = "acct-a";
type User = ReturnType<typeof renderApp>["user"];
const isDisabled = (el: HTMLElement) => el.getAttribute("aria-disabled") === "true" || (el as HTMLButtonElement).disabled === true;

async function openCalculate(user: User) {
  await screen.findByRole("heading", { level: 1 });
  await user.click(await screen.findByRole("button", { name: "Calculate estimate" }));
  const dialog = await screen.findByRole("dialog", { name: "Calculate estimate" });
  // A statement the trader makes for this calculation; it must survive a refusal.
  await user.click(within(dialog).getByRole("combobox", { name: /Fees are complete/ }));
  await user.click(await screen.findByRole("option", { name: "Yes, complete" }));
  const button = within(dialog).getByRole("button", { name: "Calculate and save" });
  await waitFor(() => expect(isDisabled(button)).toBe(false));
  return { dialog, button };
}
const addTrade = (store: AppStore, id: string) => store.trades.set(id, { trade: makeTrade({ id, accountId: A, symbol: "NQZ6", realizedPnl: "-900" }), deletedAt: null });

function setup() {
  const store = createAppStore({ accounts: [makeAccount({ id: A, name: "Eval A" })], trades: [makeTrade({ id: "t1", accountId: A })], activeId: A });
  return renderApp("/", store);
}

describe("P0-02: a calculation from changed records is refused, not saved", () => {
  it("a trade recorded while it calculated: nothing saved, nothing locked, statements kept, and the trader's next calculation saves once", async () => {
    const { store, user } = setup();
    const { dialog, button } = await openCalculate(user);
    // The sources are captured and evaluated; the trade lands before the native promotion runs.
    const saving = store.hold("snapshots.promote");
    await user.click(button);
    await waitFor(() => expect(saving.calls).toHaveLength(1));
    addTrade(store, "t-late");
    await act(() => saving.release());
    expect(await within(dialog).findByText("Not saved: the records changed")).toBeTruthy();
    expect(store.today.snapshots).toHaveLength(0);
    expect(store.today.promotions).toHaveLength(0);
    // Definite, so not an uncertain lock: no Check result, the trader may calculate again at once.
    expect(within(dialog).queryByText("Couldn't confirm it saved")).toBeNull();
    await waitFor(() => expect(isDisabled(button)).toBe(false));
    expect(within(dialog).getByRole("combobox", { name: /Fees are complete/ }).textContent).toContain("Yes, complete");
    // Nothing was retried on its own.
    expect(saving.calls).toHaveLength(1);
    await user.click(button);
    await waitFor(() => expect(store.today.promotions).toHaveLength(1));
    expect(store.today.snapshots).toHaveLength(1);
    const promoted = store.today.snapshots[0]!;
    const frozen = (promoted.explanation.inputs as { trades: { id: string }[] }).trades.map(t => t.id);
    expect(frozen).toContain("t-late");
  });

  it("a lost answer is reviewed against stored and current: the review says which stored calculation is current", async () => {
    const { store, user } = setup();
    const { dialog, button } = await openCalculate(user);
    const write = store.hold("snapshots.promote");
    await user.click(button);
    await waitFor(() => expect(write.calls).toHaveLength(1));
    await act(() => write.lose(new RepositoryError({ kind: "database", message: "disk I/O error" })));
    await user.click(await within(dialog).findByRole("button", { name: "Check result" }));
    const list = await within(dialog).findByLabelText("Saved calculations, newest first");
    expect(within(list).getByText(/the current result \(its records are unchanged\)/)).toBeTruthy();
    // A record written meanwhile: the same stored calculation is still listed, but no longer as unchanged.
    addTrade(store, "t-after");
    await user.click(within(dialog).getByRole("button", { name: "I've checked; allow saving again" }));
    await waitFor(() => expect(within(dialog).queryByText("Couldn't confirm it saved")).toBeNull());
    expect(write.calls).toHaveLength(1);
    expect(store.today.promotions).toHaveLength(1);
  });

  it("a stored calculation that is no longer current is labelled as such in the review", async () => {
    const { store, user } = setup();
    const { dialog, button } = await openCalculate(user);
    const write = store.hold("snapshots.promote");
    await user.click(button);
    await waitFor(() => expect(write.calls).toHaveLength(1));
    await act(() => write.lose(new RepositoryError({ kind: "database", message: "disk I/O error" })));
    addTrade(store, "t-after");
    await user.click(await within(dialog).findByRole("button", { name: "Check result" }));
    const list = await within(dialog).findByLabelText("Saved calculations, newest first");
    expect(within(list).getByText(/the current result, but its records have changed since/)).toBeTruthy();
    expect(write.calls).toHaveLength(1);
  });
});
