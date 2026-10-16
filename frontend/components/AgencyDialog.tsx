import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

/**
 * A plain dialog: Escape closes it, focus starts on the first field (or the first button below the title), and focus goes
 * back to what opened it. Closing is ignored while a request is running (`busy`), so the list is never left out of date.
 */
const AgencyDialog: React.FC<{ title: string; onClose: () => void; busy?: boolean; children: React.ReactNode }> = ({ title, onClose, busy, children }) => {
  const ref = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const live = useRef({ onClose, busy: !!busy });
  live.current = { onClose, busy: !!busy };
  const close = () => { if (!live.current.busy) live.current.onClose(); };
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const first = body.current?.querySelector<HTMLElement>('input, textarea, select') || body.current?.querySelector<HTMLElement>('button');
    first?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); try { opener?.focus?.(); } catch { /* the opener may be gone */ } };
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-[var(--gv-panel)] p-5 shadow-xl sm:max-w-md sm:rounded-2xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-[var(--gv-text-primary)]">{title}</h2>
          <button type="button" onClick={close} disabled={busy} aria-label="Close" className="rounded p-1 text-[var(--gv-text-secondary)]"><X className="h-5 w-5" /></button>
        </div>
        <div ref={body}>{children}</div>
      </div>
    </div>
  );
};

export default AgencyDialog;
