import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { coverFallbackText, shouldShowCoverImage } from '../../utils/calendarPlan';

/**
 * Built-in cover for a plan month: deep ink, a gold glow, a fine diagonal pattern, a small calendar drawing,
 * the month in the display serif and the business name. Fills whatever box it is put in.
 * `banner` leaves the month name and business to the heading that sits on top of it.
 */
export const CalendarCoverFallback: React.FC<{ month?: string; businessName?: string; variant?: 'card' | 'banner'; pending?: boolean }> = ({
  month, businessName, variant = 'card', pending = false,
}) => {
  const t = coverFallbackText(month, businessName);
  const id = `cc-${String(month || 'x').replace(/[^0-9a-z]/gi, '')}-${variant}`;
  const banner = variant === 'banner';
  return (
    <div role="img" aria-label={`${t.label}, plan cover`} className="relative w-full h-full overflow-hidden bg-[#17130d]">
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 400 160" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
        <defs>
          <radialGradient id={`${id}-g`} cx="78%" cy="30%" r="70%">
            <stop offset="0" stopColor="#F5A623" stopOpacity="0.38" />
            <stop offset="0.55" stopColor="#F5A623" stopOpacity="0.08" />
            <stop offset="1" stopColor="#F5A623" stopOpacity="0" />
          </radialGradient>
          <pattern id={`${id}-p`} width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
            <line x1="0" y1="0" x2="0" y2="14" stroke="#F5A623" strokeOpacity="0.07" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="400" height="160" fill={`url(#${id}-p)`} />
        <rect width="400" height="160" fill={`url(#${id}-g)`} />
        <g transform="translate(300 28)" fill="none" stroke="#F5A623" strokeOpacity="0.55" strokeWidth="1.4" strokeLinecap="round">
          <rect x="0" y="8" width="72" height="64" rx="9" />
          <line x1="0" y1="26" x2="72" y2="26" />
          <line x1="20" y1="0" x2="20" y2="16" />
          <line x1="52" y1="0" x2="52" y2="16" />
          {[0, 1, 2].flatMap((r) => [0, 1, 2, 3].map((c) => (
            <circle key={`${r}${c}`} cx={13 + c * 15.3} cy={39 + r * 12} r={r === 1 && c === 2 ? 3.4 : 1.6} fill="#F5A623" fillOpacity={r === 1 && c === 2 ? 0.95 : 0.4} stroke="none" />
          )))}
        </g>
      </svg>
      {!banner && (
        <div className="absolute inset-0 flex flex-col justify-end px-4 pb-3">
          <span className="font-serif-display text-[28px] leading-none text-[#F5F4F1]">{t.monthName}</span>
          <span className="mt-1 text-[11px] tracking-[0.14em] uppercase text-[#F5A623]/80 truncate">{[t.year, t.business].filter(Boolean).join('  ·  ')}</span>
        </div>
      )}
      {pending && <Loader2 className="absolute top-2.5 left-2.5 w-4 h-4 animate-spin text-[#F5A623]/80" aria-label="Making the cover" />}
    </div>
  );
};

/** The month's picture, or the built-in cover when there is none, it is still being made, or it will not load. */
export const CalendarCover: React.FC<{ imageUrl?: string; month?: string; businessName?: string; variant?: 'card' | 'banner'; pending?: boolean }> = ({
  imageUrl, month, businessName, variant = 'card', pending = false,
}) => {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (shouldShowCoverImage(imageUrl, failedUrl)) {
    return <img src={imageUrl} alt="" loading="lazy" onError={() => setFailedUrl(imageUrl || null)} className="w-full h-full object-cover" />;
  }
  return <CalendarCoverFallback month={month} businessName={businessName} variant={variant} pending={pending} />;
};
