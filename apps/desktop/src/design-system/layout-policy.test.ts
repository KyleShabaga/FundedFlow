// The responsive layout policy (P0-D29, docs/design/window-support.md) as checks on the stylesheets themselves:
// jsdom does no layout, so these keep the frame, its breakpoints and the Today columns from drifting.
// @ts-expect-error type error without @types/node package
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Every stylesheet under src/ except the developer-only data model panel.
const src = new URL("../", import.meta.url);
const sheets: Record<string, string> = Object.fromEntries(
  (readdirSync(src, { recursive: true }) as string[])
    .map(f => f.replace(/\\/g, "/"))
    .filter(f => f.endsWith(".css") && !f.endsWith("DataModelPanel.css"))
    // Line endings as in the repository, whatever the checkout converted them to.
    .map(f => [f, (readFileSync(new URL(f, src), "utf8") as string).replace(/\r\n/g, "\n")]),
);
const sheet = (suffix: string) => {
  const key = Object.keys(sheets).find(k => k.endsWith(suffix));
  if (!key) throw new Error(`no stylesheet ${suffix}`);
  return sheets[key];
};
const rule = (css: string, selector: string) => {
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} is defined`).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf("}", at) + 1);
};
/** Main-column widths the policy allows a breakpoint at (min-width N or max-width N - 1). */
const MAIN_BREAKPOINTS = [640, 880, 1280];

describe("shared content frame", () => {
  it("caps content at the frame token and centres it in the main column", () => {
    expect(sheet("tokens.css")).toMatch(/--frame-max:\s*1600px;/);
    const css = sheet("design-system/design-system.css");
    expect(rule(css, ".ds-app-column")).toContain("container: ds-main / inline-size");
    const frame = rule(css, ".ds-content-frame");
    expect(frame).toContain("margin-inline: auto");
    expect(frame).toContain("max-width: calc(var(--frame-max) + 2 * var(--ds-frame-gutter))");
    expect(frame).toContain("padding-inline: var(--ds-frame-gutter)");
  });

  it("steps the gutters down with the main column, using spacing tokens", () => {
    const css = sheet("design-system/design-system.css");
    expect(rule(css, ".ds-content-frame")).toContain("--ds-frame-gutter: var(--space-8)");
    expect(css).toContain("@container ds-main (max-width: 879px) { .ds-content-frame { --ds-frame-gutter: var(--space-6); } }");
    expect(css).toContain("@container ds-main (max-width: 639px) { .ds-content-frame { --ds-frame-gutter: var(--space-4); } }");
  });

  it("leaves inline padding to the frame in the shell header and content", () => {
    const css = sheet("app/shell.css");
    expect(rule(css, ".shell-header")).toContain("padding: var(--space-6) 0");
    expect(rule(css, ".shell-content")).toContain("padding: var(--space-8) 0");
  });
});

describe("one breakpoint set", () => {
  const entries = Object.entries(sheets).filter(([k]) => !k.endsWith("gallery.css"));

  it("no page sets its own wide cap; the frame owns width", () => {
    expect(entries.length).toBeGreaterThan(15);
    for (const [file, css] of entries) expect(css, file).not.toMatch(/max-width:\s*1600px/);
  });

  it("uses no window-width media queries for page layout", () => {
    for (const [file, css] of entries) expect(css, file).not.toMatch(/@media[^{]*\((?:(?:max|min)-width|width\s*[<>])/);
  });

  it("only breaks the main column at the documented widths", () => {
    for (const [file, css] of entries) {
      for (const m of css.matchAll(/@container ds-main[^{]*/g)) {
        for (const w of m[0].matchAll(/\((min|max)-width:\s*(\d+)px\)/g)) {
          const at = w[1] === "min" ? Number(w[2]) : Number(w[2]) + 1;
          expect(MAIN_BREAKPOINTS, `${file}: ${m[0].trim()}`).toContain(at);
        }
      }
    }
  });
});

describe("Today", () => {
  const css = sheet("features/today/components/today.css");

  it("lays the active accounts out in 1 to 4 columns by the section's own width", () => {
    expect(rule(css, ".td-overview")).toContain("container: td-overview / inline-size");
    expect(rule(css, ".td-cards")).toContain("grid-template-columns: repeat(12, minmax(0, 1fr))");
    expect(rule(css, ".td-cards > li")).toContain("grid-column: span 12");
    expect(css).toContain("@container td-overview (min-width: 560px) { .td-cards > li { grid-column: span 6; } }");
    expect(css).toContain("@container td-overview (min-width: 880px) { .td-cards > li { grid-column: span 4; } }");
    expect(css).toContain("@container td-overview (min-width: 1130px) {\n  .td-cards > li { grid-column: span 3; }");
  });

  it("never leaves one card alone on the last row with 3 or 4 across (P0-D31)", () => {
    // 3 across: 3n + 1 cards end two by two (4 → 2 + 2, 7 → 3 + 2 + 2).
    expect(css).toContain("@container td-overview (min-width: 880px) and (max-width: 1129px) {\n"
      + "  .td-cards:has(> li:nth-child(4)):has(> li:nth-child(3n + 1):last-child) > li:nth-last-child(-n + 4) { grid-column: span 6; }");
    // 4 across: 4n + 1 cards end three then two (5 → 3 + 2, 9 → 4 + 3 + 2).
    expect(css).toContain(".td-cards:has(> li:nth-child(5)):has(> li:nth-child(4n + 1):last-child) > li:nth-last-child(-n + 5) { grid-column: span 4; }");

    // The same rules as arithmetic: per section width and count, the cards per row and their widths.
    const GAP = 12;
    const spans = (width: number, n: number): number[] => {
      const base = width >= 1130 ? 3 : width >= 880 ? 4 : width >= 560 ? 6 : 12;
      return Array.from({ length: n }, (_, i) => {
        const fromEnd = n - i;
        if (base === 4 && n >= 4 && n % 3 === 1 && fromEnd <= 4) return 6;
        if (base === 3 && n >= 5 && n % 4 === 1 && fromEnd <= 5) return 4;
        return base;
      });
    };
    const cardWidth = (width: number, span: number) => (width - 11 * GAP) / 12 * span + (span - 1) * GAP;
    // Section widths measured in the preview at 1280, 1920 and 3440 px windows (stacked at 1280; beside freshness at
    // the others), the 1280 px window with the sidebar collapsed, and both ends of the 3- and 4-across ranges.
    for (const width of [953, 968, 923, 927, 1144, 880, 1129, 1130, 1600]) {
      for (let n = 1; n <= 8; n++) {
        const s = spans(width, n);
        // Cards per row, filling 12 tracks in order as the grid does.
        const counts: number[] = [];
        let used = 12;
        for (const span of s) { if (used + span > 12) { counts.push(1); used = span; } else { counts[counts.length - 1]++; used += span; } }
        if (n > 1) expect(counts.includes(1), `${width} px, ${n} cards: ${counts.join(" + ")}`).toBe(false);
        for (const span of s) {
          const w = cardWidth(width, span);
          expect(w, `${width} px, ${n} cards, span ${span}`).toBeGreaterThanOrEqual(270);
          expect(w, `${width} px, ${n} cards, span ${span}`).toBeLessThanOrEqual(560);
        }
      }
    }
  });

  it("lays List rows out as four aligned groups from 880 px of the section's own width, wrapping below that (P0-D23)", () => {
    // One row per account at every width: List never becomes a grid of columns.
    expect(rule(css, ".td-rows")).not.toContain("grid-template-columns");
    expect(rule(css, ".td-row")).toContain('grid-template-areas: "head foot" "est est" "setup setup" "note note"');
    const at = css.indexOf("@container td-overview (min-width: 880px) {\n  .td-row {");
    expect(at).toBeGreaterThanOrEqual(0);
    const wide = css.slice(at, css.indexOf("\n}", at));
    expect(wide).toContain("grid-template-columns: minmax(10rem, 1.1fr) minmax(13rem, 1.6fr) minmax(11rem, 1.2fr) 11rem;");
    expect(wide).toContain('grid-template-areas: "head est setup foot" "note note note foot";');
  });

  it("places freshness beside the next panel only on a wide main column, by CSS alone", () => {
    expect(css).toContain("@container ds-main (min-width: 1280px) {");
    const wide = css.slice(css.indexOf("@container ds-main (min-width: 1280px) {"));
    expect(wide).toContain(".td-page > .td-fresh { grid-column: 1 / span 5; align-self: start; }");
    // P0-D21: Check again keeps to freshness's columns, so it stays right-aligned above the panel it refreshes.
    expect(wide).toContain(".td-page > .td-intro:has(+ .td-fresh) { grid-column: 1 / span 5; }");
    expect(wide).toContain(".td-page > .td-fresh + * { grid-column: span 7; }");
    expect(wide).toContain(".td-page > .td-fresh + .td-account + .td-risk { grid-column: 6 / -1; }");
    // Nothing is moved out of reading order: no `order`, only column spans.
    expect(css).not.toMatch(/(^|[;{])\s*order\s*:/m);
  });

  it("lets the freshness list use two columns only when each gets 420 px, without squeezing values", () => {
    expect(css).toContain(".td-fresh .ds-stats { grid-template-columns: repeat(auto-fit, minmax(min(420px, 100%), 1fr));");
    expect(css).toContain(".td-fresh .ds-stats dt { flex: none; max-width: 50%; }");
  });
});
