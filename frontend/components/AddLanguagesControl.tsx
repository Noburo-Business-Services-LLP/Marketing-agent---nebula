import React, { useMemo, useState } from 'react';
import { Check, Languages, Loader2 } from 'lucide-react';
import { languageChoices, languageName, toggleLanguage } from '../utils/languages';

export interface LocalizeResult { language: string; ok: boolean; existing?: boolean; draftId?: string; message?: string }

interface Props {
  draftLanguage?: string | null;
  /** The client's own extra languages from their business profile. */
  additional: string[];
  /** Language codes that already have a version of this draft. */
  created: string[];
  onCreate: (languages: string[]) => Promise<LocalizeResult[]>;
}

export const LANGUAGE_VERSION_NOTE = 'AI draft. Please read it before you approve it. The picture text stays in the original language.';

/** "Add languages" for one draft: pick up to three languages, then each becomes its own draft to approve. */
const AddLanguagesControl: React.FC<Props> = ({ draftLanguage, additional, created, onCreate }) => {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<LocalizeResult[] | null>(null);
  const [failure, setFailure] = useState('');

  const choices = useMemo(() => languageChoices({ additional, draftLanguage, created }), [additional, draftLanguage, created]);
  const atCap = selected.length >= 3;

  const row = (c: { code: string; name: string; created: boolean }) => {
    const checked = c.created || selected.includes(c.code);
    const disabled = busy || c.created || (atCap && !selected.includes(c.code));
    return (
      <label key={c.code} className={`flex items-center gap-2 py-1 text-[13px] ${disabled ? 'opacity-70' : 'cursor-pointer'} text-[var(--gv-text-primary)]`}>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={() => setSelected((prev) => toggleLanguage(prev, c.code, draftLanguage))}
          className="w-4 h-4 accent-[var(--gv-accent)]"
        />
        <span>{c.name}</span>
        {c.created && <span className="text-[11px] text-[var(--gv-text-muted)]">Created</span>}
      </label>
    );
  };

  const submit = async () => {
    if (selected.length === 0 || busy) return;
    setBusy(true);
    setResults(null);
    setFailure('');
    try {
      const out = await onCreate(selected);
      setResults(out);
      setSelected([]);
    } catch (e: any) {
      setFailure(e?.message || 'The language versions could not be created. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-6">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-2 h-9 px-3.5 rounded-lg border border-[var(--gv-border-default)] hover:border-[var(--gv-border-strong)] hover:bg-[var(--gv-surface-1)] text-[var(--gv-text-primary)] text-[13px] font-medium"
      >
        <Languages className="w-3.5 h-3.5" />
        Add languages
      </button>

      {open && (
        <div className="mt-3 p-4 rounded-xl border border-[var(--gv-border-default)] bg-[var(--gv-panel)]">
          <p className="text-[12.5px] text-[var(--gv-text-secondary)] mb-3">
            Each language you choose becomes its own draft. You can choose up to three. {LANGUAGE_VERSION_NOTE}
          </p>

          {choices.mine.length > 0 && (
            <div className="mb-3">
              <div className="gravity-label mb-1">Your languages</div>
              {choices.mine.map(row)}
            </div>
          )}

          <div className="mb-3">
            <div className="gravity-label mb-1">Other language</div>
            <div className="grid grid-cols-2 gap-x-4">{choices.other.map(row)}</div>
          </div>

          {atCap && <p role="status" className="text-[12px] text-[var(--gv-text-muted)] mb-2">Three languages are chosen. Remove one to choose another.</p>}

          <button
            type="button"
            onClick={submit}
            disabled={busy || selected.length === 0}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-[var(--gv-accent)] hover:bg-[var(--gv-accent-hover)] text-[var(--gv-accent-ink)] text-[13px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" strokeWidth={3} />}
            Create versions
          </button>

          {busy && <p role="status" className="text-[12px] text-[var(--gv-text-muted)] mt-2">Writing the versions. This can take up to a minute.</p>}
          {failure && <p role="alert" className="text-[12px] text-[var(--gv-coral-text)] mt-2">{failure}</p>}
          {results && (
            <ul role="status" className="mt-3 space-y-1">
              {results.map((r) => (
                <li key={r.language} className={`text-[12.5px] ${r.ok ? 'text-[var(--gv-text-secondary)]' : 'text-[var(--gv-coral-text)]'}`}>
                  {r.ok
                    ? `${languageName(r.language)}: ${r.existing ? 'This version already exists.' : 'Created. It is waiting for your review.'}`
                    : `${languageName(r.language)}: ${r.message || 'This version could not be created. Please try again.'}`}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default AddLanguagesControl;
