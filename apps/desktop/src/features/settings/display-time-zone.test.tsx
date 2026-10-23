// @vitest-environment jsdom
// P0-D05: the display time-zone preference and its Settings control, over the in-memory settings store. The
// desktop zone is pinned by stubbing what the runtime reports, so nothing depends on the test machine's zone.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeState } from "../../app/RuntimeProvider";
import { createTodayStore } from "../today/test-store";
import { DisplayTimeZoneSection } from "./components/DisplayTimeZoneSection";
import { DISPLAY_TIME_ZONE_SETTING, resolveDisplayTimeZone } from "./display-time-zone";

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

const SAMPLE = "2026-10-21T23:13:00.000Z";
let desktop = "Europe/London";
let client: QueryClient;

function stubDesktopZone() {
  const original = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(function (this: Intl.DateTimeFormat) {
    return { ...original.call(this), timeZone: desktop };
  });
}
function renderSection() {
  return render(
    <QueryClientProvider client={client}>
      <DisplayTimeZoneSection sampleAt={SAMPLE} />
    </QueryClientProvider>,
  );
}
const section = () => screen.getByRole("region", { name: "Date and time" });

beforeEach(() => {
  desktop = "Europe/London";
  stubDesktopZone();
  runtime.state = { kind: "ready", status: { state: "ready", stage: "ready", schemaVersion: 17, supportedSchemaVersion: 17, created: false, failure: null, cleanup: "clear" } } as unknown as RuntimeState;
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  holder.store = createTodayStore([]);
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

describe("resolveDisplayTimeZone", () => {
  it("defaults to desktop mode when nothing is saved", () => {
    expect(resolveDisplayTimeZone(null, "Europe/London")).toEqual({ kind: "resolved", zone: "Europe/London", source: "desktop" });
  });
  it("keeps desktop mode as a mode, following whatever the computer reports", () => {
    expect(resolveDisplayTimeZone({ mode: "desktop" }, "Asia/Tokyo")).toMatchObject({ zone: "Asia/Tokyo", source: "desktop" });
  });
  it("uses a chosen zone whatever the computer reports", () => {
    expect(resolveDisplayTimeZone({ mode: "zone", zone: "America/New_York" }, "Asia/Tokyo")).toMatchObject({ zone: "America/New_York", source: "chosen" });
  });
  it("falls back to desktop time, visibly, for an unsupported or unreadable preference", () => {
    expect(resolveDisplayTimeZone({ mode: "zone", zone: "Mars/Olympus_Mons" }, "Asia/Tokyo")).toEqual({
      kind: "resolved", zone: "Asia/Tokyo", source: "fallback", problem: "unsupported-zone", savedZone: "Mars/Olympus_Mons",
    });
    expect(resolveDisplayTimeZone({ mode: "zone", zone: "+01:00" }, "Asia/Tokyo")).toMatchObject({ source: "fallback", problem: "unsupported-zone" });
    expect(resolveDisplayTimeZone("Europe/London", "Asia/Tokyo")).toMatchObject({ source: "fallback", problem: "unreadable" });
  });
});

describe("Settings → Date and time", () => {
  it("starts in desktop mode for a user with no preference and names the zone in effect", async () => {
    renderSection();
    const desktopRadio = await screen.findByRole("radio", { name: /Use desktop time zone/ });
    await waitFor(() => expect(desktopRadio).toHaveProperty("checked", true));
    expect(section().textContent).toContain("Europe/London (this computer's time zone)");
    expect(section().textContent).toContain("Oct 22, 2026, 00:13 GMT+1");
    expect(section().textContent).toContain("Account trading days and rule calculations use the account's time zone");
    expect(holder.store.settings.has(DISPLAY_TIME_ZONE_SETTING)).toBe(false);
  });

  it("saves a chosen named zone, found by search, and keeps it after a restart", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole("radio", { name: /Choose time zone/ }));
    await waitFor(() => expect(holder.store.settings.get(DISPLAY_TIME_ZONE_SETTING)).toEqual({ mode: "zone", zone: "Europe/London" }));

    await user.type(await screen.findByRole("searchbox", { name: "Find a time zone" }), "kolk");
    const trigger = screen.getByRole("combobox", { name: "Time zone" });
    trigger.focus();
    await user.keyboard("{Enter}");
    await user.click(await screen.findByRole("option", { name: /Asia\/Kolkata/ }));
    // Saved under the runtime's own id for the zone (ICU still says Asia/Calcutta), shown as Asia/Kolkata.
    await waitFor(() => expect(holder.store.settings.get(DISPLAY_TIME_ZONE_SETTING)).toMatchObject({ mode: "zone", zone: expect.stringMatching(/^Asia\/(Kolkata|Calcutta)$/) }));
    expect(section().textContent).toContain("Times show inAsia/Kolkata");
    await waitFor(() => expect(section().textContent).toContain("Oct 22, 2026, 04:43 GMT+5:30"));

    // Restart: a fresh query cache reads the stored preference; desktop changes don't move it.
    cleanup();
    client.clear();
    desktop = "America/New_York";
    renderSection();
    await waitFor(() => expect(screen.getByRole("radio", { name: /Choose time zone/ })).toHaveProperty("checked", true));
    expect(section().textContent).toContain("Oct 22, 2026, 04:43 GMT+5:30");
  });

  it("follows a desktop time-zone change when the window regains focus, in desktop mode only", async () => {
    renderSection();
    await waitFor(() => expect(section().textContent).toContain("Oct 22, 2026, 00:13 GMT+1"));
    desktop = "America/New_York";
    act(() => { window.dispatchEvent(new Event("focus")); });
    expect(section().textContent).toContain("America/New York, GMT-4 now");
    expect(section().textContent).toContain("Oct 21, 2026, 19:13 GMT-4");
    expect(holder.store.settings.has(DISPLAY_TIME_ZONE_SETTING)).toBe(false);
  });

  it("returns to desktop mode as a mode, not as the zone the computer has today", async () => {
    holder.store.settings.set(DISPLAY_TIME_ZONE_SETTING, { mode: "zone", zone: "Asia/Tokyo" });
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole("radio", { name: /Use desktop time zone/ }));
    await waitFor(() => expect(holder.store.settings.get(DISPLAY_TIME_ZONE_SETTING)).toEqual({ mode: "desktop" }));
  });

  it("shows desktop time and says why when the saved zone isn't supported", async () => {
    holder.store.settings.set(DISPLAY_TIME_ZONE_SETTING, { mode: "zone", zone: "Mars/Olympus_Mons" });
    renderSection();
    await screen.findByText("Saved time zone isn't available");
    expect(section().textContent).toContain("Mars/Olympus_Mons isn't supported on this computer");
    expect(section().textContent).toContain("Oct 22, 2026, 00:13 GMT+1");
  });

  it("reports a failed save and keeps the zone in effect", async () => {
    holder.store.repository.settings.set = async () => { throw new Error("disk full"); };
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole("radio", { name: /Choose time zone/ }));
    await screen.findByText("Time zone not saved");
    expect(section().textContent).toContain("Times still show in Europe/London (this computer's time zone)");
    expect(screen.getByRole("radio", { name: /Use desktop time zone/ })).toHaveProperty("checked", true);
  });
});
