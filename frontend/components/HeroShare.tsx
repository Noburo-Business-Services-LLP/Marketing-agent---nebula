import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Send, CalendarClock, Sparkles } from 'lucide-react';
import PlatformPicker from './PlatformPicker';
import { GravityLabel, GravityButton } from './gravity';
import { choicesFor } from '../utils/platforms';
import { heroVideoAPI } from '../services/api';

const field =
  'w-full rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-panel)] px-3 py-2.5 text-[14px] text-[var(--gv-text-primary)] placeholder:text-[var(--gv-text-tertiary)] focus:outline-none';

/** Post a finished Hero video now, or schedule it, to the connected social accounts. */
const HeroShare: React.FC<{ jobId: string; defaultCaption?: string; onPosted?: () => void }> = ({ jobId, defaultCaption = '', onPosted }) => {
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [caption, setCaption] = useState(defaultCaption);
  const [tags, setTags] = useState('');
  const [when, setWhen] = useState('');
  const [busy, setBusy] = useState<'' | 'now' | 'later'>('');
  const [note, setNote] = useState('');
  const [failed, setFailed] = useState(false);
  const [writing, setWriting] = useState(false);
  const [captionNote, setCaptionNote] = useState('');
  const askedRef = useRef('');

  // The caption and hashtags are written for you, once, when the video opens. You can edit them or ask for another.
  const writeCaption = async () => {
    if (writing) return;
    setWriting(true); setCaptionNote('');
    try {
      const r = await heroVideoAPI.caption(jobId);
      if (!r?.success || !r.caption) throw new Error(r?.message || 'We could not write a caption this time. You can write your own or try again.');
      setCaption(r.caption);
      setTags((r.hashtags || []).join(' '));
    } catch (e: any) {
      setCaptionNote(e?.message || 'We could not write a caption this time. You can write your own or try again.');
    } finally { setWriting(false); }
  };
  useEffect(() => {
    if (defaultCaption || askedRef.current === jobId) return;
    askedRef.current = jobId;
    writeCaption();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const toggle = (k: string) => setPlatforms((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));

  const send = async (publishNow: boolean) => {
    if (busy) return;
    setNote(''); setFailed(false);
    if (!platforms.length) { setFailed(true); setNote('Choose at least one place to post.'); return; }
    if (!publishNow && !when) { setFailed(true); setNote('Choose a date and time to schedule.'); return; }
    setBusy(publishNow ? 'now' : 'later');
    try {
      const r = await heroVideoAPI.publish(jobId, {
        platforms, caption: caption.trim(), hashtags: tags.split(/\s+/).filter(Boolean),
        publishNow, scheduledAt: publishNow ? undefined : new Date(when).toISOString(),
      });
      if (!r?.success) throw new Error(r?.message || 'We could not post this video right now. Please try again in a little while.');
      setNote(r.message || (publishNow ? 'Your video is being posted now.' : 'Your video is scheduled.'));
      onPosted?.();
    } catch (e: any) {
      setFailed(true);
      setNote(e?.message || 'We could not post this video right now. Please try again in a little while.');
    } finally { setBusy(''); }
  };

  return (
    <div className="space-y-3 pt-2 border-t border-[var(--gv-border-subtle)]">
      <GravityLabel>Post or schedule</GravityLabel>
      <div className="flex items-center gap-4">
        <span className="text-[13px] font-semibold text-[var(--gv-text-primary)]">Posting to</span>
        <PlatformPicker kind="video" items={choicesFor('video').map(({ key, label, soon, video }) => ({ key, label, soon, blocked: !video }))} selected={platforms} onToggle={toggle} />
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] font-semibold text-[var(--gv-text-primary)]">Caption and hashtags</span>
        <button type="button" onClick={writeCaption} disabled={writing} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--gv-accent-text)] disabled:opacity-60">
          {writing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}{writing ? 'Writing…' : 'Write another'}
        </button>
      </div>
      <textarea rows={4} maxLength={2000} value={caption} onChange={(e) => setCaption(e.target.value)} className={field} placeholder={writing ? 'Writing a caption for you…' : 'Your caption'} aria-label="Caption" />
      {captionNote && <p role="status" className="text-[12.5px] text-[var(--gv-text-secondary)]">{captionNote}</p>}
      <input value={tags} onChange={(e) => setTags(e.target.value)} className={field} placeholder="Hashtags, separated by spaces (optional)" aria-label="Hashtags" />
      <div className="flex flex-wrap items-center gap-3">
        <GravityButton onClick={() => send(true)} disabled={!!busy}>
          {busy === 'now' ? (<><Loader2 className="w-4 h-4 animate-spin" /> Posting…</>) : (<><Send className="w-4 h-4" /> Post now</>)}
        </GravityButton>
        <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className={`${field} sm:max-w-[240px]`} aria-label="Schedule date and time" />
        <GravityButton variant="ghost" onClick={() => send(false)} disabled={!!busy}>
          {busy === 'later' ? (<><Loader2 className="w-4 h-4 animate-spin" /> Scheduling…</>) : (<><CalendarClock className="w-4 h-4" /> Schedule</>)}
        </GravityButton>
      </div>
      {note && <p role={failed ? 'alert' : 'status'} className="text-[13px] text-[var(--gv-text-primary)]">{note}</p>}
    </div>
  );
};

export default HeroShare;
