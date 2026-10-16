import React, { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronDown, Loader2, Users } from 'lucide-react';
import { apiService } from '../services/api';
import type { AgencyClient } from '../services/api';
import type { User } from '../types';
import { agencyErrorMessage, clientStatus, isInsideClient, limitLabel, showClientSwitcher } from '../utils/agency';

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gv-accent-text)]';

/** Header menu for an agency: choose a client to work in, see all clients, or go back to the agency account. */
const ClientSwitcher: React.FC<{ user: User | null; onNavigate?: () => void }> = ({ user, onNavigate }) => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'ready'>('idle');
  const [clients, setClients] = useState<AgencyClient[]>([]);
  const [limit, setLimit] = useState(0);
  const [opening, setOpening] = useState<string | null>(null);
  const [problem, setProblem] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  let holdsPass = false;
  try { holdsPass = Boolean(localStorage.getItem('csmReturnToken')); } catch { /* storage may be blocked */ }
  const inside = isInsideClient(user);
  const currentName = inside ? (user?.actingAgency?.name || localStorage.getItem('csmActingClient') || 'Client') : '';

  const load = () => {
    setState('loading'); setProblem('');
    apiService.getAgencyClients()
      .then((r) => { setClients(r.clients || []); setLimit(r.limit || 0); setState('ready'); })
      .catch(() => setState('error'));
  };

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); } };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open]);

  if (!showClientSwitcher(user, holdsPass)) return null;

  const toggle = () => {
    if (!open && state !== 'ready') load();
    setOpen((o) => !o);
  };

  const choose = async (c: AgencyClient) => {
    setOpening(c.id); setProblem('');
    const r = await apiService.openAgencyClient(c.id);
    if (r.success) {
      window.location.hash = '#/dashboard';
      window.location.reload();
    } else {
      setProblem(agencyErrorMessage(r, 'We could not open this client. Please try again.'));
      setOpening(null);
    }
  };

  const allClients = () => {
    setOpen(false);
    onNavigate?.();
    if (inside) {
      if (apiService.returnToCsmAccount()) { window.location.hash = '#/agency/clients'; window.location.reload(); }
    } else {
      navigate('/agency/clients');
    }
  };

  const row = 'w-full min-h-[40px] flex items-center gap-2 px-2.5 rounded-lg text-[13px] text-left outline-none';

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={toggle}
        className={`w-full min-h-[40px] flex items-center justify-between gap-2 px-3 rounded-xl bg-[var(--gv-surface-1)] border border-[var(--gv-border-subtle)] hover:bg-[var(--gv-surface-2)] text-[var(--gv-text-primary)] transition-colors ${FOCUS_RING}`}
      >
        <span className="flex items-center gap-2 min-w-0">
          <Users className="w-4 h-4 shrink-0 text-[var(--gv-text-tertiary)]" aria-hidden="true" />
          <span className="text-[13px] font-semibold truncate">{inside ? currentName : 'Switch client'}</span>
        </span>
        <ChevronDown className={`w-3.5 h-3.5 shrink-0 text-[var(--gv-text-muted)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label="Clients" className="absolute left-0 top-full mt-1 z-40 w-full md:w-[300px] max-h-[70vh] overflow-y-auto p-1 rounded-xl bg-[var(--gv-panel)] border border-[var(--gv-border-default)] shadow-lg">
          {state === 'loading' && (
            <div className="flex items-center gap-2 px-3 py-3 text-[13px] text-[var(--gv-text-secondary)]" role="status"><Loader2 className="w-4 h-4 animate-spin" /> Loading your clients</div>
          )}
          {state === 'error' && (
            <div className="px-3 py-3 text-[13px] text-[var(--gv-text-secondary)]">
              <p>We could not load your clients.</p>
              <button type="button" onClick={load} className="mt-1 font-semibold text-[var(--gv-accent-text)] underline underline-offset-2">Try again</button>
            </div>
          )}
          {state === 'ready' && clients.length === 0 && (
            <p className="px-3 py-3 text-[13px] text-[var(--gv-text-secondary)]">You have no clients yet. Open All clients to add the first one.</p>
          )}
          {state === 'ready' && clients.map((c) => {
            const st = clientStatus(c, limit);
            const isCurrent = inside && c.name === currentName;
            return (
              <button
                key={c.id}
                type="button"
                role="menuitem"
                disabled={!st.canOpen || opening !== null}
                aria-current={isCurrent ? 'true' : undefined}
                title={st.reason || undefined}
                onClick={() => choose(c)}
                className={`${row} ${st.canOpen ? `text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-2)] ${FOCUS_RING}` : 'text-[var(--gv-text-muted)] cursor-default'}`}
              >
                <span className="w-4 shrink-0 flex items-center justify-center">
                  {opening === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : isCurrent ? <Check className="w-3.5 h-3.5 text-[var(--gv-accent-text)]" /> : null}
                </span>
                <span className="flex-1 min-w-0 truncate font-medium">{c.name}</span>
                {st.paused && <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--gv-surface-2)] text-[var(--gv-text-secondary)]">Paused</span>}
              </button>
            );
          })}
          {problem && <p role="alert" className="px-3 py-2 text-[12.5px] text-red-600">{problem}</p>}
          <div className="mt-1 pt-1 border-t border-[var(--gv-border-subtle)]">
            <button type="button" role="menuitem" onClick={allClients} className={`${row} text-[var(--gv-accent-text)] font-semibold hover:bg-[var(--gv-surface-2)] ${FOCUS_RING}`}>
              <span className="w-4 shrink-0" />
              <span className="flex-1">All clients</span>
              {state === 'ready' && !inside && <span className="text-[11.5px] font-normal text-[var(--gv-text-tertiary)]">{limitLabel(clients.length, limit)}</span>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClientSwitcher;
