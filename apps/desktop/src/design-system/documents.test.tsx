// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { expectNoAxeViolations } from "../test/axe";
import { DesignSystemGallery } from "./DesignSystemGallery";
import { useState } from "react";
import { Badge, Button, Disclosure, DisclosureCard, DocumentView, GatePage, InlineNotice } from "./index";

afterEach(cleanup);

const sections = [
  { heading: "First", paragraphs: ["One.", "Two."] },
  { heading: "Second", paragraphs: ["Three."] },
];

describe("GatePage", () => {
  it("owns the page's main landmark and h1, focuses the title and keeps the actions after the body", async () => {
    render(<GatePage eyebrow="FundedFlow" title="Before you start" actions={<><Button variant="secondary">Decline</Button><Button>Accept</Button></>}>
      <p>Summary.</p>
    </GatePage>);
    const main = screen.getByRole("main", { name: "Before you start" });
    const title = within(main).getByRole("heading", { level: 1, name: "Before you start" });
    expect(document.activeElement).toBe(title);
    // Keyboard order: body first, then Decline, then Accept.
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Decline" }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Accept" }));
    expect(screen.getByText("Summary.").compareDocumentPosition(screen.getByRole("button", { name: "Decline" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await expectNoAxeViolations();
  });

  it("renders as a section with an h2 and leaves focus alone in preview", () => {
    render(<GatePage preview title="Example" actions={<Button>Go</Button>}><p>Body</p></GatePage>);
    expect(screen.queryByRole("main")).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "Example" })).toBeTruthy();
    expect(document.activeElement).toBe(document.body);
  });
});

describe("DocumentView and Disclosure", () => {
  it("renders an article named by its title with section headings one level lower", () => {
    render(<DocumentView title="Notice" badge={<Badge tone="warn">Draft</Badge>} meta="Version 1" sections={sections} />);
    const article = screen.getByRole("article", { name: "Notice" });
    expect(within(article).getByRole("heading", { level: 2, name: "Notice" })).toBeTruthy();
    expect(within(article).getAllByRole("heading", { level: 3 }).map(h => h.textContent)).toEqual(["First", "Second"]);
    expect(within(article).getByText("Draft")).toBeTruthy();
    expect(within(article).getByText("Version 1")).toBeTruthy();
    expect(within(article).getByText("Two.")).toBeTruthy();
  });

  it("shows bundled text as text, never as markup", () => {
    render(<DocumentView headingLevel={3} title="T" sections={[{ heading: "H", paragraphs: ["<b>not bold</b>"] }]} />);
    expect(screen.getByText("<b>not bold</b>")).toBeTruthy();
    expect(document.querySelector("article b")).toBeNull();
    expect(screen.getByRole("heading", { level: 4, name: "H" })).toBeTruthy();
  });

  it("is a keyboard-operable expander whose summary carries screen-reader context", async () => {
    render(<main><Disclosure summary="Read the notice" srSummary="(draft, version 1)"><p>Hidden body</p></Disclosure></main>);
    const details = document.querySelector("details")!;
    const summary = details.querySelector("summary")!;
    expect(summary.textContent).toBe("Read the notice (draft, version 1)");
    expect(details.open).toBe(false);
    // The summary is in the tab order; Enter/Space toggling is the browser's own (jsdom doesn't model it).
    await userEvent.tab();
    expect(document.activeElement).toBe(summary);
    await userEvent.click(summary);
    expect(details.open).toBe(true);
    expect(screen.getByText("Hidden body")).toBeTruthy();
    await expectNoAxeViolations();
  });

  it("has a gallery section that works outside Tauri", async () => {
    render(<DesignSystemGallery />);
    const heading = screen.getByRole("heading", { name: "GatePage, DocumentView and Disclosure (NA-3)" });
    const section = heading.closest("section")!;
    await userEvent.click(within(section).getByRole("button", { name: "Accept" }));
    expect(within(section).getByRole("status").textContent).toBe("Example answer: Accepted");
    expect(within(section).queryByRole("article", { name: "Example licence" })).toBeNull();
    await userEvent.click(within(section).getByText("Read an example licence"));
    expect(await within(section).findByRole("article", { name: "Example licence" })).toBeTruthy();
  });

  it("reports each open and close to onToggle", async () => {
    const calls: boolean[] = [];
    render(<Disclosure summary="Notices" onToggle={open => calls.push(open)}><p>Body</p></Disclosure>);
    const summary = document.querySelector("summary")!;
    await userEvent.click(summary);
    await waitFor(() => expect(calls).toEqual([true]));
    await userEvent.click(summary);
    await waitFor(() => expect(calls).toEqual([true, false]));
  });

  it("keeps line breaks in preformatted documents and still renders text, not markup", () => {
    render(<DocumentView preformatted headingLevel={3} title="Licence" sections={[{ heading: "MIT", paragraphs: ["Line one\n  indented <i>two</i>"] }]} />);
    const article = screen.getByRole("article", { name: "Licence" });
    expect(article.classList.contains("is-preformatted")).toBe(true);
    expect(within(article).getByText(/indented <i>two<\/i>/).textContent).toBe("Line one\n  indented <i>two</i>");
    expect(article.querySelector("i")).toBeNull();
  });
});

describe("DisclosureCard (P0-D22)", () => {
  function Card({ initial = false, onOpenChange }: { initial?: boolean; onOpenChange?: (open: boolean) => void }) {
    const [open, setOpen] = useState(initial);
    return (
      <main>
        <DisclosureCard title="How fresh this is" summary="Checked at Oct 22, 00:13 GMT+1" open={open}
          onOpenChange={next => { onOpenChange?.(next); setOpen(next); }}
          notices={<InlineNotice tone="warning" title="Checkpoints disagree">Visible while closed.</InlineNotice>}>
          <p>Last import</p>
          <a href="#trade">Trade link</a>
        </DisclosureCard>
        <button type="button">After</button>
      </main>
    );
  }

  it("is a region named by its title, with a header button whose expanded state matches the body", async () => {
    render(<Card />);
    const region = screen.getByRole("region", { name: "How fresh this is" });
    const toggle = within(region).getByRole("button", { name: /How fresh this is/ });
    expect(within(region).getByRole("heading", { level: 2 }).contains(toggle)).toBe(true);
    expect(toggle.textContent).toContain("Checked at Oct 22, 00:13 GMT+1");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const body = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(body.contains(screen.getByText("Last import"))).toBe(true);
    expect(body.hasAttribute("inert")).toBe(true);
    expect(region.classList.contains("is-open")).toBe(false);
    // The chevron is decoration; the expanded state is the button's.
    expect(toggle.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    await expectNoAxeViolations();
  });

  it("opens and closes from the header by click, Enter and Space, and keeps notices outside the body", async () => {
    const user = userEvent.setup();
    const changes = vi.fn();
    render(<Card onOpenChange={changes} />);
    const toggle = screen.getByRole("button", { name: /How fresh this is/ });
    const body = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    const notice = screen.getByText("Checkpoints disagree");
    expect(body.contains(notice)).toBe(false);

    await user.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(body.hasAttribute("inert")).toBe(false);
    toggle.focus();
    await user.keyboard("{Enter}");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await user.keyboard(" ");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(changes.mock.calls).toEqual([[true], [false], [true]]);
    // Clicking inside the details does not toggle them.
    await user.click(screen.getByText("Last import"));
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await expectNoAxeViolations();
  });

  it("starts open when the caller says so", () => {
    render(<Card initial />);
    expect(screen.getByRole("button", { name: /How fresh this is/ }).getAttribute("aria-expanded")).toBe("true");
  });
});
