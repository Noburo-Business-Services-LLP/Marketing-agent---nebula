import React from 'react';
import { useSearchParams } from 'react-router-dom';
import './pageTabs.css';

export interface PageTab {
  key: string;
  label: string;
  element: React.ReactNode;
  /** The page header shown above the tab bar while this tab is open (the shared PageHeader), so the title comes first. */
  header?: React.ReactNode;
  /** Width classes for the header and tab bar, so they line up with the tab's own column (for example 'max-w-[960px] mx-auto'). */
  frame?: string;
  /** Not listed in the tab bar; still opens from its address (for example an old bookmark), and is then listed while open. */
  hidden?: boolean;
}

/**
 * Two or three related screens on one page, chosen with a small tab bar. The tab is kept in the address
 * (?tab=ideas) so links and the browser back button work. Used to fold rarely used pages into the ones they belong with.
 */
const PageTabs: React.FC<{ tabs: PageTab[]; label?: string }> = ({ tabs, label }) => {
  const [params, setParams] = useSearchParams();
  const current = tabs.find((t) => t.key === params.get('tab')) || tabs[0];
  const listed = tabs.filter((t) => !t.hidden || t.key === current.key);
  return (
    <div>
      <div className={current.frame || ''}>
        {current.header}
        <div className="nb-tabs">
          <div role="tablist" aria-label={label} className="nb-tabs-list">
            {listed.map((t, i) => (
              <button
                key={t.key}
                id={`tab-${t.key}`}
                role="tab"
                type="button"
                aria-selected={t.key === current.key}
                tabIndex={t.key === current.key ? 0 : -1}
                onKeyDown={(e) => {
                  // Arrow keys move between the tabs (the usual tab pattern); Enter or Space opens one.
                  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
                  e.preventDefault();
                  const n = listed.length;
                  const to = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + (e.key === 'ArrowRight' ? 1 : n - 1)) % n;
                  (e.currentTarget.parentElement?.children[to] as HTMLElement | undefined)?.focus();
                }}
                onClick={() => { const next = new URLSearchParams(params); if (t.key === tabs[0].key) next.delete('tab'); else next.set('tab', t.key); setParams(next, { replace: false }); }}
                className="nb-tabs-tab"
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div key={current.key} role="tabpanel" aria-labelledby={`tab-${current.key}`}>{current.element}</div>
    </div>
  );
};

export default PageTabs;
