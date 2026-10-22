// Bundled legal documents (NA-3). Documents are plain data compiled into the app: nothing is fetched at
// runtime. Each carries a version, an effective date and the SHA-256 digest of its canonical text
// (`documentText`); `legal.test.ts` recomputes every digest, so a text edit without a new digest fails CI.

export interface LegalSection {
  heading: string;
  paragraphs: string[];
}

export interface LegalDocument {
  /** Stable id stored in the acceptance record ("privacy-notice", "user-agreement"). */
  id: string;
  title: string;
  /** Bumped whenever the text changes; a new version asks for acceptance again. */
  version: string;
  /** ISO date (YYYY-MM-DD). */
  effectiveDate: string;
  /** Draft documents are placeholders pending counsel review and say so wherever they are shown. */
  draft: boolean;
  /** One plain-language sentence for the first-run screen and Settings. */
  summary: string;
  sections: LegalSection[];
  /** Lowercase hex SHA-256 of `documentText(this)`. */
  digest: string;
}

/** The exact text the digest covers: every field a reader sees, in a fixed layout. */
export function documentText(doc: Omit<LegalDocument, "digest">): string {
  const lines = [
    doc.title,
    `id: ${doc.id}`,
    `version: ${doc.version}`,
    `effective: ${doc.effectiveDate}`,
    `draft: ${doc.draft}`,
    "",
    doc.summary,
  ];
  for (const section of doc.sections) lines.push("", `## ${section.heading}`, ...section.paragraphs.flatMap(p => ["", p]));
  return `${lines.join("\n")}\n`;
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
}
