/**
 * The one page-header spec (owner, 2026-10-19: "make it uniform and consistent across pages").
 * The numbers live here so the style sheet (components/pageHeader.css) and the tests read one source.
 * Spec in words: docs/superpowers/ops/tile-system.md, "Page header".
 */
export const PAGE_HEADER = {
  /** Serif display title. Desktop and tablet size, then the phone size below 640 px wide. */
  titleDesktopPx: 32,
  titlePhonePx: 26,
  titleLineHeight: 1.15,
  titleWeight: 400,
  /** The gold italic emphasis word, one step deeper than the display gold for 3 to 1 on the cream at this size. */
  emphasisColour: '#C06F00',
  /** Small uppercase eyebrow over the title. */
  eyebrowPx: 11,
  /** One-line description under the title. */
  descriptionPx: 14,
  descriptionMaxWidthPx: 640,
  /** Space below the whole header, then on a phone. The header itself has no top margin. */
  gapBelowPx: 24,
  gapBelowPhonePx: 20,
  phoneBreakpointPx: 639,
} as const;

/** The class names the component uses; tests check the style sheet defines each of them. */
export const PAGE_HEADER_CLASSES = ['nb-page-head', 'nb-page-head-text', 'nb-page-eyebrow', 'nb-page-title', 'nb-page-desc', 'nb-page-actions'] as const;
