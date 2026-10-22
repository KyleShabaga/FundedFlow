// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { expectNoAxeViolations } from "../test/axe";
import { InfoTip, MetricCard } from "./index";

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  // Radix measures with ResizeObserver.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const LABEL = "About Net P&L";

function renderTip({ before = true } = {}) {
  render(
    <main>
      {before && <button type="button">Before</button>}
      <InfoTip label={LABEL}>
        <p>Realized profit after fees.</p>
      </InfoTip>
      <button type="button">After</button>
      <p>Outside</p>
    </main>,
  );
  return screen.getByRole("button", { name: LABEL });
}

const popup = () => screen.queryByRole("dialog", { name: LABEL });

// One userEvent instance per test so pointer position carries across calls. Real timers: Testing Library's async wrapper waits on a real setTimeout, so Vitest fake timers hang userEvent.
const sleep = (ms: number) => act(() => new Promise<void>((resolve) => window.setTimeout(resolve, ms)));

describe("InfoTip semantics", () => {
  it("is a labelled button that controls a labelled dialog holding the children", async () => {
    const user = userEvent.setup();
    const trigger = renderTip();
    expect(trigger.getAttribute("type")).toBe("button");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.hasAttribute("aria-controls")).toBe(false);
    expect(popup()).toBeNull();

    await user.click(trigger);
    const dialog = popup();
    expect(dialog).not.toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe(dialog!.id);
    expect(dialog!.id).toBeTruthy();
    expect(within(dialog!).getByText("Realized profit after fees.")).toBeTruthy();
    // Not portalled: it sits in the wrapper with the button.
    expect(dialog!.closest(".ds-infotip")).toBe(trigger.closest(".ds-infotip"));
  });

  it("never moves focus into the popup", async () => {
    const user = userEvent.setup();
    const trigger = renderTip();
    await user.click(trigger);
    expect(popup()).not.toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

describe("InfoTip hover", () => {
  it("opens after about 120 ms and closes about 200 ms after the pointer leaves", async () => {
    const user = userEvent.setup();
    const trigger = renderTip();
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    const entered = Date.now();
    await user.hover(trigger);
    expect(popup()).toBeNull();
    expect(setTimeoutSpy.mock.calls.some(([, ms]) => ms === 120)).toBe(true);
    await waitFor(() => expect(popup()).not.toBeNull());
    expect(Date.now() - entered).toBeGreaterThanOrEqual(110);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    setTimeoutSpy.mockClear();
    const left = Date.now();
    await user.unhover(trigger);
    expect(popup()).not.toBeNull();
    expect(setTimeoutSpy.mock.calls.some(([, ms]) => ms === 200)).toBe(true);
    await waitFor(() => expect(popup()).toBeNull());
    expect(Date.now() - left).toBeGreaterThanOrEqual(190);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("does not open when the pointer leaves before the delay", async () => {
    const user = userEvent.setup();
    const trigger = renderTip();
    await user.hover(trigger);
    await user.unhover(trigger);
    await sleep(400);
    expect(popup()).toBeNull();
  });

  // Crossing the gap between the button and the popup (.ds-popover sits 6 px below the anchor) leaves and re-enters
  // the wrapper; re-entering must cancel the pending close. userEvent reproduces the leave and re-enter.
  it("stays open while the pointer moves from the button into the popup", async () => {
    const user = userEvent.setup();
    const trigger = renderTip();
    await user.hover(trigger);
    await waitFor(() => expect(popup()).not.toBeNull());
    await user.hover(popup()!);
    await sleep(400);
    expect(popup()).not.toBeNull();
  });

  it("closes when the pointer leaves the wrapper from the popup", async () => {
    const user = userEvent.setup();
    const trigger = renderTip();
    await user.hover(trigger);
    await waitFor(() => expect(popup()).not.toBeNull());
    await user.hover(screen.getByText("Realized profit after fees."));
    await user.hover(screen.getByText("Outside"));
    await waitFor(() => expect(popup()).toBeNull());
  });
});

describe("InfoTip keyboard", () => {
  it("opens on keyboard focus and closes on blur when not pinned", async () => {
    const user = userEvent.setup();
    // dom-selector's :focus-visible heuristic is reliable for the first Tab from <body>, so the trigger comes first.
    const trigger = renderTip({ before: false });
    await user.tab();
    expect(document.activeElement).toBe(trigger);
    expect(popup()).not.toBeNull();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "After" }));
    expect(popup()).toBeNull();
  });

  it("pins on Enter so blur does not close it", async () => {
    const user = userEvent.setup();
    const trigger = renderTip();
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(popup()).not.toBeNull();
    await user.tab();
    expect(popup()).not.toBeNull();
  });

  it("pins on Space", async () => {
    const user = userEvent.setup();
    const trigger = renderTip();
    trigger.focus();
    await user.keyboard(" ");
    expect(popup()).not.toBeNull();
    await user.tab();
    expect(popup()).not.toBeNull();
  });

  it("closes on Escape and keeps focus on the trigger", async () => {
    const user = userEvent.setup();
    const trigger = renderTip({ before: false });
    await user.tab();
    await user.keyboard("{Enter}");
    expect(popup()).not.toBeNull();
    await user.keyboard("{Escape}");
    expect(popup()).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });

  it("does not open on mouse focus alone (focus without :focus-visible)", async () => {
    const user = userEvent.setup();
    const trigger = renderTip();
    // A programmatic focus after a pointer interaction is not :focus-visible in jsdom.
    await user.click(screen.getByText("Outside"));
    trigger.focus();
    expect(trigger.matches(":focus-visible")).toBe(false);
    expect(popup()).toBeNull();
  });
});

describe("InfoTip click and tap", () => {
  it("click pins it open, so leaving with the mouse does not close it", async () => {
    const user = userEvent.setup();
    const trigger = renderTip();
    await user.click(trigger);
    expect(popup()).not.toBeNull();
    await user.unhover(trigger);
    await user.hover(screen.getByText("Outside"));
    await sleep(400);
    expect(popup()).not.toBeNull();
  });

  it("a second click on the button closes it without reopening", async () => {
    const user = userEvent.setup();
    const trigger = renderTip();
    await user.click(trigger);
    expect(popup()).not.toBeNull();
    await user.click(trigger);
    expect(popup()).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });

  it("clicking while hover-opened pins it instead of closing it", async () => {
    const user = userEvent.setup();
    const trigger = renderTip();
    await user.hover(trigger);
    await waitFor(() => expect(popup()).not.toBeNull());
    await user.click(trigger);
    expect(popup()).not.toBeNull();
    await user.hover(screen.getByText("Outside"));
    await sleep(400);
    expect(popup()).not.toBeNull();
  });

  it("a press outside closes it once released (Radix Dialog defers pointer-down-outside to the click)", async () => {
    const user = userEvent.setup();
    const trigger = renderTip();
    await user.click(trigger);
    expect(popup()).not.toBeNull();
    const outside = screen.getByText("Outside");
    await user.pointer({ keys: "[MouseLeft>]", target: outside });
    await user.pointer({ keys: "[/MouseLeft]", target: outside });
    expect(popup()).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("a click outside closes it", async () => {
    const user = userEvent.setup();
    const trigger = renderTip();
    await user.click(trigger);
    await user.click(screen.getByText("Outside"));
    expect(popup()).toBeNull();
  });

  it("a click inside the popup keeps it open", async () => {
    const user = userEvent.setup();
    const trigger = renderTip();
    await user.click(trigger);
    await user.click(screen.getByText("Realized profit after fees."));
    expect(popup()).not.toBeNull();
  });

  it("touch tap opens and pins it, and a second tap closes it", async () => {
    const user = userEvent.setup();
    const trigger = renderTip();
    await user.pointer({ keys: "[TouchA]", target: trigger });
    expect(popup()).not.toBeNull();
    // A touch has no hover: nothing schedules a close.
    await sleep(400);
    expect(popup()).not.toBeNull();
    await user.pointer({ keys: "[TouchA]", target: trigger });
    expect(popup()).toBeNull();
  });
});

describe("InfoTip alignment", () => {
  function rect(left: number, w = 20): DOMRect {
    return { left, right: left + w, top: 10, bottom: 30, width: w, height: 20, x: left, y: 10, toJSON: () => ({}) } as DOMRect;
  }

  it("opens toward the left near the right edge of the window", async () => {
    const user = userEvent.setup();
    const trigger = renderTip();
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue(rect(window.innerWidth - 30));
    await user.click(trigger);
    const dialog = popup()!;
    expect(dialog.classList.contains("ds-popover-end")).toBe(true);
    expect(dialog.classList.contains("ds-popover-start")).toBe(false);
  });

  it("opens toward the right near the left edge of the window", async () => {
    const user = userEvent.setup();
    const trigger = renderTip();
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue(rect(16));
    await user.click(trigger);
    const dialog = popup()!;
    expect(dialog.classList.contains("ds-popover-start")).toBe(true);
    expect(dialog.classList.contains("ds-popover-end")).toBe(false);
  });

  it("uses width as a maximum that shrinks to the window", async () => {
    const user = userEvent.setup();
    render(
      <InfoTip label={LABEL} width={200}>
        x
      </InfoTip>,
    );
    await user.click(screen.getByRole("button", { name: LABEL }));
    // jsdom serializes calc(100vw - 32px) as "-32px + 100vw".
    const maxWidth = popup()!.style.maxWidth;
    expect(maxWidth).toMatch(/^min\(200px, /);
    expect(maxWidth).toContain("100vw");
    expect(maxWidth).toContain("32px");
    expect(popup()!.style.width).toBe("");
  });
});

describe("InfoTip accessibility", () => {
  it("has no axe violations closed or open", async () => {
    const user = userEvent.setup();
    const trigger = renderTip();
    await expectNoAxeViolations();
    await user.click(trigger);
    expect(popup()).not.toBeNull();
    await expectNoAxeViolations();
  });
});

describe("MetricCard info", () => {
  const money = { kind: "money", amount: "1234.50" } as const;

  it("puts an About button after the label, without a foot when only info is given", async () => {
    const user = userEvent.setup();
    const { container } = render(<MetricCard label="Net P&L" value={money} sub="22 W · 14 L" info="Realized P&L after fees and commissions." />);
    const head = container.querySelector(".ds-tile-head")!;
    const label = within(head as HTMLElement).getByText("Net P&L");
    const button = within(head as HTMLElement).getByRole("button", { name: "About Net P&L" });
    expect(label.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector(".ds-metric-foot")).toBeNull();
    expect(screen.getByText("22 W · 14 L")).toBeTruthy();

    await user.click(button);
    const dialog = screen.getByRole("dialog", { name: "About Net P&L" });
    expect(within(dialog).getByText("Realized P&L after fees and commissions.")).toBeTruthy();
  });

  it("keeps the foot when basis is also given", () => {
    const { container } = render(<MetricCard label="Net P&L" value={money} basis="Realized · all time" info="How it is worked out." />);
    const foot = container.querySelector(".ds-metric-foot");
    expect(foot).not.toBeNull();
    expect(foot!.textContent).toContain("Realized · all time");
    expect(screen.getByRole("button", { name: "About Net P&L" })).toBeTruthy();
  });

  it("has no info button without info", () => {
    render(<MetricCard label="Net P&L" value={money} sub="22 W · 14 L" />);
    expect(screen.queryByRole("button", { name: /About/ })).toBeNull();
    expect(screen.getByText("22 W · 14 L")).toBeTruthy();
  });

  it("keeps the unavailable reason visible with or without info", () => {
    const value = { kind: "unavailable", reason: "No closed trades yet" } as const;
    const { rerender } = render(<MetricCard label="Win rate" value={value} info="Wins divided by closed trades." />);
    expect(screen.getByText("No closed trades yet")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(<MetricCard label="Win rate" value={value} />);
    expect(screen.getByText("No closed trades yet")).toBeTruthy();
  });

  it("has no axe violations with the info open", async () => {
    const user = userEvent.setup();
    render(
      <main>
        <MetricCard label="Net P&L" value={money} sub="22 W · 14 L" info="Realized P&L after fees." />
      </main>,
    );
    await expectNoAxeViolations();
    await user.click(screen.getByRole("button", { name: "About Net P&L" }));
    await expectNoAxeViolations();
  });
});
