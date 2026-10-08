import React from 'react';
import { useSearchParams } from 'react-router-dom';

export interface PageTab { key: string; label: string; element: React.ReactNode }

/**
 * Two or three related screens on one page, chosen with a small tab bar. The tab is kept in the address
 * (?tab=ideas) so links and the browser back button work. Used to fold rarely used pages into the ones they belong with.
 */
const PageTabs: React.FC<{ tabs: PageTab[] }> = ({ tabs }) => {
  const [params, setParams] = useSearchParams();
  const current = tabs.find((t) => t.key === params.get('tab')) || tabs[0];
  return (
    <div>
      <div className="mb-6 overflow-x-auto">
        <div role="tablist" className="inline-flex items-center gap-1 p-1 rounded-full bg-[var(--gv-surface-1)] border border-[var(--gv-border-subtle)]">
          {tabs.map((t) => (
            <button
              key={t.key}
              role="tab"
              type="button"
              aria-selected={t.key === current.key}
              onClick={() => { const next = new URLSearchParams(params); if (t.key === tabs[0].key) next.delete('tab'); else next.set('tab', t.key); setParams(next, { replace: false }); }}
              className={`whitespace-nowrap h-9 px-5 rounded-full text-[13px] font-semibold transition-colors ${t.key === current.key ? 'bg-[var(--gv-surface-3)] text-[var(--gv-text-primary)]' : 'text-[var(--gv-text-tertiary)] hover:text-[var(--gv-text-secondary)]'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div key={current.key}>{current.element}</div>
    </div>
  );
};

export default PageTabs;
