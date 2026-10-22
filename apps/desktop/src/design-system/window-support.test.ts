// Build 26.85 window support as checks on the stylesheets and the native window config (docs/design/window-support.md).
// jsdom does no layout and doesn't evaluate media queries, so these keep the compact, short-height and contrast-theme
// rules from drifting; the native matrix (window-support-matrix.md) covers the rest.
// @ts-expect-error type error without @types/node package
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");
const rule = (css: string, selector: string) => {
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} is defined`).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf("}", at) + 1);
};

describe("native window", () => {
  it("allows 800 × 480 logical px and keeps the 1280 × 800 default", () => {
    const [window] = JSON.parse(read("../../src-tauri/tauri.conf.json")).app.windows;
    expect(window).toMatchObject({ width: 1280, height: 800, minWidth: 800, minHeight: 480 });
  });
});

describe("short windows", () => {
  it("keeps dialog actions reachable: the dialog fits the height and its body scrolls", () => {
    const css = read("./controls.css");
    expect(rule(css, ".ds-dialog")).toContain("max-height: calc(100vh - 48px)");
    expect(rule(css, ".ds-dialog")).toContain("flex-direction: column");
    expect(rule(css, ".ds-dialog-body")).toContain("overflow-y: auto");
    expect(rule(css, ".ds-popover")).toContain("max-height: calc(100vh - 120px)");
  });

  it("keeps sticky action bars at the bottom of the scrolling page", () => {
    const bars: [string, string][] = [
      ["./documents.css", ".ds-gate-actions"],
      ["../features/imports/components/imports.css", ".imp-bar"],
      ["../features/daily-reviews/components/daily-review.css", ".dr-actions"],
      ["../features/rulebooks/components/rulebooks.css", ".rb-save-bar"],
    ];
    for (const [file, selector] of bars) {
      const css = read(file);
      const at = css.indexOf(`${selector} {`);
      const body = css.slice(at, css.indexOf("}", at));
      expect(body, selector).toMatch(/position: sticky;\s*bottom: 0/);
    }
  });

  it("gives the page more height by compacting the header, without hiding it", () => {
    const css = read("../app/shell.css");
    const short = css.slice(css.indexOf("@media (max-height: 599px) {"));
    expect(short).toContain(".shell-header { min-height: 0; padding-block: var(--space-3); }");
    expect(short.slice(0, short.indexOf("\n}"))).not.toMatch(/display:\s*none/);
  });
});

describe("Windows contrast themes", () => {
  const css = read("./forced-colors.css");

  it("is loaded with the design system", () => {
    expect(read("./index.ts")).toContain('import "./forced-colors.css";');
    expect(css).toContain("@media (forced-colors: active) {");
  });

  it("keeps focus, selection, edges and meters visible with system colours", () => {
    expect(css).toMatch(/:focus-visible \{ outline: 2px solid Highlight/);
    expect(css).toMatch(/\.ds-tab\[aria-pressed="true"\][^{]*\{\s*forced-color-adjust: none; background: Highlight; color: HighlightText;/);
    expect(css).toMatch(/\.ds-cal-day\.is-selected[^{]*\{ outline: 3px solid Highlight/);
    expect(css).toMatch(/\.ds-dialog, \.ds-drawer \{ border: 2px solid CanvasText; \}/);
    expect(css).toMatch(/\.ds-rule-fill, \.ds-mini-fill, \.ds-pmeter-fill, \.ds-bars-bar \{ forced-color-adjust: none; background: CanvasText; \}/);
    expect(css).toMatch(/\.ds-status-pill\.ds-status-unknown \{ border-style: dashed; \}/);
    // Only system colours: no token or hex colour can leak into a contrast theme.
    expect(css).not.toMatch(/var\(--|#[0-9a-f]{3,6}\b/i);
  });

  it("marks the current route and the shown account without a tint", () => {
    const shell = read("../app/shell.css");
    expect(shell).toMatch(/@media \(forced-colors: active\) \{[\s\S]*\.shell-nav-link\[aria-current="page"\][^{]*\{ forced-color-adjust: none; background: Highlight; color: HighlightText; \}/);
    expect(read("../features/today/components/today.css")).toContain("@media (forced-colors: active) { .td-card.is-selected { outline: 3px solid Highlight; outline-offset: 1px; } }");
  });
});
