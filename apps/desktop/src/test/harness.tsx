// TEST ONLY. Build 26 shared harness: renders the real <App /> (HashRouter, QueryClient, RuntimeProvider,
// ToastProvider, AppShell and every route) over the in-memory app store. Test files must mock exactly these
// boundaries, before importing this module:
//
//   vi.mock("@tauri-apps/api/core", async () => (await import("../test/boundaries")).tauriCoreMock);
//   vi.mock("../lib/data/api", async () => (await import("../test/boundaries")).apiMock);
//   vi.mock("@tauri-apps/plugin-dialog", async () => (await import("../test/boundaries")).dialogPluginMock);
//
// A fresh QueryClient comes with every <App /> mount; `resetHarness()` clears the rest of the shared state
// (hash route, browser storage, module-level operation lock, boundary queues). No sleeps: tests wait for
// visible results, and pending work is controlled with store holds and runtime answer queues.
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { vi } from "vitest";

import App from "../App";
import { resetDataControlLock } from "../features/data-controls/hooks/data-controls";
import { createAppStore, type AppStoreSeed } from "./app-store";
import { boundary, resetBoundaries } from "./boundaries";

/** jsdom gaps Radix and the shell rely on. Idempotent; call from beforeAll. */
export function installBrowserShims() {
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  window.matchMedia ??= ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

export function resetHarness() {
  cleanup();
  resetBoundaries();
  resetDataControlLock();
  try { localStorage.clear(); } catch { /* storage may be unavailable */ }
  window.location.hash = "/";
  vi.useRealTimers();
}

/**
 * Seeds the store and renders the whole app at `path` (a hash route such as "/journal"). `strict` adds the
 * StrictMode wrapper main.tsx uses (doubled effects make call counts noisier, so it is off by default).
 */
export function renderApp(path = "/", seed: AppStoreSeed | ReturnType<typeof createAppStore> = {}, { strict = false } = {}) {
  const store = "repository" in seed ? seed : createAppStore(seed);
  boundary.repository = store.repository;
  window.location.hash = path;
  const user = userEvent.setup();
  const view = render(strict ? <StrictMode><App /></StrictMode> : <App />);
  return { store, user, view };
}

/** The page's h1 (the shell focuses it after navigation). */
export const pageHeading = () => screen.getByRole("heading", { level: 1 });
export const currentPath = () => window.location.hash.replace(/^#/, "") || "/";
