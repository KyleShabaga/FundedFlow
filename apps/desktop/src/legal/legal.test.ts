import { describe, expect, it } from "vitest";

import { coversCurrent, CURRENT_LEGAL_DOCUMENTS, currentAcceptance, documentText, LICENSE_SUMMARY, PRIVACY_SUMMARY, sha256Hex } from ".";
import { privacyNotice } from "./privacy-notice";
import { userAgreement } from "./user-agreement";

describe("bundled legal documents", () => {
  it.each(CURRENT_LEGAL_DOCUMENTS.map(doc => [doc.id, doc] as const))("%s carries the digest of its text", async (_, doc) => {
    // Self-consistency only. A text change needs Kyle's approval of the new text and digest, recorded in
    // docs/privacy-product-verification.md, before the pinned digests below change; never copy the printed digest
    // without that record.
    expect(doc.digest, `${doc.id}: set digest to ${await sha256Hex(documentText(doc))}`).toBe(await sha256Hex(documentText(doc)));
  });

  // The approved documents (owner content approval, docs/privacy-product-verification.md). These literals change
  // only after Kyle approves a new text, version and digest there (TASK-025).
  it("are exactly the approved documents: privacy notice and License and product information, both 0.2.1-draft", () => {
    expect(privacyNotice.digest).toBe("8b83157f3e1075a64fb631e39616c37e5b70cc3c70e54f473c05ec9d0db1c392");
    expect(privacyNotice.version).toBe("0.2.1-draft");
    expect(userAgreement.digest).toBe("96894603aff89db92b60b307f85693756d0e540f03851c2d39568a441c68911a");
    expect(userAgreement.version).toBe("0.2.1-draft");
  });

  // The first-run and Settings summaries as merged with these documents (PR #107). They are not part of the documents
  // or their digests, so a change here is reviewed on its own.
  it("show the summaries as merged", () => {
    expect(PRIVACY_SUMMARY).toEqual([
      "Your desktop journal is local and unencrypted. The app has no sign-in, telemetry or update checker; the installer may download WebView2 from Microsoft.",
      "Settings provides exports, restore and deletion controls. Recovery copies, external backups and WebView storage have different deletion limits; read the notice before erasing data.",
    ]);
    expect(LICENSE_SUMMARY).toEqual({
      notice: "Copyright (c) 2026 Kyle Shabaga",
      terms: [
        "FundedFlow is open source under the MIT License. You may use, copy, modify, distribute, sublicense and sell copies, provided you include the copyright and permission notice in all copies or substantial portions of the software.",
        "It is provided as is, without warranty, as a record-keeping tool that doesn't give financial, trading or investment advice.",
        "Third-party components (libraries, crates, npm packages and fonts) are licensed by their own authors under their own terms.",
      ],
    });
  });

  it("are versioned, dated and, until owner content and release approval, marked as drafts everywhere they appear", () => {
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
