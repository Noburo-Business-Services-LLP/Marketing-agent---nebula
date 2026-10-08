import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, ChevronDown, HelpCircle, LogOut, Settings } from 'lucide-react';

/** Top-right profile: the business name and a small menu for settings, help and log out. */
const AccountMenu: React.FC<{ name: string; email: string; onLogout: () => void; compact?: boolean }> = ({ name, email, onLogout, compact }) => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const initial = name.trim().charAt(0).toUpperCase() || 'B';

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open]);

  const go = (to: string) => { setOpen(false); navigate(to); };
  const item = 'w-full flex items-center gap-2.5 px-3 h-10 rounded-lg text-[13.5px] text-left text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-2)]';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title={name}
        className="flex items-center gap-2 h-9 pl-1.5 pr-2 rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-surface-1)] hover:bg-[var(--gv-surface-2)]"
      >
        <span className="w-6 h-6 rounded-md bg-[var(--gv-accent-fill)] border border-[var(--gv-border-default)] text-[11px] font-semibold text-[var(--gv-accent-text)] flex items-center justify-center">{initial}</span>
        {!compact && <span className="hidden lg:block text-[13px] font-semibold text-[var(--gv-text-primary)] max-w-[140px] truncate">{name}</span>}
        <ChevronDown className="w-3.5 h-3.5 text-[var(--gv-text-muted)]" />
      </button>
      {open && (
        <div role="menu" aria-label="Account" className="absolute right-0 top-full mt-2 w-64 z-50 p-1.5 rounded-xl bg-[var(--gv-panel)] border border-[var(--gv-border-default)] shadow-lg">
          <div className="px-3 py-2.5 border-b border-[var(--gv-border-subtle)] mb-1">
            <p className="text-[13.5px] font-semibold text-[var(--gv-text-primary)] truncate">{name}</p>
            <p className="text-[12px] text-[var(--gv-text-tertiary)] truncate">{email}</p>
          </div>
          <button role="menuitem" type="button" className={item} onClick={() => go('/settings?tab=business')}><Building2 className="w-4 h-4 text-[var(--gv-text-tertiary)]" />Business profile</button>
          <button role="menuitem" type="button" className={item} onClick={() => go('/settings')}><Settings className="w-4 h-4 text-[var(--gv-text-tertiary)]" />Settings</button>
          <a role="menuitem" className={item} href="mailto:support@nebulaa.ai"><HelpCircle className="w-4 h-4 text-[var(--gv-text-tertiary)]" />Help and support</a>
          <button role="menuitem" type="button" className={item} onClick={() => { setOpen(false); onLogout(); }}><LogOut className="w-4 h-4 text-[var(--gv-text-tertiary)]" />Log out</button>
        </div>
      )}
    </div>
  );
};

export default AccountMenu;
