import React, { useEffect, useId, useRef, useState } from 'react';
import { apiService } from '../services/api';
import { customerMessage } from '../utils/errors';
import { HandleAction, handleActionLabel, validateHandle } from '../utils/competitorInsights';

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gv-accent)]';
const BTN = `inline-flex items-center justify-center rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-panel)] px-3 min-h-[44px] text-[13px] font-semibold text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-2)] disabled:opacity-60 ${FOCUS}`;
const LINK = `inline-flex items-center rounded-md min-h-[44px] text-[13px] font-semibold text-[var(--gv-text-primary)] underline underline-offset-2 hover:text-[var(--gv-accent)] ${FOCUS}`;
const FALLBACK = 'We could not save the handle. Please try again.';

export interface SavedHandle { id: string; name: string; handle: string; handleStatus: string }

interface Props {
  competitorId: string;
  competitorName: string;
  /** The handle now (without @); prefilled in the input. */
  handle?: string;
  action: HandleAction;
  onSaved: (saved: SavedHandle) => void;
  /** Called when the server says the account needs the add-on. */
  onLocked?: () => void;
}

/** A small inline control: "Confirm handle" or "Edit handle" opens one field with Save and Cancel. */
const HandleEditor: React.FC<Props> = ({ competitorId, competitorName, handle = '', action, onSaved, onLocked }) => {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(handle);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const alive = useRef(true);
  const id = useId();

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);

  const openIt = () => { setValue(handle); setError(''); setOpen(true); };
  const close = () => { setOpen(false); setError(''); setTimeout(() => opener.current?.focus(), 0); };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const v = validateHandle(value);
    if (v.ok === false) { setError(v.message); input.current?.focus(); return; }
    setBusy(true); setError('');
    try {
      const res = await apiService.setCompetitorHandle(competitorId, v.handle);
      if (!alive.current) return;
      if (res && res.success && res.competitor) {
        setOpen(false);
        onSaved({ id: competitorId, name: res.competitor.name || competitorName, handle: res.competitor.handle || v.handle, handleStatus: res.competitor.handleStatus || 'confirmed' });
      } else {
        setError(customerMessage(res && res.message, FALLBACK));
      }
    } catch (err: any) {
      if (!alive.current) return;
      if (err && err.data && err.data.upgradeRequired && onLocked) onLocked();
      setError(customerMessage(err, FALLBACK));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  if (!open) {
    return <button ref={opener} type="button" className={LINK} onClick={openIt} aria-label={`${handleActionLabel(action)} for ${competitorName}`}>{handleActionLabel(action)}</button>;
  }

  return (
    <form onSubmit={save} className="mt-1 w-full" noValidate>
      <label htmlFor={id} className="block text-[12.5px] text-[var(--gv-text-secondary)]">Instagram handle for {competitorName}</label>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <input
          id={id}
          ref={input}
          type="text"
          inputMode="text"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={60}
          value={value}
          onChange={(ev) => { setValue(ev.target.value); if (error) setError(''); }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          className={`min-h-[44px] w-full min-w-0 rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-panel)] px-3 text-[14px] text-[var(--gv-text-primary)] sm:w-auto sm:flex-1 ${FOCUS}`}
        />
        <button type="submit" disabled={busy} className={BTN}>{busy ? 'Saving' : action === 'confirm' ? 'Confirm' : 'Save'}</button>
        <button type="button" onClick={close} disabled={busy} className={BTN}>Cancel</button>
      </div>
      {error && <p id={`${id}-err`} role="alert" className="mt-1 text-[13px] text-[var(--gv-text-primary)]">{error}</p>}
    </form>
  );
};

export default HandleEditor;
