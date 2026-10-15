import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Download, Loader2, Package, Image as ImageIcon, User as UserIcon, Wand2, Trash2 } from 'lucide-react';
import { GravityHero, GravityEmphasis, GravityPanel, GravityLabel, GravityButton } from '../components/gravity';
import IdeaBoxTools from '../components/IdeaBoxTools';
import AssetPicker, { PickedAsset } from '../components/AssetPicker';
import { apiService, brandAssetsAPI, studioVideosAPI, StudioVideo, StudioConcept } from '../services/api';
import { appendText } from '../utils/ideaFiles';
import { canPlan, waitMessage, videosLeft, CHANGE_IDEAS, StepKey } from '../utils/studioVideo';
import { downloadImage } from '../utils/download';

type Option = { key: string; label: string; hint?: string };
const FALLBACK_STYLES: Option[] = [
  { key: 'natural', label: 'Real and personal', hint: 'Someone talks to the camera, like a phone video' },
  { key: 'cinematic', label: 'Cinematic', hint: 'A short film: several shots, music, no talking' },
  { key: 'product', label: 'Product showcase', hint: 'Your product up close with a voice-over' },
  { key: 'festive', label: 'Festive', hint: 'Warm festival mood: lamps, lights, family' },
];
const FALLBACK_LANGS: Option[] = [{ key: 'english', label: 'English' }, { key: 'tamil', label: 'Tamil' }, { key: 'none', label: 'No speech, music only' }];

const STEPS: Array<{ key: StepKey; label: string }> = [
  { key: 'idea', label: 'Your idea' },
  { key: 'yours', label: 'Make it yours' },
  { key: 'check', label: 'Check the plan' },
];

const tile = (on: boolean) => `text-left rounded-xl border px-4 py-3 transition-colors ${on
  ? 'border-[var(--gv-accent)] bg-[var(--gv-accent-fill)] text-[var(--gv-accent-text)]'
  : 'border-[var(--gv-border-default)] bg-[var(--gv-surface-1)] text-[var(--gv-text-secondary)] hover:text-[var(--gv-text-primary)]'}`;
const field = 'w-full rounded-xl border border-[var(--gv-border-default)] bg-[var(--gv-surface-1)] px-4 py-3 text-[14px] text-[var(--gv-text-primary)] placeholder:text-[var(--gv-text-muted)] outline-none focus:border-[var(--gv-accent)]';

const PickRow: React.FC<{
  Icon: React.ComponentType<{ className?: string }>; title: string; hint: string; picked: PickedAsset[];
  onPick: () => void; onClear: () => void; placeholder: string; text: string; onText: (t: string) => void; pickLabel: string;
}> = ({ Icon, title, hint, picked, onPick, onClear, placeholder, text, onText, pickLabel }) => (
  <div className="rounded-2xl border border-[var(--gv-border-subtle)] bg-[var(--gv-surface-1)] p-4">
    <div className="flex items-start gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--gv-accent-fill)] text-[var(--gv-accent)]"><Icon className="h-[18px] w-[18px]" /></span>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold text-[var(--gv-text-primary)]">{title} <span className="font-normal text-[var(--gv-text-tertiary)]">· optional</span></div>
        <div className="text-[12.5px] text-[var(--gv-text-secondary)]">{hint}</div>
      </div>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {picked.map((p) => (
        <span key={p.id || p.name} className="inline-flex items-center gap-2 rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-surface-2)] p-1 pr-2.5 text-[12.5px]">
          {p.imageUrl || p.dataUrl ? <img src={p.dataUrl || p.imageUrl} alt="" className="h-9 w-9 rounded-md object-cover" /> : null}
          <span className="max-w-[160px] truncate">{p.name}</span>
        </span>
      ))}
      <GravityButton variant="ghost" onClick={onPick} className="!py-2">{picked.length ? 'Change' : pickLabel}</GravityButton>
      {picked.length > 0 && <button type="button" onClick={onClear} className="text-[12.5px] text-[var(--gv-text-tertiary)] underline underline-offset-2">Remove</button>}
    </div>
    <input value={text} onChange={(e) => onText(e.target.value)} className={`${field} mt-3`} placeholder={placeholder} maxLength={200} />
  </div>
);

const CreateVideo: React.FC = () => {
  const [step, setStep] = useState<StepKey>('idea');
  const [styles, setStyles] = useState<Option[]>(FALLBACK_STYLES);
  const [langs, setLangs] = useState<Option[]>(FALLBACK_LANGS);
  const [cost, setCost] = useState<number>(0);
  const [balance, setBalance] = useState<number | null>(null);

  const [idea, setIdea] = useState('');
  const [style, setStyle] = useState('natural');
  const [language, setLanguage] = useState('english');
  const [who, setWho] = useState('');
  const [where, setWhere] = useState('');
  const [people, setPeople] = useState<PickedAsset[]>([]);
  const [places, setPlaces] = useState<PickedAsset[]>([]);
  const [products, setProducts] = useState<PickedAsset[]>([]);
  const [picker, setPicker] = useState<null | 'character' | 'environment' | 'products'>(null);

  const [concept, setConcept] = useState<StudioConcept | null>(null);
  const [title, setTitle] = useState('');
  const [conceptText, setConceptText] = useState('');
  const [spoken, setSpoken] = useState('');
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState('');

  const [current, setCurrent] = useState<StudioVideo | null>(null);
  const [history, setHistory] = useState<StudioVideo[]>([]);
  const [changeText, setChangeText] = useState('');
  const [waited, setWaited] = useState(0);
  const pollRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);

  const refreshBalance = useCallback(() => {
    apiService.getCredits().then((r) => { if (r?.success) setBalance(Number(r.credits?.balance ?? 0)); }).catch(() => undefined);
  }, []);

  const loadHistory = useCallback(() => {
    studioVideosAPI.list().then((r) => {
      if (!r?.success) return;
      setHistory(r.videos || []);
      const running = (r.videos || []).find((v) => v.status === 'processing');
      if (running) { setCurrent((c) => c || running); }
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    studioVideosAPI.options().then((r) => {
      if (!r?.success) return;
      if (r.styles?.length) setStyles(r.styles);
      if (r.languages?.length) setLangs(r.languages);
      setCost(r.quarks || 0);
    }).catch(() => undefined);
    refreshBalance();
    loadHistory();
    return () => { if (pollRef.current) window.clearTimeout(pollRef.current); if (tickRef.current) window.clearInterval(tickRef.current); };
  }, [refreshBalance, loadHistory]);

  // Poll the video that is being made, and let the person leave and come back: the list finds it again.
  useEffect(() => {
    if (!current || current.status !== 'processing') {
      if (tickRef.current) { window.clearInterval(tickRef.current); tickRef.current = null; }
      return;
    }
    setWaited(Math.max(0, Math.round((Date.now() - new Date(current.createdAt).getTime()) / 1000)));
    tickRef.current = window.setInterval(() => setWaited((w) => w + 1), 1000);
    const poll = async () => {
      try {
        const r = await studioVideosAPI.get(current.id);
        if (r?.success && r.video) {
          setCurrent(r.video);
          if (r.video.status !== 'processing') { loadHistory(); refreshBalance(); return; }
        }
      } catch { /* try again */ }
      pollRef.current = window.setTimeout(poll, 5000);
    };
    pollRef.current = window.setTimeout(poll, 5000);
    return () => { if (pollRef.current) window.clearTimeout(pollRef.current); if (tickRef.current) { window.clearInterval(tickRef.current); tickRef.current = null; } };
  }, [current?.id, current?.status, loadHistory, refreshBalance]);

  useEffect(() => { if (current) setStep('result'); }, [current?.id]);

  /** Photos picked from a device have no saved record yet: save them to the brand assets first so they can be reused. */
  const saveNew = async (assets: PickedAsset[], type: 'character' | 'environment'): Promise<string[]> => {
    const ids: string[] = [];
    for (const a of assets) {
      if (a.id) { ids.push(a.id); continue; }
      if (!a.dataUrl) continue;
      const r: any = await brandAssetsAPI.upload({ imageData: a.dataUrl, type, name: a.name || (type === 'character' ? 'Person' : 'Place') });
      const id = r?.asset?._id || r?.asset?.id;
      if (id) ids.push(String(id));
    }
    return ids;
  };

  const choices = async () => ({
    idea, style, language, who: who.trim(), where: where.trim(),
    characterIds: await saveNew(people, 'character'),
    placeIds: await saveNew(places, 'environment'),
    productIds: products.map((p) => p.id).filter(Boolean),
  });

  const plan = async () => {
    setError(''); setPlanning(true);
    try {
      const c = await choices();
      const r = await studioVideosAPI.concept(c);
      if (!r?.success || !r.concept) { setError(r?.message || 'We could not plan this video. Please try again.'); return; }
      setConcept(r as StudioConcept); setTitle(r.title || 'My video'); setConceptText(r.concept || ''); setSpoken(r.spokenLine || '');
      setStep('check');
    } catch (e: any) {
      setError(e?.message || 'We could not plan this video. Please try again.');
    } finally { setPlanning(false); }
  };

  const make = async () => {
    setError(''); setPlanning(true);
    try {
      const c = await choices();
      const r = await studioVideosAPI.create({ ...c, title, concept: conceptText, beats: concept?.beats || [], spokenLine: language === 'none' ? '' : spoken, aspectRatio: '9:16' });
      if (!r?.success || !r.video) { setError(r?.message || 'We could not start the video. Please try again.'); return; }
      setCurrent(r.video); refreshBalance();
    } catch (e: any) {
      setError(e?.data?.message || e?.message || 'We could not start the video. Please try again.');
    } finally { setPlanning(false); }
  };

  const makeChange = async (text: string) => {
    if (!current || !text.trim()) return;
    setError(''); setPlanning(true);
    try {
      const r = await studioVideosAPI.change(current.id, text.trim());
      if (!r?.success || !r.video) { setError(r?.message || 'We could not start the change. Please try again.'); return; }
      setChangeText(''); setCurrent(r.video); refreshBalance();
    } catch (e: any) {
      setError(e?.data?.message || e?.message || 'We could not start the change. Please try again.');
    } finally { setPlanning(false); }
  };

  const startOver = () => { setCurrent(null); setConcept(null); setStep('idea'); setError(''); };
  const stepIndex = STEPS.findIndex((s) => s.key === step);
  const left = balance != null && cost ? videosLeft(balance, cost) : null;
  const priceLine = cost ? `${cost} Quarks${left != null ? ` · you have enough for ${left} video${left === 1 ? '' : 's'}` : ''}` : '';
  const processing = current?.status === 'processing';

  return (
    <div className="max-w-[820px] mx-auto pb-24">
      <GravityHero
        className="!mb-6"
        eyebrow="Videos"
        headline={<>Describe your <GravityEmphasis>video</GravityEmphasis></>}
      />

      {step !== 'result' && (
        <ol className="mb-6 flex items-center justify-center gap-2 text-[12.5px]" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s.key} className="flex items-center gap-2">
              <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11.5px] font-bold ${i < stepIndex ? 'bg-[var(--gv-accent)] text-[var(--gv-accent-ink)]' : i === stepIndex ? 'border border-[var(--gv-accent)] text-[var(--gv-accent-text)]' : 'border border-[var(--gv-border-default)] text-[var(--gv-text-tertiary)]'}`}>
                {i < stepIndex ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className={i === stepIndex ? 'font-semibold text-[var(--gv-text-primary)]' : 'text-[var(--gv-text-tertiary)]'}>{s.label}</span>
              {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-[var(--gv-border-default)]" aria-hidden="true" />}
            </li>
          ))}
        </ol>
      )}

      {error && <p role="alert" className="mb-4 rounded-xl border border-[var(--gv-border-default)] bg-[var(--gv-surface-1)] px-4 py-3 text-[13px] text-[var(--gv-text-primary)]">{error}</p>}

      {step === 'idea' && (
        <div className="space-y-6">
          <GravityPanel halo beam>
            <GravityLabel gold className="mb-2">What is the video about?</GravityLabel>
            <textarea
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              rows={4}
              className="gravity-bare w-full bg-transparent border-none outline-none text-[14.5px] text-[var(--gv-text-tertiary)] leading-relaxed resize-none placeholder:text-[var(--gv-text-muted)]"
              placeholder="For example: Diwali offer at our sweet shop. A gift box of kaju katli and mysore pak, 10% off, free home delivery above ₹1,000."
            />
            <IdeaBoxTools
              languageLabel={language === 'tamil' ? 'Tamil' : 'English'}
              onText={(t) => setIdea((d) => appendText(d, t))}
              onRead={(ups) => ups.forEach((u) => u.brief && setIdea((d) => appendText(d, u.brief)))}
              onReuse={(u) => u.brief && setIdea((d) => appendText(d, u.brief))}
            />
          </GravityPanel>

          <div>
            <div className="gravity-label mb-2">Look</div>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Look of the video">
              {styles.map((s) => (
                <button key={s.key} type="button" role="radio" aria-checked={style === s.key} onClick={() => setStyle(s.key)} className={tile(style === s.key)}>
                  <span className="block text-[14px] font-semibold">{s.label}</span>
                  <span className="block text-[12.5px] opacity-80">{s.hint}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="gravity-label mb-2">Spoken language</div>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Spoken language">
              {langs.map((l) => (
                <button key={l.key} type="button" role="radio" aria-checked={language === l.key} onClick={() => setLanguage(l.key)} className={`${tile(language === l.key)} !py-2`}>{l.label}</button>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <GravityButton disabled={!canPlan(idea)} onClick={() => setStep('yours')}>Next <ArrowRight className="h-4 w-4" /></GravityButton>
          </div>
        </div>
      )}

      {step === 'yours' && (
        <div className="space-y-4">
          <p className="text-center text-[13.5px] text-[var(--gv-text-secondary)]">Add your own people, place and products so the video looks like your business. Skip any of these and we will choose something believable.</p>
          <PickRow Icon={UserIcon} title="Who appears" hint="A photo of the person: you, your team or a customer who agreed." picked={people}
            onPick={() => setPicker('character')} onClear={() => setPeople([])} pickLabel="Choose a photo" text={who} onText={setWho} placeholder="Or describe them: a smiling shopkeeper in her 40s, in a cotton saree" />
          <PickRow Icon={ImageIcon} title="Where it happens" hint="A photo of your shop, kitchen, studio or anywhere you work." picked={places}
            onPick={() => setPicker('environment')} onClear={() => setPlaces([])} pickLabel="Choose a photo" text={where} onText={setWhere} placeholder="Or describe it: a busy sweet shop with brass lamps" />
          <PickRow Icon={Package} title="Your product" hint="The exact product to show. It will match your photo." picked={products}
            onPick={() => setPicker('products')} onClear={() => setProducts([])} pickLabel="Choose products" text="" onText={() => undefined} placeholder="" />
          <div className="flex items-center justify-between pt-2">
            <GravityButton variant="ghost" onClick={() => setStep('idea')}><ArrowLeft className="h-4 w-4" /> Back</GravityButton>
            <GravityButton disabled={planning} onClick={plan}>
              {planning ? <><Loader2 className="h-4 w-4 animate-spin" /> Planning…</> : <>Plan my video <ArrowRight className="h-4 w-4" /></>}
            </GravityButton>
          </div>
        </div>
      )}

      {step === 'check' && concept && (
        <div className="space-y-5">
          <GravityPanel>
            <GravityLabel gold className="mb-2">Here is the plan</GravityLabel>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={`${field} mb-3 font-semibold`} maxLength={60} aria-label="Video name" />
            <label className="gravity-label mb-1 block" htmlFor="v-concept">What the video shows</label>
            <textarea id="v-concept" value={conceptText} onChange={(e) => setConceptText(e.target.value)} rows={4} className={field} />
            {concept.beats?.length > 0 && (
              <ol className="mt-3 list-decimal space-y-1 pl-5 text-[13px] text-[var(--gv-text-secondary)]">
                {concept.beats.map((b, i) => <li key={i}>{b}</li>)}
              </ol>
            )}
            {language !== 'none' && (
              <>
                <label className="gravity-label mb-1 mt-4 block" htmlFor="v-spoken">What is said ({language === 'tamil' ? 'Tamil' : 'English'})</label>
                <textarea id="v-spoken" value={spoken} onChange={(e) => setSpoken(e.target.value)} rows={2} className={field} />
                <p className="mt-1 text-[12px] text-[var(--gv-text-tertiary)]">Check every word, especially names, prices and numbers.</p>
              </>
            )}
          </GravityPanel>
          <div className="flex items-center justify-between">
            <GravityButton variant="ghost" onClick={() => setStep('yours')}><ArrowLeft className="h-4 w-4" /> Back</GravityButton>
            <div className="text-right">
              <GravityButton disabled={planning || !conceptText.trim()} onClick={make}>
                {planning ? <><Loader2 className="h-4 w-4 animate-spin" /> Starting…</> : <><Wand2 className="h-4 w-4" /> Make my video</>}
              </GravityButton>
              {priceLine && <div className="mt-1 text-[12px] text-[var(--gv-text-tertiary)]">{priceLine}</div>}
            </div>
          </div>
        </div>
      )}

      {step === 'result' && current && (
        <div className="space-y-6">
          <GravityPanel>
            <div className="flex flex-col items-center gap-4">
              {processing && (
                <div className="flex aspect-[9/16] w-full max-w-[300px] flex-col items-center justify-center gap-3 rounded-2xl border border-[var(--gv-border-default)] bg-[var(--gv-surface-2)] p-6 text-center" role="status">
                  <Loader2 className="h-7 w-7 animate-spin text-[var(--gv-accent)]" />
                  <div className="text-[14px] font-semibold text-[var(--gv-text-primary)]">{waitMessage(waited)}</div>
                  <div className="text-[12.5px] text-[var(--gv-text-secondary)]">This takes 1 to 4 minutes. You can leave this page: your video will be in this list when you come back.</div>
                </div>
              )}
              {current.status === 'completed' && current.videoUrl && (
                <video src={current.videoUrl} controls playsInline className="w-full max-w-[300px] rounded-2xl bg-black" />
              )}
              {current.status === 'failed' && (
                <div className="w-full max-w-[420px] rounded-2xl border border-[var(--gv-border-default)] bg-[var(--gv-surface-2)] p-5 text-center text-[13.5px] text-[var(--gv-text-primary)]" role="alert">{current.error}</div>
              )}
              <div className="text-center">
                <div className="text-[15px] font-semibold text-[var(--gv-text-primary)]">{current.title}</div>
                {current.change && <div className="text-[12.5px] text-[var(--gv-text-tertiary)]">Change: {current.change}</div>}
              </div>
              {current.status === 'completed' && (
                <div className="flex flex-wrap justify-center gap-2">
                  <GravityButton onClick={() => downloadImage(current.videoUrl, current.title || 'video')}><Download className="h-4 w-4" /> Download</GravityButton>
                  <GravityButton variant="ghost" onClick={startOver}>Make another video</GravityButton>
                </div>
              )}
              {current.status === 'failed' && <GravityButton onClick={startOver}>Try again</GravityButton>}
            </div>
          </GravityPanel>

          {current.status === 'completed' && (
            <GravityPanel>
              <GravityLabel gold className="mb-2">Want something different?</GravityLabel>
              <p className="mb-3 text-[13px] text-[var(--gv-text-secondary)]">Say what to change and we keep the rest the same. Each change makes a new version{cost ? ` and uses ${cost} Quarks` : ''}.</p>
              <div className="flex flex-wrap gap-2">
                {CHANGE_IDEAS.map((c) => (
                  <button key={c} type="button" disabled={planning} onClick={() => makeChange(c)} className="rounded-full border border-[var(--gv-border-default)] bg-[var(--gv-surface-2)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--gv-text-secondary)] hover:text-[var(--gv-text-primary)] disabled:opacity-50">{c}</button>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <input value={changeText} onChange={(e) => setChangeText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') makeChange(changeText); }} className={field} placeholder="For example: make the lamp bigger" maxLength={400} />
                <GravityButton disabled={planning || !changeText.trim()} onClick={() => makeChange(changeText)}>Change</GravityButton>
              </div>
            </GravityPanel>
          )}
        </div>
      )}

      {history.length > 0 && (
        <section className="mt-12" aria-label="Your videos">
          <div className="gravity-label mb-3">Your videos</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {history.slice(0, 8).map((v) => (
              <div key={v.id} className="group relative overflow-hidden rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-surface-1)]">
                <button type="button" onClick={() => setCurrent(v)} className="block w-full text-left">
                  <div className="aspect-[9/16] w-full bg-[var(--gv-surface-2)]">
                    {v.status === 'completed' && v.videoUrl
                      ? <video src={`${v.videoUrl}#t=0.5`} className="h-full w-full object-cover" muted playsInline preload="metadata" />
                      : <div className="flex h-full items-center justify-center p-3 text-center text-[12px] text-[var(--gv-text-secondary)]">{v.status === 'processing' ? 'Being made…' : 'Not made'}</div>}
                  </div>
                  <div className="truncate px-2.5 py-2 text-[12.5px] font-medium text-[var(--gv-text-primary)]">{v.title}</div>
                </button>
                {v.status !== 'processing' && (
                  <button type="button" aria-label={`Delete ${v.title}`} onClick={async () => { await studioVideosAPI.remove(v.id); setHistory((h) => h.filter((x) => x.id !== v.id)); if (current?.id === v.id) startOver(); }} className="absolute right-1.5 top-1.5 rounded-md bg-black/55 p-1.5 text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"><Trash2 className="h-3.5 w-3.5" /></button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="mt-10 text-center text-[12px] text-[var(--gv-text-muted)]">
        Looking for the old step-by-step maker? <Link to="/reels/studio" className="underline underline-offset-2">Open it here</Link>.
      </p>

      <AssetPicker
        open={picker === 'character'} onClose={() => setPicker(null)} source="character" max={1}
        selected={people} onChange={(a) => { setPeople(a); setPicker(null); }}
      />
      <AssetPicker
        open={picker === 'environment'} onClose={() => setPicker(null)} source="environment" max={1}
        selected={places} onChange={(a) => { setPlaces(a); setPicker(null); }}
      />
      <AssetPicker
        open={picker === 'products'} onClose={() => setPicker(null)} source="products" max={2}
        selected={products} onChange={(a) => { setProducts(a); setPicker(null); }}
      />
    </div>
  );
};

export default CreateVideo;
