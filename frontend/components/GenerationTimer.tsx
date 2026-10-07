import React, { useEffect, useState } from 'react';
import { etaState } from '../utils/eta';

/**
 * A running clock, a typical range and an easing bar for any slow generation.
 * `startedAt` is when the work really began (epoch ms); without it the clock
 * starts when this appears.
 */
const GenerationTimer: React.FC<{
  minSeconds: number;
  maxSeconds: number;
  startedAt?: number;
  className?: string;
}> = ({ minSeconds, maxSeconds, startedAt, className = '' }) => {
  const [t0] = useState(() => startedAt || Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const s = etaState((now - t0) / 1000, minSeconds, maxSeconds);
  return (
    <div className={className} role="timer" aria-live="off">
      <div className="h-1.5 w-full rounded-full overflow-hidden bg-[var(--gv-border-subtle)]">
        <div className="h-full rounded-full bg-[var(--gv-accent)] transition-all duration-1000" style={{ width: `${s.percent}%` }} />
      </div>
      <p className="mt-1.5 text-[12.5px] text-[var(--gv-text-secondary)]">
        {s.over
          ? `Time so far ${s.elapsed}. This is taking longer than usual, but it is still working. If it fails, your Quarks are returned.`
          : `Time so far ${s.elapsed} · usually ${s.range}`}
      </p>
    </div>
  );
};

export default GenerationTimer;
