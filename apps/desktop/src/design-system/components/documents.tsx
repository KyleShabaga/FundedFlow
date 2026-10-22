// Full-page gate, document view and disclosure (NA-3).
//
// - GatePage: a whole-window step shown instead of the app frame (first-run agreement). It owns the page's
//   only h1 and main landmark, moves focus to its title on mount, and keeps its actions in view at the
//   bottom of the card while the body scrolls with the page. `preview` renders it inside another page.
// - DocumentView: long-form text (notices, agreements) as an article with a title, a badge, a meta line and
//   headed sections. It renders bundled text only: no markup is interpreted.
// - Disclosure: a native details/summary expander, so keyboard and screen-reader behaviour is the browser's.
//   `srSummary` adds hidden text to the summary for context the visible label leaves out.
// - DisclosureCard (P0-D22): a card whose header is one real button (title, a short summary, a chevron) that opens
//   and closes the body below it in the document flow. Notices passed as `notices` stay visible while it is closed.
//   The closed body is inert, so nothing in it can be focused or read.

import { ChevronDown } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";

import { cx } from "./cx";
import type { HeadingLevel } from "./primitives";

/* ---------- GatePage ---------- */

export interface GatePageProps {
  title: string;
  /** Small text above the title, such as the product name or a step. */
  eyebrow?: ReactNode;
  children: ReactNode;
  /** The decision buttons; kept in view at the bottom of the card. */
  actions: ReactNode;
  /**
   * Inside another page (the gallery): a section with an h2 instead of the page's main landmark and h1,
   * and focus stays where it is.
   */
  preview?: boolean;
  className?: string;
}

export function GatePage({ title, eyebrow, children, actions, preview = false, className }: GatePageProps) {
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  // Focus the title on mount so keyboard and screen-reader users start at the top of the step.
  useEffect(() => {
    if (!preview) titleRef.current?.focus();
  }, [preview]);
  const Landmark = preview ? "section" : "main";
  const Title = preview ? "h2" : "h1";
  return (
    <div className={cx("ds-surface ds-gate-page", preview && "is-preview", className)}>
      <Landmark className="ds-gate-main" aria-labelledby={titleId}>
        <div className="ds-card ds-gate-card">
          <header className="ds-gate-head">
            {eyebrow != null && <div className="ds-gate-eyebrow">{eyebrow}</div>}
            <Title id={titleId} ref={titleRef} tabIndex={-1} className="ds-gate-title">{title}</Title>
          </header>
          <div className="ds-gate-body">{children}</div>
          <div className="ds-gate-actions">{actions}</div>
        </div>
      </Landmark>
    </div>
  );
}

/* ---------- DocumentView ---------- */

export interface DocumentSection {
  heading: string;
  paragraphs: string[];
}

export interface DocumentViewProps {
  title: string;
  /** Beside the title, such as a "Draft" badge. */
  badge?: ReactNode;
  /** Under the title: version, dates. */
  meta?: ReactNode;
  sections: DocumentSection[];
  /** The title's level; section headings are one level lower. Default 2. */
  headingLevel?: Exclude<HeadingLevel, 4>;
  /** Paragraphs keep their line breaks and indentation, in a monospaced face: for licence texts. Still text, never markup. */
  preformatted?: boolean;
  className?: string;
}

export function DocumentView({ title, badge, meta, sections, headingLevel = 2, preformatted = false, className }: DocumentViewProps) {
  const titleId = useId();
  const Title = `h${headingLevel}` as const;
  const Section = `h${headingLevel + 1}` as "h3" | "h4";
  return (
    <article className={cx("ds-document", preformatted && "is-preformatted", className)} aria-labelledby={titleId}>
      <header className="ds-document-head">
        <div className="ds-row">
          <Title id={titleId} className="ds-title">{title}</Title>
          {badge}
        </div>
        {meta != null && <p className="ds-faint ds-document-meta">{meta}</p>}
      </header>
      {sections.map(section => (
        <section key={section.heading} className="ds-document-section">
          <Section className="ds-document-heading">{section.heading}</Section>
          {section.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
        </section>
      ))}
    </article>
  );
}

/* ---------- Disclosure ---------- */

export interface DisclosureProps {
  summary: ReactNode;
  /** Extra screen-reader text read after the visible summary. */
  srSummary?: string;
  defaultOpen?: boolean;
  /** Called when the reader opens or closes it, for example to load a long body on first open. */
  onToggle?: (open: boolean) => void;
  children: ReactNode;
  className?: string;
}

export function Disclosure({ summary, srSummary, defaultOpen = false, onToggle, children, className }: DisclosureProps) {
  return (
    <details className={cx("ds-disclosure", className)} open={defaultOpen || undefined}
      onToggle={onToggle && (event => onToggle(event.currentTarget.open))}>
      <summary className="ds-disclosure-summary">
        {summary}
        {srSummary && <span className="ds-sr-only"> {srSummary}</span>}
      </summary>
      <div className="ds-disclosure-body">{children}</div>
    </details>
  );
}

/* ---------- DisclosureCard (P0-D22) ---------- */

export interface DisclosureCardProps {
  /** The card's name: the heading text, and the accessible name of the region and the toggle. */
  title: string;
  /** Heading level of the title. Default 2. */
  headingLevel?: 2 | 3;
  /** Short text beside the title, visible open or closed ("Checked at Oct 22, 00:13"). Read as part of the toggle. */
  summary?: ReactNode;
  /** Controlled: the caller keeps the choice (for example across data refreshes). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Essential notices, shown under the header whether the card is open or closed. */
  notices?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function DisclosureCard({ title, headingLevel = 2, summary, open, onOpenChange, notices, children, className }: DisclosureCardProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const bodyId = `${id}-body`;
  const Heading = `h${headingLevel}` as const;
  return (
    <section className={cx("ds-card", "ds-disclosure-card", open && "is-open", className)} aria-labelledby={titleId}>
      <Heading className="ds-disclosure-card-heading">
        <button type="button" className="ds-disclosure-card-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => onOpenChange(!open)}>
          <span className="ds-disclosure-card-text">
            <span id={titleId} className="ds-title">{title}</span>
            {summary != null && <span className="ds-disclosure-card-summary">{summary}</span>}
          </span>
          <ChevronDown size={18} aria-hidden="true" className="ds-disclosure-card-chevron" />
        </button>
      </Heading>
      {notices}
      <div id={bodyId} className="ds-disclosure-card-body" inert={!open}>
        <div className="ds-disclosure-card-inner">{children}</div>
      </div>
    </section>
  );
}
