// @vitest-environment jsdom
// Build 26.78: Settings → Privacy & legal → Third-party notices, and the parser for THIRD_PARTY_NOTICES.txt.
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type NoticesPart, parseNotices, THIRD_PARTY_SUMMARY } from "../../legal";
import { expectNoAxeViolations } from "../../test/axe";
import NOTICES from "../../../THIRD_PARTY_NOTICES.txt?raw";
import { ThirdPartyNotices } from "./components/ThirdPartyNotices";

afterEach(cleanup);

const parts: NoticesPart[] = [
  { title: "Rust crates (1)", sections: [{ heading: "serde 1.0.0", paragraphs: ["Licence: MIT\nCopyright (c) Example"] }] },
  { title: "Licence texts (1)", sections: [{ heading: "[T1] MIT", paragraphs: ["Permission is hereby granted <b>free</b>\nof charge."] }] },
];

describe("the generated notices file", () => {
  it("parses into the parts and counts the summary reports", () => {
    const parsed = parseNotices(NOTICES);
    const { rust, npm, fonts, licenseTexts, total } = THIRD_PARTY_SUMMARY;
    expect(parsed.map(p => p.title)).toEqual(["FundedFlow third-party notices", `Rust crates (${rust})`, `npm packages (${npm})`, `Fonts (${fonts})`, `Licence texts (${licenseTexts})`]);
    expect(parsed.slice(1, 4).map(p => p.sections.length)).toEqual([rust, npm, fonts]);
    expect(parsed[4].sections).toHaveLength(licenseTexts);
    expect(rust + npm + fonts).toBe(total);
    for (const part of parsed.slice(1, 4)) for (const section of part.sections) {
      expect(section.paragraphs[0], section.heading).toMatch(/^Licence: .+\n(Copyright|©|\(c\))[^\n]*(\n.*)*\nLicence text: \[T\d+\]/i);
    }
  });

  it("names the three bundled fonts and keeps licence texts' line breaks", () => {
    const parsed = parseNotices(NOTICES);
    const fonts = parsed.find(p => p.title.startsWith("Fonts"))!;
    expect(fonts.sections.map(s => s.heading.split(" ")[0])).toEqual(["@fontsource/jetbrains-mono", "@fontsource/space-grotesk", "@fontsource-variable/inter"].sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : 1));
    const ofl = parsed[parsed.length - 1].sections.find(s => s.heading.endsWith("OFL-1.1"))!;
    expect(ofl.paragraphs.join("\n\n")).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(ofl.paragraphs.some(p => p.includes("\n"))).toBe(true);
  });
});

describe("Third-party notices in Settings", () => {
  it("shows the counts at once and loads the full text only when first opened", async () => {
    const load = vi.fn(() => Promise.resolve(parts));
    render(<main><ThirdPartyNotices load={load} /></main>);
    expect(screen.getByText(new RegExp(`includes ${THIRD_PARTY_SUMMARY.total} third-party components: ${THIRD_PARTY_SUMMARY.rust} Rust crates`))).toBeTruthy();
    expect(screen.queryByText(/Not included in this build yet/)).toBeNull();
    expect(load).not.toHaveBeenCalled();
    const summary = screen.getByText("Read the third-party notices");
    await userEvent.click(summary);
    const article = await screen.findByRole("article", { name: "Rust crates (1)" });
    expect(within(article).getByRole("heading", { level: 4, name: "serde 1.0.0" })).toBeTruthy();
    // Text, never markup.
    expect(screen.getByText(/Permission is hereby granted <b>free<\/b>/)).toBeTruthy();
    expect(document.querySelector("article b")).toBeNull();
    await userEvent.click(summary);
    await userEvent.click(summary);
    await waitFor(() => expect(document.querySelector("details")!.open).toBe(true));
    expect(load).toHaveBeenCalledTimes(1);
    await expectNoAxeViolations();
  });

  it("says where else to find the notices if they can't be loaded, and retries", async () => {
    const load = vi.fn<() => Promise<NoticesPart[]>>().mockRejectedValueOnce(new Error("chunk failed")).mockResolvedValueOnce(parts);
    render(<main><ThirdPartyNotices load={load} /></main>);
    await userEvent.click(screen.getByText("Read the third-party notices"));
    expect(await screen.findByText(/also in THIRD_PARTY_NOTICES\.txt/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("article", { name: "Licence texts (1)" })).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
