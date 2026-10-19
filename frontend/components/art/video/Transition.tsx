import React from 'react';

/** Videos, Between parts: two frames joined by a fade, a zoom or a straight cut. Decorative. */
export const TransitionArt: React.FC<{ kind: string; on?: boolean }> = ({ kind, on }) => {
  const ink = on ? '#E8A33D' : '#14203A';
  const a = on ? 1 : 0.3;
  return (
    <svg viewBox="0 0 56 28" width="56" height="28" aria-hidden="true" focusable="false">
      <rect x="2" y="5" width="20" height="18" rx="3" fill={ink} opacity={a * 0.55} />
      {kind === 'zoom' ? (
        <rect x="30" y="1" width="24" height="26" rx="3" fill={ink} opacity={a} />
      ) : kind === 'cut' ? (
        <>
          <path d="M27 3v22" stroke={ink} strokeWidth="1.6" strokeLinecap="round" opacity={a} />
          <rect x="32" y="5" width="20" height="18" rx="3" fill={ink} opacity={a} />
        </>
      ) : (
        <>
          <rect x="16" y="5" width="20" height="18" rx="3" fill={ink} opacity={a * 0.3} />
          <rect x="32" y="5" width="20" height="18" rx="3" fill={ink} opacity={a} />
        </>
      )}
    </svg>
  );
};
