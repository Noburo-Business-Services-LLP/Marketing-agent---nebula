import React from 'react';
import { availableOptions, cleanSelection, isAtCap, toggleLanguage } from '../utils/languages';

export interface AdditionalLanguageLabels {
  title: string;
  hint: string;
  full: string;
  names: Record<string, string>;
}

interface Props {
  primary?: string | null;
  value: string[];
  onChange: (next: string[]) => void;
  labels: AdditionalLanguageLabels;
}

/** Optional chips for the extra languages a client also posts in. Shared by sign-up and Settings. */
const AdditionalLanguagePicker: React.FC<Props> = ({ primary, value, onChange, labels }) => {
  const selected = cleanSelection(value, primary);
  const atCap = isAtCap(selected);
  return (
    <div>
      <p id="additional-languages-label" className="block text-sm font-bold mb-1 text-[var(--gv-text-primary)]">{labels.title}</p>
      <p className="text-xs mb-2 text-[var(--gv-text-muted)]">{labels.hint}</p>
      <div role="group" aria-labelledby="additional-languages-label" className="flex flex-wrap gap-2">
        {availableOptions(primary).map((code) => {
          const on = selected.includes(code);
          const locked = atCap && !on;
          return (
            <button
              key={code}
              type="button"
              aria-pressed={on}
              disabled={locked}
              onClick={() => onChange(toggleLanguage(selected, code, primary))}
              className={`px-3 py-1.5 rounded-full border text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                on
                  ? 'border-[var(--gv-accent)] bg-[var(--gv-accent)] text-[var(--gv-accent-ink)]'
                  : 'border-[var(--gv-border-default)] bg-[var(--gv-panel)] text-[var(--gv-text-secondary)] hover:border-[var(--gv-border-strong)]'
              }`}
            >
              {labels.names[code] || code}
            </button>
          );
        })}
      </div>
      {atCap && <p role="status" className="text-xs mt-2 text-[var(--gv-text-muted)]">{labels.full}</p>}
    </div>
  );
};

export default AdditionalLanguagePicker;
