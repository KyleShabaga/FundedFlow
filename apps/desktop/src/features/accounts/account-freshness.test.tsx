// @vitest-environment jsdom
// P0-D06 through the real account selector and the Settings section: the active account is the checked choice (no
// checkmark, not disabled), every row has a dot and a written reason, the policy is chosen in Settings, persists,
// resets and re-colours the dots without a restart, and the display time zone changes only the explanation.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeState } from "../../app/RuntimeProvider";
import { ToastProvider } from "../../design-system";
import type { AccountFreshnessInputs } from "../../lib/data/freshness";
import { FreshnessPolicySection } from "../settings/components/FreshnessPolicySection";
import { DISPLAY_TIME_ZONE_SETTING } from "../settings/display-time-zone";
import { createTodayStore } from "../today/test-store";
import { ACTIVE_ACCOUNT_SETTING } from "./active-account";
import { AccountSwitcher } from "./components/AccountSwitcher";
import { FRESHNESS_POLICY_SETTING } from "./freshness";
import { makeAccount } from "./test-store";

const runtime = vi.hoisted(() => ({ state: { kind: "ready" } as unknown as RuntimeState, check: vi.fn() }));
const holder = vi.hoisted(() => ({ store: null as unknown as ReturnType<typeof createTodayStore> }));
const native = vi.hoisted(() => ({ rows: [] as unknown[], calls: [] as string[], fail: false }));
vi.mock("../../app/RuntimeProvider", () => ({ useRuntime: () => runtime }));
vi.mock("../../lib/data/api", () => ({ get repository() { return holder.store.repository; } }));
vi.mock("../../lib/data/freshness", async importOriginal => ({
  ...(await importOriginal<object>()),
  freshnessGateway: {
    list: async (asOf: string) => {
      native.calls.push(asOf);
      if (native.fail) throw new Error("unavailable");
      return structuredClone(native.rows);
    },
  },
}));

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});

const NOW = "2026-10-21T18:00:00.000Z";
const STARTS = ["2026-10-20T21:00:00.000Z", "2026-10-19T21:00:00.000Z", "2026-10-16T21:00:00.000Z"];
const row = (accountId: string, over: Partial<AccountFreshnessInputs> = {}): AccountFreshnessInputs => ({
  accountId, currentTradingDay: "2026-10-21", tradingDayStarts: STARTS, nextTradingDayStart: "2026-10-21T21:00:00.000Z",
  lastCommittedImportAt: null, lastFailedImportAt: null, lastManualTradeAt: null, lastConfirmedCheckpointAt: null, ...over,
});
let client: QueryClient;

function renderUi(withSettings = false) {
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <AccountSwitcher />
          {withSettings && <FreshnessPolicySection />}
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}
async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: /Eval [AB]/, description: "Account" }));
  return screen.findByRole("menu");
}
const choice = (menu: HTMLElement, name: RegExp) => within(menu).getByRole("menuitemradio", { name });

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(NOW), shouldAdvanceTime: true, toFake: ["Date"] });
  runtime.state = { kind: "ready", status: { state: "ready", stage: "ready", schemaVersion: 17, supportedSchemaVersion: 17, created: false, failure: null, cleanup: "clear" } } as unknown as RuntimeState;
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  holder.store = createTodayStore([
    makeAccount({ id: "a", name: "Eval A" }),
    makeAccount({ id: "b", name: "Eval B" }),
    makeAccount({ id: "c", name: "Eval C" }),
    makeAccount({ id: "d", name: "Old attempt", status: "failed" }),
  ]);
  holder.store.settings.set(ACTIVE_ACCOUNT_SETTING, "a");
  holder.store.settings.set(DISPLAY_TIME_ZONE_SETTING, { mode: "zone", zone: "America/New_York" });
  native.fail = false;
  native.calls = [];
  native.rows = [
    row("a", { lastCommittedImportAt: "2026-10-21T13:00:00.000Z" }), // fresh
    row("b", { lastCommittedImportAt: "2026-10-16T13:00:00.000Z" }), // before the previous trading day
    row("c"), // nothing yet
    row("d", { lastCommittedImportAt: "2026-09-01T13:00:00.000Z" }), // finished
  ];
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("account menu", () => {
  it("marks the active account as the checked choice, without a checkmark and without disabling it", async () => {
    const user = userEvent.setup();
    renderUi();
    const menu = await openMenu(user);
    const a = choice(menu, /Eval A/);
    expect(a.getAttribute("aria-checked")).toBe("true");
    expect(a.getAttribute("aria-disabled")).toBeNull();
    expect(a.querySelector(".lucide-check")).toBeNull();
    expect(choice(menu, /Eval B/).getAttribute("aria-checked")).toBe("false");
    // Live and finished sections stay.
    expect(within(menu).getByText("Live accounts")).toBeTruthy();
    expect(within(menu).getByText("Finished attempts")).toBeTruthy();
    // Choosing the active account again changes nothing.
    await user.click(a);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(holder.store.settings.get(ACTIVE_ACCOUNT_SETTING)).toBe("a");
  });

  it("gives every row a dot and its reason in words, never green for missing data", async () => {
    const user = userEvent.setup();
    renderUi();
    const menu = await openMenu(user);
    await waitFor(() => expect(choice(menu, /Eval A/).textContent).toContain("Fresh · updated Oct 21, 09:00 GMT-4"));
    expect(choice(menu, /Eval A/).querySelector(".ds-dot-success")).not.toBeNull();
    expect(choice(menu, /Eval B/).textContent).toContain("Needs attention · last update Oct 16, 09:00 GMT-4");
    expect(choice(menu, /Eval B/).querySelector(".ds-dot-caution")).not.toBeNull();
    expect(choice(menu, /Eval C/).textContent).toContain("Unknown · no records yet");
    expect(choice(menu, /Eval C/).querySelector(".ds-dot-unknown")).not.toBeNull();
    expect(choice(menu, /Old attempt/).textContent).toContain("Unknown · finished attempt, no new data expected");
    expect(within(menu).getByText(/Fresh means records updated since the previous trading day began \(default policy\)\. It isn't a live connection/)).toBeTruthy();
    // One read for every account.
    expect(native.calls).toHaveLength(1);
  });

  it("shows unknown, not fresh, when the inputs can't be read", async () => {
    native.fail = true;
    const user = userEvent.setup();
    renderUi();
    const menu = await openMenu(user);
    await waitFor(() => expect(choice(menu, /Eval A/).textContent).toContain("Unknown · couldn't check"));
    expect(menu.querySelector(".ds-dot-success")).toBeNull();
  });

  it("changes only the explanation's time zone when the display zone changes", async () => {
    const user = userEvent.setup();
    renderUi();
    let menu = await openMenu(user);
    await waitFor(() => expect(choice(menu, /Eval A/).textContent).toContain("Fresh · updated Oct 21, 09:00 GMT-4"));
    await user.keyboard("{Escape}");
    holder.store.settings.set(DISPLAY_TIME_ZONE_SETTING, { mode: "zone", zone: "Asia/Tokyo" });
    await act(() => client.invalidateQueries({ queryKey: ["fundedflow", "features", "settings"] }));
    menu = await openMenu(user);
    await waitFor(() => expect(choice(menu, /Eval A/).textContent).toContain("Fresh · updated Oct 21, 22:00 GMT+9"));
    expect(choice(menu, /Eval B/).querySelector(".ds-dot-caution")).not.toBeNull();
  });

  it("re-reads after a write and when the window regains focus", async () => {
    // Saved during Tuesday's trading day: fresh on Wednesday, stale once Thursday's begins.
    native.rows[0] = row("a", { lastCommittedImportAt: "2026-10-20T13:00:00.000Z" });
    const user = userEvent.setup();
    renderUi();
    let menu = await openMenu(user);
    await waitFor(() => expect(choice(menu, /Eval A/).textContent).toContain("Fresh"));
    await user.keyboard("{Escape}");
    // Choosing an account is a write: the inputs are read again (one call for every account).
    menu = await openMenu(user);
    await user.click(choice(menu, /Eval B/));
    await waitFor(() => expect(native.calls).toHaveLength(2));
    // After Thursday's trading day begins, Rust's new boundaries make A's records stale; focus re-reads them.
    native.rows = native.rows.map(r => ({ ...(r as AccountFreshnessInputs), tradingDayStarts: ["2026-10-21T21:00:00.000Z", ...STARTS], nextTradingDayStart: "2026-10-22T21:00:00.000Z" }));
    vi.setSystemTime(new Date("2026-10-21T21:00:02.000Z"));
    act(() => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(native.calls).toHaveLength(3));
    menu = await openMenu(user);
    await waitFor(() => expect(within(menu).getByRole("menuitemradio", { name: /Eval A/ }).textContent).toContain("Needs attention"));
  });
});

describe("Settings → Account freshness", () => {
  it("defaults, saves a preset at once, re-colours the dots without a restart, and resets to the default", async () => {
    const user = userEvent.setup();
    renderUi(true);
    const policy = await screen.findByRole("radiogroup", { name: /Freshness policy/ });
    await waitFor(() => expect(within(policy).getByRole("radio", { name: /Default: updated since the previous trading day/ })).toHaveProperty("checked", true));
    await user.click(within(policy).getByRole("radio", { name: /Records within 3 days and a firm checkpoint/ }));
    await waitFor(() => expect(holder.store.settings.get(FRESHNESS_POLICY_SETTING)).toEqual({ mode: "with_checkpoint" }));
    const menu = await openMenu(user);
    await waitFor(() => expect(choice(menu, /Eval A/).textContent).toContain("Needs attention · no firm checkpoint confirmed"));
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: "Reset to default" }));
    await waitFor(() => expect(holder.store.settings.get(FRESHNESS_POLICY_SETTING)).toEqual({ mode: "default" }));
    expect(within(policy).getByRole("radio", { name: /Default/ })).toHaveProperty("checked", true);
  });

  it("validates a custom policy, saves it and keeps it after a restart", async () => {
    const user = userEvent.setup();
    renderUi(true);
    const policy = await screen.findByRole("radiogroup", { name: /Freshness policy/ });
    await user.click(within(policy).getByRole("radio", { name: /Custom/ }));
    const count = screen.getByRole("textbox", { name: /Records updated within/ });
    await user.clear(count);
    await user.type(count, "12");
    await user.click(screen.getByRole("button", { name: "Save custom policy" }));
    expect(await screen.findByText("Enter a whole number from 1 to 9.")).toBeTruthy();
    expect(holder.store.settings.has(FRESHNESS_POLICY_SETTING)).toBe(false);

    await user.clear(count);
    await user.type(count, "2");
    await user.click(screen.getByRole("switch", { name: /Require a firm checkpoint/ }));
    const days = screen.getByRole("textbox", { name: /Checkpoint within/ });
    await user.clear(days);
    await user.type(days, "14");
    await user.click(screen.getByRole("button", { name: "Save custom policy" }));
    await waitFor(() => expect(holder.store.settings.get(FRESHNESS_POLICY_SETTING)).toEqual({
      mode: "custom", rules: { records: { unit: "trading_days", count: 2 }, checkpoint: { required: true, maxDays: 14 } },
    }));
    expect(screen.getByText(/Records updated within the last 2 trading days, and a firm checkpoint you confirmed in the last 14 days\./)).toBeTruthy();

    cleanup();
    client.clear();
    renderUi(true);
    const again = await screen.findByRole("radiogroup", { name: /Freshness policy/ });
    await waitFor(() => expect(within(again).getByRole("radio", { name: /Custom/ })).toHaveProperty("checked", true));
  });

  it("falls back to the default, visibly, when the saved policy can't be used", async () => {
    holder.store.settings.set(FRESHNESS_POLICY_SETTING, { mode: "always_green" });
    renderUi(true);
    await screen.findByText("Saved policy couldn't be used");
    const user = userEvent.setup();
    const menu = await openMenu(user);
    expect(within(menu).getByText(/because the saved one can't be used/)).toBeTruthy();
  });
});
