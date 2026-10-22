// Full-page gate, document view and disclosure (NA-3).
//
// - GatePage: a whole-window step shown instead of the app frame (first-run agreement). It owns the page's
//   only h1 and main landmark, moves focus to its title on mount, and keeps its actions in view at the
//   bottom of the card while the body scrolls with the page. `preview` renders it inside another page.
// - DocumentView: long-form text (notices, agreements) as an article with a title, a badge, a meta line and
//   headed sections. It renders bundled text only: no markup is interpreted.
// - Disclosure: a native details/summary expander, so keyboard and screen-reader behaviour is the browser's.
//   `srSummary` adds hidden text to the summary for context the visible label leaves out.

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
  className?: string;
}

export function DocumentView({ title, badge, meta, sections, headingLevel = 2, className }: DocumentViewProps) {
  const titleId = useId();
  const Title = `h${headingLevel}` as const;
  const Section = `h${headingLevel + 1}` as "h3" | "h4";
  return (
    <article className={cx("ds-document", className)} aria-labelledby={titleId}>
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
  children: ReactNode;
  className?: string;
}

export function Disclosure({ summary, srSummary, defaultOpen = false, children, className }: DisclosureProps) {
  return (
    <details className={cx("ds-disclosure", className)} open={defaultOpen || undefined}>
      <summary className="ds-disclosure-summary">
        {summary}
        {srSummary && <span className="ds-sr-only"> {srSummary}</span>}
      </summary>
      <div className="ds-disclosure-body">{children}</div>
    </details>
  );
}
