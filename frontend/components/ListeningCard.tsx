import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiService } from '../services/api';
import type { ListeningResponse } from '../types';
import { LOAD_ERROR, LOCKED_NOTE, TITLE, asOfLine, barRows, barSummary, basedOn, cardState, dayText, notEnoughLines, platformName, quoteLabel, quoteText, quotesFor, recentLinkLabel, recentNegativeRows, waitingText } from '../utils/listening';
import type { ListeningLabel } from '../utils/listening';

const CARD = 'mb-6 rounded-2xl border border-[var(--gv-border-subtle)] bg-[var(--gv-surface-1)] p-4 sm:p-6';
const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gv-accent)]';
const BTN = `inline-flex items-center justify-center rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-panel)] px-3 min-h-[44px] text-[13px] font-semibold text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-2)] ${FOCUS}`;
const LINK = `rounded-md font-semibold text-[var(--gv-text-primary)] underline underline-offset-2 hover:text-[var(--gv-accent)] ${FOCUS}`;
const TEXT2 = 'text-[var(--gv-text-secondary)]';
const H = 'text-[18px] font-semibold text-[var(--gv-text-primary)]';

/** Segment fills. Words and counts sit beside the bar, and the negative part is striped, so colour is never the only signal. */
const FILL: Record<ListeningLabel, React.CSSProperties> = {
  positive: { background: 'var(--gv-accent)' },
  neutral: { background: 'var(--gv-text-muted)' },
  negative: { background: 'repeating-linear-gradient(135deg, var(--gv-coral) 0 4px, var(--gv-coral-text) 4px 8px)' },
};

interface Props {
  /** Inbox page: also lists the latest negative comments, as links to the conversation. */
  showRecent?: boolean;
  /** My plan: an account without the Inbox add-on sees one calm line instead of nothing. */
  lockedNote?: boolean;
}

/** What people say about you: how many of the recent comments and messages were positive, neutral and negative. */
const ListeningCard: React.FC<Props> = ({ showRecent = false, lockedNote = false }) => {
  const [res, setRes] = useState<ListeningResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);

  const load = useCallback(async () => {
    setFailed(false);
    setLoaded(false);
    try {
      const r = await apiService.getListening();
      if (alive.current) setRes(r);
    } catch {
      if (alive.current) { setRes(null); setFailed(true); }
    } finally {
      if (alive.current) setLoaded(true);
    }
  }, []);

  useEffect(() => { alive.current = true; load(); return () => { alive.current = false; }; }, [load]);

  if (!loaded) {
    return (
      <section aria-labelledby="listening-title" className={CARD} aria-busy="true">
        <h2 id="listening-title" className={H}>{TITLE}</h2>
        <p role="status" className={`mt-1 text-[14px] ${TEXT2}`}>Loading…</p>
      </section>
    );
  }

  const state = failed ? 'error' : cardState(res);
  if (state === 'locked') {
    if (!lockedNote) return null;
    return (
      <p className={`mb-6 rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-surface-1)] px-4 py-3 text-[14px] leading-relaxed ${TEXT2}`}>
        {LOCKED_NOTE.before}
        <Link to="/trial-expired" className={LINK}>{LOCKED_NOTE.link}</Link>
        {LOCKED_NOTE.after}
      </p>
    );
  }

  const rows = state === 'ready' ? barRows(res) : [];
  const quotes = state === 'ready' ? quotesFor(res) : [];
  const recent = state === 'ready' && showRecent ? recentNegativeRows(res) : [];
  const asOf = state === 'ready' ? asOfLine(res) : '';
  const lines = state === 'not_enough' ? notEnoughLines(res) : null;

  return (
    <section aria-labelledby="listening-title" className={CARD}>
      <h2 id="listening-title" className={H}>{TITLE}</h2>

      {state === 'error' && (
        <div className="mt-2">
          <p role="alert" className="text-[14px] text-[var(--gv-text-primary)]">{LOAD_ERROR}</p>
          <button type="button" className={`${BTN} mt-3`} onClick={load}>Try again</button>
        </div>
      )}

      {lines && (
        <>
          <p className="mt-1 text-[14px] font-medium text-[var(--gv-text-primary)]">{lines.headline}</p>
          <p className={`mt-1 text-[14px] leading-relaxed ${TEXT2}`}>{lines.note}</p>
        </>
      )}

      {state === 'waiting' && (
        <p className={`mt-1 text-[14px] leading-relaxed ${TEXT2}`}>{(res && res.message) || waitingText()}</p>
      )}

      {state === 'ready' && res && (
        <>
          <p className={`mt-1 text-[14px] ${TEXT2}`}>{basedOn(res)}{asOf ? ` ${asOf}` : ''}</p>

          <div role="img" aria-label={barSummary(res)} className="mt-4 flex h-3 w-full gap-0.5 overflow-hidden rounded-full">
            {rows.filter((r) => r.width > 0).map((r) => (
              <div key={r.key} data-segment={r.key} style={{ width: `${r.width}%`, ...FILL[r.key] }} />
            ))}
          </div>

          <table className="mt-3 w-full text-left text-[14px]">
            <caption className="sr-only">Comments and messages by how they read</caption>
            <thead className="text-[12.5px] font-medium text-[var(--gv-text-secondary)]"><tr><th scope="col" className="pb-1 pr-2 font-medium">Kind</th><th scope="col" className="pb-1 pr-2 text-right font-medium">Comments</th><th scope="col" className="pb-1 text-right font-medium">Share</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t border-[var(--gv-border-subtle)] first:border-t-0">
                  <th scope="row" className="py-1.5 pr-2 font-medium text-[var(--gv-text-primary)]">
                    <span aria-hidden="true" className="mr-2 inline-block h-3 w-3 rounded-sm align-middle" style={FILL[r.key]} />
                    {r.label}
                  </th>
                  <td className={`py-1.5 pr-2 text-right tabular-nums ${TEXT2}`}>{r.count}</td>
                  <td className="py-1.5 text-right tabular-nums font-medium text-[var(--gv-text-primary)]">{r.percent}%</td>
                </tr>
              ))}
            </tbody>
          </table>

          {res.trend && <p className="mt-3 break-words text-[14px] leading-relaxed text-[var(--gv-text-primary)]">{res.trend}</p>}

          {quotes.length > 0 && (
            <ul className="mt-4 space-y-3" aria-label="What some people wrote">
              {quotes.map((q, i) => (
                <li key={q.id || i}>
                  <figure className="m-0 rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)] px-3 py-2">
                    <blockquote className="m-0 break-words text-[14px] leading-relaxed text-[var(--gv-text-primary)]">“{quoteText(q)}”</blockquote>
                    <figcaption className="mt-1 text-[12.5px] text-[var(--gv-text-secondary)]">{quoteLabel(q)}</figcaption>
                  </figure>
                </li>
              ))}
            </ul>
          )}

          {recent.length > 0 && (
            <div className="mt-4">
              <h3 className="text-[14px] font-semibold text-[var(--gv-text-primary)]">Recently negative</h3>
              <ul className="mt-1 divide-y divide-[var(--gv-border-subtle)]">
                {recent.map((r) => (
                  <li key={r.id}>
                    <Link to={r.href} aria-label={`${recentLinkLabel(r)}: ${r.preview}`} className={`block min-h-[44px] break-words py-2 text-[14px] text-[var(--gv-text-primary)] hover:text-[var(--gv-accent)] ${FOCUS}`}>
                      <span className="underline underline-offset-2">{r.preview}</span>
                      <span className="block text-[12.5px] text-[var(--gv-text-secondary)]">{[platformName(r.platform), dayText(r.date)].filter(Boolean).join(', ')}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
};

export default ListeningCard;
