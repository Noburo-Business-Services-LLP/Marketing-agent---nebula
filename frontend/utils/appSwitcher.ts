export type NebulaaAreaId = 'content' | 'outreach' | 'leads';

export interface NebulaaArea {
  id: NebulaaAreaId;
  label: string;
  path: string | null;
  available: boolean;
}

export const NEBULAA_AREAS: NebulaaArea[] = [
  { id: 'content', label: 'Content', path: '/dashboard', available: true },
  { id: 'outreach', label: 'Outreach', path: null, available: false },
  { id: 'leads', label: 'Lead generation', path: null, available: false },
];

export const CURRENT_AREA_ID: NebulaaAreaId = 'content';

export function areaTarget(area: NebulaaArea): string | null {
  return area.available && area.path ? area.path : null;
}

/** Next available index from `from` in direction `dir`, wrapping; returns `from` if no other is available. */
export function nextEnabledIndex(areas: NebulaaArea[], from: number, dir: 1 | -1): number {
  const n = areas.length;
  for (let step = 1; step <= n; step++) {
    const i = (((from + dir * step) % n) + n) % n;
    if (areas[i].available) return i;
  }
  return from;
}
