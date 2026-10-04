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
import { Upload } from 'lucide-react';
import { BorderBeam } from '../ui/border-beam';

/** Small-caps meta label. Pairs with the `.gravity-label` class in index.html. */
export const GravityLabel: React.FC<{
  children: React.ReactNode;
  gold?: boolean;
  className?: string;
}> = ({ children, gold = false, className = '' }) => (
  <div className={`gravity-label ${gold ? 'text-[var(--gv-accent-text)]' : ''} ${className}`}>
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
  /** 'lg' is the full entry-point hero; 'md' is a working step header. */
  size?: 'lg' | 'md';
  className?: string;
}> = ({ eyebrow, headline, subcopy, align = 'center', size = 'lg', className = '' }) => {
  const lg = size === 'lg';
  return (
    <div className={`${align === 'center' ? 'text-center' : 'text-left'} ${lg ? 'mb-10' : 'mb-6'} ${className}`}>
      {eyebrow && <GravityLabel gold className={lg ? 'mb-4' : 'mb-2'}>{eyebrow}</GravityLabel>}
      <h1
        className={`font-serif-display leading-[1.1] tracking-[-0.02em] text-[var(--gv-text-primary)] ${
          lg ? 'text-[clamp(34px,4.4vw,56px)] leading-[1.05] mb-5' : 'text-[26px] mb-2'
        }`}
      >
        {headline}
      </h1>
      {subcopy && (
        <p
          className={`text-[var(--gv-text-secondary)] leading-relaxed ${lg ? 'text-[15px] max-w-[560px]' : 'text-[13.5px] max-w-[620px]'} ${
            align === 'center' ? 'mx-auto' : ''
          }`}
        >
          {subcopy}
        </p>
      )}
    </div>
  );
};

/** The gold italic emphasis word used inside a GravityHero headline (headline scale — uses the large-text-safe accent). */
export const GravityEmphasis: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="italic text-[var(--gv-accent-display)]">{children}</span>
);

const usePanelSurface = (): React.CSSProperties => ({
  background:
    'linear-gradient(180deg, rgb(var(--gv-ink-rgb) / 0.05) 0%, rgb(var(--gv-ink-rgb) / 0.01) 45%, rgb(var(--gv-ink-rgb) / 0.03) 100%), var(--gv-panel)',
  boxShadow:
    'inset 0 1px 0 0 rgb(var(--gv-ink-rgb) / 0.10), inset 0 -1px 0 0 rgba(0,0,0,0.12), inset 0 0 70px rgba(245,166,35,0.05)',
});

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
  /** Classes for the inner content wrapper — spacing utilities belong here,
      since `className` lands on the outer surface whose children are the
      glow layer and this wrapper, not the content itself. */
  contentClassName?: string;
  padding?: string;
}> = ({ children, halo = false, beam = false, className = '', contentClassName = '', padding = 'p-5' }) => {
  const panelSurface = usePanelSurface();
  const surface = (
    <div className={`relative rounded-2xl ${padding} ${beam ? '' : 'border border-[var(--gv-border-subtle)]'} ${className}`} style={panelSurface}>
      {/* Ambient interior glow, warm to match the travelling beam. Clipped to
          the panel's radius here rather than with overflow-hidden on the
          surface, which would cut off popovers and dropdowns in the content. */}
      <div
        className="pointer-events-none absolute inset-0 -z-0 rounded-2xl overflow-hidden"
        style={{ background: 'radial-gradient(60% 100% at 50% 100%, rgba(245,166,35,0.09) 0%, transparent 60%)' }}
      />
      <div className={`relative ${contentClassName}`}>{children}</div>
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
    className="group relative flex items-center gap-4 h-[68px] px-5 rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-surface-1)] hover:bg-[var(--gv-surface-2)] hover:border-[var(--gv-border-default)] transition-all text-left w-full"
  >
    <span className="w-9 h-9 rounded-md bg-[var(--gv-accent-fill)] border border-[rgb(var(--gv-accent-rgb)/0.20)] flex items-center justify-center flex-shrink-0">
      <Icon className="w-4 h-4 text-[var(--gv-accent)]" />
    </span>
    <div className="flex-1 min-w-0">
      <div className="gravity-label mb-0.5">{label}</div>
      <div className="text-[14px] font-semibold text-[var(--gv-text-primary)] truncate">{value}</div>
    </div>
    <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--gv-text-muted)] group-hover:text-[var(--gv-accent-text)]">
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
      <div className="absolute top-full left-0 right-0 mt-2 rounded-xl border border-[var(--gv-border-default)] bg-[var(--gv-panel)] shadow-2xl z-50 overflow-hidden max-h-72 overflow-y-auto">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => { onPick(o.value); onClose(); }}
            className="w-full text-left px-4 py-2.5 text-[13px] text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-2)] transition-colors"
          >
            {o.label}
          </button>
        ))}
      </div>
    </>
  );
};

export type GravityStep = {
  label: string;
  state: 'done' | 'active' | 'upcoming';
  clickable: boolean;
};

/**
 * Slim progress rail for multi-step flows — numbered nodes on a connecting
 * line, rather than a grid of buttons.
 *
 * The parent computes each step's state and clickability; this only renders.
 * Labels live in hover tooltips with the active step named underneath, so an
 * 11-step flow stays one compact row instead of a wrapping keypad.
 */
export const GravityStepRail: React.FC<{
  steps: GravityStep[];
  onStepClick: (index: number) => void;
  className?: string;
}> = ({ steps, onStepClick, className = '' }) => {
  const activeIndex = steps.findIndex((s) => s.state === 'active');
  const activeLabel = activeIndex >= 0 ? steps[activeIndex].label : '';

  return (
    <div className={className}>
      <div className="flex items-center">
        {steps.map((s, i) => (
          <React.Fragment key={`${s.label}-${i}`}>
            <div className="relative group flex-shrink-0">
              <button
                type="button"
                disabled={!s.clickable}
                onClick={() => s.clickable && onStepClick(i)}
                aria-label={s.label}
                aria-current={s.state === 'active' ? 'step' : undefined}
                className={`flex items-center justify-center rounded-full text-[11px] font-semibold transition-all ${
                  s.state === 'active'
                    ? 'w-8 h-8 bg-[var(--gv-accent)] text-[var(--gv-accent-ink)] shadow-[0_0_18px_rgba(245,166,35,0.45)] ring-2 ring-[rgb(var(--gv-accent-rgb)/0.25)]'
                    : s.state === 'done'
                      ? 'w-7 h-7 bg-[rgb(var(--gv-accent-rgb)/0.85)] text-[var(--gv-accent-ink)] hover:bg-[var(--gv-accent)] cursor-pointer'
                      : 'w-7 h-7 border border-[var(--gv-border-default)] text-[var(--gv-text-muted)]'
                } ${!s.clickable && s.state !== 'active' ? 'cursor-default' : ''}`}
              >
                {i + 1}
              </button>
              {/* Label on hover, above the node — below would collide with
                  the active step's name printed under the rail. */}
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2.5 px-2.5 py-1.5 rounded-lg bg-[var(--gv-panel)] border border-[var(--gv-border-default)] text-[11px] text-[var(--gv-text-primary)] whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-30 shadow-xl">
                {s.label}
              </div>
            </div>
            {i < steps.length - 1 && (
              <div
                className={`flex-1 h-px mx-1.5 sm:mx-2 ${
                  steps[i].state === 'done' ? 'bg-[rgb(var(--gv-accent-rgb)/0.35)]' : 'bg-[var(--gv-surface-3)]'
                }`}
              />
            )}
          </React.Fragment>
        ))}
      </div>
      {activeLabel && (
        <div className="mt-3.5 text-center">
          <span className="gravity-label">
            Step {activeIndex + 1} of {steps.length}
          </span>
          <div className="text-[13.5px] font-semibold text-[var(--gv-text-primary)] mt-0.5">{activeLabel}</div>
        </div>
      )}
    </div>
  );
};

/**
 * File picker.
 *
 * `<input type="file">` renders its button with native OS chrome that no
 * amount of CSS can restyle — the reason uploads looked pasted-in against
 * everything else. The only reliable fix is to hide the real input and drive
 * it from a element we control, which is what this does.
 */
export const GravityFileInput: React.FC<{
  accept?: string;
  onFile: (file: File | undefined) => void;
  disabled?: boolean;
  buttonText?: string;
  /** Name of the current selection, shown beside the button. */
  fileName?: string;
  className?: string;
}> = ({ accept, onFile, disabled = false, buttonText = 'Choose file', fileName, className = '' }) => {
  const ref = React.useRef<HTMLInputElement>(null);
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => ref.current?.click()}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[12.5px] font-semibold transition-all border border-[var(--gv-border-default)] text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-2)] hover:border-[var(--gv-border-strong)] disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Upload className="w-3.5 h-3.5 text-[var(--gv-accent)]" />
        {buttonText}
      </button>
      <span className="text-[12px] text-[var(--gv-text-tertiary)] truncate">
        {fileName || 'No file chosen'}
      </span>
      <input
        ref={ref}
        type="file"
        accept={accept}
        disabled={disabled}
        className="hidden"
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          // Reset so picking the same file twice still fires onChange.
          e.target.value = '';
        }}
      />
    </div>
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
    primary: 'bg-[var(--gv-accent)] text-[var(--gv-accent-ink)] hover:bg-[var(--gv-accent-hover)] shadow-[0_4px_18px_rgba(245,166,35,0.20)]',
    ghost: 'border border-[var(--gv-border-default)] text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-2)] hover:border-[var(--gv-border-strong)]',
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${variants[variant]} ${className}`}>
      {children}
    </button>
  );
};
