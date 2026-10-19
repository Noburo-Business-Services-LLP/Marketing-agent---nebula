import React from 'react';
import './pageHeader.css';

/**
 * The one page header used at the top of every page (owner, 2026-10-19): an optional small uppercase eyebrow, the
 * serif display title (32 px, 26 px on a phone) with an optional gold italic emphasis part, an optional one-line
 * description, and an optional actions slot on the right (under the text on a phone).
 * Spec: docs/superpowers/ops/tile-system.md, "Page header". Numbers: utils/pageHeader.ts.
 *
 *   <PageHeader eyebrow="Library" title="Everything you have" emphasis="made" description="..." actions={<button />} />
 *
 * `emphasis` is added after the title with a space. For an emphasis in the middle of a title, pass a node and wrap
 * that part in <PageEmphasis>.
 */
export interface PageHeaderProps {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  emphasis?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** The heading level. A page has one h1; a tab inside a page that already has one may use h2. */
  as?: 'h1' | 'h2';
  /** Kept for tour anchors and links: id on the header, id on the title. */
  id?: string;
  titleId?: string;
  /** For example a data-tour anchor on the header. */
  dataTour?: string;
  /** Read out with the description, for a line that changes (for example a live count). */
  descriptionLive?: boolean;
  className?: string;
  children?: React.ReactNode;
}

/** The gold italic emphasis inside a page title. */
export const PageEmphasis: React.FC<{ children: React.ReactNode }> = ({ children }) => <em className="nb-page-em">{children}</em>;

const PageHeader: React.FC<PageHeaderProps> = ({
  eyebrow, title, emphasis, description, actions, as = 'h1', id, titleId, dataTour, descriptionLive, className = '', children,
}) => {
  const Title = as;
  return (
    <header id={id} data-tour={dataTour} className={`nb-page-head ${className}`.trim()}>
      <div className="nb-page-head-text">
        {eyebrow && <p className="nb-page-eyebrow">{eyebrow}</p>}
        <Title id={titleId} className="nb-page-title">
          {title}
          {emphasis && <>{' '}<em className="nb-page-em">{emphasis}</em></>}
        </Title>
        {description && <p className="nb-page-desc" aria-live={descriptionLive ? 'polite' : undefined}>{description}</p>}
        {children}
      </div>
      {actions && <div className="nb-page-actions">{actions}</div>}
    </header>
  );
};

export default PageHeader;
