import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, Layers, Calendar as CalendarIcon, Zap, Image as ImageIcon, Instagram, Facebook, Linkedin, ChevronRight, Loader2, Check, Clock, Save, AlertCircle, RotateCcw, Pencil, Trash2 } from 'lucide-react';
import { draftsAPI, brandAssetsAPI, apiService } from '../services/api';
import { Draft } from '../types';
import GeneratingFill from '../components/GeneratingFill';
import { BorderBeam } from '../components/ui/border-beam';

const ASPECTS = [
  { key: '4:5',  label: '4:5',  hint: 'Portrait' },
  { key: '1:1',  label: '1:1',  hint: 'Square' },
  { key: '9:16', label: '9:16', hint: 'Vertical' },
  { key: '16:9', label: '16:9', hint: 'Landscape' },
];

// Direct fetch to the streaming endpoint — apiService doesn't expose SSE.
const API_BASE = typeof window !== 'undefined' && window.location.hostname !== 'localhost'
  ? '/api'
  : 'http://localhost:5000/api';
const getToken = () =>
  (typeof window !== 'undefined' && (localStorage.getItem('token') || localStorage.getItem('authToken'))) || '';

// Gravity Create — matches the prototype's Create screen exactly.
// Two modes: Campaign (multi-post plan) and Single post.
// Wires the primary CTA to apiService.createCampaign, then routes to
// /drafts (Approve) so the user sees what got produced.

type CreateMode = 'campaign' | 'single';

const DURATIONS = ['1 week', '2 weeks', '3 weeks', '4 weeks'];
const CADENCES = ['2 posts / week', '3 posts / week', '5 posts / week', 'Daily'];
const TONES = ['Warm, unhurried', 'Confident, bold', 'Playful, kinetic', 'Luxurious, poetic', 'Professional, calm'];
const VISUAL_STYLES = ['4:5 portrait', '1:1 square', '9:16 vertical', '16:9 landscape'];
const PLATFORMS = [
  { key: 'instagram', label: 'Instagram', Icon: Instagram },
  { key: 'facebook',  label: 'Facebook',  Icon: Facebook },
  { key: 'x',         label: 'X',         Icon: ImageIcon /* placeholder */ },
  { key: 'linkedin',  label: 'LinkedIn',  Icon: Linkedin },
];

const MetaBox: React.FC<{
  label: string;
  value: string;
  Icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
}> = ({ label, value, Icon, onClick }) => (
  <button
    onClick={onClick}
    className="group relative flex items-center gap-4 h-[68px] px-5 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/[0.12] transition-all text-left w-full"
  >
    <span className="w-9 h-9 rounded-md bg-[#F5A623]/10 border border-[#F5A623]/20 flex items-center justify-center flex-shrink-0">
      <Icon className="w-4 h-4 text-[#F5A623]" />
    </span>
    <div className="flex-1 min-w-0">
      <div className="gravity-label mb-0.5">{label}</div>
      <div className="text-[14px] font-semibold text-[#F5F4F1] truncate">{value}</div>
    </div>
    <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35 group-hover:text-[#F5A623]">
      Edit
    </span>
  </button>
);

const OptionPopover: React.FC<{
  open: boolean;
  options: string[];
  onPick: (v: string) => void;
  onClose: () => void;
}> = ({ open, options, onPick, onClose }) => {
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute top-full left-0 right-0 mt-2 rounded-xl border border-white/[0.10] bg-[#151515] shadow-2xl z-50 overflow-hidden">
        {options.map((o) => (
          <button
            key={o}
            onClick={() => { onPick(o); onClose(); }}
            className="w-full text-left px-4 py-2.5 text-[13px] text-[#F5F4F1] hover:bg-white/[0.06] transition-colors"
          >
            {o}
          </button>
        ))}
      </div>
    </>
  );
};

const GravityCreate: React.FC = () => {
  const navigate = useNavigate();
  const [mode, setMode] = useState<CreateMode>('campaign');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [duration, setDuration] = useState('2 weeks');
  const [cadence, setCadence] = useState('3 posts / week');
  const [tone, setTone] = useState('Warm, unhurried');
  const [visualStyle, setVisualStyle] = useState('4:5 portrait');
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(['instagram']);
  const [openPopover, setOpenPopover] = useState<null | 'duration' | 'cadence' | 'tone' | 'style'>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressMsg, setProgressMsg] = useState<string>('');
  const [postsGenerated, setPostsGenerated] = useState<number>(0);

  // Results stay on this page instead of bouncing to /drafts. The image is
  // produced by a background worker, so we poll the draft(s) until the
  // artwork lands, then offer keep / publish / schedule inline.
  const [results, setResults] = useState<Draft[]>([]);
  const [actioned, setActioned] = useState<Record<string, 'draft' | 'approved' | 'scheduled'>>({});
  const [actionBusy, setActionBusy] = useState<string>('');
  const [scheduleFor, setScheduleFor] = useState<string>('');
  const [schedulingId, setSchedulingId] = useState<string>('');
  const pollRef = useRef<any>(null);

  // Brand logo choice, pulled from Brand Assets. Applied AFTER the image is
  // generated — handing a logo to an image model gets it redrawn and smeared.
  const [logos, setLogos] = useState<Array<{ id: string; url: string; name: string }>>([]);
  const [selectedLogo, setSelectedLogo] = useState<string>('');
  const [captionBusy, setCaptionBusy] = useState<string>('');
  const [editingCaption, setEditingCaption] = useState<string>('');
  const [captionDraft, setCaptionDraft] = useState<string>('');

  useEffect(() => {
    (async () => {
      try {
        const res: any = await brandAssetsAPI.getLogos();
        const list = (res?.assets || res?.logos || res?.data || [])
          .map((a: any) => ({ id: String(a._id || a.id || a.url), url: a.url || a.imageUrl || '', name: a.name || 'Logo' }))
          .filter((a: any) => a.url);
        setLogos(list);
        const primary = (res?.assets || res?.logos || []).find((a: any) => a.isPrimary);
        if (primary?.url) setSelectedLogo(primary.url);
      } catch { /* no logos configured — picker just stays empty */ }
    })();
  }, []);

  const setAspect = (key: string) => {
    const match = VISUAL_STYLES.find((v) => v.startsWith(key));
    if (match) setVisualStyle(match);
  };

  const stillRendering = results.some((d) => String(d?.status || '').toLowerCase() === 'processing');

  // Poll while any result is still rendering. Cleared as soon as everything
  // has an image (or failed), so we are not hammering the API forever.
  useEffect(() => {
    if (!results.length || !stillRendering) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const refreshed = await Promise.all(
          results.map(async (d) => {
            if (String(d?.status || '').toLowerCase() !== 'processing') return d;
            try {
              const res = await draftsAPI.getDraft(d._id);
              let next: any = res?.draft || d;
              // Artwork just landed — stamp the chosen logo on now that
              // there is something to stamp it onto.
              const img = next?.imageUrl || next?.creative?.imageUrls?.[0];
              if (selectedLogo && img && !next.logoApplied) {
                try {
                  const applied = await draftsAPI.applyLogo(next._id, selectedLogo);
                  if (applied?.draft) next = applied.draft;
                } catch { /* keep the unbranded image rather than losing it */ }
              }
              return next;
            } catch { return d; }
          })
        );
        setResults(refreshed);
      } catch { /* transient — next tick retries */ }
    }, 5000);
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [results, stillRendering]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const draftImage = (d: any): string =>
    d?.imageUrl || d?.creative?.imageUrls?.[0] || d?.images?.[0] || '';

  // Keep as draft — the record already exists as a draft the moment it is
  // generated, so this only needs to acknowledge and clear it from view.
  const keepAsDraft = (d: Draft) => {
    setActioned((prev) => ({ ...prev, [d._id]: 'draft' }));
  };

  const approveNow = async (d: Draft) => {
    setActionBusy(d._id);
    setError(null);
    try {
      await draftsAPI.publishDraft(d._id, selectedPlatforms);
      setActioned((prev) => ({ ...prev, [d._id]: 'approved' }));
    } catch (e: any) {
      setError(e?.message || 'Could not publish this post');
    } finally {
      setActionBusy('');
    }
  };

  // Writes a caption for the poster that was actually produced, rather than
  // echoing the user's prompt back at them.
  const generateCaption = async (d: any) => {
    const img = draftImage(d);
    if (!img) return;
    setCaptionBusy(d._id);
    setError(null);
    try {
      const res: any = await apiService.generateCaptionFromImage(img, selectedPlatforms[0] || 'instagram');
      const next = res?.caption || res?.data?.caption || '';
      if (!next) throw new Error('No caption came back');
      await draftsAPI.updateDraft(d._id, { caption: next });
      setResults((prev) => prev.map((x: any) => x._id === d._id ? { ...x, caption: next } : x));
    } catch (e: any) {
      setError(e?.message || 'Could not write a caption');
    } finally {
      setCaptionBusy('');
    }
  };

  const saveCaption = async (d: Draft) => {
    setCaptionBusy(d._id);
    try {
      await draftsAPI.updateDraft(d._id, { caption: captionDraft });
      setResults((prev) => prev.map((x: any) => x._id === d._id ? { ...x, caption: captionDraft } : x));
      setEditingCaption('');
    } catch (e: any) {
      setError(e?.message || 'Could not save the caption');
    } finally {
      setCaptionBusy('');
    }
  };

  const regenerateImage = async (d: Draft) => {
    setActionBusy(d._id);
    setError(null);
    try {
      await draftsAPI.retryImageGeneration(d._id);
      setResults((prev) => prev.map((x: any) => x._id === d._id ? { ...x, status: 'processing', imageUrl: '' } : x));
    } catch (e: any) {
      setError(e?.message || 'Could not regenerate');
    } finally {
      setActionBusy('');
    }
  };

  const discard = async (d: Draft) => {
    setActionBusy(d._id);
    try {
      await draftsAPI.deleteDraft(d._id);
    } catch { /* already gone — drop it from view regardless */ }
    setResults((prev) => prev.filter((x: any) => x._id !== d._id));
    setActionBusy('');
  };

  // "Send all to approval" — publishes every card that hasn't been actioned.
  const sendAllToApproval = async () => {
    const pending = results.filter((d: any) => !actioned[d._id] && draftImage(d));
    if (!pending.length) return;
    setActionBusy('all');
    setError(null);
    const done: Record<string, 'approved'> = {};
    for (const d of pending) {
      try {
        await draftsAPI.publishDraft(d._id, selectedPlatforms);
        done[d._id] = 'approved';
      } catch { /* keep going; the rest can still go out */ }
    }
    setActioned((prev) => ({ ...prev, ...done }));
    const failed = pending.length - Object.keys(done).length;
    if (failed > 0) setError(`${failed} of ${pending.length} could not be sent.`);
    setActionBusy('');
  };

  const scheduleNow = async (d: Draft) => {
    if (!scheduleFor) { setError('Pick a date and time first'); return; }
    setActionBusy(d._id);
    setError(null);
    try {
      // The backend creates the Campaign behind this draft, which is what the
      // publishing scheduler actually picks up.
      await draftsAPI.scheduleDraft(d._id, new Date(scheduleFor).toISOString());
      setActioned((prev) => ({ ...prev, [d._id]: 'scheduled' }));
      setSchedulingId('');
      setScheduleFor('');
    } catch (e: any) {
      setError(e?.message || 'Could not schedule this post');
    } finally {
      setActionBusy('');
    }
  };

  const togglePlatform = (key: string) =>
    setSelectedPlatforms((prev) => prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]);

  // Post count estimate (matches prototype text "~6 posts · 2 per week")
  const estimate = useMemo(() => {
    const weeks = parseInt(duration, 10) || 1;
    const perWeek = parseInt(cadence, 10) || 1;
    return { total: weeks * perWeek, perWeek };
  }, [duration, cadence]);

  // Map friendly duration/aspect labels to backend enum values used by
  // /generate-campaign-stream.
  const backendDuration = useMemo(() => {
    const map: Record<string, string> = {
      '1 week': '1week',
      '2 weeks': '2weeks',
      '3 weeks': '3weeks',
      '4 weeks': '4weeks',
    };
    return map[duration] || '1week';
  }, [duration]);

  const backendAspect = useMemo(() => {
    if (visualStyle.startsWith('1:1')) return '1:1';
    if (visualStyle.startsWith('9:16')) return '9:16';
    if (visualStyle.startsWith('16:9')) return '16:9';
    return '4:5';
  }, [visualStyle]);

  // Single-post mode — use draftsAPI.generateImageBg which:
  //   1. Creates a Draft record with status='processing'
  //   2. Enqueues the background worker to generate the image via
  //      Nano Banana + save the Cloudinary URL back to the draft.
  // The result is then polled and shown on THIS page — keeping, approving
  // and scheduling all happen here rather than over in /drafts.
  const handleDraftSinglePost = async () => {
    setProgressMsg('Queuing the poster…');
    const res: any = await draftsAPI.generateImageBg({
      type: 'post',
      title: name.trim() || 'Untitled post',
      caption: description.trim() || name.trim() || '',
      hashtags: [],
      platforms: selectedPlatforms,
      prompt: description.trim() || name.trim() || 'A cinematic marketing poster',
      aspectRatio: backendAspect,
    });
    if (res?.draft) {
      setResults([res.draft]);
      setActioned({});
    }
    setProgressMsg('');
  };

  // Campaign mode — real AI generation via the streaming endpoint used
  // by the legacy Campaigns page. Streams posts as they're generated,
  // updates progress, then lands in Approve when done.
  const handleDraftCampaign = async () => {
    const token = getToken();
    if (!token) throw new Error('Please log in again.');

    const body = {
      campaignName: name.trim(),
      campaignDescription: description.trim() || name.trim(),
      objective: 'awareness',
      platforms: selectedPlatforms,
      tone: (tone.split(',')[0] || 'professional').toLowerCase(),
      language: 'English',
      aspectRatio: backendAspect,
      keyMessages: selectedPlatforms
        .map((p) => `[${p.toUpperCase()} CONTENT FORMAT]\n${description.trim()}`)
        .join('\n\n---\n\n'),
      duration: backendDuration,
      startDate: new Date().toISOString().split('T')[0],
      preferredDays: [],
      targetAge: '18-35',
      targetGender: 'all',
      targetLocation: '',
      targetInterests: '',
      productLogo: null,
      linkedProduct: null,
    };

    setProgressMsg('Warming up the studio…');
    const response = await fetch(`${API_BASE}/campaigns/generate-campaign-stream`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Server responded ${response.status}`);
    if (!response.body) throw new Error('No response body from server.');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = '';
    let complete = false;
    let postCount = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith('data: ') && currentEvent) {
          try {
            const data = JSON.parse(line.slice(6));
            if (currentEvent === 'status' || currentEvent === 'generating') {
              setProgressMsg(data.message || 'Drafting…');
            } else if (currentEvent === 'post') {
              postCount += 1;
              setPostsGenerated(postCount);
              setProgressMsg(`Drafted ${postCount} post${postCount > 1 ? 's' : ''}…`);
            } else if (currentEvent === 'complete') {
              complete = true;
            } else if (currentEvent === 'error') {
              throw new Error(data?.message || 'Generation failed');
            }
          } catch (parseErr) {
            // Ignore malformed lines
          }
        }
      }
    }
    if (!complete && postCount === 0) {
      throw new Error('Generation ended without any posts.');
    }

    // Same as single-post mode: show what was produced here rather than
    // sending the user off to /drafts. Pull the freshly-created drafts so
    // each one can be kept, approved or scheduled inline.
    setProgressMsg('Loading what was drafted…');
    try {
      const res = await draftsAPI.getDrafts();
      const fresh = (res?.drafts || [])
        .filter((d: any) => !['published', 'posted', 'scheduled', 'rejected'].includes(String(d?.status || '').toLowerCase()))
        .slice(0, postCount || 12);
      setResults(fresh);
      setActioned({});
    } catch {
      // If the fetch fails the posts still exist — fall back to Approve.
      navigate('/drafts');
      return;
    }
    setProgressMsg('');
  };

  const handleDraft = async () => {
    if (!name.trim()) { setError('Give it a name first.'); return; }
    if (selectedPlatforms.length === 0) { setError('Pick at least one platform.'); return; }
    setError(null);
    setSubmitting(true);
    setPostsGenerated(0);
    setProgressMsg('');
    try {
      if (mode === 'single') {
        await handleDraftSinglePost();
      } else {
        await handleDraftCampaign();
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to draft. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Cmd/Ctrl+Enter to launch (matches prototype's "⌘↵ to launch")
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !submitting) handleDraft();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [submitting, name, description, duration, cadence, tone, visualStyle, selectedPlatforms]);

  // While a request is in flight there is no draft record yet, so show
  // placeholder cards in the grid straight away. They animate in place and
  // are swapped for the real drafts the moment those come back.
  const pendingCards = submitting && results.length === 0
    ? Array.from({ length: mode === 'campaign' ? Math.min(estimate.total, 4) : 1 })
    : [];

  return (
    <div className="max-w-[900px] mx-auto pb-24">
      {/* Mode toggle */}
      <div className="flex items-center justify-center mb-14 mt-4">
        <div className="inline-flex items-center gap-1 p-1 rounded-full bg-white/[0.03] border border-white/[0.06]">
          <button
            onClick={() => setMode('campaign')}
            className={`flex items-center gap-2 h-9 px-5 rounded-full text-[13px] font-semibold transition-colors ${
              mode === 'campaign' ? 'bg-white/[0.10] text-[#F5F4F1]' : 'text-white/55 hover:text-white/80'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            Campaign
          </button>
          <button
            onClick={() => setMode('single')}
            className={`flex items-center gap-2 h-9 px-5 rounded-full text-[13px] font-semibold transition-colors ${
              mode === 'single' ? 'bg-white/[0.10] text-[#F5F4F1]' : 'text-white/55 hover:text-white/80'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Single post
          </button>
        </div>
      </div>

      {/* Hero */}
      <div className="text-center mb-10">
        <div className="gravity-label text-[#F5A623] mb-4">
          {mode === 'campaign' ? 'Plan a campaign · ' + duration : 'Draft a post · one shot'}
        </div>
        <h1 className="font-serif-display text-[56px] leading-[1.05] tracking-[-0.02em] text-[#F5F4F1] mb-5">
          {mode === 'campaign' ? (
            <>What are we <span className="italic text-[#F5A623]">working on</span>?</>
          ) : (
            <>What's on your <span className="italic text-[#F5A623]">mind</span>?</>
          )}
        </h1>
        <p className="text-[15px] text-white/55 max-w-[560px] mx-auto leading-relaxed">
          {mode === 'campaign'
            ? 'Describe the campaign once. Gravity drafts the full run — across platforms, spaced out, in your voice.'
            : 'One sentence is enough. Gravity turns it into a scroll-stopping post.'}
        </p>
      </div>

      {/* Name + Description card, wrapped in a travelling border beam.
          `mono` is the greyscale variant — desaturated and brightened it
          reads as brushed steel rather than a neon outline, with a narrow
          hue range so a warm glint passes through as the beam travels. */}
      {/* Three layers make the metal read: a soft outward halo (CSS, below
          the card), the travelling beam on the 1px edge (BorderBeam), and a
          brushed gradient + rim highlights on the surface itself. */}
      <div className="relative mb-5">
      <div className="metalHalo" aria-hidden />
      <BorderBeam
        size="md"
        // 'sunset' is the warm variant — orange/gold/amber, matching the
        // Gravity accent. Hue-shift stays ON so the gold shimmers as the
        // beam travels rather than sitting flat.
        colorVariant="sunset"
        theme="dark"
        saturation={1.35}
        brightness={2.4}
        hueRange={18}
        duration={3.6}
        borderRadius={16}
        strength={1}
        className="relative block"
        style={{ zIndex: 1 }}
      >
      {/* No border of its own — the beam IS the border, so a competing
          1px outline would sit exactly on top of it. Warm interior sheen
          so the surface picks up the gold as the beam passes. */}
      <div
        className="relative rounded-2xl p-5 overflow-hidden"
        style={{
          background: 'linear-gradient(180deg, rgba(255,214,150,0.055) 0%, rgba(255,255,255,0.012) 45%, rgba(255,196,84,0.028) 100%), #0f0d0a',
          boxShadow: 'inset 0 1px 0 0 rgba(255,214,150,0.16), inset 0 -1px 0 0 rgba(0,0,0,0.6), inset 0 0 70px rgba(245,166,35,0.05)'
        }}
      >
        {/* Ambient interior glow, warm to match the travelling beam. */}
        <div className="pointer-events-none absolute inset-0 -z-0" style={{ background: 'radial-gradient(60% 100% at 50% 100%, rgba(245,166,35,0.09) 0%, transparent 60%)' }} />
        <div className="relative">
          <div className="flex items-baseline gap-4 mb-3">
            <span className="gravity-label text-[#F5A623]">{mode === 'campaign' ? 'Campaign' : 'Post'}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={mode === 'campaign' ? 'Monsoon menu launch' : 'Sunday pour-over ritual'}
              className="flex-1 bg-transparent border-none outline-none text-[16px] font-semibold text-[#F5F4F1] placeholder:text-white/25"
            />
          </div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={mode === 'campaign'
              ? 'e.g. Launch our monsoon menu over two weeks — tease, reveal, drive footfall to the Saturday launch event.'
              : 'e.g. Slow Sunday. Filter coffee, one hand pouring, room quiet — invite people to spend the morning with us.'}
            rows={4}
            className="w-full bg-transparent border-none outline-none text-[14.5px] text-white/60 leading-relaxed resize-none placeholder:text-white/25"
          />
        </div>
      </div>
      </BorderBeam>
      </div>

      {/* Metadata grid — Campaign mode only */}
      {mode === 'campaign' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          <div className="relative">
            <MetaBox label="Duration" value={duration} Icon={CalendarIcon} onClick={() => setOpenPopover(openPopover === 'duration' ? null : 'duration')} />
            <OptionPopover open={openPopover === 'duration'} options={DURATIONS} onPick={setDuration} onClose={() => setOpenPopover(null)} />
          </div>
          <div className="relative">
            <MetaBox label="Cadence" value={cadence} Icon={Layers} onClick={() => setOpenPopover(openPopover === 'cadence' ? null : 'cadence')} />
            <OptionPopover open={openPopover === 'cadence'} options={CADENCES} onPick={setCadence} onClose={() => setOpenPopover(null)} />
          </div>
          <div className="relative">
            <MetaBox label="Tone" value={tone} Icon={Sparkles} onClick={() => setOpenPopover(openPopover === 'tone' ? null : 'tone')} />
            <OptionPopover open={openPopover === 'tone'} options={TONES} onPick={setTone} onClose={() => setOpenPopover(null)} />
          </div>
          <div className="relative">
            <MetaBox label="Visual Style" value={visualStyle} Icon={ImageIcon} onClick={() => setOpenPopover(openPopover === 'style' ? null : 'style')} />
            <OptionPopover open={openPopover === 'style'} options={VISUAL_STYLES} onPick={setVisualStyle} onClose={() => setOpenPopover(null)} />
          </div>
        </div>
      )}

      {/* Platforms */}
      <div className="flex items-center justify-center gap-4 py-4 mb-2">
        <span className="gravity-label">Platforms</span>
        <div className="flex items-center gap-2">
          {PLATFORMS.map(({ key, label, Icon }) => {
            const active = selectedPlatforms.includes(key);
            return (
              <button
                key={key}
                onClick={() => togglePlatform(key)}
                title={label}
                className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all ${
                  active
                    ? 'bg-white/[0.10] text-[#F5F4F1] border border-white/[0.14]'
                    : 'bg-transparent text-white/35 border border-white/[0.06] hover:text-white/70'
                }`}
              >
                <Icon className="w-4 h-4" />
              </button>
            );
          })}
        </div>
        {mode === 'campaign' && (
          <div className="ml-2 text-[12px] text-white/50">
            <span className="tabular-nums font-semibold text-[#F5F4F1]">~{estimate.total} posts</span>
            <span className="mx-1.5 text-white/25">·</span>
            <span>{estimate.perWeek} per week</span>
          </div>
        )}
      </div>

      {/* Aspect + logo — shown for BOTH modes. These used to be campaign-only
          (aspect) or missing entirely (logo), so single posts silently
          rendered 4:5 with no branding. */}
      <div className="max-w-2xl mx-auto mt-8 grid gap-4 sm:grid-cols-2">
        <div>
          <div className="gravity-label mb-2">Aspect ratio</div>
          <div className="flex gap-1.5">
            {ASPECTS.map((a) => {
              const active = visualStyle.startsWith(a.key);
              return (
                <button
                  key={a.key}
                  onClick={() => setAspect(a.key)}
                  title={a.hint}
                  className={`flex-1 rounded-lg border px-2 py-2 text-[12px] font-semibold transition-colors ${
                    active
                      ? 'border-[#F5A623] bg-[#F5A623]/12 text-[#F5A623]'
                      : 'border-white/[0.10] bg-white/[0.02] text-white/55 hover:text-white/85'
                  }`}
                >
                  {a.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="gravity-label mb-2">
            Logo {logos.length === 0 && <span className="text-white/30 normal-case">· none in Brand Assets</span>}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setSelectedLogo('')}
              className={`rounded-lg border px-3 py-2 text-[12px] font-semibold transition-colors ${
                !selectedLogo
                  ? 'border-[#F5A623] bg-[#F5A623]/12 text-[#F5A623]'
                  : 'border-white/[0.10] bg-white/[0.02] text-white/55 hover:text-white/85'
              }`}
            >
              No logo
            </button>
            {logos.map((l) => (
              <button
                key={l.id}
                onClick={() => setSelectedLogo(l.url)}
                title={l.name}
                className={`w-11 h-11 rounded-lg border overflow-hidden bg-white/[0.04] transition-colors ${
                  selectedLogo === l.url ? 'border-[#F5A623]' : 'border-white/[0.10] hover:border-white/30'
                }`}
              >
                <img src={l.url} alt={l.name} className="w-full h-full object-contain p-1" />
              </button>
            ))}
            {logos.length === 0 && (
              <button
                onClick={() => navigate('/brand-assets')}
                className="text-[11.5px] text-white/40 hover:text-[#F5A623] underline underline-offset-2"
              >
                Add one
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="text-center text-[13px] text-red-400 mb-4 mt-4">{error}</div>
      )}

      {/* Primary CTA */}
      <div className="flex flex-col items-center gap-3 mt-6">
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={handleDraft}
            disabled={submitting}
            className="flex items-center gap-2 h-12 px-8 rounded-xl bg-[#F5A623] hover:bg-[#ffb833] text-[#1A1208] text-[14.5px] font-semibold shadow-[0_10px_40px_rgba(245,166,35,0.30)] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Drafting…
              </>
            ) : (
              <>
                <Zap className="w-4 h-4" strokeWidth={2.5} />
                {mode === 'campaign' ? 'Draft my campaign' : 'Draft this post'}
              </>
            )}
          </button>
        </div>
        {submitting && progressMsg && (
          <div className="text-[12.5px] text-white/60 mt-1 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#F5A623] animate-pulse" />
            {progressMsg}
            {postsGenerated > 0 && (
              <span className="text-white/40">· {postsGenerated} draft{postsGenerated !== 1 ? 's' : ''} so far</span>
            )}
          </div>
        )}
      </div>

      {/* In-flight placeholders — the card appears immediately with the
          animation in it, then becomes the real draft when it lands. */}
      {pendingCards.length > 0 && (
        <div className="max-w-5xl mx-auto mt-14">
          <div className="text-center mb-10">
            <div className="gravity-label text-[#F5A623] mb-3">
              {mode === 'campaign' ? 'Building your campaign' : 'Drafting your post'}
            </div>
            <h2 className="text-[42px] leading-[1.1] font-semibold text-[#F5F4F1] tracking-[-0.02em]">
              Making something <em className="italic font-normal text-[#F5A623]">good</em>.
            </h2>
            {progressMsg && <p className="text-[13.5px] text-white/45 mt-3">{progressMsg}</p>}
          </div>
          <div className={`grid gap-4 ${pendingCards.length === 1 ? 'grid-cols-1 max-w-md mx-auto' : 'sm:grid-cols-2 lg:grid-cols-3'}`}>
            {pendingCards.map((_, i) => (
              <div key={i} className="rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
                <div className="relative bg-black" style={{ aspectRatio: backendAspect.replace(':', ' / ') }}>
                  <GeneratingFill prompt={description.trim() || name.trim()} resolution={backendAspect} />
                </div>
                <div className="p-3.5">
                  <div className="h-3 w-2/3 rounded bg-white/[0.07] animate-pulse" />
                  <div className="h-2.5 w-1/3 rounded bg-white/[0.05] animate-pulse mt-2.5" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Results — everything happens here now. No hop to /drafts. */}
      {results.length > 0 && (
        <div className="max-w-5xl mx-auto mt-14">
          <div className="relative text-center mb-10">
            <button
              onClick={() => { setResults([]); setActioned({}); setSchedulingId(''); }}
              className="absolute right-0 top-0 inline-flex items-center gap-1.5 rounded-lg border border-white/[0.12] px-3 py-2 text-[12px] text-white/60 hover:text-white hover:border-white/25 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Start over
            </button>

            <div className="gravity-label text-[#F5A623] mb-3">
              {results.length} variation{results.length !== 1 ? 's' : ''} · pick what you love
            </div>
            <h2 className="text-[42px] leading-[1.1] font-semibold text-[#F5F4F1] tracking-[-0.02em]">
              Here's what <em className="italic font-normal text-[#F5A623]">came back</em>.
            </h2>
            <p className="text-[13.5px] text-white/45 mt-3">
              {stillRendering
                ? 'Still rendering — this updates on its own.'
                : 'Edit or regenerate any of them. Approve to send to your queue. Discard to throw away.'}
            </p>
          </div>

          <div className={`grid gap-4 ${results.length === 1 ? 'grid-cols-1 max-w-md' : 'sm:grid-cols-2 lg:grid-cols-3'}`}>
            {results.map((d: any) => {
              const img = draftImage(d);
              const processing = String(d?.status || '').toLowerCase() === 'processing';
              const failed = String(d?.status || '').toLowerCase() === 'failed';
              const done = actioned[d._id];
              const busy = actionBusy === d._id;

              return (
                <div key={d._id} className="rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
                  <div className="relative bg-black/40" style={{ aspectRatio: backendAspect.replace(':', ' / ') }}>
                    {img ? (
                      <img src={img} alt={d.title || 'Draft'} className="w-full h-full object-contain" />
                    ) : failed ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                        <AlertCircle className="w-6 h-6 text-red-400" />
                        <span className="text-[11px] text-red-300">Image failed</span>
                      </div>
                    ) : (
                      <GeneratingFill prompt={d.imagePrompt || d.title || ''} resolution={backendAspect} />
                    )}
                  </div>

                  <div className="p-3.5">
                    {editingCaption === d._id ? (
                      <div className="space-y-2">
                        <textarea
                          value={captionDraft}
                          onChange={(e) => setCaptionDraft(e.target.value)}
                          rows={3}
                          className="w-full rounded-lg bg-black/40 border border-white/[0.12] px-2.5 py-2 text-[12.5px] text-[#F5F4F1] resize-none"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => saveCaption(d)}
                            disabled={captionBusy === d._id}
                            className="flex-1 rounded-lg bg-[#F5A623] text-black text-[11.5px] font-semibold py-1.5 disabled:opacity-50"
                          >
                            {captionBusy === d._id ? <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto" /> : 'Save'}
                          </button>
                          <button
                            onClick={() => setEditingCaption('')}
                            className="px-3 rounded-lg border border-white/[0.12] text-[11.5px] text-white/60"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-[12.5px] leading-snug text-[#F5F4F1]/90">
                          {d.caption || <span className="text-white/30 italic">No caption yet</span>}
                        </p>
                        <div className="flex items-center justify-between mt-2.5">
                          <div className="gravity-label text-white/35">
                            {backendAspect} · {mode === 'campaign' ? 'Campaign' : 'Editorial'}
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => generateCaption(d)}
                              disabled={captionBusy === d._id || !img}
                              title="Write a caption from this image"
                              className="p-1.5 rounded-md text-white/40 hover:text-[#F5A623] hover:bg-white/[0.06] disabled:opacity-30"
                            >
                              {captionBusy === d._id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                            </button>
                            <button
                              onClick={() => { setEditingCaption(d._id); setCaptionDraft(d.caption || ''); }}
                              title="Edit caption"
                              className="p-1.5 rounded-md text-white/40 hover:text-white hover:bg-white/[0.06]"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => regenerateImage(d)}
                              disabled={busy || processing}
                              title="Regenerate image"
                              className="p-1.5 rounded-md text-white/40 hover:text-white hover:bg-white/[0.06] disabled:opacity-30"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => discard(d)}
                              disabled={busy}
                              title="Discard"
                              className="p-1.5 rounded-md text-white/40 hover:text-red-400 hover:bg-white/[0.06] disabled:opacity-30"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </>
                    )}

                    {done ? (
                      <div className="mt-3 inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-emerald-400">
                        <Check className="w-3.5 h-3.5" />
                        {done === 'approved' ? 'Published' : done === 'scheduled' ? 'Scheduled' : 'Saved to drafts'}
                      </div>
                    ) : schedulingId === d._id ? (
                      <div className="mt-3 space-y-2">
                        <input
                          type="datetime-local"
                          value={scheduleFor}
                          onChange={(e) => setScheduleFor(e.target.value)}
                          className="w-full rounded-lg bg-black/40 border border-white/[0.12] px-2.5 py-1.5 text-[12px] text-[#F5F4F1]"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => scheduleNow(d)}
                            disabled={busy || !scheduleFor}
                            className="flex-1 rounded-lg bg-[#F5A623] text-black text-[11.5px] font-semibold py-1.5 disabled:opacity-50"
                          >
                            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto" /> : 'Confirm'}
                          </button>
                          <button
                            onClick={() => { setSchedulingId(''); setScheduleFor(''); }}
                            className="px-3 rounded-lg border border-white/[0.12] text-[11.5px] text-white/60"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <button
                          onClick={() => keepAsDraft(d)}
                          disabled={busy}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-white/[0.12] text-[11.5px] text-white/70 hover:bg-white/[0.05] disabled:opacity-50"
                        >
                          <Save className="w-3 h-3" /> Draft
                        </button>
                        <button
                          onClick={() => approveNow(d)}
                          disabled={busy || processing || !img}
                          title={processing ? 'Wait for the artwork' : 'Publish now'}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 text-[11.5px] font-semibold disabled:opacity-40"
                        >
                          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Approve
                        </button>
                        <button
                          onClick={() => { setSchedulingId(d._id); setScheduleFor(''); }}
                          disabled={busy || processing || !img}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#F5A623]/15 text-[#F5A623] text-[11.5px] font-semibold disabled:opacity-40"
                        >
                          <Clock className="w-3 h-3" /> Schedule
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer actions */}
          <div className="flex items-center justify-center gap-3 mt-10">
            <button
              onClick={handleDraft}
              disabled={submitting || stillRendering}
              className="inline-flex items-center gap-2 h-11 px-5 rounded-xl border border-white/[0.14] text-[13px] font-semibold text-white/75 hover:text-white hover:border-white/30 transition-colors disabled:opacity-40"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
              Generate {results.length || 4} more
            </button>
            <button
              onClick={sendAllToApproval}
              disabled={actionBusy === 'all' || stillRendering || results.every((d: any) => actioned[d._id])}
              className="inline-flex items-center gap-2 h-11 px-6 rounded-xl bg-[#F5A623] hover:bg-[#ffb833] text-[#1A1208] text-[13px] font-semibold shadow-[0_10px_40px_rgba(245,166,35,0.25)] transition-colors disabled:opacity-40"
            >
              {actionBusy === 'all' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" strokeWidth={2.5} />}
              Send all to approval
            </button>
          </div>
        </div>
      )}

    </div>
  );
};

export default GravityCreate;
