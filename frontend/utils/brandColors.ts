// Nebulaa used to fill in these two colours for clients who had none. They are not the client's own colours.
const PLACEHOLDER_PRIMARY = '#111111';
const PLACEHOLDER_SECONDARY = '#FFCC29';

export function isPlaceholderColorPair(primary?: string | null, secondary?: string | null): boolean {
  return (
    String(primary || '').trim().toUpperCase() === PLACEHOLDER_PRIMARY &&
    String(secondary || '').trim().toUpperCase() === PLACEHOLDER_SECONDARY
  );
}
