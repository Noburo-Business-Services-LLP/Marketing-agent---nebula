import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { coverFallbackText, shouldShowCoverImage } from '../../utils/calendarPlan';

type Tone = 'dark' | 'light';
/** Colours of the built-in cover: `light` (cream to soft gold, brown ink) for the cream pages, `dark` (deep ink) as before. */
const TONES: Record<Tone, { bg: string; line: number; glow: number; draw: string; drawOpacity: number; month: string; sub: string }> = {
  dark: { bg: '#17130d', line: 0.07, glow: 0.38, draw: '#F5A623', drawOpacity: 0.55, month: '#F5F4F1', sub: 'rgb(245 166 35 / 0.8)' },
  light: { bg: 'linear-gradient(150deg, #FFF9EC 0%, #FFEFC9 60%, #FFE2A1 100%)', line: 0.16, glow: 0.45, draw: '#C77A0A', drawOpacity: 0.8, month: '#2B1D0E', sub: '#8A5200' },
};

/**
 * Built-in cover for a plan month: a gold glow, a fine diagonal pattern, a small calendar drawing,
 * the month in the display serif and the business name, on deep ink (`tone="dark"`) or cream and soft gold
 * (`tone="light"`). Fills whatever box it is put in.
 * `banner` leaves the month name and business to the heading that sits on top of it.
 */
export const CalendarCoverFallback: React.FC<{ month?: string; businessName?: string; variant?: 'card' | 'banner'; pending?: boolean; tone?: Tone }> = ({
  month, businessName, variant = 'card', pending = false, tone = 'dark',
}) => {
  const t = coverFallbackText(month, businessName);
  const c = TONES[tone];
  const id = `cc-${String(month || 'x').replace(/[^0-9a-z]/gi, '')}-${variant}-${tone}`;
  const banner = variant === 'banner';
  return (
    <div role="img" aria-label={`${t.label}, plan cover`} className="relative w-full h-full overflow-hidden" style={{ background: c.bg }}>
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 400 160" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
        <defs>
          <radialGradient id={`${id}-g`} cx="78%" cy="30%" r="70%">
            <stop offset="0" stopColor="#F5A623" stopOpacity={c.glow} />
            <stop offset="0.55" stopColor="#F5A623" stopOpacity="0.08" />
            <stop offset="1" stopColor="#F5A623" stopOpacity="0" />
          </radialGradient>
          <pattern id={`${id}-p`} width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
            <line x1="0" y1="0" x2="0" y2="14" stroke={c.draw} strokeOpacity={c.line} strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="400" height="160" fill={`url(#${id}-p)`} />
        <rect width="400" height="160" fill={`url(#${id}-g)`} />
        <g transform="translate(300 28)" fill="none" stroke={c.draw} strokeOpacity={c.drawOpacity} strokeWidth="1.4" strokeLinecap="round">
          <rect x="0" y="8" width="72" height="64" rx="9" />
          <line x1="0" y1="26" x2="72" y2="26" />
          <line x1="20" y1="0" x2="20" y2="16" />
          <line x1="52" y1="0" x2="52" y2="16" />
          {[0, 1, 2].flatMap((r) => [0, 1, 2, 3].map((c) => (
            <circle key={`${r}${c}`} cx={13 + c * 15.3} cy={39 + r * 12} r={r === 1 && c === 2 ? 3.4 : 1.6} fill={TONES[tone].draw} fillOpacity={r === 1 && c === 2 ? 0.95 : 0.4} stroke="none" />
          )))}
        </g>
      </svg>
      {!banner && (
        <div className="absolute inset-0 flex flex-col justify-end px-4 pb-3">
          <span className="font-serif-display text-[28px] leading-none" style={{ color: c.month }}>{t.monthName}</span>
          <span className="mt-1 text-[11px] tracking-[0.14em] uppercase truncate" style={{ color: c.sub }}>{[t.year, t.business].filter(Boolean).join('  ·  ')}</span>
        </div>
      )}
      {pending && <Loader2 className="absolute top-2.5 left-2.5 w-4 h-4 animate-spin " style={{ color: c.draw }} aria-label="Making the cover" />}
    </div>
  );
};

/** The month's picture, or the built-in cover when there is none, it is still being made, or it will not load. */
export const CalendarCover: React.FC<{ imageUrl?: string; month?: string; businessName?: string; variant?: 'card' | 'banner'; pending?: boolean; tone?: Tone }> = ({
  imageUrl, month, businessName, variant = 'card', pending = false, tone = 'dark',
}) => {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (shouldShowCoverImage(imageUrl, failedUrl)) {
    return <img src={imageUrl} alt="" loading="lazy" onError={() => setFailedUrl(imageUrl || null)} className="w-full h-full object-cover" />;
  }
  return <CalendarCoverFallback month={month} businessName={businessName} variant={variant} pending={pending} tone={tone} />;
};
