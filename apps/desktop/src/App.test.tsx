// @vitest-environment jsdom
import { useQueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
// The shell is tested on its own: the Accounts page and header account selector make their own
// data reads and are covered by features/accounts/accounts.test.tsx.
vi.mock("./features/accounts/components/AccountsPage", () => ({ AccountsPage: () => <h2>Accounts is not built yet</h2> }));
vi.mock("./features/today/components/TodayPage", () => ({ TodayPage: () => <h2>Today is not built yet</h2> }));
vi.mock("./features/accounts/components/AccountSwitcher", () => ({ AccountSwitcher: () => null }));

import App from "./App";
import { AppProviders } from "./app/AppProviders";
import { useRuntime } from "./app/RuntimeProvider";
import { RuntimeGate } from "./components/RuntimeGate";

const ready = {
  state: "ready", stage: "ready", schemaVersion: 13,
  supportedSchemaVersion: 13, created: true, failure: null,
};

beforeEach(() => {
  localStorage.clear();
  window.location.hash = "/";
  invoke.mockReset().mockResolvedValue(ready);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("renders the product foundation in a browser without loading developer data", async () => {
  render(<StrictMode><App /></StrictMode>);
  expect(screen.getByRole("heading", { name: "Today", level: 1 })).toBeTruthy();
  await screen.findByRole("heading", { name: "Today is not built yet" });
  expect(screen.queryByRole("navigation", { name: "Developer views" })).toBeNull();
  expect(invoke.mock.calls).toEqual([["runtime_status"]]);
});

it("contains an unavailable runtime without losing the product root or requesting accounts", async () => {
  invoke.mockRejectedValue(new Error("bridge unavailable"));
  render(<App />);
  await screen.findByRole("alert");
  expect(screen.getByRole("heading", { name: "Today", level: 1 })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Today is not built yet" })).toBeNull();
  expect(screen.queryByText(/no accounts/i)).toBeNull();
  expect(invoke.mock.calls).toEqual([["runtime_status"]]);
});

it("shares one router, stable query client and runtime check across consumers and rerenders", async () => {
  const clients: ReturnType<typeof useQueryClient>[] = [];
  function Probe() {
    const client = useQueryClient();
    clients.push(client);
    const { state } = useRuntime();
    const location = useLocation();
    return <p>{location.pathname}: {state.kind}</p>;
  }
  const tree = () => <AppProviders>
    <Probe />
    <RuntimeGate><p>First consumer</p></RuntimeGate>
    <RuntimeGate><p>Second consumer</p></RuntimeGate>
  </AppProviders>;
  const view = render(tree());
  await screen.findByText("/: ready");
  view.rerender(tree());
  expect(screen.getByText("First consumer")).toBeTruthy();
  expect(screen.getByText("Second consumer")).toBeTruthy();
  expect(new Set(clients).size).toBe(1);
  expect(clients[0].getQueryCache().getAll()).toEqual([]);
  expect(clients[0].getDefaultOptions().queries?.retry).toBe(false);
  expect(clients[0].getDefaultOptions().mutations?.retry).toBe(false);
  expect(invoke.mock.calls).toEqual([["runtime_status"]]);
});

it("contains render errors and returns to the root with a fresh runtime check", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  function BrokenScreen(): never { throw new Error("private internal details"); }
  window.location.hash = "/broken";
  render(<AppProviders><Routes>
    <Route path="/broken" element={<BrokenScreen />} />
    <Route path="/" element={<RuntimeGate><p>Recovered app</p></RuntimeGate>} />
  </Routes></AppProviders>);
  expect(screen.getByRole("alert").textContent).not.toContain("private internal details");
  fireEvent.click(screen.getByRole("button", { name: "Return to app" }));
  await screen.findByText("Recovered app");
  await waitFor(() => expect(window.location.hash).toBe("#/"));
  expect(invoke).toHaveBeenCalledWith("runtime_status");
});
