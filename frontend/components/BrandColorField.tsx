import React from 'react';
import { normalizeHexColor } from '../utils/brandColors';

interface BrandColorFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  isDarkMode: boolean;
}

export const COLOR_ERROR = 'Enter a colour such as #E63946 (three or six letters and numbers after the #).';

/** A round colour swatch (opens the browser colour picker) next to an editable, validated hex field. */
const BrandColorField: React.FC<BrandColorFieldProps> = ({ label, value, onChange, isDarkMode }) => {
  const normalized = normalizeHexColor(value);
  const invalid = value.trim() !== '' && !normalized;
  const border = isDarkMode ? 'border-slate-600' : 'border-gray-300';
  const id = `brand-color-${label.toLowerCase().replace(/\s+/g, '-')}`;

  return (
    <div className="space-y-3">
      <label htmlFor={id} className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{label}</label>
      <div className="flex items-center gap-2">
        <span
          className={`brand-swatch relative inline-block h-10 w-10 shrink-0 overflow-hidden rounded-full border ${border}`}
          style={{ background: normalized || 'transparent' }}
        >
          <input
            type="color"
            aria-label={`Choose ${label.toLowerCase()} with the colour picker`}
            value={(normalized || '#FFFFFF').toLowerCase()}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </span>
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => { if (normalized && normalized !== value) onChange(normalized); }}
          placeholder="#RRGGBB"
          aria-invalid={invalid}
          className={`flex-1 min-w-0 px-3 py-2 rounded-lg border ${isDarkMode ? 'bg-slate-800 border-slate-600 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
        />
      </div>
      {invalid && <p className="text-xs" role="alert" style={{ color: 'var(--gv-text-secondary)' }}>{COLOR_ERROR}</p>}
      {!value && <p className="text-xs" style={{ color: 'var(--gv-text-tertiary)' }}>Not set yet</p>}
    </div>
  );
};

export default BrandColorField;
