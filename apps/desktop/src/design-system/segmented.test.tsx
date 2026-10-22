// @vitest-environment jsdom
// SegmentedControl folding into a labelled dropdown when its buttons don't fit (Build 26.85). jsdom does no layout,
// so the buttons' natural width and the container's width are stubbed and the ResizeObserver is driven by hand.
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { SegmentedControl, type SegmentOption } from "./index";
import { expectNoAxeViolations } from "../test/axe";

let needed = 420;
let available = 800;
let observers: ((entries: unknown[]) => void)[] = [];

beforeAll(() => {
  // Radix Select needs these in jsdom.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.scrollIntoView ??= () => {};
});
beforeEach(() => {
  needed = 420;
  available = 800;
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("ds-seg") ? needed : 0;
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    if (this.dataset.testid === "toolbar") return available;
    // The content-sized tools box is never wider than what it holds; its width must not decide anything.
    return this.dataset.testid === "tools" ? 150 : 0;
  });
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: (entries: unknown[]) => void) { observers.push(callback); }
    observe() {}
    disconnect() {}
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); observers = []; });

type Row = "all" | "new" | "dupes" | "errors";
const OPTIONS: SegmentOption<Row>[] = [
  { value: "all", label: "All", count: 120 },
  { value: "new", label: "Will import", count: 96 },
  { value: "dupes", label: "Duplicates", count: 23 },
  { value: "errors", label: "Errors", count: 1 },
];

function Filter({ overflow, onChange, errors = 1, nested = false }: { overflow?: "menu" | "scroll"; onChange?: (v: Row) => void; errors?: number; nested?: boolean }) {
  const [value, setValue] = useState<Row>("dupes");
  const control = (
    <SegmentedControl<Row> label="Show rows" options={OPTIONS.map(o => (o.value === "errors" ? { ...o, count: errors } : o))} value={value}
      overflow={overflow} onValueChange={v => { setValue(v); onChange?.(v); }} />
  );
  return (
    <div data-testid="toolbar" style={nested ? { display: "flex" } : undefined}>
      {/* A DataTable-style tools box: a flex item that doesn't grow, so it is only as wide as what it holds. */}
      {nested ? <div data-testid="tools" style={{ display: "flex" }}>{control}</div> : control}
      <p>Showing {value}</p>
    </div>
  );
}
const narrow = (width: number) => act(() => { available = width; for (const notify of observers) notify([]); });

describe("SegmentedControl at narrow widths", () => {
  it("shows pressed buttons while they fit", () => {
    render(<Filter />);
    const group = screen.getByRole("group", { name: "Show rows" });
    expect(within(group).getByRole("button", { name: "Duplicates 23" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("folds into a labelled dropdown before it would overflow, keeping the selection and the counts", async () => {
    const { container } = render(<Filter />);
    narrow(400);
    expect(screen.queryByRole("group", { name: "Show rows" })).toBeNull();
    const select = screen.getByRole("combobox", { name: "Show rows" });
    expect(select.textContent).toContain("Duplicates (23)");
    expect(screen.getByText("Showing dupes")).toBeTruthy();
    await expectNoAxeViolations({ root: container });
  });

  it("is keyboard-operable when folded and the caller keeps the value through unfolding", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Filter onChange={onChange} />);
    narrow(300);
    const select = screen.getByRole("combobox", { name: "Show rows" });
    select.focus();
    await user.keyboard("{Enter}");
    await user.click(await screen.findByRole("option", { name: "Errors (1)" }));
    expect(onChange).toHaveBeenCalledWith("errors");
    expect(screen.getByText("Showing errors")).toBeTruthy();
    narrow(900);
    const group = screen.getByRole("group", { name: "Show rows" });
    expect(within(group).getByRole("button", { name: "Errors 1" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("moves focus to the dropdown when the focused buttons fold", () => {
    render(<Filter />);
    screen.getByRole("button", { name: "All 120" }).focus();
    narrow(300);
    expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "Show rows" }));
  });

  it("measures the row a content-sized toolbar sits in, so it unfolds again when the window widens", () => {
    render(<Filter nested />);
    narrow(300);
    expect(screen.getByRole("combobox", { name: "Show rows" })).toBeTruthy();
    narrow(1600);
    expect(screen.getByRole("group", { name: "Show rows" })).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("keeps the same dropdown and its focus when the counts change while folded", () => {
    const { rerender } = render(<Filter errors={1} />);
    narrow(300);
    const select = screen.getByRole("combobox", { name: "Show rows" });
    select.focus();
    rerender(<Filter errors={7} />);
    expect(screen.getByRole("combobox", { name: "Show rows" })).toBe(select);
    expect(document.activeElement).toBe(select);
    // The measuring copy is out of reach: no extra buttons, nothing focusable.
    expect(screen.queryAllByRole("button", { name: /Errors/ })).toHaveLength(0);
    expect(document.querySelector(".ds-seg-measure")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps the buttons and scrolls sideways when the caller asks for scroll", () => {
    render(<Filter overflow="scroll" />);
    narrow(200);
    expect(screen.getByRole("group", { name: "Show rows" })).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("decides nothing without layout, so hidden or unmeasured controls keep their buttons", () => {
    needed = 0;
    render(<Filter />);
    narrow(10);
    expect(screen.getByRole("group", { name: "Show rows" })).toBeTruthy();
  });
});
