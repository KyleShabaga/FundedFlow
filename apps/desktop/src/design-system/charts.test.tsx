// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { type CurveStyle, curvePath, niceStep, RunningTotalChart, type RunningTotalPoint, valueTicks } from "./index";
import { expectNoAxeViolations } from "../test/axe";

afterEach(cleanup);

const NUM = String.raw`-?\d+(?:\.\d+)?(?:e[-+]?\d+)?`;

/** Parses the C segments of a smooth path into control and end points. */
function cubicSegments(d: string) {
  const re = new RegExp(`C(${NUM}) (${NUM}) (${NUM}) (${NUM}) (${NUM}) (${NUM})`, "g");
  return [...d.matchAll(re)].map((m) => {
    const [x1, y1, x2, y2, x, y] = m.slice(1).map(Number);
    return { x1, y1, x2, y2, x, y };
  });
}

function startPoint(d: string) {
  const m = d.match(new RegExp(`^M(${NUM}) (${NUM})`));
  expect(m).toBeTruthy();
  return { x: Number(m![1]), y: Number(m![2]) };
}

/** Seeded PRNG (mulberry32), so the random series is the same every run. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const even = (n: number, dx = 10) => Array.from({ length: n }, (_, i) => i * dx);
const r2 = (v: number) => Number(v.toFixed(2));

function randomWalk(n: number, seed: number) {
  const rand = mulberry32(seed);
  const ys: number[] = [];
  let v = 0;
  for (let i = 0; i < n; i++) {
    v += (rand() - 0.5) * 200;
    // Some flat runs too: a running total holds on breakeven trades.
    if (rand() < 0.1) v = ys[i - 1] ?? v;
    ys.push(v);
  }
  return ys;
}

const SERIES: Record<string, { xs: number[]; ys: number[] }> = {
  "monotone rising": { xs: even(8), ys: [0, 1, 3, 4, 10, 30, 31, 80] },
  "zig-zag with sign changes": { xs: even(9), ys: [0, 50, -40, 60, -70, 20, -5, 90, -90] },
  "flat run": { xs: even(9), ys: [0, 20, 20, 20, 20, 40, 40, 10, 10] },
  "single big spike": { xs: even(9), ys: [0, 0, 0, 0, 1000, 0, 0, 0, 0] },
  "uneven spacing": { xs: [0, 1, 30, 31, 100, 101, 140], ys: [0, 100, -20, 300, 290, -500, 0] },
  "seeded random 200 points": { xs: even(200, 3.2), ys: randomWalk(200, 20260821) },
};

describe("curvePath smooth", () => {
  const EPS = 0.011;
  for (const [name, { xs, ys }] of Object.entries(SERIES)) {
    it(`never overshoots and passes through every point: ${name}`, () => {
      const d = curvePath(xs, ys, "smooth");
      expect(startPoint(d)).toEqual({ x: r2(xs[0]), y: r2(ys[0]) });
      const segs = cubicSegments(d);
      expect(segs).toHaveLength(xs.length - 1);
      segs.forEach((s, i) => {
        const lo = Math.min(ys[i], ys[i + 1]) - EPS;
        const hi = Math.max(ys[i], ys[i + 1]) + EPS;
        const at = `${name}, segment ${i} (${ys[i]} → ${ys[i + 1]}): controls ${s.y1}, ${s.y2}`;
        expect(s.y1 >= lo && s.y1 <= hi, at).toBe(true);
        expect(s.y2 >= lo && s.y2 <= hi, at).toBe(true);
        // Control x values stay inside the segment, so the curve is a function of x.
        expect(s.x1 >= r2(xs[i]) - EPS && s.x2 <= r2(xs[i + 1]) + EPS, at).toBe(true);
        expect(s.x).toBe(r2(xs[i + 1]));
        expect(s.y).toBe(r2(ys[i + 1]));
      });
    });
  }

  it("joins two points with a straight line", () => {
    expect(curvePath([0, 100], [50, 10], "smooth")).toBe("M0 50L100 10");
  });

  it("draws nothing for no points and only the move for one", () => {
    expect(curvePath([], [], "smooth")).toBe("");
    expect(curvePath([], [], "step")).toBe("");
    expect(curvePath([5], [7], "smooth")).toBe("M5 7");
    expect(curvePath([5], [7], "step")).toBe("M5 7");
  });
});

describe("curvePath step", () => {
  it("is M x0 y0 then H xi V yi for each point", () => {
    const xs = [0, 12.3456, 24.69, 37.0349];
    const ys = [100, 80.5, 120.004, 99.999];
    expect(curvePath(xs, ys, "step")).toBe("M0 100H12.35V80.5H24.69V120H37.03V100");
  });

  it("reaches the same observed points as the smooth curve", () => {
    const { xs, ys } = SERIES["seeded random 200 points"];
    const step = curvePath(xs, ys, "step");
    const re = new RegExp(`H(${NUM})V(${NUM})`, "g");
    const stepPoints = [...step.matchAll(re)].map((m) => [Number(m[1]), Number(m[2])]);
    const smoothPoints = cubicSegments(curvePath(xs, ys, "smooth")).map((s) => [s.x, s.y]);
    expect(stepPoints).toEqual(smoothPoints);
    expect(startPoint(step)).toEqual(startPoint(curvePath(xs, ys, "smooth")));
  });
});

/** Mantissa of a positive step: step / 10^floor(log10(step)), rounded against float noise. */
const mantissa = (step: number) => Number((step / 10 ** Math.floor(Math.log10(step))).toFixed(9));

describe("niceStep", () => {
  it("returns 1, 2, 2.5 or 5 times a power of ten at or above the raw step", () => {
    const rand = mulberry32(7);
    const raws = [0.0003, 0.001, 0.0123, 0.2, 0.25, 0.26, 1, 1.01, 2, 2.4, 2.6, 4.9, 5.1, 9.99, 10, 23, 77, 101, 2500, 2501, 123456];
    for (let i = 0; i < 200; i++) raws.push(10 ** (rand() * 12 - 4));
    for (const raw of raws) {
      const step = niceStep(raw);
      expect([1, 2, 2.5, 5], `raw ${raw} → ${step}`).toContain(mantissa(step));
      expect(step, `raw ${raw}`).toBeGreaterThanOrEqual(raw * (1 - 1e-9));
      // The smallest such step: the next one down would be below raw.
      expect(step / 2.5, `raw ${raw} → ${step}`).toBeLessThan(raw * (1 + 1e-9));
    }
    expect(niceStep(0.26)).toBeCloseTo(0.5, 12);
    expect(niceStep(2.4)).toBe(2.5);
    expect(niceStep(10)).toBe(10);
    expect(niceStep(10.5)).toBe(20);
  });

  it("falls back to 1 for zero, negative and non-finite input", () => {
    expect(niceStep(0)).toBe(1);
    expect(niceStep(-3)).toBe(1);
    expect(niceStep(Number.NaN)).toBe(1);
    expect(niceStep(Number.POSITIVE_INFINITY)).toBe(1);
  });

  // Below 10 the integer steps are 1, 2, 5 or 10. From 10 up, 2.5 x 10^k is itself whole (25, 250) and allowed,
  // so the mantissa check covers raw < 10 only.
  it("with integer=true returns whole steps of 1, 2 or 5 times a power of ten (2.5 only when whole), at least 1", () => {
    const cases: [number, number][] = [
      [0.01, 1], [0.3, 1], [0.6, 1], [1, 1], [1.2, 2], [2, 2], [2.1, 5], [3, 5], [5, 5], [5.5, 10], [9, 10],
    ];
    for (const [raw, expected] of cases) expect(niceStep(raw, true), `raw ${raw}`).toBe(expected);
    const rand = mulberry32(11);
    for (let i = 0; i < 200; i++) {
      const raw = 10 ** (rand() * 6 - 2);
      const step = niceStep(raw, true);
      expect(Number.isInteger(step), `raw ${raw} → ${step}`).toBe(true);
      expect(step).toBeGreaterThanOrEqual(1);
      expect(step).toBeGreaterThanOrEqual(raw * (1 - 1e-9));
      expect(raw < 10 ? [1, 2, 5] : [1, 2, 2.5, 5], `raw ${raw} → ${step}`).toContain(mantissa(step));
    }
    expect(niceStep(21, true)).toBe(25);
  });
});

describe("valueTicks", () => {
  const check = (lo: number, hi: number, count: number) => {
    const { ticks, step } = valueTicks(lo, hi, count);
    const at = `lo ${lo}, hi ${hi}, count ${count}: ${ticks.join(", ")}`;
    expect(ticks, at).toContain(0);
    expect(ticks[0], at).toBeLessThanOrEqual(Math.min(lo, 0));
    expect(ticks[ticks.length - 1], at).toBeGreaterThanOrEqual(Math.max(hi, 0));
    expect([1, 2, 2.5, 5], at).toContain(mantissa(step));
    for (let i = 1; i < ticks.length; i++) expect(ticks[i] - ticks[i - 1], at).toBeCloseTo(step, 8);
    // Every tick is a whole multiple of the step.
    for (const t of ticks) expect(Math.abs(t / step - Math.round(t / step)), at).toBeLessThan(1e-6);
    // Snug: not more than one step of slack at either end.
    expect(ticks[0], at).toBeGreaterThan(Math.min(lo, 0) - step - 1e-9);
    // All-zero input widens to 0..1.
    expect(ticks[ticks.length - 1], at).toBeLessThan(Math.max(hi, 0, lo === 0 && hi === 0 ? 1 : 0) + step + 1e-9);
    return { ticks, step };
  };

  it("covers all-positive values from zero", () => {
    expect(check(120, 980, 4)).toEqual({ ticks: [0, 250, 500, 750, 1000], step: 250 });
  });

  it("covers all-negative values up to zero", () => {
    expect(check(-980, -120, 4)).toEqual({ ticks: [-1000, -750, -500, -250, 0], step: 250 });
  });

  it("covers mixed values with zero inside", () => {
    const { ticks } = check(-310, 1234.56, 4);
    expect(ticks[0]).toBeLessThan(0);
    expect(ticks[ticks.length - 1]).toBeGreaterThan(0);
  });

  it("gives 0..1 for all-zero values", () => {
    const { ticks } = check(0, 0, 4);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBe(1);
  });

  it("holds for a spread of ranges and counts", () => {
    const rand = mulberry32(99);
    for (let i = 0; i < 300; i++) {
      const scale = 10 ** (rand() * 8 - 2);
      const a = (rand() - 0.5) * 2 * scale;
      const b = (rand() - 0.5) * 2 * scale;
      check(Math.min(a, b), Math.max(a, b), 2 + Math.floor(rand() * 6));
    }
    check(0.001, 0.004, 3);
    check(-0.3, 0.1, 4);
    check(12345678.9, 12345678.9, 4);
  });
});

/* ---------- RunningTotalChart ---------- */

const POINTS: RunningTotalPoint[] = [
  { key: "t1", value: "250", label: "Trade 1 · ES", detail: "Result +$250.00" },
  { key: "t2", value: "-120.5", label: "Trade 2 · NQ", detail: "Result −$370.50" },
  { key: "t3", value: "480.25", label: "Trade 3 · ES", detail: "Result +$600.75" },
  { key: "t4", value: "1234.56", label: "Trade 4 · CL", detail: "Result +$754.31" },
];

function chart(props: Partial<Parameters<typeof RunningTotalChart>[0]> = {}) {
  return render(
    <main>
      <RunningTotalChart points={POINTS} currency="USD" yTitle="Cumulative net P&L" xTitle="Closed trades (exit order)" label="Closed-trade P&L curve" {...props} />
    </main>,
  );
}

const tickTexts = (container: HTMLElement) => [...container.querySelectorAll("text.ds-rt-tick")].map((t) => t.textContent);
const titles = (container: HTMLElement) => [...container.querySelectorAll("text.ds-rt-title")].map((t) => t.textContent);
const liveRegion = (container: HTMLElement) => container.querySelector('.ds-sr-only[aria-live="polite"]')!;
const circle = (container: HTMLElement, cls: string) => {
  const c = container.querySelector(`circle.${cls}`);
  return c ? { cx: c.getAttribute("cx"), cy: c.getAttribute("cy") } : null;
};

describe("RunningTotalChart rendering", () => {
  it("falls back to 640 px wide in jsdom and draws axes, titles, zero line and ticks", () => {
    const { container } = chart();
    const svg = container.querySelector("svg.ds-rt-svg")!;
    expect(svg.getAttribute("width")).toBe("640");
    expect(svg.getAttribute("height")).toBe("240");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(titles(container)).toEqual(["Closed trades (exit order)", "Cumulative net P&L (USD)"]);
    const ticks = tickTexts(container);
    expect(ticks).toContain("0");
    expect(ticks).toContain("$0");
    expect(ticks.some((t) => t!.startsWith("−$")), ticks.join(" | ")).toBe(true);
    expect(ticks.some((t) => t!.startsWith("+$")), ticks.join(" | ")).toBe(true);
    expect(ticks.some((t) => t!.startsWith("-"))).toBe(false);
    expect(container.querySelector("line.ds-rt-zero")).toBeTruthy();
    expect(container.querySelector("path.ds-rt-line")).toBeTruthy();
    expect(container.querySelector("path.ds-rt-area")).toBeTruthy();
    // No tooltip or announcement until a point is active.
    expect(container.querySelector(".ds-rt-tip")).toBeNull();
    expect(liveRegion(container).textContent).toBe("");
  });

  it("names the currency in the Y-axis title and uses its symbol", () => {
    const { container } = chart({ currency: "EUR" });
    expect(titles(container)).toContain("Cumulative net P&L (EUR)");
    expect(tickTexts(container)).toContain("€0");
  });

  it("leaves the code out of the Y-axis title when the currency is null", () => {
    const { container } = chart({ currency: null });
    expect(titles(container)).toEqual(["Closed trades (exit order)", "Cumulative net P&L"]);
    expect(tickTexts(container)).toContain("$0");
  });

  it("puts the zero line on the zero tick", () => {
    const { container } = chart();
    const zeroTick = [...container.querySelectorAll("text.ds-rt-tick")].find((t) => t.textContent === "$0")!;
    expect(container.querySelector("line.ds-rt-zero")!.getAttribute("y1")).toBe(zeroTick.getAttribute("y"));
  });

  it("draws the same observed points in step and smooth styles", () => {
    const ends: Record<CurveStyle, unknown> = { step: null, smooth: null };
    const lines: Record<CurveStyle, string> = { step: "", smooth: "" };
    for (const curve of ["step", "smooth"] as const) {
      const { container } = chart({ curve });
      ends[curve] = circle(container, "ds-rt-end");
      lines[curve] = container.querySelector("path.ds-rt-line")!.getAttribute("d")!;
      cleanup();
    }
    expect(ends.step).toEqual(ends.smooth);
    expect(ends.step).not.toBeNull();
    const stepPts = [...lines.step.matchAll(new RegExp(`H(${NUM})V(${NUM})`, "g"))].map((m) => [Number(m[1]), Number(m[2])]);
    const smoothPts = cubicSegments(lines.smooth).map((s) => [s.x, s.y]);
    expect(stepPts).toHaveLength(POINTS.length);
    expect(stepPts).toEqual(smoothPts);
    expect(startPoint(lines.step)).toEqual(startPoint(lines.smooth));
  });

  it("draws the start and one point for n=1", () => {
    for (const curve of ["step", "smooth"] as const) {
      const { container } = chart({ curve, points: [{ key: "only", value: "42.5", label: "Trade 1" }] });
      const d = container.querySelector("path.ds-rt-line")!.getAttribute("d")!;
      expect(d).toMatch(curve === "step" ? new RegExp(`^M${NUM} ${NUM}H${NUM}V${NUM}$`) : new RegExp(`^M${NUM} ${NUM}L${NUM} ${NUM}$`));
      expect(tickTexts(container)).toEqual(expect.arrayContaining(["0", "1", "$0"]));
      expect(circle(container, "ds-rt-end")).not.toBeNull();
      cleanup();
    }
  });

  it("does not crash with no points", () => {
    const { container } = chart({ points: [] });
    expect(container.querySelector("path.ds-rt-line")).toBeTruthy();
    // All-zero values give a 0..1 axis with sub-dollar ticks, in cents.
    expect(tickTexts(container)).toContain("$0.00");
  });

  it("uses compact labels for large values", () => {
    const { container } = chart({ points: [{ key: "big", value: "12345678.9", label: "Trade 1" }, { key: "big2", value: "-2500000", label: "Trade 2" }] });
    const ticks = tickTexts(container);
    expect(ticks.some((t) => /^\+\$\d+\.\dM$/.test(t!)), ticks.join(" | ")).toBe(true);
    expect(ticks.some((t) => /^−\$\d+\.\dM$/.test(t!)), ticks.join(" | ")).toBe(true);
    for (const t of ticks) expect(t!.length).toBeLessThanOrEqual(8);
  });

  it("uses cent ticks for small ranges", () => {
    const { container } = chart({ points: [{ key: "a", value: "0.25", label: "Trade 1" }, { key: "b", value: "0.4", label: "Trade 2" }] });
    const ticks = tickTexts(container);
    // A 0.1 step shows cents.
    expect(ticks).toEqual(["$0.00", "+$0.10", "+$0.20", "+$0.30", "+$0.40", "0", "1", "2"]);
  });

  // A 2.5 x 10^k step needs one more decimal than its power of ten (2.5 is not "+$3").
  it("labels 2.5-step ticks exactly", () => {
    const { container } = chart({ points: [{ key: "a", value: "9", label: "Trade 1" }] });
    expect(tickTexts(container).slice(0, 5)).toEqual(["$0.00", "+$2.50", "+$5.00", "+$7.50", "+$10.00"]);
  });
});

describe("RunningTotalChart keyboard", () => {
  it("is a focusable chart group that reads the observed point, never an interpolated value", async () => {
    const user = userEvent.setup();
    const { container } = chart();
    await user.tab();
    const group = screen.getByRole("group", { name: "Closed-trade P&L curve" });
    expect(group.getAttribute("aria-roledescription")).toBe("chart");
    expect(document.activeElement).toBe(group);

    // Focus selects the last point.
    expect(liveRegion(container).textContent).toBe("Trade 4 · CL, Result +$754.31, running total +$1,234.56");
    let tip = container.querySelector(".ds-rt-tip")!;
    expect(tip.getAttribute("aria-hidden")).toBe("true");
    expect(tip.textContent).toContain("Trade 4 · CL");
    expect(tip.textContent).toContain("Result +$754.31");
    expect(tip.textContent).toContain("Running total +$1,234.56");
    expect(circle(container, "ds-rt-active")).toEqual(circle(container, "ds-rt-end"));

    await user.keyboard("{ArrowLeft}");
    expect(liveRegion(container).textContent).toBe("Trade 3 · ES, Result +$600.75, running total +$480.25");
    tip = container.querySelector(".ds-rt-tip")!;
    expect(tip.textContent).toContain("Running total +$480.25");

    await user.keyboard("{ArrowLeft}");
    expect(liveRegion(container).textContent).toBe("Trade 2 · NQ, Result −$370.50, running total −$120.50");
    expect(container.querySelector(".ds-rt-tip")!.textContent).toContain("Running total −$120.50");

    await user.keyboard("{Home}");
    expect(liveRegion(container).textContent).toBe("Start, running total $0.00");
    tip = container.querySelector(".ds-rt-tip")!;
    expect(tip.textContent).toContain("Start");
    expect(tip.textContent).toContain("Running total $0.00");

    // Clamped at the start.
    await user.keyboard("{ArrowLeft}");
    expect(liveRegion(container).textContent).toBe("Start, running total $0.00");

    await user.keyboard("{End}");
    expect(liveRegion(container).textContent).toContain("running total +$1,234.56");
    // Clamped at the end.
    await user.keyboard("{ArrowRight}");
    expect(liveRegion(container).textContent).toContain("running total +$1,234.56");

    await user.keyboard("{Escape}");
    expect(liveRegion(container).textContent).toBe("");
    expect(container.querySelector(".ds-rt-tip")).toBeNull();
    expect(container.querySelector("circle.ds-rt-active")).toBeNull();
  });

  it("uses the given start label", async () => {
    const user = userEvent.setup();
    const { container } = chart({ startLabel: "Before first trade", currency: "EUR" });
    await user.tab();
    await user.keyboard("{Home}");
    expect(liveRegion(container).textContent).toBe("Before first trade, running total €0.00");
    expect(container.querySelector(".ds-rt-tip")!.textContent).toContain("Before first trade");
  });

  it("clears the active point on blur", async () => {
    const user = userEvent.setup();
    const { container } = chart();
    await user.tab();
    expect(container.querySelector(".ds-rt-tip")).toBeTruthy();
    await user.tab();
    expect(container.querySelector(".ds-rt-tip")).toBeNull();
    expect(liveRegion(container).textContent).toBe("");
  });

  it("puts the active dot at the same place in step and smooth styles", async () => {
    const positions: Record<CurveStyle, unknown[]> = { step: [], smooth: [] };
    for (const curve of ["step", "smooth"] as const) {
      const user = userEvent.setup();
      const { container } = chart({ curve });
      await user.tab();
      positions[curve].push(circle(container, "ds-rt-active"));
      for (let i = 0; i < POINTS.length; i++) {
        await user.keyboard("{ArrowLeft}");
        positions[curve].push(circle(container, "ds-rt-active"));
      }
      cleanup();
    }
    expect(positions.step).toHaveLength(POINTS.length + 1);
    expect(positions.step.every((p) => p != null)).toBe(true);
    expect(positions.step).toEqual(positions.smooth);
  });

  it("does not crash and reads the exact amount for one large point", async () => {
    const user = userEvent.setup();
    const { container } = chart({ points: [{ key: "big", value: "12345678.9", label: "Trade 1" }] });
    await user.tab();
    expect(liveRegion(container).textContent).toBe("Trade 1, running total +$12,345,678.90");
    await user.keyboard("{Home}");
    expect(liveRegion(container).textContent).toBe("Start, running total $0.00");
  });
});

describe("RunningTotalChart accessibility", () => {
  it("has no axe violations at rest or with a point active", async () => {
    const user = userEvent.setup();
    const { container } = chart();
    await expectNoAxeViolations({ root: container });
    await user.tab();
    await user.keyboard("{ArrowLeft}");
    await expectNoAxeViolations({ root: container });
  });
});
