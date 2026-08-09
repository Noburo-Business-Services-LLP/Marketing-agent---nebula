// Tracks a Smart Calendar reel that is rendering in the background.
//
// The build runs server-side on the persistent queue, so it survives page
// navigation and reloads. This keeps a small breadcrumb in localStorage so
// any page can show "reel generating" and offer a way back into the wizard.

const STORAGE_KEY = 'gravity.backgroundReel';
const EVENT = 'gravity:background-reel';

export type BackgroundReel = {
  jobId: string;
  itemId: string;
  day: number;
  headline: string;
  startedAt: number;
  progress: number;
  step: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
};

export const readBackgroundReel = (): BackgroundReel | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BackgroundReel;
    return parsed?.jobId ? parsed : null;
  } catch {
    return null;
  }
};

// Same-tab listeners don't get the native `storage` event, so fan out our own.
const broadcast = (value: BackgroundReel | null) => {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: value }));
};

export const startBackgroundReel = (
  entry: Omit<BackgroundReel, 'startedAt' | 'progress' | 'step' | 'status'>
): BackgroundReel => {
  const value: BackgroundReel = {
    ...entry,
    startedAt: Date.now(),
    progress: 0,
    step: 'queued',
    status: 'queued'
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch { /* quota or private mode — the indicator just won't persist */ }
  broadcast(value);
  return value;
};

export const updateBackgroundReel = (patch: Partial<BackgroundReel>): void => {
  const current = readBackgroundReel();
  if (!current) return;
  const next = { ...current, ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch { /* ignore */ }
  broadcast(next);
};

export const clearBackgroundReel = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
  broadcast(null);
};

// Subscribes to changes from this tab and others. Returns an unsubscribe fn.
export const onBackgroundReelChange = (cb: (value: BackgroundReel | null) => void): (() => void) => {
  const local = (e: Event) => cb((e as CustomEvent).detail ?? null);
  const cross = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) cb(readBackgroundReel());
  };
  window.addEventListener(EVENT, local);
  window.addEventListener('storage', cross);
  return () => {
    window.removeEventListener(EVENT, local);
    window.removeEventListener('storage', cross);
  };
};
