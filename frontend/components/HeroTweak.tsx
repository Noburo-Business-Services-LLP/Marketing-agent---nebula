import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { GravityPanel, GravityLabel, GravityButton } from './gravity';
import { apiService, heroVideoAPI } from '../services/api';

export interface TweakSource {
  title?: string;
  prompt: string;
  finish?: any;
  tweak?: { aspectRatio?: string; refImageUrls?: string[]; references?: any[]; beatSheet?: any[]; dialogue?: string };
}

const field =
  'w-full rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-panel)] px-3 py-2.5 text-[14px] leading-relaxed text-[var(--gv-text-primary)] focus:outline-none';

/**
 * Start a new version of a finished Hero video from its own prompt. Change the prompt, then make it. This makes a
 * new video, so it costs Quarks like any other; the earlier video stays in your library.
 */
const HeroTweak: React.FC<{ source: TweakSource; onStarted: (jobId: string) => void }> = ({ source, onStarted }) => {
  const [prompt, setPrompt] = useState(source.prompt || '');
  const [price, setPrice] = useState<number | undefined>(undefined);
  const [balance, setBalance] = useState<number | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    apiService.getCredits().then((r: any) => {
      if (!live || !r?.success) return;
      if (typeof r.credits?.balance === 'number') setBalance(r.credits.balance);
      if (typeof r.costs?.hero_video_clip === 'number') setPrice(r.costs.hero_video_clip);
    }).catch(() => {});
    return () => { live = false; };
  }, []);

  const cannotAfford = price !== undefined && balance !== undefined && balance < price;
  const t = source.tweak || {};

  const make = async () => {
    if (busy || !prompt.trim() || cannotAfford) return;
    setBusy(true); setError('');
    try {
      const r = await heroVideoAPI.generate({
        prompt: prompt.trim(),
        aspectRatio: ((t.aspectRatio as any) || '9:16'),
        refImageUrls: t.refImageUrls,
        references: t.references as any,
        finish: source.finish,
        beatSheet: t.beatSheet as any,
        dialogue: t.dialogue,
      });
      if (!r?.success || !r.jobId) throw Object.assign(new Error(r?.message || 'Your Hero video could not be started.'), { data: r });
      onStarted(r.jobId);
    } catch (e: any) {
      setError(e?.data?.creditsExhausted ? 'You do not have enough Quarks for this video. Top up and try again.' : (e?.message || 'Your Hero video could not be started. Please try again.'));
    } finally { setBusy(false); }
  };

  return (
    <GravityPanel contentClassName="space-y-4">
      <GravityLabel gold>Make a new version</GravityLabel>
      <p className="text-[13.5px] text-[var(--gv-text-secondary)]">
        {source.title ? `Starting from "${source.title}". ` : ''}Change the prompt to change the story, the look or the words, then make a new video. Your earlier video stays in your library.
      </p>
      <div>
        <label htmlFor="tweak-prompt" className="block text-[13px] font-semibold text-[var(--gv-text-primary)] mb-1.5">Video prompt (edit freely)</label>
        <textarea id="tweak-prompt" rows={12} value={prompt} onChange={(e) => setPrompt(e.target.value)} className={field} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <GravityButton onClick={make} disabled={busy || !prompt.trim() || cannotAfford}>
          {busy ? (<><Loader2 className="w-4 h-4 animate-spin" /> Starting…</>) : `Make a new version${price !== undefined ? ` · ${price} Quarks` : ''}`}
        </GravityButton>
        {price !== undefined && balance !== undefined && <span className="text-[12.5px] text-[var(--gv-text-tertiary)]">Price {price} Quarks · Your balance {balance} Quarks</span>}
      </div>
      {cannotAfford && <p role="status" className="text-[12.5px] text-[var(--gv-text-primary)]">A Hero video costs {price} Quarks and you have {balance}. Top up to make one; nothing is charged until you press the button.</p>}
      {error && <p role="alert" className="text-[13px] text-[var(--gv-text-primary)]">{error}</p>}
    </GravityPanel>
  );
};

export default HeroTweak;
