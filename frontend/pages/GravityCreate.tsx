import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, Layers, Calendar as CalendarIcon, Zap, Image as ImageIcon, Instagram, Facebook, Linkedin, ChevronRight, Loader2 } from 'lucide-react';
import { apiService } from '../services/api';

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

  // Single-post mode — quick create via the existing createCampaign API,
  // then land in Approve to review + tweak the draft.
  const handleDraftSinglePost = async () => {
    await apiService.createCampaign({
      name: name.trim() || 'Untitled post',
      objective: 'engagement',
      platforms: selectedPlatforms,
      status: 'draft',
      creative: {
        type: 'image',
        textContent: description.trim() || name.trim() || 'Untitled post',
        imageUrls: [],
        captions: '',
      },
      scheduling: { startDate: new Date().toISOString(), frequency: 'once' as any },
      tone,
      aiGenerated: true,
    } as any);
    navigate('/drafts');
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
    navigate('/drafts');
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

      {/* Name + Description card */}
      <div
        className="relative rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 mb-5 overflow-hidden"
        style={{ boxShadow: '0 0 80px rgba(245,166,35,0.04)' }}
      >
        {/* Ambient interior glow */}
        <div className="pointer-events-none absolute inset-0 -z-0" style={{ background: 'radial-gradient(60% 100% at 50% 100%, rgba(245,166,35,0.06) 0%, transparent 60%)' }} />
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

      {/* Error */}
      {error && (
        <div className="text-center text-[13px] text-red-400 mb-4">{error}</div>
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
          <div className="hidden md:flex items-center gap-1.5 text-[11px] text-white/40">
            <kbd className="inline-flex items-center gap-0.5 h-6 px-1.5 rounded bg-white/[0.06] border border-white/[0.08] text-[10px] font-semibold text-white/70">
              ⌘↵
            </kbd>
            <span>to launch</span>
          </div>
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

      {/* Escape hatch to old page */}
      <div className="text-center mt-14">
        <button
          onClick={() => navigate('/campaigns-classic')}
          className="text-[12px] text-white/35 hover:text-white/60 inline-flex items-center gap-1"
        >
          <span>Browse all campaigns</span>
          <ChevronRight className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};

export default GravityCreate;
