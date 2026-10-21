// Keeps the colour tokens readable: every text/background pair the design
// system uses must meet WCAG contrast in both themes.
// @ts-expect-error type error without @types/node package
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css: string = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");

function theme(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gi)) out[m[1]] = m[2];
  return out;
}

function luminance(hex: string) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const TEXT_PAIRS: [string, string][] = [
  ["ink", "bg-000"], ["ink", "bg-100"], ["ink", "bg-300"],
  ["ink-muted", "bg-100"], ["ink-muted", "bg-200"], ["ink-faint", "bg-100"], ["ink-faint", "bg-200"],
  ["flow", "bg-100"], ["on-flow", "flow-fill"], ["flow", "flow-soft"],
  ["profit", "bg-100"], ["profit", "bg-200"], ["profit", "profit-soft"],
  ["loss", "bg-100"], ["loss", "bg-200"], ["loss", "loss-soft"],
  ["warn", "bg-100"], ["warn", "warn-soft"],
];

describe.each([
  ["dark", '[data-theme="dark"] {'],
  ["light", '[data-theme="light"] {'],
])("%s theme", (_name, selector) => {
  const t = theme(selector);
  it.each(TEXT_PAIRS)("%s on %s is at least 4.5:1", (fg, bg) => {
    expect(t[fg], fg).toBeDefined();
    expect(t[bg], bg).toBeDefined();
    expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
  });
  it("control borders are at least 3:1 on cards", () => {
    expect(contrast(t["line-200"], t["bg-100"])).toBeGreaterThanOrEqual(3);
  });
  it("both ends of the brand mark gradient are at least 3:1 on the page and on cards", () => {
    for (const stop of ["brand-mark-start", "brand-mark-end"]) {
      for (const bg of ["bg-000", "bg-100"]) expect(contrast(t[stop], t[bg]), `${stop} on ${bg}`).toBeGreaterThanOrEqual(3);
    }
  });
});
