import React from 'react';

/** The small gold flourish beside the plan's title card. Decorative; the page animates it only without reduced motion. */
export const PlanSparkleArt: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true" focusable="false" className={className}>
    <path className="nb-spark-a" d="M20 4c1.4 8.6 4 11.2 12.6 12.6C24 18 21.4 20.6 20 29.2 18.6 20.6 16 18 7.4 16.6 16 15.2 18.6 12.6 20 4z" fill="#F5A623" />
    <path className="nb-spark-b" d="M32 25c.7 3.8 1.9 5 5.6 5.6-3.7.7-4.9 1.9-5.6 5.6-.7-3.7-1.9-4.9-5.6-5.6 3.7-.6 4.9-1.8 5.6-5.6z" fill="#FFCB2E" />
    <circle className="nb-spark-c" cx="8" cy="31" r="2" fill="#EE6330" />
  </svg>
);
