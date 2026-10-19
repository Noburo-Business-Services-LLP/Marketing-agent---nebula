import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Check, Copy, ExternalLink, Loader2, PenLine, X } from 'lucide-react';
import { apiService } from '../../services/api';
import { setPrefill } from '../../utils/prefill';
import {
  CHECK_LINE, DECENT_LINE, KIND_TITLE, OWN_PAGE_LINE, SELF_POST_LINE, TONE_LABEL, WORKING_LINE,
  createHandoff, draftOf, leftLine, newDraftKey, outcomeOf, priceLabel,
  type DraftKind, type DraftOptions, type DraftSource, type DraftText, type DraftTone, type Outcome,
} from '../../utils/homeDrafts';
import CompetitorAvatar from '../CompetitorAvatar';
import './draftSheet.css';

// The compact sheet behind "Make a post in response" and "Draft a witty comment" on a competitor's best post. It shows
// the price before anything is pressed, then the draft once it has passed both checks. Nothing is posted from here:
// a comment is copied by the customer and posted by them on the other page, a post opens in Create.
// Accessible: a modal dialog with its title, focus kept inside while open, Escape closes, focus goes back to the button.

const FOCUSABLE = 'button:not([disabled]), a[href], select:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const DraftSheet: React.FC<{
  kind: DraftKind; source: DraftSource; options: DraftOptions; postsOnly?: boolean; onClose: () => void; onDone?: () => void;
}> = ({ kind, source, options, postsOnly = false, onClose, onDone }) => {
  const navigate = useNavigate();
  const box = useRef<HTMLDivElement>(null);
  const [tone, setTone] = useState<DraftTone>('friendly');
  const [language, setLanguage] = useState<string>(options.language || 'english');
  const [state, setState] = useState<'confirm' | 'working' | 'done' | 'failed'>('confirm');
  const [draft, setDraft] = useState<DraftText | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [copied, setCopied] = useState(false);
  const key = useRef(newDraftKey());
  const live = useRef(onClose);
  live.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const first = box.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); live.current(); return; }
      if (e.key !== 'Tab' || !box.current) return;
      const list = Array.from(box.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (!list.length) return;
      const a = list[0]; const z = list[list.length - 1];
      if (e.shiftKey && (document.activeElement === a || !box.current.contains(document.activeElement))) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); try { opener?.focus?.(); } catch { /* the opener may be gone */ } };
  }, []);

  // When the content changes (the pressed button is replaced), focus moves to the main action of the new content,
  // or stays inside the sheet.
  useEffect(() => {
    if (!box.current) return;
    const main = box.current.querySelector<HTMLElement>('[data-autofocus]');
    if (main && (state === 'done' || state === 'failed')) { main.focus(); return; }
    if (!box.current.contains(document.activeElement)) box.current.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }, [state]);

  const price = priceLabel(options, kind, postsOnly);
  const write = async () => {
    setState('working'); setOutcome(null); setCopied(false);
    try {
      const answer = await apiService.makeHomeDraft(kind, { ref: source.ref, key: key.current, tone, language });
      const d = draftOf(answer, kind);
      if (!d) throw new Error('');
      setDraft(d); setState('done'); onDone?.();
    } catch (e) {
      setOutcome(outcomeOf(e)); setState('failed');
    }
  };
  const again = () => { key.current = newDraftKey(); setDraft(null); setOutcome(null); setState('confirm'); };
  const copy = async () => {
    try { await navigator.clipboard.writeText(String(draft?.comment || '')); setCopied(true); }
    catch { setCopied(false); setOutcome({ state: 'error', message: 'Copying did not work here. Select the text and copy it yourself.', canRetry: false }); }
  };
  const useInCreate = () => {
    const h = createHandoff(draft, language);
    if (!h) return;
    setPrefill('carousel', h.data);
    onClose();
    navigate(h.route);
  };

  const titleId = `hd-title-${kind}`;
  // Rendered on the page body, so no card around the button (a transform or a blur) can trap the fixed backdrop.
  return createPortal((
    <div className="nb-hd-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} className="nb-hd-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={state === 'working' ? 'true' : undefined}>
        <header className="nb-hd-head">
          {source.name
            ? <CompetitorAvatar name={source.name} handle={source.handle} url={source.avatarUrl} />
            : <span className="nb-hd-mark" aria-hidden="true"><PenLine aria-hidden="true" /></span>}
          <div className="nb-hd-titles">
            <h2 id={titleId}>{KIND_TITLE[kind]}</h2>
            <p className="nb-hd-from">From {source.title}</p>
          </div>
          <button type="button" className="nb-hd-close" onClick={onClose} aria-label="Close"><X aria-hidden="true" /></button>
        </header>

        {state === 'confirm' && (
          <div className="nb-hd-body">
            <fieldset className="nb-hd-field">
              <legend>Tone</legend>
              <div className="nb-hd-tones">
                {(options.tones?.length ? options.tones : (['friendly', 'witty'] as DraftTone[])).map((t) => (
                  <label key={t} className="nb-hd-tone" data-on={tone === t ? 'true' : undefined}>
                    <input type="radio" name={`hd-tone-${kind}`} value={t} checked={tone === t} onChange={() => setTone(t)} />
                    <span>{TONE_LABEL[t] || t}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {options.languages?.length > 1 && (
              <label className="nb-hd-field nb-hd-lang">
                <span>Language</span>
                <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                  {options.languages.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
                </select>
              </label>
            )}
            <p className="nb-hd-note">{DECENT_LINE}</p>
            {kind === 'witty_comment' && <p className="nb-hd-note" data-strong="true">{SELF_POST_LINE}</p>}
            <div className="nb-hd-price">
              <span>{price ? `Costs ${price}.` : ''} If we cannot write a draft we are happy with, nothing is charged.</span>
              {leftLine(options) && <span className="nb-hd-left">{leftLine(options)}</span>}
            </div>
            <div className="nb-hd-actions">
              <button type="button" className="nb-hd-btn" data-primary="true" onClick={write} disabled={options.left === 0}>Write the draft</button>
              <button type="button" className="nb-hd-btn" onClick={onClose}>Cancel</button>
            </div>
          </div>
        )}

        {state === 'working' && (
          <div className="nb-hd-body nb-hd-working" role="status" aria-live="polite">
            <Loader2 aria-hidden="true" className="nb-hd-spin" />
            <p>{WORKING_LINE}</p>
          </div>
        )}

        {state === 'done' && draft && (
          <div className="nb-hd-body">
            {kind === 'witty_comment' ? (
              <>
                <p className="nb-hd-label" id="hd-draft-label">Your comment</p>
                <p className="nb-hd-draft" aria-labelledby="hd-draft-label" lang={language === 'english' ? 'en' : undefined}>{draft.comment}</p>
                <p className="nb-hd-note" data-strong="true">{SELF_POST_LINE}</p>
              </>
            ) : (
              <>
                <p className="nb-hd-label" id="hd-caption-label">Caption</p>
                <p className="nb-hd-draft" aria-labelledby="hd-caption-label">{draft.caption}</p>
                {draft.imageIdea && (<><p className="nb-hd-label" id="hd-idea-label">Picture idea</p><p className="nb-hd-idea" aria-labelledby="hd-idea-label">{draft.imageIdea}</p></>)}
                <p className="nb-hd-note">{OWN_PAGE_LINE}</p>
              </>
            )}
            <p className="nb-hd-note">{CHECK_LINE}</p>
            {outcome && <p className="nb-hd-problem" role="status">{outcome.message}</p>}
            <div className="nb-hd-actions">
              {kind === 'witty_comment' ? (
                <>
                  <button type="button" className="nb-hd-btn" data-primary="true" data-autofocus onClick={copy}>{copied ? <><Check aria-hidden="true" />Copied</> : <><Copy aria-hidden="true" />Copy</>}</button>
                  {source.url && <a className="nb-hd-btn" href={source.url} target="_blank" rel="noopener noreferrer">Open the post<ExternalLink aria-hidden="true" /></a>}
                </>
              ) : (
                <button type="button" className="nb-hd-btn" data-primary="true" data-autofocus onClick={useInCreate}>Use in Create</button>
              )}
              <button type="button" className="nb-hd-btn" onClick={again}>Write another</button>
            </div>
            <p className="nb-hd-sr" role="status" aria-live="polite">{copied ? 'Copied. Paste it under their post yourself.' : ''}</p>
          </div>
        )}

        {state === 'failed' && outcome && (
          <div className="nb-hd-body">
            <p className="nb-hd-problem" role="alert">{outcome.message}</p>
            <div className="nb-hd-actions">
              {outcome.canRetry && <button type="button" className="nb-hd-btn" data-primary="true" data-autofocus onClick={again}>Try again</button>}
              <button type="button" className="nb-hd-btn" data-autofocus={outcome.canRetry ? undefined : true} onClick={onClose}>Close</button>
            </div>
          </div>
        )}
      </div>
    </div>
  ), document.body);
};

/** The two small actions under a competitor's best post, each with its price before it is pressed. */
export const DraftActions: React.FC<{ options: DraftOptions; postsOnly?: boolean; onPick: (kind: DraftKind) => void; compact?: boolean }> = ({ options, postsOnly = false, onPick, compact = false }) => (
  <div className="nb-hd-picks" data-compact={compact ? 'true' : undefined}>
    {(['response_post', 'witty_comment'] as DraftKind[]).map((k) => {
      const price = priceLabel(options, k, postsOnly);
      return (
        <button key={k} type="button" className="nb-hd-pick" onClick={() => onPick(k)} aria-label={`${k === 'response_post' ? 'Make a post in response' : 'Draft a witty comment'}${price ? `, ${price}` : ''}`}>
          <span className="nb-hd-pick-label">{k === 'response_post' ? 'Make a post in response' : 'Draft a witty comment'}</span>
          {price && <span className="nb-hd-pick-price">{price}</span>}
        </button>
      );
    })}
  </div>
);

export default DraftSheet;
