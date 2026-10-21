// @vitest-environment jsdom
import { useQuery } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
// The shell is tested on its own: the Accounts page and header account selector make their own
// data reads and are covered by features/accounts/accounts.test.tsx.
vi.mock("../features/accounts/components/AccountsPage", () => ({ AccountsPage: () => <h2>Accounts is not built yet</h2> }));
vi.mock("../features/accounts/components/AccountSwitcher", () => ({ AccountSwitcher: () => null }));
import App from "../App";
import { RuntimeGate } from "../components/RuntimeGate";
import { deferred, failed, ready } from "../test/runtime-fixtures";
import { AppProviders } from "./AppProviders";
import { AppShell } from "./AppShell";
import { useRuntime } from "./RuntimeProvider";

beforeEach(() => {
  window.location.hash = "/";
  localStorage.clear();
  invoke.mockReset().mockResolvedValue(ready);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("preserves an open draft and route, disables its actions and recovers without remounting", async () => {
  const user = userEvent.setup();
  const mounts = vi.fn();
  const save = vi.fn();
  function Draft() {
    const [text, setText] = useState("");
    useEffect(() => { mounts(); }, []);
    return <form onSubmit={event => { event.preventDefault(); save(text); }}>
      <label>Draft note<input value={text} onChange={event => setText(event.target.value)} /></label>
      <button type="submit">Save draft</button>
    </form>;
  }
  window.location.hash = "/journal";
  render(<AppProviders><Routes><Route element={<AppShell />}>
    <Route path="journal" element={<RuntimeGate showStatus={false}><Draft /></RuntimeGate>} />
  </Route></Routes></AppProviders>);
  const input = await screen.findByRole("textbox", { name: "Draft note" }) as HTMLInputElement;
  await user.type(input, "Keep my unsaved note");
  invoke.mockResolvedValue(failed("open_failed"));
  act(() => { window.dispatchEvent(new Event("focus")); });
  await screen.findByRole("alert");
  expect(window.location.hash).toBe("#/journal");
  expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBeTruthy();
  expect(screen.getByText(/Previously shown data may be out of date/)).toBeTruthy();
  expect(input.value).toBe("Keep my unsaved note");
  expect(input.matches(":disabled")).toBe(true);
  expect(input.closest("[inert]")).toBeTruthy();
  const button = document.querySelector('button[type="submit"]') as HTMLButtonElement;
  await user.click(button);
  expect(save).not.toHaveBeenCalled();
  expect(mounts).toHaveBeenCalledTimes(1);
  const retryResponse = deferred<unknown>();
  invoke.mockReturnValueOnce(retryResponse.promise);
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(screen.getByRole("status").textContent).toContain("Retrying local data");
  expect((screen.getByRole("button", { name: "Retrying…" }) as HTMLButtonElement).disabled).toBe(true);
  expect(input.matches(":disabled")).toBe(true);
  await act(async () => { retryResponse.resolve(ready); });
  await screen.findByRole("textbox", { name: "Draft note" });
  expect(input.matches(":disabled")).toBe(false);
  expect(input.closest("[inert]")).toBeNull();
  expect(input.value).toBe("Keep my unsaved note");
  expect(mounts).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Save draft" }));
  expect(save).toHaveBeenCalledWith("Keep my unsaved note");
  expect(invoke.mock.calls).toEqual([["runtime_status"], ["runtime_status"], ["retry_runtime"]]);
});

it("revalidates on window focus without disabling content or announcing an outage", async () => {
  const user = userEvent.setup();
  window.location.hash = "/journal";
  render(<AppProviders><Routes><Route element={<AppShell />}>
    <Route path="journal" element={<RuntimeGate showStatus={false}><label>Draft note<input /></label></RuntimeGate>} />
  </Route></Routes></AppProviders>);
  const input = await screen.findByRole("textbox", { name: "Draft note" }) as HTMLInputElement;
  await user.type(input, "Still typing");
  const recheck = deferred<unknown>();
  invoke.mockReturnValueOnce(recheck.promise);
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  expect(invoke.mock.calls).toEqual([["runtime_status"], ["runtime_status"]]);
  expect(input.matches(":disabled")).toBe(false);
  expect(input.closest("[inert]")).toBeNull();
  expect(document.activeElement).toBe(input);
  expect(screen.queryByText(/Checking local data/)).toBeNull();
  expect(screen.queryByText(/Previously shown data may be out of date/)).toBeNull();
  await act(async () => { recheck.resolve(ready); });
  expect(input.matches(":disabled")).toBe(false);
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe("Still typing");
});

it("announces availability and permits keyboard-only Retry without stealing initial focus", async () => {
  const user = userEvent.setup();
  invoke.mockResolvedValue(failed("open_failed"));
  render(<App />);
  const retry = await screen.findByRole("button", { name: "Retry" });
  expect(document.activeElement).toBe(document.body);
  expect(screen.getByRole("alert").getAttribute("aria-live")).toBe("assertive");
  expect(screen.getByText(/Do not delete or replace your journal/)).toBeTruthy();
  for (let index = 0; index < 12 && document.activeElement !== retry; index++) await user.tab();
  expect(document.activeElement).toBe(retry);
  invoke.mockResolvedValue(ready);
  await user.keyboard("{Enter}");
  await screen.findByRole("heading", { name: "Today is not built yet" });
  expect(screen.getByRole("status").textContent).toBe("Local data is available.");
  expect(document.activeElement).toBe(screen.getByRole("main"));
  expect(invoke.mock.calls).toEqual([["runtime_status"], ["retry_runtime"]]);
});

it("keeps recovery and Settings available on safe and unknown routes", async () => {
  const user = userEvent.setup();
  invoke.mockResolvedValue(failed("migration_failed"));
  window.location.hash = "/missing";
  render(<App />);
  await screen.findByRole("alert");
  expect(screen.getByRole("heading", { name: "This page doesn't exist" })).toBeTruthy();
  await user.click(screen.getByRole("link", { name: "Settings" }));
  await screen.findByRole("heading", { name: "Settings is not built yet" });
  expect(screen.getAllByRole("alert")).toHaveLength(1);
  expect(screen.getByText(/Keep your journal and pre-upgrade backup in place/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  expect((screen.getByRole("button", { name: "Import CSV" }) as HTMLButtonElement).disabled).toBe(true);
});

it("explains unsupported schema without exposing a retry, reset or downgrade action", async () => {
  invoke.mockResolvedValue(failed("newer_schema"));
  render(<App />);
  await screen.findByRole("alert");
  expect(screen.getByText(/Install a FundedFlow version that supports this journal/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /retry|reset|restore|downgrade/i })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Today is not built yet" })).toBeNull();
});

// Test-only data consumer demonstrates the gate contract without implementing Build 14 hooks.
const accounts = vi.fn<() => Promise<unknown[]>>();
function AccountsProbe() {
  const { state } = useRuntime();
  const query = useQuery({ queryKey: ["test-only", "accounts"], queryFn: accounts, enabled: state.kind === "ready" });
  if (query.isError) return <p>Accounts could not be loaded</p>;
  if (!query.isSuccess) return <p>Loading accounts</p>;
  return <p>{query.data.length === 0 ? "No accounts yet" : "Accounts loaded"}</p>;
}
it("distinguishes a successful empty response from runtime and query failures", async () => {
  accounts.mockReset().mockResolvedValue([]);
  invoke.mockResolvedValue(failed("open_failed"));
  const tree = () => <AppProviders><RuntimeGate><AccountsProbe /></RuntimeGate></AppProviders>;
  const view = render(tree());
  await screen.findByRole("alert");
  expect(accounts).not.toHaveBeenCalled();
  expect(screen.queryByText("No accounts yet")).toBeNull();
  invoke.mockResolvedValue(ready);
  await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText("No accounts yet");
  expect(accounts).toHaveBeenCalledTimes(1);
  view.unmount();
  accounts.mockRejectedValue(new Error("Account query failed"));
  render(tree());
  await screen.findByText("Accounts could not be loaded");
  expect(screen.queryByText("No accounts yet")).toBeNull();
});

it("contains a render failure with keyboard-focusable Settings escape and a fresh runtime check", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  function Crash(): never { throw new Error("private data must not be shown"); }
  window.location.hash = "/broken";
  render(<AppProviders><Routes><Route element={<AppShell />}>
    <Route path="broken" element={<Crash />} />
    <Route path="settings" element={<p>Safe Settings</p>} />
  </Route></Routes></AppProviders>);
  const fallback = screen.getByRole("alert");
  expect(fallback.textContent).not.toContain("private data must not be shown");
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "FundedFlow couldn't display this screen" }));
  const user = userEvent.setup();
  await user.tab();
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open Settings" }));
  await user.keyboard("{Enter}");
  await screen.findByText("Safe Settings");
  await waitFor(() => expect(window.location.hash).toBe("#/settings"));
  expect(invoke).toHaveBeenCalledWith("runtime_status");
});

it("returns keyboard focus to Retry when recovery itself fails", async () => {
  invoke.mockResolvedValue(failed("open_failed"));
  render(<App />);
  const retry = await screen.findByRole("button", { name: "Retry" });
  retry.focus();
  invoke.mockRejectedValue(new Error("bridge rejected retry"));
  await userEvent.setup().keyboard("{Enter}");
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Retry" })));
  expect(screen.getByRole("alert").textContent).toContain("This does not mean your journal is empty");
});
