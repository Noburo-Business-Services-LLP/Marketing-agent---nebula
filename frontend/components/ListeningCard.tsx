import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircleReply, MessagesSquare, Quote, TrendingUp } from 'lucide-react';
import { apiService } from '../services/api';
import type { ListeningResponse } from '../types';
import { PlatformMark } from './plan/PlanMarks';
import { markOf } from '../utils/inboxView';
import {
  LOAD_ERROR, LOCKED_NOTE, TITLE, barRows, barSummary, basedOn, cardState, dayText, donutArcs, donutLead, lastCheckedLine, notEnoughLines,
  platformName, quoteText, quotesFor, recentLinkLabel, recentNegativeRows, waitingText, weeklyNote,
} from '../utils/listening';
import './listening.css';

interface Props {
  /** Inbox page: also lists the latest negative comments, with a Reply button to the conversation. */
  showRecent?: boolean;
  /** My plan: an account without the Inbox add-on sees one calm line instead of nothing. */
  lockedNote?: boolean;
}

const R = 46;
const C = 2 * Math.PI * R;

/** The three-colour ring: warm gold positive, soft sand neutral, coral negative (striped, so colour is never the only signal). */
const Ring: React.FC<{ res: ListeningResponse }> = ({ res }) => {
  const id = useId().replace(/:/g, '');
  const arcs = donutArcs(res, C);
  const lead = donutLead(res);
  return (
    <div className="nb-ls-ring" role="img" aria-label={barSummary(res)}>
      <svg viewBox="0 0 120 120" aria-hidden="true" focusable="false">
        <defs>
          <pattern id={`nb-ls-stripe-${id}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="#EE6330" />
            <rect width="2.4" height="6" fill="#C2410C" />
          </pattern>
        </defs>
        <circle cx="60" cy="60" r={R} className="nb-ls-ring-track" />
        <g transform="rotate(-90 60 60)">
          {arcs.map((a) => (
            <circle key={a.key} cx="60" cy="60" r={R} className="nb-ls-arc" data-part={a.key}
              stroke={a.key === 'negative' ? `url(#nb-ls-stripe-${id})` : undefined}
              strokeDasharray={`${a.length} ${a.gap}`} strokeDashoffset={a.offset} />
          ))}
        </g>
      </svg>
      {lead && (
        <span className="nb-ls-ring-mid" aria-hidden="true">
          <strong>{lead.percent}%</strong>
          <span>{lead.label}</span>
        </span>
      )}
    </div>
  );
};

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

  const head = (sub?: React.ReactNode) => (
    <div className="nb-ls-head">
      <span className="nb-ls-icon" aria-hidden="true"><MessagesSquare /></span>
      <div>
        <h2 id="listening-title">{TITLE}</h2>
        {sub}
      </div>
    </div>
  );

  if (!loaded) {
    return (
      <section aria-labelledby="listening-title" className="nb-ls" aria-busy="true">
        {head(<p role="status" className="nb-ls-sub">Loading…</p>)}
      </section>
    );
  }

  const state = failed ? 'error' : cardState(res);
  // Scoring is not running (or this account was never scored): say nothing about weekly checks, show nothing.
  if (state === 'off') return null;
  if (state === 'locked') {
    if (!lockedNote) return null;
    return (
      <p className="nb-ls-locked">
        {LOCKED_NOTE.before}
        <Link to="/trial-expired">{LOCKED_NOTE.link}</Link>
        {LOCKED_NOTE.after}
      </p>
    );
  }

  const rows = state === 'ready' ? barRows(res) : [];
  const quotes = state === 'ready' ? quotesFor(res) : [];
  const recent = state === 'ready' && showRecent ? recentNegativeRows(res) : [];
  const lastChecked = state === 'ready' ? lastCheckedLine(res) : '';
  const lines = state === 'not_enough' ? notEnoughLines(res) : null;

  return (
    <section aria-labelledby="listening-title" className="nb-ls">
      {head(state === 'ready' && res ? <p className="nb-ls-sub">{basedOn(res)}{lastChecked ? ` ${lastChecked}` : ''}</p> : undefined)}

      {state === 'error' && (
        <div className="nb-ls-quiet">
          <p role="alert">{LOAD_ERROR}</p>
          <button type="button" className="nb-ls-btn" onClick={load}>Try again</button>
        </div>
      )}

      {lines && (
        <div className="nb-ls-quiet">
          <p><strong>{lines.headline}</strong> {lines.note}</p>
        </div>
      )}

      {state === 'waiting' && (
        <div className="nb-ls-quiet"><p>{(res && res.message) || waitingText()}</p></div>
      )}

      {state === 'ready' && res && (
        <>
          <div className="nb-ls-hero">
            <Ring res={res} />
            <ul className="nb-ls-tiles" aria-label="Comments and messages by how they read">
              {rows.map((r) => (
                <li key={r.key} className="nb-ls-tile" data-part={r.key}>
                  <span className="nb-ls-tile-top"><span className="nb-ls-dot" aria-hidden="true" />{r.label}</span>
                  <strong className="nb-ls-tile-n">{r.percent}%</strong>
                  <span className="nb-ls-tile-c">{r.count === 1 ? '1 comment' : `${r.count} comments`}</span>
                </li>
              ))}
            </ul>
          </div>

          {res.trend && (
            <p className="nb-ls-callout"><TrendingUp aria-hidden="true" /><span>{res.trend}</span></p>
          )}

          {quotes.length > 0 && (
            <div className="nb-ls-block">
              <h3>What some people wrote</h3>
              <ul className="nb-ls-quotes" data-count={quotes.length}>
                {quotes.map((q, i) => (
                  <li key={q.id || i}>
                    <figure className="nb-ls-quote" data-part={q.label === 'negative' ? 'negative' : 'positive'}>
                      <Quote className="nb-ls-quote-mark" aria-hidden="true" />
                      <blockquote>{quoteText(q)}</blockquote>
                      <figcaption>
                        <PlatformMark platform={markOf(q.platform)} size={20} />
                        <span className="nb-ls-quote-meta">{[platformName(q.platform), dayText(q.date)].filter(Boolean).join(', ')}</span>
                        <span className="nb-ls-chip" data-part={q.label === 'negative' ? 'negative' : 'positive'}>{q.label === 'negative' ? 'Negative' : 'Positive'}</span>
                      </figcaption>
                    </figure>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {recent.length > 0 && (
            <div className="nb-ls-block">
              <h3>Recently negative</h3>
              <ul className="nb-ls-recent">
                {recent.map((r) => (
                  <li key={r.id} className="nb-ls-recent-row">
                    <PlatformMark platform={markOf(r.platform)} size={22} />
                    <span className="nb-ls-recent-text">
                      <span className="nb-ls-recent-preview">{r.preview}</span>
                      <span className="nb-ls-recent-meta">{[platformName(r.platform), dayText(r.date)].filter(Boolean).join(', ')}</span>
                    </span>
                    <Link to={r.href} className="nb-ls-btn" aria-label={`Reply. ${recentLinkLabel(r)}: ${r.preview}`}>
                      <MessageCircleReply aria-hidden="true" />Reply
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="nb-ls-foot">{weeklyNote()}</p>
        </>
      )}
    </section>
  );
};

export default ListeningCard;
