/** Elapsed time and a typical range for a slow task, shown so people know roughly how long to wait. */
export interface EtaState { percent: number; elapsed: string; range: string; over: boolean }

export function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function rangeText(minSeconds: number, maxSeconds: number): string {
  if (maxSeconds < 90) return `${minSeconds} to ${maxSeconds} seconds`;
  return `${Math.round(minSeconds / 60)} to ${Math.round(maxSeconds / 60)} minutes`;
}

/**
 * The bar eases toward 95% across the typical range and never reaches 100%
 * until the work is really finished, so it cannot claim "done" early.
 */
export function etaState(elapsedSeconds: number, minSeconds: number, maxSeconds: number): EtaState {
  const e = Math.max(0, elapsedSeconds);
  const share = 1 - Math.exp((-2.2 * e) / Math.max(1, maxSeconds));
  return {
    percent: Math.min(95, Math.round(share * 95 * 1.05)),
    elapsed: formatElapsed(e),
    range: rangeText(minSeconds, maxSeconds),
    over: e > maxSeconds,
  };
}
