// TEST ONLY. Build 26 axe-core regression check for settled jsdom pages. It scans document.body by default, so
// portalled dialogs, drawers, menus and toasts are included. Any violation fails the test with its rule, impact
// and target selectors. Exceptions are listed here with rule, surface, reason and owner; never disable rules
// broadly to get a green run.
import axe from "axe-core";
import { expect } from "vitest";

/**
 * Rules jsdom cannot evaluate. These are not accessibility waivers: each is a pending manual check in
 * docs/architecture/build-26-accessibility-journeys.md (owner: Build 26 manual checklist, then Build 27).
 */
const JSDOM_LIMITS: Record<string, string> = {
  // jsdom has no layout or computed colours, so contrast cannot be measured. Manual: both themes, WebView2.
  "color-contrast": "jsdom has no rendering; contrast is a manual check",
  "color-contrast-enhanced": "jsdom has no rendering; contrast is a manual check",
  // Requires layout (element sizes). Manual: Windows scaling 125%/150% and zoom.
  "target-size": "jsdom has no layout; target size is a manual check",
};

/**
 * Exceptions for one rule on named elements only; the rule still runs everywhere else. Each is listed in the
 * Build 26 handoff with its owner.
 */
const SCOPED_EXCEPTIONS: { rule: string; selector: string; reason: string }[] = [
  {
    rule: "region",
    // Radix portals menus and tooltips to <body>, outside the app's landmarks. They are popups owned by their
    // trigger (aria-controls/aria-describedby), opened from inside a landmark, and closed on focus loss; axe's
    // best-practice "region" rule doesn't model popups. Owner: design system (Build 13) if a container is added.
    selector: "[data-radix-popper-content-wrapper]",
    reason: "portalled popup content owned by a trigger inside a landmark",
  },
];

export interface AxeOptions {
  /** Narrow the scan to one subtree (defaults to the whole document body, including portals). */
  root?: Element;
}

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

export async function axeViolations({ root = document.body }: AxeOptions = {}) {
  const off = (ids: string[]) => Object.fromEntries(ids.map(id => [id, { enabled: false }]));
  const scoped = [...new Set(SCOPED_EXCEPTIONS.map(e => e.rule))];
  const main = await axe.run(root, { runOnly: { type: "tag", values: TAGS }, rules: off([...Object.keys(JSDOM_LIMITS), ...scoped]), resultTypes: ["violations"] });
  const excluded = SCOPED_EXCEPTIONS.map(e => e.selector).filter(selector => document.querySelector(selector));
  const rest = await axe.run({ include: [root], exclude: excluded.map(selector => [selector]) } as axe.ElementContext, {
    runOnly: { type: "rule", values: scoped }, resultTypes: ["violations"],
  });
  return [...main.violations, ...rest.violations];
}

/** Fails with a readable list of violations. */
export async function expectNoAxeViolations(options?: AxeOptions) {
  const violations = await axeViolations(options);
  const report = violations.map(v => `${v.id} (${v.impact}): ${v.help}\n${v.nodes.map(n => `  ${n.target.join(" ")}\n    ${n.failureSummary?.replace(/\n/g, "\n    ")}`).join("\n")}`);
  expect(report, report.join("\n\n")).toEqual([]);
}
