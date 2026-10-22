import { Badge, Disclosure, DocumentView } from "../../../design-system";
import type { LegalDocument } from "../../../legal";

const DATE = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" });
/** "2026-10-21" → "October 21, 2026" (a calendar date, not an instant). */
export const formatDocumentDate = (isoDate: string) => DATE.format(new Date(`${isoDate}T00:00:00Z`));

export const documentMeta = (doc: LegalDocument) => `Version ${doc.version} · ${doc.draft ? "Draft dated" : "Effective"} ${formatDocumentDate(doc.effectiveDate)}`;

/** One bundled document behind an expander, for the first-run screen and Settings. */
export function LegalDocumentDisclosure({ doc, headingLevel }: { doc: LegalDocument; headingLevel: 2 | 3 }) {
  return (
    <Disclosure summary={`Read the ${doc.title.replace(/ \(draft\)$/, "").toLowerCase()}`}
      srSummary={`(${doc.draft ? "draft, " : ""}version ${doc.version})`}>
      <DocumentView headingLevel={headingLevel} title={doc.title} meta={documentMeta(doc)}
        badge={doc.draft ? <Badge tone="warn">Draft</Badge> : undefined} sections={doc.sections} />
    </Disclosure>
  );
}
