// @vitest-environment jsdom
// TASK-023: with unsaved daily review edits, closing the window (title-bar X, Alt+F4) asks first. Tauri closes the
// window natively and the page gets no `beforeunload`, so the guard listens for the close request while the form is
// dirty, and only then. `@tauri-apps/api/window` is the fake in test/tauri-window.ts, which follows Tauri 2.12's
// close sequence. The repository is the in-memory journal store (test-store.ts).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeState } from "../../app/RuntimeProvider";
import { ToastProvider } from "../../design-system";
import { tauriWindow } from "../../test/tauri-window";
import { warmUp } from "../../test/warm-up";
import { makeAccount } from "../accounts/test-store";
import { createJournalStore, trade } from "../journal/test-store";
import { DailyReviewPage } from "./components/DailyReviewPage";

const runtime = vi.hoisted(() => ({ state: { kind: "ready" } as unknown as RuntimeState, check: vi.fn() }));
const holder = vi.hoisted(() => ({ store: null as unknown as ReturnType<typeof createJournalStore> }));
vi.mock("../../app/RuntimeProvider", () => ({ useRuntime: () => runtime }));
vi.mock("../../lib/data/api", () => ({ get repository() { return holder.store.repository; } }));
vi.mock("@tauri-apps/api/window", async () => (await import("../../test/tauri-window")).tauriWindowMock);

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});

const A = "acct-a";
const day = `/journal/days/2026-10-19?account=${A}`;
function renderDay() {
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[day]}>
          <Routes>
            <Route path="/journal/days/:tradingDay" element={<DailyReviewPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

let client: QueryClient;
function fresh() {
  runtime.state = { kind: "ready", status: { state: "ready", stage: "ready", schemaVersion: 18, supportedSchemaVersion: 18, created: false, failure: null, cleanup: "clear" } } as unknown as RuntimeState;
  runtime.check.mockReset().mockResolvedValue(undefined);
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  holder.store = createJournalStore([makeAccount({ id: A, name: "Eval A" })], [
    trade({ id: "t1", accountId: A, symbol: "ESZ6", tradingDay: "2026-10-19", realizedPnl: "96" }),
  ]);
  try { sessionStorage.clear(); } catch { /* jsdom has it */ }
}
beforeAll(async () => {
  fresh();
  await warmUp(renderDay, () => screen.findByRole("form", { name: "Daily review" }));
  client.clear();
});
beforeEach(() => {
  fresh();
  tauriWindow.reset();
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

const prompt = () => screen.queryByRole("alertdialog", { name: "Leave without saving the review?" });
const focus = () => within(screen.getByRole("form", { name: "Daily review" })).getByLabelText(/Focus for the session/) as HTMLTextAreaElement;

async function dirtyDay(user: ReturnType<typeof userEvent.setup>) {
  renderDay();
  await screen.findByRole("form", { name: "Daily review" });
  await user.click(focus());
  await user.paste("draft text");
  await waitFor(() => expect(tauriWindow.listeners()).toBe(1));
  return focus();
}

const requestClose = () => act(() => tauriWindow.requestClose());

describe("closing the window with unsaved daily review edits (TASK-023)", () => {
  it("asks instead of closing, and the window is not destroyed", async () => {
    const user = userEvent.setup();
    const editor = await dirtyDay(user);
    expect(await requestClose()).toBe("prevented");
    const dialog = await screen.findByRole("alertdialog", { name: "Leave without saving the review?" });
    // The close variant: session storage does not survive the window, so it doesn't promise a restore.
    expect(within(dialog).getByText("Closing the window discards your edits; they can't be restored later.")).toBeTruthy();
    expect(tauriWindow.destroy).not.toHaveBeenCalled();
    expect(focus()).toBe(editor);
  });

  it("Stay keeps the editor and its text, and closing asks again", async () => {
    const user = userEvent.setup();
    const editor = await dirtyDay(user);
    await requestClose();
    const dialog = await screen.findByRole("alertdialog", { name: "Leave without saving the review?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(prompt()).toBeNull());
    expect(focus()).toBe(editor);
    expect(editor.value).toBe("draft text");
    expect(tauriWindow.destroy).not.toHaveBeenCalled();
    expect(await requestClose()).toBe("prevented");
    expect(await screen.findByRole("alertdialog", { name: "Leave without saving the review?" })).toBeTruthy();
  });

  it("Leave destroys the window", async () => {
    const user = userEvent.setup();
    await dirtyDay(user);
    await requestClose();
    const dialog = await screen.findByRole("alertdialog", { name: "Leave without saving the review?" });
    await user.click(within(dialog).getByRole("button", { name: "Leave" }));
    await waitFor(() => expect(tauriWindow.destroy).toHaveBeenCalledTimes(1));
  });

  it("a clean window closes at once: no listener, so Tauri closes it natively", async () => {
    renderDay();
    await screen.findByRole("form", { name: "Daily review" });
    expect(tauriWindow.onCloseRequested).not.toHaveBeenCalled();
    expect(await requestClose()).toBe("closed");
    expect(prompt()).toBeNull();
  });

  it("stops listening once the form is clean again", async () => {
    const user = userEvent.setup();
    await dirtyDay(user);
    await user.clear(focus());
    await waitFor(() => expect(tauriWindow.listeners()).toBe(0));
    expect(await requestClose()).toBe("closed");
    expect(prompt()).toBeNull();
  });
});
