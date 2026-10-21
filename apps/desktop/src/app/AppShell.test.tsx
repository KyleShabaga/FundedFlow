// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
// The shell is tested on its own: the Accounts page and header account selector make their own
// data reads and are covered by features/accounts/accounts.test.tsx.
vi.mock("../features/accounts/components/AccountsPage", () => ({ AccountsPage: () => <h2>Accounts is not built yet</h2> }));
vi.mock("../features/journal/components/JournalPage", () => ({ JournalPage: () => <h2>Journal is not built yet</h2> }));
vi.mock("../features/daily-reviews/components/DailyReviewPage", () => ({ DailyReviewPage: () => <h2>Daily review stub</h2> }));
vi.mock("../features/today/components/TodayPage", () => ({ TodayPage: () => <h2>Today is not built yet</h2> }));
vi.mock("../features/insights/components/InsightsPage", () => ({ InsightsPage: () => <h2>Insights is not built yet</h2> }));
vi.mock("../features/accounts/components/AccountSwitcher", () => ({ AccountSwitcher: () => null }));
vi.mock("../features/data-controls/components/DataControlsPage", () => ({ DataControlsPage: () => <h2>Settings is not built yet</h2> }));
import App from "../App";
import { AppFrame } from "../design-system";

let narrow = false;
let change: (() => void) | undefined;
const paths = [["Today", "/"], ["Journal", "/journal"], ["Insights", "/insights"], ["Accounts", "/accounts"], ["Settings", "/settings"]];
const current = () => screen.getByRole("navigation", { name: "Primary navigation" }).querySelectorAll('[aria-current="page"]');

beforeEach(() => {
  window.location.hash = "/";
  localStorage.clear();
  narrow = false;
  change = undefined;
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    get matches() { return narrow; },
    addEventListener: (_: string, listener: () => void) => { change = listener; },
    removeEventListener: vi.fn(),
  })));
  invoke.mockReset().mockResolvedValue({
    state: "ready", stage: "ready", schemaVersion: 13,
    supportedSchemaVersion: 13, created: true, failure: null,
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each(paths)("opens %s from its hash and retains it after a frontend remount", async (name, path) => {
  window.location.hash = path;
  let view = render(<App />);
  await screen.findByRole("heading", { name: `${name} is not built yet` });
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(name);
  expect(current().length).toBe(1);
  expect(current()[0].getAttribute("aria-label")).toBe(name);
  view.unmount();
  view = render(<App />);
  await screen.findByRole("heading", { name: `${name} is not built yet` });
  expect(window.location.hash).toBe(`#${path}`);
  view.unmount();
});

it("navigates all pages with one persistent sidebar, active item and runtime owner", async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("heading", { name: "Today is not built yet" });
  const nav = screen.getByRole("navigation", { name: "Primary navigation" });
  expect(within(nav).getAllByRole("link")).toHaveLength(5);
  for (const [name, path] of paths.slice(1)) {
    await user.click(within(nav).getByRole("link", { name }));
    await screen.findByRole("heading", { name: `${name} is not built yet` });
    expect(window.location.hash).toBe(`#${path}`);
    expect(current().length).toBe(1);
    expect(current()[0].getAttribute("aria-label")).toBe(name);
    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBe(nav);
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1 }));
  }
  expect(invoke.mock.calls).toEqual([["runtime_status"]]);
  expect(screen.queryByText(/no accounts/i)).toBeNull();
});

it("shows a useful unknown route and returns to Today without a false active item", async () => {
  window.location.hash = "/journal/missing";
  render(<App />);
  expect(screen.getByRole("heading", { name: "Page not found" })).toBeTruthy();
  expect(current()).toHaveLength(0);
  await userEvent.setup().click(screen.getByRole("link", { name: "Go to Today" }));
  await screen.findByRole("heading", { name: "Today is not built yet" });
  expect(current()[0].getAttribute("aria-label")).toBe("Today");
});

it.each(["/journal/", "/JOURNAL"])("keeps the title and active item aligned for %s", async path => {
  window.location.hash = path;
  render(<App />);
  await screen.findByRole("heading", { name: "Journal is not built yet" });
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Journal");
  expect(current()[0].getAttribute("aria-label")).toBe("Journal");
});

it("titles a day's review and keeps Journal active", async () => {
  window.location.hash = "/journal/days/2026-10-19?account=a1";
  render(<App />);
  await screen.findByRole("heading", { name: "Daily review stub" });
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Daily review");
  expect(current()[0].getAttribute("aria-label")).toBe("Journal");
});

it("supports skip navigation, Tab/Enter links, Space toggle, Ctrl+B and Escape", async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("heading", { name: "Today is not built yet" });
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole("link", { name: "Skip to main content" }));
  await user.keyboard("{Enter}");
  expect(document.activeElement).toBe(screen.getByRole("main"));
  expect(window.location.hash).toBe("#/");
  screen.getByRole("button", { name: "Collapse sidebar" }).focus();
  await user.keyboard(" ");
  expect(screen.getByRole("button", { name: "Expand sidebar" }).getAttribute("aria-expanded")).toBe("false");
  await user.keyboard("{Escape}");
  expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeTruthy();
  await user.keyboard("{Control>}b{/Control}");
  expect(screen.getByRole("button", { name: "Collapse sidebar" })).toBeTruthy();
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole("link", { name: "Today" }));
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole("link", { name: "Journal" }));
  await user.keyboard("{Enter}");
  await screen.findByRole("heading", { name: "Journal is not built yet" });
});

it("retains the collapse preference across navigation and remounts with named icon links", async () => {
  const user = userEvent.setup();
  const view = render(<App />);
  await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
  const nav = screen.getByRole("navigation", { name: "Primary navigation" });
  for (const [name] of paths) expect(within(nav).getByRole("link", { name }).title).toBe(name);
  await user.click(within(nav).getByRole("link", { name: "Accounts" }));
  expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeTruthy();
  view.unmount();
  render(<App />);
  expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeTruthy();
});

it("automatically uses an icon rail on narrow windows and restores the wide preference", async () => {
  render(<App />);
  await screen.findByRole("heading", { name: "Today is not built yet" });
  act(() => { narrow = true; change?.(); });
  expect((screen.getByRole("button", { name: "Sidebar collapsed for narrow window" }) as HTMLButtonElement).disabled).toBe(true);
  expect(document.querySelector(".ds-app-frame.is-collapsed")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Settings" })).toBeTruthy();
  act(() => { narrow = false; change?.(); });
  expect(screen.getByRole("button", { name: "Collapse sidebar" })).toBeTruthy();
});

it("keeps navigation and Settings available when runtime fails and never enables import", async () => {
  invoke.mockRejectedValue(new Error("bridge unavailable"));
  render(<App />);
  await screen.findByRole("alert");
  // Import CSV offers Quick import and the full wizard; both stay behind the runtime gate, so nothing is read or sent.
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Import CSV" }));
  await user.click(await screen.findByRole("menuitem", { name: /Quick import/ }));
  await waitFor(() => expect(window.location.hash).toBe("#/import/quick"));
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Quick import");
  await user.click(screen.getByRole("button", { name: "Import CSV" }));
  await user.click(await screen.findByRole("menuitem", { name: /Full wizard/ }));
  await waitFor(() => expect(window.location.hash).toBe("#/import"));
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Import trades");
  expect(screen.queryByRole("link", { name: "Import CSV" })).toBeNull();
  expect(screen.queryByRole("navigation", { name: "Primary navigation" })!.querySelector('[aria-current="page"]')).toBeNull();
  await userEvent.setup().click(screen.getByRole("link", { name: "Settings" }));
  await screen.findByRole("heading", { name: "Settings is not built yet" });
  await waitFor(() => expect(invoke.mock.calls).toEqual([["runtime_status"]]));
});

it("renders the shared frame without a router or runtime host", () => {
  const view = render(<AppFrame collapsed={false} sidebar={<p>Sidebar slot</p>} header={<h1>Header slot</h1>}><main>Content slot</main></AppFrame>);
  expect(screen.getByRole("complementary").textContent).toBe("Sidebar slot");
  expect(screen.getByRole("main").textContent).toBe("Content slot");
  view.rerender(<AppFrame collapsed sidebar={null} header={null}>Rail</AppFrame>);
  expect(document.querySelector(".ds-app-frame.is-collapsed")).toBeTruthy();
  expect(invoke).not.toHaveBeenCalled();
});

it("anchors the collapse toggle on the sidebar edge beside the logo, first in keyboard order, in both widths", async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("heading", { name: "Today is not built yet" });
  const sidebar = screen.getByRole("complementary");
  const edge = sidebar.querySelector(".ds-app-sidebar-edge")!;
  const toggle = within(edge as HTMLElement).getByRole("button", { name: "Collapse sidebar" });
  // Outside the scrolling area (never clipped), and before the links so Tab reaches it next to the logo.
  expect(sidebar.querySelector(".ds-app-sidebar-scroll")!.contains(toggle)).toBe(false);
  expect(edge.compareDocumentPosition(sidebar.querySelector(".shell-nav")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(toggle.getAttribute("aria-keyshortcuts")).toBe("Control+B");
  expect(toggle.getAttribute("aria-controls")).toBe("primary-navigation");
  await user.hover(toggle);
  expect((await screen.findAllByText("Collapse sidebar (Ctrl+B)")).length).toBeGreaterThan(0);
  await user.click(toggle);
  const collapsed = within(sidebar.querySelector(".ds-app-sidebar-edge") as HTMLElement).getByRole("button", { name: "Expand sidebar" });
  expect(collapsed.getAttribute("aria-expanded")).toBe("false");
  // Navigation and the selected route survive collapsing.
  expect(within(screen.getByRole("navigation", { name: "Primary navigation" })).getByRole("link", { name: "Today" }).getAttribute("aria-current")).toBe("page");
});
