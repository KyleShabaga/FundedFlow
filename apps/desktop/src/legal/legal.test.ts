import { describe, expect, it } from "vitest";

import { coversCurrent, CURRENT_LEGAL_DOCUMENTS, currentAcceptance, documentText, sha256Hex } from ".";

describe("bundled legal documents", () => {
  it.each(CURRENT_LEGAL_DOCUMENTS.map(doc => [doc.id, doc] as const))("%s carries the digest of its text", async (_, doc) => {
    // On a text change, copy the digest from this failure into the document and bump its version.
    expect(doc.digest, `${doc.id}: set digest to ${await sha256Hex(documentText(doc))}`).toBe(await sha256Hex(documentText(doc)));
  });

  it("are versioned, dated and, until counsel signs off, marked as drafts everywhere they appear", () => {
    const ids = CURRENT_LEGAL_DOCUMENTS.map(d => d.id);
    expect(ids).toEqual(["privacy-notice", "user-agreement"]);
    for (const doc of CURRENT_LEGAL_DOCUMENTS) {
      expect(doc.version).toMatch(/^\d+\.\d+\.\d+(-[0-9a-z.]+)?$/);
      expect(doc.effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(doc.draft).toBe(true);
      expect(doc.version).toContain("draft");
      expect(doc.title).toContain("(draft)");
      expect(doc.sections[0].heading).toBe("About this draft");
    }
  });

  it("make no claim of review or of a network feature", () => {
    for (const doc of CURRENT_LEGAL_DOCUMENTS) {
      const text = documentText(doc).toLowerCase();
      expect(text).not.toMatch(/reviewed by (our|a) (lawyer|counsel) and approved|legally binding|final version/);
      expect(text).not.toMatch(/we (collect|share|sell)/);
    }
  });

  it("digest the text exactly: any visible change gives a new digest", async () => {
    const [doc] = CURRENT_LEGAL_DOCUMENTS;
    const changed = { ...doc, sections: [{ ...doc.sections[0], paragraphs: [`${doc.sections[0].paragraphs[0]} `] }, ...doc.sections.slice(1)] };
    expect(await sha256Hex(documentText(changed))).not.toBe(doc.digest);
    expect(await sha256Hex(documentText({ ...doc, version: "9.9.9" }))).not.toBe(doc.digest);
  });

  it("count as accepted only when every current document matches by id, version and digest", () => {
    const current = currentAcceptance();
    expect(coversCurrent(current)).toBe(true);
    expect(coversCurrent([...current].reverse())).toBe(true);
    expect(coversCurrent(null)).toBe(false);
    expect(coversCurrent([])).toBe(false);
    expect(coversCurrent(current.slice(1))).toBe(false);
    expect(coversCurrent(current.map((d, i) => (i === 0 ? { ...d, version: "0.0.1" } : d)))).toBe(false);
    expect(coversCurrent(current.map((d, i) => (i === 1 ? { ...d, digest: "f".repeat(64) } : d)))).toBe(false);
  });
});
