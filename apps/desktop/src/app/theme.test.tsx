// @vitest-environment jsdom
// Build 26.85: the app follows the Windows light/dark setting live; nothing forces dark on the app root or the
// render-failure screen.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { RootErrorBoundary } from "./RootErrorBoundary";

beforeEach(() => {
  // The OS prefers light.
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: query === "(prefers-color-scheme: light)",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function Boom(): never {
  throw new Error("render failed");
}

it("puts no forced theme on the app root, so the OS preference applies", () => {
  const { container } = render(<RootErrorBoundary><p>Screen</p></RootErrorBoundary>);
  expect(screen.getByText("Screen")).toBeTruthy();
  expect(container.querySelector(".app-root")).toBeTruthy();
  expect(container.querySelector("[data-theme]")).toBeNull();
});

it("keeps the render-failure screen theme-neutral too", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { container } = render(<RootErrorBoundary><Boom /></RootErrorBoundary>);
  expect(screen.getByRole("heading", { name: "FundedFlow couldn't display this screen" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Return to app" })).toBeTruthy();
  expect(container.querySelector("[data-theme]")).toBeNull();
});
