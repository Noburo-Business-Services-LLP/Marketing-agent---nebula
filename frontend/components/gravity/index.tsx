/**
 * Gravity design system — the vocabulary the Create tab established, extracted
 * so every other page can reuse it instead of re-deriving it.
 *
 * Colour and input styling already come free from the `gravity-shell` override
 * layer in index.html. What lives here is the part that layer cannot retrofit:
 * typographic hierarchy, spacing rhythm, and the halo/beam treatments.
 *
 * Lifted from pages/GravityCreate.tsx — these are proven, not invented.
 */
import React from 'react';
import { BorderBeam } from '../ui/border-beam';

/** Small-caps meta label. Pairs with the `.gravity-label` class in index.html. */
export const GravityLabel: React.FC<{
  children: React.ReactNode;
  gold?: boolean;
  className?: string;
}> = ({ children, gold = false, className = '' }) => (
  <div className={`gravity-label ${gold ? 'text-[#F5A623]' : ''} ${className}`}>
    {children}
  </div>
);

/**
 * Page hero: gold eyebrow, serif display headline, muted subcopy.
 * `emphasis` is rendered italic in gold, the way Create highlights one word.
 */
export const GravityHero: React.FC<{
  eyebrow?: string;
  headline: React.ReactNode;
  subcopy?: string;
  align?: 'center' | 'left';
  className?: string;
}> = ({ eyebrow, headline, subcopy, align = 'center', className = '' }) => (
  <div className={`${align === 'center' ? 'text-center' : 'text-left'} mb-10 ${className}`}>
    {eyebrow && <GravityLabel gold className="mb-4">{eyebrow}</GravityLabel>}
    <h1 className="font-serif-display text-[clamp(34px,4.4vw,56px)] leading-[1.05] tracking-[-0.02em] text-[#F5F4F1] mb-5">
      {headline}
    </h1>
    {subcopy && (
      <p
        className={`text-[15px] text-white/55 max-w-[560px] leading-relaxed ${
          align === 'center' ? 'mx-auto' : ''
        }`}
      >
        {subcopy}
      </p>
    )}
  </div>
);

/** The gold italic emphasis word used inside a GravityHero headline. */
export const GravityEmphasis: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="italic text-[#F5A623]">{children}</span>
);

const PANEL_SURFACE: React.CSSProperties = {
  background:
    'linear-gradient(180deg, rgba(255,214,150,0.055) 0%, rgba(255,255,255,0.012) 45%, rgba(255,196,84,0.028) 100%), #0f0d0a',
  boxShadow:
    'inset 0 1px 0 0 rgba(255,214,150,0.16), inset 0 -1px 0 0 rgba(0,0,0,0.6), inset 0 0 70px rgba(245,166,35,0.05)',
};

/**
 * The metal card.
 *
 * `halo` and `beam` are deliberately OFF by default: the glow reads as special
 * because it is rare. Give a page at most one panel with them enabled.
 *
 * With `beam` on, the travelling light IS the border, so the card carries no
 * 1px outline of its own — a competing outline would sit right on top of it.
 */
export const GravityPanel: React.FC<{
  children: React.ReactNode;
  halo?: boolean;
  beam?: boolean;
  className?: string;
  padding?: string;
}> = ({ children, halo = false, beam = false, className = '', padding = 'p-5' }) => {
  const surface = (
    <div className={`relative rounded-2xl ${padding} overflow-hidden ${beam ? '' : 'border border-white/[0.06]'} ${className}`} style={PANEL_SURFACE}>
      {/* Ambient interior glow, warm to match the travelling beam. */}
      <div
        className="pointer-events-none absolute inset-0 -z-0"
        style={{ background: 'radial-gradient(60% 100% at 50% 100%, rgba(245,166,35,0.09) 0%, transparent 60%)' }}
      />
      <div className="relative">{children}</div>
    </div>
  );

  if (!halo && !beam) return surface;

  return (
    <div className="relative">
      {halo && <div className="metalHalo" aria-hidden />}
      {beam ? (
        <BorderBeam
          size="md"
          colorVariant="sunset"
          theme="dark"
          saturation={1.35}
          brightness={2.4}
          hueRange={18}
          duration={3.6}
          borderRadius={16}
          strength={1}
          className="relative block"
          style={{ zIndex: 1 }}
        >
          {surface}
        </BorderBeam>
      ) : (
        surface
      )}
    </div>
  );
};

/**
 * A labelled setting box — icon, label, current value, EDIT affordance.
 * Pair with GravityOptionPopover for the dropdown, anchored by a
 * `relative`-positioned wrapper.
 */
export const GravityMetaBox: React.FC<{
  label: string;
  value: string;
  Icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  actionText?: string;
}> = ({ label, value, Icon, onClick, actionText = 'Edit' }) => (
  <button
    type="button"
    onClick={onClick}
    className="group relative flex items-center gap-4 h-[68px] px-5 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/[0.12] transition-all text-left w-full"
  >
    <span className="w-9 h-9 rounded-md bg-[#F5A623]/10 border border-[#F5A623]/20 flex items-center justify-center flex-shrink-0">
      <Icon className="w-4 h-4 text-[#F5A623]" />
    </span>
    <div className="flex-1 min-w-0">
      <div className="gravity-label mb-0.5">{label}</div>
      <div className="text-[14px] font-semibold text-[#F5F4F1] truncate">{value}</div>
    </div>
    <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35 group-hover:text-[#F5A623]">
      {actionText}
    </span>
  </button>
);

export type GravityOption = { value: string; label: string };

/** Dropdown panel for a GravityMetaBox. Renders nothing when closed. */
export const GravityOptionPopover: React.FC<{
  open: boolean;
  options: GravityOption[];
  onPick: (value: string) => void;
  onClose: () => void;
}> = ({ open, options, onPick, onClose }) => {
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute top-full left-0 right-0 mt-2 rounded-xl border border-white/[0.10] bg-[#151515] shadow-2xl z-50 overflow-hidden max-h-72 overflow-y-auto">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => { onPick(o.value); onClose(); }}
            className="w-full text-left px-4 py-2.5 text-[13px] text-[#F5F4F1] hover:bg-white/[0.06] transition-colors"
          >
            {o.label}
          </button>
        ))}
      </div>
    </>
  );
};

/** Primary (gold) and ghost buttons, matching Create's action styling. */
export const GravityButton: React.FC<{
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost';
  disabled?: boolean;
  className?: string;
  type?: 'button' | 'submit';
}> = ({ children, onClick, variant = 'primary', disabled = false, className = '', type = 'button' }) => {
  const base =
    'inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-[13px] font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed';
  const variants = {
    primary: 'bg-[#F5A623] text-[#1A1208] hover:bg-[#ffb833] shadow-[0_4px_18px_rgba(245,166,35,0.20)]',
    ghost: 'border border-white/[0.12] text-[#F5F4F1] hover:bg-white/[0.05] hover:border-white/20',
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${variants[variant]} ${className}`}>
      {children}
    </button>
  );
};
