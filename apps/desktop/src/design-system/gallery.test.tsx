// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DesignSystemGallery } from "./DesignSystemGallery";

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

describe("DesignSystemGallery", () => {
  it("renders every Build 13 section outside Tauri", () => {
    render(<DesignSystemGallery />);
    for (const title of ["Form controls", "Buttons, dialogs and menus", "Notices, toasts and status", "Async states", "Data display"]) {
      expect(screen.getByRole("heading", { name: title })).toBeTruthy();
    }
    expect(screen.getByRole("table", { name: "Example accounts" })).toBeTruthy();
  });
  it("shows the content frame section with a header row and a body on the same frame", () => {
    render(<DesignSystemGallery />);
    const section = screen.getByRole("heading", { name: "Content frame" }).closest("section")!;
    expect(section.querySelectorAll(".ds-content-frame")).toHaveLength(2);
  });
  it("shows the narrow-widths section with the same filter twice", () => {
    render(<DesignSystemGallery />);
    const section = screen.getByRole("heading", { name: "Narrow widths" }).closest("section")!;
    expect(within(section).getByRole("group", { name: "Show rows (wide)" })).toBeTruthy();
  });
  it("shows the brand mark and logo section", () => {
    render(<DesignSystemGallery />);
    const section = screen.getByRole("heading", { name: "Brand mark and logo" }).closest("section")!;
    expect(within(section).getByText("Flow").closest(".ds-brand-name")?.textContent).toBe("FundedFlow");
    expect(section.querySelectorAll("svg.ds-brand-mark").length).toBe(4);
  });
  it("shows the running-total chart with axis titles and switches it between stepped and smooth", async () => {
    const user = userEvent.setup();
    render(<DesignSystemGallery />);
    const section = screen.getByRole("heading", { name: "RunningTotalChart" }).closest("section")!;
    const chart = within(section).getByRole("group", { name: "Example running total of 14 closed trades" });
    expect(within(chart).getByText("Cumulative net P&L (USD)")).toBeTruthy();
    expect(chart.querySelector(".ds-rt-line")?.getAttribute("d")).not.toContain("C");
    await user.click(within(section).getByRole("button", { name: "Smooth" }));
    expect(chart.querySelector(".ds-rt-line")?.getAttribute("d")).toContain("C");
  });
  it("switches the example async state without showing numbers while loading", async () => {
    render(<DesignSystemGallery />);
    const group = screen.getByRole("group", { name: "Example state" });
    const section = group.closest("section")!;
    expect(within(section).getByText("Loading accounts")).toBeTruthy();
    await userEvent.click(within(group).getByRole("button", { name: "Error" }));
    expect(within(section).getByText("Couldn't load accounts")).toBeTruthy();
    await userEvent.click(within(group).getByRole("button", { name: "No records" }));
    expect(within(section).getByText("Add your first account")).toBeTruthy();
  });
  it("validates the example form and focuses the first problem", async () => {
    render(<DesignSystemGallery />);
    await userEvent.click(screen.getByRole("button", { name: "Save account" }));
    expect(await screen.findByText("Fix 3 problems before saving")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: /Account name/ }));
  });
});
