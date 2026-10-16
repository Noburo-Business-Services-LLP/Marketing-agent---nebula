import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

/** A plain dialog: Escape closes it, focus starts inside it, and the page behind stays put. */
const AgencyDialog: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('input, button')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-[var(--gv-panel)] p-5 shadow-xl sm:max-w-md sm:rounded-2xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-[var(--gv-text-primary)]">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-[var(--gv-text-secondary)]"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
};

export default AgencyDialog;
