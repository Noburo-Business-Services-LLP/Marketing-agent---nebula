import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Calendar as CalendarIcon, Check, ChevronDown, Download, Loader2, Package, Image as ImageIcon, User as UserIcon, Wand2, Trash2, Sparkles } from 'lucide-react';
import { GravityHero, GravityEmphasis, GravityPanel, GravityLabel, GravityButton } from '../components/gravity';
import IdeaBoxTools from '../components/IdeaBoxTools';
import PlatformPicker from '../components/PlatformPicker';
import AssetPicker, { PickedAsset } from '../components/AssetPicker';
import ReferenceMaker from '../components/ReferenceMaker';
import CalendarIdeaPicker from '../components/CalendarIdeaPicker';
import { apiService, brandAssetsAPI, studioVideosAPI, StudioVideo, StudioConcept } from '../services/api';
import {
  DEFAULT_STYLE, Shape, Part, StyleOption, LengthOption, isNewSpeech, NEW_SPEECH_NOTE, shapeForPlatforms, suggestionHint, orderStyles, visibleStyles,
  styleImageFallback, lengthLine, priceLine as buildPriceLine, shortBalanceMessage, padParts, editPartLine, editPartBeats, partsToText, partLabel,
  progressLabel, canChange, NO_CHANGE_NOTE, plainMessage, readChoices, saveChoices, SHOW_FIRST_STYLES,
  FALLBACK_TRANSITIONS, transitionOf, cleanEndLine, showTransitions, showSubtitles, finishPayload, END_LINE_MAX, NO_LOGO_HINT, SUBTITLES_HINT
} from '../utils/videoOptions';
import { choicesFor, platformLabel } from '../utils/platforms';
import { appendText, referenceAssetFromFile } from '../utils/ideaFiles';
import { canPlan, waitMessage, CHANGE_IDEAS, StepKey } from '../utils/studioVideo';
import { downloadImage } from '../utils/download';
import { takePrefill, nearestLanguage } from '../utils/prefill';

type Option = { key: string; label: string; hint?: string };
const FALLBACK_STYLES: Option[] = [
  { key: 'daily-life-vlog', label: 'Daily life vlog', hint: 'Someone talks to the camera, like a phone video' },
  { key: 'cinematic-commercial', label: 'Cinematic commercial', hint: 'A polished short film with music' },
];
const FALLBACK_LANGS: Option[] = [{ key: 'english', label: 'English' }, { key: 'tamil', label: 'Tamil' }, { key: 'none', label: 'No speech, music only' }];
const FALLBACK_VOICES: Option[] = [{ key: 'female', label: 'Female voice' }, { key: 'male', label: 'Male voice' }];
const FALLBACK_SHAPES: Record<string, string> = { instagram: '9:16', facebook: '9:16', linkedin: '16:9', twitter: '9:16', youtube: '16:9' };

const STEPS: Array<{ key: StepKey; label: string }> = [
  { key: 'idea', label: 'Your idea' },
  { key: 'yours', label: 'Make it yours' },
  { key: 'check', label: 'Check the plan' },
];

const tile = (on: boolean) => `text-left rounded-xl border px-4 py-3 transition-colors ${on
  ? 'border-[var(--gv-accent)] bg-[var(--gv-accent-fill)] text-[var(--gv-accent-text)]'
  : 'border-[var(--gv-border-default)] bg-[var(--gv-surface-1)] text-[var(--gv-text-secondary)] hover:text-[var(--gv-text-primary)]'}`;
const field = 'w-full rounded-xl border border-[var(--gv-border-default)] bg-[var(--gv-surface-1)] px-4 py-3 text-[14px] text-[var(--gv-text-primary)] placeholder:text-[var(--gv-text-muted)] outline-none focus:border-[var(--gv-accent)]';

const StyleTile: React.FC<{ s: StyleOption; on: boolean; pick: () => void }> = ({ s, on, pick }) => (
  <button type="button" role="radio" aria-checked={on} onClick={pick}
    className={`group relative block w-full min-w-0 overflow-hidden rounded-xl border text-left transition-colors ${on ? 'border-[var(--gv-accent)] ring-1 ring-[var(--gv-accent)]' : 'border-[var(--gv-border-default)] hover:border-[var(--gv-border-strong)]'} bg-[var(--gv-surface-1)]`}>
    <div className="relative aspect-video w-full bg-[var(--gv-surface-2)]">
      {s.image && <img src={s.image} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover"
        onError={(e) => { const img = e.currentTarget; const f = styleImageFallback(img.getAttribute('src') || ''); if (f) img.src = f; }} />}
      {on && <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--gv-accent)] text-[var(--gv-accent-ink)]"><Check className="h-3 w-3" /></span>}
    </div>
    <div className={`px-2.5 py-2 ${on ? 'bg-[var(--gv-accent-fill)]' : ''}`}>
      <span className="block text-[13px] font-semibold leading-tight text-[var(--gv-text-primary)]">{s.label}</span>
      {s.hint && <span className="mt-0.5 block truncate text-[11.5px] text-[var(--gv-text-secondary)]" title={s.hint}>{s.hint}</span>}
    </div>
  </button>
);

const PickRow: React.FC<{
  Icon: React.ComponentType<{ className?: string }>; title: string; hint: string; picked: PickedAsset[];
  onPick: () => void; onClear: () => void; placeholder: string; text: string; onText: (t: string) => void; pickLabel: string;
  onCreate?: () => void; createLabel?: string;
}> = ({ Icon, title, hint, picked, onPick, onClear, placeholder, text, onText, pickLabel, onCreate, createLabel }) => (
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
      {onCreate && <GravityButton variant="ghost" onClick={onCreate} className="!py-2"><Sparkles className="h-4 w-4 text-[var(--gv-accent)]" /> {createLabel || 'Create with AI'}</GravityButton>}
      {picked.length > 0 && <button type="button" onClick={onClear} className="text-[12.5px] text-[var(--gv-text-tertiary)] underline underline-offset-2">Remove</button>}
    </div>
    <input value={text} onChange={(e) => onText(e.target.value)} className={`${field} mt-3`} placeholder={placeholder} maxLength={200} />
  </div>
);

const CreateVideo: React.FC = () => {
  const [step, setStep] = useState<StepKey>('idea');
  const [styles, setStyles] = useState<StyleOption[]>(FALLBACK_STYLES);
  const [langs, setLangs] = useState<Option[]>(FALLBACK_LANGS);
  const [voices, setVoices] = useState<Option[]>(FALLBACK_VOICES);
  const [lengths, setLengths] = useState<LengthOption[]>([]);
  const [shapes, setShapes] = useState<Record<string, string>>(FALLBACK_SHAPES);
  const [platformIds, setPlatformIds] = useState<string[] | null>(null);
  const [clipSeconds, setClipSeconds] = useState(10);
  const [cost, setCost] = useState<number>(0);
  const [balance, setBalance] = useState<number | null>(null);

  const [idea, setIdea] = useState('');
  const remembered = useRef(readChoices());
  const [style, setStyle] = useState(remembered.current.style || DEFAULT_STYLE);
  const [language, setLanguage] = useState(remembered.current.language || 'english');
  const [voice, setVoice] = useState(remembered.current.voice === 'male' ? 'male' : 'female');
  const [shape, setShape] = useState<Shape>('9:16');
  const shapeByHand = useRef(false);
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [clips, setClips] = useState(1);
  const [transitions, setTransitions] = useState<Array<{ key: string; label: string }>>(FALLBACK_TRANSITIONS);
  const [transition, setTransition] = useState(transitionOf(remembered.current.transition));
  const [subtitles, setSubtitles] = useState(remembered.current.subtitles === true);
  const [wantLogo, setWantLogo] = useState(remembered.current.logo === true);
  const [hasLogo, setHasLogo] = useState(false);
  const [endLine, setEndLine] = useState('');
  const [stylesOpen, setStylesOpen] = useState(false);
  const [parts, setParts] = useState<Part[]>([]);
  const [fromPlan, setFromPlan] = useState(false);
  const planLanguage = useRef<string | null>(null);
  const [who, setWho] = useState('');
  const [where, setWhere] = useState('');
  const [people, setPeople] = useState<PickedAsset[]>([]);
  const [places, setPlaces] = useState<PickedAsset[]>([]);
  const [products, setProducts] = useState<PickedAsset[]>([]);
  const [picker, setPicker] = useState<null | 'character' | 'environment' | 'products'>(null);
  const [maker, setMaker] = useState<null | 'person' | 'place'>(null);
  const [ideaPickerOpen, setIdeaPickerOpen] = useState(false);
  const [pickedIdea, setPickedIdea] = useState('');
  const [refCost, setRefCost] = useState(0);
  const [cast, setCast] = useState<Array<{ role: string; description: string }>>([]);
  const [castFor, setCastFor] = useState('');
  const [makerSeed, setMakerSeed] = useState('');

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

  useEffect(() => { saveChoices({ style, language, voice, transition, subtitles, logo: wantLogo }); }, [style, language, voice, transition, subtitles, wantLogo]);

  const weekMark = useRef<{ itemId: string; weekId?: string } | null>(null);

  const loadHistory = useCallback(() => {
    studioVideosAPI.list().then((r) => {
      if (!r?.success) return;
      setHistory(r.videos || []);
      // A video still being made stays in the list as "Being made". Opening the page never pulls the person back to it.
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const p = takePrefill('video');
    if (!p) return;
    if (p.weekItemId) weekMark.current = { itemId: p.weekItemId, weekId: p.weekId };
    const text = String(p.idea || '').trim();
    if (text) { setIdea(text); setFromPlan(true); }
    if (p.language) {
      planLanguage.current = p.language;
      setLanguage((cur) => nearestLanguage(p.language, ['english', 'tamil'], cur));
    }
  }, []);

  useEffect(() => {
    studioVideosAPI.options().then((r) => {
      if (!r?.success) return;
      if (r.styles?.length) setStyles(r.styles);
      if (r.voices?.length) setVoices(r.voices);
      if (r.lengths?.length) setLengths(r.lengths);
      if (r.transitions?.length) setTransitions(r.transitions);
      setHasLogo(r.hasLogo === true);
      if (r.platformShapes) setShapes(r.platformShapes);
      if (r.platforms?.length) setPlatformIds(r.platforms);
      if (r.clipSeconds || r.seconds) setClipSeconds(r.clipSeconds || r.seconds);
      if (r.languages?.length) {
        setLangs(r.languages);
        if (planLanguage.current) {
          const want = planLanguage.current;
          planLanguage.current = null;
          setLanguage((cur) => nearestLanguage(want, r.languages.map((l: any) => l.key), cur));
        }
      }
      setCost(r.costPerClip || r.quarks || 0);
      setRefCost(r.referenceQuarks || 0);
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

  // Videos being made in the background: keep their cards in the list up to date while the person works on another.
  const othersMaking = history.some((v) => v.status === 'processing' && v.id !== current?.id);
  useEffect(() => {
    if (!othersMaking) return;
    const t = window.setInterval(loadHistory, 8000);
    return () => window.clearInterval(t);
  }, [othersMaking, loadHistory]);

  useEffect(() => { if (current) setStep('result'); }, [current?.id]);
  // Each step starts at the top, so a phone never lands halfway down the next one.
  useEffect(() => { if (step !== 'result') window.scrollTo({ top: 0 }); }, [step]);
  // Opening a video from the list below must bring its player into view, wherever the page was scrolled.
  useEffect(() => { if (step === 'result' && current) document.getElementById('video-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [step, current?.id]);

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
    idea, style, language, clips, aspectRatio: shape, who: who.trim(), where: where.trim(),
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
      setParts(clips > 1 ? padParts(r.parts, clips, { beats: r.beats || [], spokenLine: r.spokenLine || '' }) : []);
      setStep('check');
    } catch (e: any) {
      setError(e?.message || 'We could not plan this video. Please try again.');
    } finally { setPlanning(false); }
  };

  const make = async () => {
    setError(''); setPlanning(true);
    try {
      const c = await choices();
      const quiet = language === 'none';
      const outParts = clips > 1 ? parts.map((p) => ({ beats: p.beats, spokenLine: quiet ? '' : p.spokenLine })) : undefined;
      const spokenAll = quiet ? '' : outParts ? outParts.map((p) => p.spokenLine).filter(Boolean).join(' ') : spoken;
      const r = await studioVideosAPI.create({ ...c, title, concept: conceptText, beats: concept?.beats || [], spokenLine: spokenAll, aspectRatio: shape, voice: quiet ? undefined : voice, parts: outParts, platforms: platforms.length ? platforms : undefined, ...finishPayload({ clips, language, transition, subtitles, logo: wantLogo, hasLogo, endLine }) });
      if (!r?.success || !r.video) { setError(plainMessage(r?.message) || 'We could not start the video. Please try again.'); return; }
      setCurrent(r.video); refreshBalance();
      // Tell the week card this one is made (best effort, once).
      const m = weekMark.current;
      if (m && r.video.id) { weekMark.current = null; apiService.markWeekItemMade(m.itemId, String(r.video.id), m.weekId).catch(() => undefined); }
    } catch (e: any) {
      setError(plainMessage(e?.data?.message || e?.message) || 'We could not start the video. Please try again.');
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
      setError(plainMessage(e?.data?.message || e?.message) || 'We could not start the change. Please try again.');
    } finally { setPlanning(false); }
  };

  // Suggest who could appear, once per idea, when the person reaches the second step.
  useEffect(() => {
    if (step !== 'yours' || castFor === idea || !canPlan(idea)) return;
    setCastFor(idea);
    studioVideosAPI.cast(idea).then((r) => setCast(r?.cast || [])).catch(() => setCast([]));
  }, [step, idea, castFor]);

  const startOver = () => { setCurrent(null); setConcept(null); setStep('idea'); setError(''); };
  const stepIndex = STEPS.findIndex((s) => s.key === step);
  const total = (lengths.find((l) => l.clips === clips)?.quarks) || cost * clips;
  const seconds = (lengths.find((l) => l.clips === clips)?.seconds) || clipSeconds * clips;
  const priceLine = buildPriceLine({ seconds, clips, total, balance });
  const shortMsg = cost ? shortBalanceMessage({ balance, perClip: cost, clips, clipSeconds }) : '';
  const lengthChoices: LengthOption[] = lengths.length ? lengths : [{ clips: 1, seconds: clipSeconds, quarks: cost }];
  const orderedStyles = useMemo(() => orderStyles(styles), [styles]);
  const shownStyles = visibleStyles(orderedStyles, style, stylesOpen);
  const platformItems = useMemo(() => choicesFor('video').filter((p) => !platformIds || platformIds.includes(p.key)).map((p) => ({ key: p.key, label: p.label })), [platformIds]);
  const pickShape = (v: Shape) => { shapeByHand.current = true; setShape(v); };
  const togglePlatform = (k: string) => {
    const next = platforms.includes(k) ? platforms.filter((x) => x !== k) : [...platforms, k];
    setPlatforms(next);
    const want = shapeForPlatforms(next, shapes);
    if (want && !shapeByHand.current) setShape(want);
  };
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
            <div className="mb-4 flex flex-wrap items-center justify-center gap-3">
              <GravityButton variant="ghost" onClick={() => setIdeaPickerOpen(true)} className="!py-2"><CalendarIcon className="h-4 w-4 text-[var(--gv-accent)]" /> Choose an idea from your calendar</GravityButton>
              {pickedIdea && <span className="text-[12.5px] text-[var(--gv-text-tertiary)]">Loaded: <span className="text-[var(--gv-accent-text)]">{pickedIdea}</span></span>}
            </div>
            <GravityLabel gold className="mb-2">What is the video about?</GravityLabel>
            <textarea
              value={idea}
              onChange={(e) => { setIdea(e.target.value); setFromPlan(false); }}
              rows={4}
              className="gravity-bare w-full bg-transparent border-none outline-none text-[14.5px] text-[var(--gv-text-tertiary)] leading-relaxed resize-none placeholder:text-[var(--gv-text-muted)]"
              placeholder="For example: Diwali offer at our sweet shop. A gift box of kaju katli and mysore pak, 10% off, free home delivery above ₹1,000."
            />
            {fromPlan && <p className="mt-2 text-[12.5px] text-[var(--gv-text-tertiary)]">Filled in from your plan. Change anything you like.</p>}
            <IdeaBoxTools
              languageLabel={language === 'tamil' ? 'Tamil' : 'English'}
              onText={(t) => setIdea((d) => appendText(d, t))}
              onRead={(ups) => ups.forEach((u) => u.brief && setIdea((d) => appendText(d, u.brief)))}
              onReuse={(u) => u.brief && setIdea((d) => appendText(d, u.brief))}
              referenceChoices={[
                { label: 'A person', onPick: (f) => { if (people.length >= 2) return 'You already have two people. Remove one first.'; setPeople((p) => [...p, referenceAssetFromFile(f)].slice(0, 2)); } },
                { label: 'A place', onPick: (f) => setPlaces([referenceAssetFromFile(f)]) },
                { label: 'A product', onPick: (f) => { if (products.length >= 2) return 'You already have two products. Remove one first.'; setProducts((p) => [...p, referenceAssetFromFile(f)].slice(0, 2)); } },
              ]}
            />
          </GravityPanel>

          <div className="flex justify-end">
            <GravityButton disabled={!canPlan(idea)} onClick={() => setStep('yours')}>Next <ArrowRight className="h-4 w-4" /></GravityButton>
          </div>
        </div>
      )}

      {step === 'yours' && (
        <div className="space-y-5">
          <div>
            <div className="gravity-label mb-2">Look</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Look of the video">
              {orderedStyles.map((st) => (
                <div key={st.key} className={`min-w-0 ${shownStyles.includes(st) ? '' : 'hidden sm:block'}`}><StyleTile s={st} on={style === st.key} pick={() => setStyle(st.key)} /></div>
              ))}
            </div>
            {orderedStyles.length > SHOW_FIRST_STYLES && (
              <button type="button" onClick={() => setStylesOpen((o) => !o)} aria-expanded={stylesOpen} className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-medium text-[var(--gv-accent-text)] sm:hidden">
                {stylesOpen ? 'Show fewer' : `Show all ${orderedStyles.length}`} <ChevronDown className={`h-3.5 w-3.5 transition-transform ${stylesOpen ? 'rotate-180' : ''}`} />
              </button>
            )}
          </div>

          <div>
            <div className="gravity-label mb-2">Spoken language</div>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Spoken language">
              {langs.map((l) => (
                <button key={l.key} type="button" role="radio" aria-checked={language === l.key} onClick={() => setLanguage(l.key)} className={`${tile(language === l.key)} !py-2`}>{l.label}</button>
              ))}
            </div>
            {isNewSpeech(language) && <p className="mt-2 text-[12.5px] text-[var(--gv-text-tertiary)]">{NEW_SPEECH_NOTE}</p>}
          </div>

          {language !== 'none' && (
            <div>
              <div className="gravity-label mb-2">Voice</div>
              <div className="inline-flex overflow-hidden rounded-xl border border-[var(--gv-border-default)]" role="radiogroup" aria-label="Voice">
                {voices.map((v) => (
                  <button key={v.key} type="button" role="radio" aria-checked={voice === v.key} onClick={() => setVoice(v.key)}
                    className={`px-4 py-2 text-[14px] font-semibold transition-colors ${voice === v.key ? 'bg-[var(--gv-accent-fill)] text-[var(--gv-accent-text)]' : 'bg-[var(--gv-surface-1)] text-[var(--gv-text-secondary)] hover:text-[var(--gv-text-primary)]'}`}>
                    {v.key === 'male' ? 'Male' : v.key === 'female' ? 'Female' : v.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="gravity-label mb-2">Where will you post it? <span className="font-normal normal-case text-[var(--gv-text-tertiary)]">· optional</span></div>
            <PlatformPicker items={platformItems} selected={platforms} onToggle={togglePlatform} kind="video" className="flex-wrap" />
          </div>

          <div>
            <div className="gravity-label mb-2">Shape</div>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap" role="radiogroup" aria-label="Video shape">
              {([['9:16', 'Vertical', 'Reels, Shorts, Stories'], ['16:9', 'Wide', 'YouTube, websites, LinkedIn']] as const).map(([v, label, hint]) => {
                const sug = suggestionHint(v, platforms, shapes, platformLabel);
                return (
                  <button key={v} type="button" role="radio" aria-checked={shape === v} onClick={() => pickShape(v)} className={`${tile(shape === v)} !py-2`}>
                    <span className="block text-[14px] font-semibold">{label}</span>
                    <span className="block text-[12.5px] opacity-80">{sug || hint}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="gravity-label mb-2">Length</div>
            <div className="inline-flex max-w-full flex-wrap overflow-hidden rounded-xl border border-[var(--gv-border-default)]" role="radiogroup" aria-label="Length of the video">
              {lengthChoices.map((l) => (
                <button key={l.clips} type="button" role="radio" aria-checked={clips === l.clips} onClick={() => setClips(l.clips)}
                  className={`min-w-[52px] px-3.5 py-2 text-[14px] font-semibold transition-colors ${clips === l.clips ? 'bg-[var(--gv-accent-fill)] text-[var(--gv-accent-text)]' : 'bg-[var(--gv-surface-1)] text-[var(--gv-text-secondary)] hover:text-[var(--gv-text-primary)]'}`}>
                  {l.seconds}s
                </button>
              ))}
            </div>
            <p className="mt-2 text-[12.5px] text-[var(--gv-text-secondary)]">{lengthLine(seconds, clips)}</p>
            {priceLine && <p className="text-[12px] text-[var(--gv-text-tertiary)]">{priceLine}</p>}
            {shortMsg && <p role="status" className="mt-1 text-[12.5px] font-medium text-[var(--gv-text-primary)]">{shortMsg}</p>}
          </div>

          {showTransitions(clips) && (
            <div>
              <div className="gravity-label mb-2">Between parts</div>
              <div className="inline-flex max-w-full flex-wrap overflow-hidden rounded-xl border border-[var(--gv-border-default)]" role="radiogroup" aria-label="How the parts are joined">
                {transitions.map((t) => (
                  <button key={t.key} type="button" role="radio" aria-checked={transition === t.key} onClick={() => setTransition(transitionOf(t.key))}
                    className={`px-3.5 py-2 text-[14px] font-semibold transition-colors ${transition === t.key ? 'bg-[var(--gv-accent-fill)] text-[var(--gv-accent-text)]' : 'bg-[var(--gv-surface-1)] text-[var(--gv-text-secondary)] hover:text-[var(--gv-text-primary)]'}`}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {showSubtitles(language) && (
            <label className="flex cursor-pointer items-start gap-3">
              <input type="checkbox" role="switch" checked={subtitles} onChange={(e) => setSubtitles(e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--gv-accent-fill)]" />
              <span>
                <span className="block text-[14px] font-semibold text-[var(--gv-text-primary)]">Subtitles</span>
                <span className="block text-[12.5px] text-[var(--gv-text-secondary)]">{SUBTITLES_HINT}</span>
              </span>
            </label>
          )}

          <div>
            <label className={`flex items-start gap-3 ${hasLogo ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'}`}>
              <input type="checkbox" role="switch" checked={wantLogo && hasLogo} disabled={!hasLogo} onChange={(e) => setWantLogo(e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--gv-accent-fill)]" />
              <span>
                <span className="block text-[14px] font-semibold text-[var(--gv-text-primary)]">Add my logo</span>
                <span className="block text-[12.5px] text-[var(--gv-text-secondary)]">{hasLogo ? 'Your logo sits in a corner of the video' : NO_LOGO_HINT}</span>
              </span>
            </label>
            {wantLogo && hasLogo && (
              <div className="mt-3">
                <label className="gravity-label mb-2 block" htmlFor="end-line">Closing line <span className="font-normal normal-case text-[var(--gv-text-tertiary)]">· optional</span></label>
                <input id="end-line" value={endLine} onChange={(e) => setEndLine(cleanEndLine(e.target.value.slice(0, END_LINE_MAX + 20)))} className={field} maxLength={END_LINE_MAX} placeholder="For example: Order today, free delivery" />
                <p className="mt-1 text-[12px] text-[var(--gv-text-tertiary)]">Shown with your logo over the last 2 seconds</p>
              </div>
            )}
          </div>

          <p className="text-center text-[13.5px] text-[var(--gv-text-secondary)]">Add your own people, place and products so the video looks like your business. Skip any of these and we will choose something believable.</p>
          <PickRow Icon={UserIcon} title="Who appears" hint="A photo of the person: you, your team or a customer who agreed." picked={people}
            onPick={() => setPicker('character')} onClear={() => setPeople([])} pickLabel="Choose a photo" onCreate={people.length < 2 ? () => { setMakerSeed(who); setMaker('person'); } : undefined} createLabel={people.length ? 'Add another person' : 'Create with AI'} text={who} onText={setWho} placeholder="Or describe them: a smiling shopkeeper in her 40s, in a cotton saree" />
          {cast.length > 0 && people.length < 2 && (
            <div className="-mt-1 rounded-2xl border border-dashed border-[var(--gv-border-default)] px-4 py-3">
              <div className="text-[12.5px] font-semibold text-[var(--gv-text-primary)]">Suggested for your idea</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {cast.map((c) => (
                  <button key={c.role} type="button" onClick={() => { setMakerSeed(c.description); setMaker('person'); }} title={c.description}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[var(--gv-border-default)] bg-[var(--gv-surface-2)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--gv-text-secondary)] hover:text-[var(--gv-text-primary)]">
                    <Sparkles className="h-3.5 w-3.5 text-[var(--gv-accent)]" /> {c.role}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11.5px] text-[var(--gv-text-tertiary)]">Pick one to see them, then keep them or make another. You can have up to two people.</p>
            </div>
          )}
          <PickRow Icon={ImageIcon} title="Where it happens" hint="A photo of your shop, kitchen, studio or anywhere you work." picked={places}
            onPick={() => setPicker('environment')} onClear={() => setPlaces([])} pickLabel="Choose a photo" onCreate={() => setMaker('place')} createLabel="Create with AI" text={where} onText={setWhere} placeholder="Or describe it: a busy sweet shop with brass lamps" />
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
            {clips > 1 ? (
              <div className="mt-4 space-y-3">
                <p className="text-[12.5px] text-[var(--gv-text-secondary)]">{lengthLine(seconds, clips)}. Each part carries on from the one before.</p>
                {parts.map((p, i) => (
                  <div key={i} className="rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-surface-1)] p-3">
                    <div className="mb-2 text-[13px] font-semibold text-[var(--gv-text-primary)]">{partLabel(i, clips)}</div>
                    <label className="gravity-label mb-1 block" htmlFor={`v-beats-${i}`}>The shots</label>
                    <textarea id={`v-beats-${i}`} value={partsToText(p.beats)} onChange={(e) => setParts((ps) => editPartBeats(ps, i, e.target.value))} rows={3} className={field} />
                    {language !== 'none' && (
                      <>
                        <label className="gravity-label mb-1 mt-3 block" htmlFor={`v-line-${i}`}>What is said ({langs.find((l) => l.key === language)?.label || language})</label>
                        <textarea id={`v-line-${i}`} value={p.spokenLine} onChange={(e) => setParts((ps) => editPartLine(ps, i, e.target.value))} rows={2} className={field} />
                      </>
                    )}
                  </div>
                ))}
                {language !== 'none' && <p className="text-[12px] text-[var(--gv-text-tertiary)]">Check every word, especially names, prices and numbers.</p>}
              </div>
            ) : (
              <>
                {concept.beats?.length > 0 && (
                  <ol className="mt-3 list-decimal space-y-1 pl-5 text-[13px] text-[var(--gv-text-secondary)]">
                    {concept.beats.map((b, i) => <li key={i}>{b}</li>)}
                  </ol>
                )}
                {language !== 'none' && (
                  <>
                    <label className="gravity-label mb-1 mt-4 block" htmlFor="v-spoken">What is said ({langs.find((l) => l.key === language)?.label || language})</label>
                    <textarea id="v-spoken" value={spoken} onChange={(e) => setSpoken(e.target.value)} rows={2} className={field} />
                    <p className="mt-1 text-[12px] text-[var(--gv-text-tertiary)]">Check every word, especially names, prices and numbers.</p>
                  </>
                )}
              </>
            )}
          </GravityPanel>
          <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
            <GravityButton variant="ghost" onClick={() => setStep('yours')}><ArrowLeft className="h-4 w-4" /> Back</GravityButton>
            <div className="flex flex-col items-end text-right">
              <GravityButton disabled={planning || !conceptText.trim()} onClick={make}>
                {planning ? <><Loader2 className="h-4 w-4 animate-spin" /> Starting…</> : <><Wand2 className="h-4 w-4" /> Make my video</>}
              </GravityButton>
              <div className="mt-1 text-[12px] text-[var(--gv-text-tertiary)]">{lengthLine(seconds, clips)}</div>
              {priceLine && <div className="text-[12px] text-[var(--gv-text-tertiary)]">{priceLine}</div>}
              {shortMsg && <div role="status" className="text-[12px] font-medium text-[var(--gv-text-primary)]">{shortMsg}</div>}
            </div>
          </div>
        </div>
      )}

      {step === 'result' && current && (
        <div id="video-result" className="space-y-6">
          <GravityPanel>
            <div className="flex flex-col items-center gap-4">
              {processing && (
                <div className={`flex ${current?.aspectRatio === '16:9' ? 'aspect-video max-w-[560px]' : 'aspect-[9/16] max-w-[300px]'} w-full flex-col items-center justify-center gap-3 rounded-2xl border border-[var(--gv-border-default)] bg-[var(--gv-surface-2)] p-6 text-center`} role="status">
                  <Loader2 className="h-7 w-7 animate-spin text-[var(--gv-accent)]" />
                  <div className="text-[14px] font-semibold text-[var(--gv-text-primary)]">{waitMessage(waited)}</div>
                  {progressLabel(current.clips || 1, current.clipsDone || 0) && <div className="text-[13px] font-semibold text-[var(--gv-accent-text)]">{progressLabel(current.clips || 1, current.clipsDone || 0)}</div>}
                  <div className="text-[12.5px] text-[var(--gv-text-secondary)]">{(current.clips || 1) > 1 ? 'A longer video takes a few minutes. ' : 'This takes 1 to 4 minutes. '} You can leave this page: your video will be in this list when you come back.</div>
                </div>
              )}
              {current.status === 'completed' && current.videoUrl && (
                <video src={current.videoUrl} controls playsInline className={`w-full ${current.aspectRatio === '16:9' ? 'max-w-[560px]' : 'max-w-[300px]'} rounded-2xl bg-black`} />
              )}
              {current.status === 'failed' && (
                <div className="w-full max-w-[420px] rounded-2xl border border-[var(--gv-border-default)] bg-[var(--gv-surface-2)] p-5 text-center text-[13.5px] text-[var(--gv-text-primary)]" role="alert">{plainMessage(current.error)}</div>
              )}
              <div className="text-center">
                <div className="text-[15px] font-semibold text-[var(--gv-text-primary)]">{current.title}</div>
                {current.change && <div className="text-[12.5px] text-[var(--gv-text-tertiary)]">Change: {current.change}</div>}
                {current.notice && <div role="status" className="mx-auto mt-2 max-w-[420px] text-[12.5px] text-[var(--gv-text-secondary)]">{current.notice}</div>}
              </div>
              {current.status === 'completed' && (
                <div className="flex flex-wrap justify-center gap-2">
                  <GravityButton onClick={() => downloadImage(current.videoUrl, current.title || 'video')}><Download className="h-4 w-4" /> Download</GravityButton>
                  <GravityButton variant="ghost" onClick={startOver}>Make another video</GravityButton>
                </div>
              )}
              {processing && <GravityButton variant="ghost" onClick={startOver}>Make another video while you wait</GravityButton>}
              {current.status === 'failed' && <GravityButton onClick={startOver}>Try again</GravityButton>}
            </div>
          </GravityPanel>

          {current.status === 'completed' && !canChange(current.seconds) && (
            <p className="text-center text-[13px] text-[var(--gv-text-secondary)]">{NO_CHANGE_NOTE}</p>
          )}
          {current.status === 'completed' && canChange(current.seconds) && (
            <GravityPanel>
              <GravityLabel gold className="mb-2">Want something different?</GravityLabel>
              <p className="mb-3 text-[13px] text-[var(--gv-text-secondary)]">Say what to change and we keep the rest the same. Each change makes a new 10 second version.</p>
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
                <button type="button" onClick={() => { setCurrent(v); setStep('result'); setError(''); }} className="block w-full text-left">
                  <div className={`${v.aspectRatio === '16:9' ? 'aspect-video' : 'aspect-[9/16]'} w-full bg-[var(--gv-surface-2)]`}>
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

      <CalendarIdeaPicker
        open={ideaPickerOpen}
        onClose={() => setIdeaPickerOpen(false)}
        type="reel"
        onPick={(i: any) => {
          setIdea([i.creativeConcept || i.headline || '', i.shootType ? `Style: ${i.shootType}.` : ''].filter(Boolean).join(' '));
          setPickedIdea(i.headline || '');
        }}
      />
      {maker && (
        <ReferenceMaker
          kind={maker}
          initialDescription={makerSeed || (maker === 'person' ? who : where)}
          quarks={refCost}
          onClose={() => { setMaker(null); setMakerSeed(''); }}
          onUse={(a) => { if (maker === 'person') setPeople((p) => [...p, a].slice(0, 2)); else setPlaces([a]); setMaker(null); setMakerSeed(''); }}
        />
      )}
      <AssetPicker
        open={picker === 'character'} onClose={() => setPicker(null)} source="character" max={2}
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
