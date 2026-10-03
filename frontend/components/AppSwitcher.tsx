import React, { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronDown } from 'lucide-react';
import { NEBULAA_AREAS, CURRENT_AREA_ID, areaTarget, nextEnabledIndex } from '../utils/appSwitcher';

interface AppSwitcherProps {
  /** Called after an available area is chosen (the mobile drawer uses it to close itself). */
  onNavigate?: () => void;
}

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gv-accent-text)]';

const AppSwitcher: React.FC<AppSwitcherProps> = ({ onNavigate }) => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const menuId = useId();
  const rafRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  const current = NEBULAA_AREAS.find((a) => a.id === CURRENT_AREA_ID) ?? NEBULAA_AREAS[0];

  const focusItem = (i: number) => itemRefs.current[i]?.focus();
  const firstEnabled = () => NEBULAA_AREAS.findIndex((a) => a.available);

  const openAndFocusFirst = () => {
    setOpen(true);
    // wait for the menu to mount before focusing
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      focusItem(firstEnabled());
    });
  };

  const closeToButton = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Space is left to the native button click (handling it here too let some
  // browsers open the menu on keydown and close it again on the click).
  const onButtonKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter') {
      e.preventDefault();
      openAndFocusFirst();
    }
  };

  const activate = (i: number) => {
    const target = areaTarget(NEBULAA_AREAS[i]);
    if (!target) return;
    setOpen(false);
    navigate(target);
    onNavigate?.();
  };

  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const focused = itemRefs.current.findIndex((el) => el === document.activeElement);
    const from = focused < 0 ? firstEnabled() : focused;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusItem(nextEnabledIndex(NEBULAA_AREAS, from, 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusItem(nextEnabledIndex(NEBULAA_AREAS, from, -1));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeToButton();
    } else if (e.key === 'Tab') {
      setOpen(false);
    } else if ((e.key === 'Enter' || e.key === ' ') && focused >= 0) {
      e.preventDefault();
      activate(focused);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? setOpen(false) : openAndFocusFirst())}
        onKeyDown={onButtonKeyDown}
        className={`w-full min-h-[40px] flex items-center justify-between gap-2 px-3 rounded-xl bg-[var(--gv-surface-1)] border border-[var(--gv-border-subtle)] hover:bg-[var(--gv-surface-2)] text-[var(--gv-text-primary)] transition-colors ${FOCUS_RING} focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--gv-panel)]`}
      >
        <span className="text-[13px] font-semibold truncate">{current.label}</span>
        <ChevronDown className={`w-3.5 h-3.5 shrink-0 text-[var(--gv-text-muted)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Nebulaa apps"
          onKeyDown={onMenuKeyDown}
          className="absolute left-0 right-0 top-full mt-1 z-40 p-1 rounded-xl bg-[var(--gv-panel)] border border-[var(--gv-border-default)] shadow-lg"
        >
          {NEBULAA_AREAS.map((area, i) => {
            const isCurrent = area.id === CURRENT_AREA_ID;
            return (
              <div
                key={area.id}
                ref={(el) => { itemRefs.current[i] = el; }}
                role="menuitem"
                aria-disabled={area.available ? undefined : true}
                aria-current={isCurrent ? 'true' : undefined}
                tabIndex={-1}
                onClick={() => activate(i)}
                className={`min-h-[40px] flex items-center gap-2 px-2.5 rounded-lg text-[13px] outline-none ${
                  area.available
                    ? `cursor-pointer text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-2)] focus:bg-[var(--gv-surface-2)] focus-visible:ring-inset ${FOCUS_RING}`
                    : 'cursor-default text-[var(--gv-text-muted)]'
                }`}
              >
                <span className="w-4 shrink-0 flex items-center justify-center">
                  {isCurrent && <Check className="w-3.5 h-3.5 text-[var(--gv-accent-text)]" />}
                </span>
                {/* The label never truncates: at sidebar width "Lead generation" and the
                    pill do not fit on one line, so the pill always sits below the label. */}
                <span className="flex-1 min-w-0 flex flex-col items-start gap-0.5 py-1.5">
                  <span className="font-medium">{area.label}</span>
                  {!area.available && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap bg-[var(--gv-accent-fill)] text-[var(--gv-accent-text)]">
                      Coming soon
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AppSwitcher;
