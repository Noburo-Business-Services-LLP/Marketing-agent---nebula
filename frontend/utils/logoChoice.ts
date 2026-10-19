import { LOGO_GRID } from '../constants/logoPositions.ts';
import type { LogoGridPosition } from '../constants/logoPositions.ts';

/**
 * Where the logo goes on Create content when nothing has been chosen for it yet: the top right corner
 * (owner request, 2026-10-19). A position saved on the logo in Brand assets always wins.
 */
export const DEFAULT_LOGO_POSITION: LogoGridPosition = 'top-right';

/** The saved position when it is one the picker offers, otherwise the default. Never replaces a saved choice. */
export function logoPositionFor(saved: unknown): LogoGridPosition {
  return typeof saved === 'string' && (LOGO_GRID as string[]).includes(saved)
    ? (saved as LogoGridPosition)
    : DEFAULT_LOGO_POSITION;
}

/** Arrow-key movement inside a row of choices: right and down go forward, left and up go back, both wrap. */
export function stepChoice(count: number, index: number, key: string): number {
  if (count <= 0) return -1;
  const from = index < 0 ? 0 : index;
  if (key === 'ArrowRight' || key === 'ArrowDown') return (from + 1) % count;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (from - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return index;
}
