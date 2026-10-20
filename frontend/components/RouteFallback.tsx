import React, { useEffect, useState } from 'react';

/** Shown while a page file loads. Draws nothing for the first 150 ms so a fast load never flashes. */
const RouteFallback: React.FC<{ delayMs?: number }> = ({ delayMs = 150 }) => {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setShow(true), delayMs);
    return () => window.clearTimeout(t);
  }, [delayMs]);
  if (!show) return null;
  return (
    <div role="status" aria-live="polite" aria-label="Loading the page" className="animate-pulse space-y-4 py-2">
      <div className="h-3 w-28 rounded-full bg-[var(--gv-surface-2,rgba(0,0,0,0.06))]" />
      <div className="h-8 w-2/3 max-w-md rounded-lg bg-[var(--gv-surface-2,rgba(0,0,0,0.06))]" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-32 rounded-2xl bg-[var(--gv-surface-2,rgba(0,0,0,0.06))]" />
        ))}
      </div>
      <span className="sr-only">Loading the page</span>
    </div>
  );
};

export default RouteFallback;
