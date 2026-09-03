import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Brain, Database, Hash, Megaphone, PlayCircle, TrendingUp, Copy, RefreshCw, Loader2, ArrowRight } from 'lucide-react';
import { aiMemoryAPI } from '../services/api';
import {
  GravityHero,
  GravityEmphasis,
  GravityLabel,
  GravityButton,
} from '../components/gravity';

const StatCard: React.FC<{ icon: React.ElementType; label: string; value: string | number }> = ({ icon: Icon, label, value }) => {
  // Counts earn the display size; a status string like "metadata_ready" would
  // just overflow the card at 26px, so it drops to body size instead.
  const isCount = typeof value === 'number' || /^\d+$/.test(String(value));
  return (
    <div className="p-5 rounded-xl border border-white/[0.06] bg-white/[0.02] min-w-0">
      <div className="flex items-center justify-between gap-3">
        <GravityLabel>{label}</GravityLabel>
        <Icon className="w-4 h-4 text-[#F5A623] flex-shrink-0" />
      </div>
      <div
        className={`mt-3 text-[#F5F4F1] truncate ${isCount ? 'text-[26px] font-serif-display leading-none' : 'text-[14px] font-semibold'}`}
        title={String(value)}
      >
        {value}
      </div>
    </div>
  );
};

const Panel: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <section className={`rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 ${className}`}>{children}</section>
);

const AIMemory: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await aiMemoryAPI.getSummary();
      setData(res);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const summary = data?.summary || {};
  const bestHashtags = useMemo(() => summary.bestHashtags || [], [summary.bestHashtags]);

  const copyContext = async () => {
    await navigator.clipboard.writeText(data?.reusableContext || '');
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#F5A623]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <GravityHero
          align="left"
          eyebrow="AI Memory"
          headline={<>What Gravity has <GravityEmphasis>learned</GravityEmphasis></>}
          subcopy="Create, store, learn, and reuse content intelligence across Nebulaa."
          className="!mb-0"
        />
        <GravityButton variant="ghost" onClick={load} className="flex-shrink-0">
          <RefreshCw className="w-4 h-4 text-[#F5A623]" />
          Refresh
        </GravityButton>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <StatCard icon={Megaphone} label="Campaign memories" value={summary.campaignMemories || 0} />
        <StatCard icon={PlayCircle} label="Video memories" value={summary.videoMemories || 0} />
        <StatCard icon={TrendingUp} label="Performance records" value={summary.performanceMemories || 0} />
        <StatCard icon={Database} label="Vector status" value={summary.embeddingReady?.status || 'ready'} />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <div className="flex items-center justify-between gap-3 mb-4">
            <GravityLabel gold>Brand Intelligence</GravityLabel>
            <Brain className="w-4 h-4 text-[#F5A623]" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ['Tone', summary.brandTone],
              ['Writing', summary.writingStyle || 'learning'],
              ['CTA style', summary.ctaStyle || 'learning'],
              ['Visual style', summary.visualStyle || 'learning']
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3.5">
                <GravityLabel>{label}</GravityLabel>
                <div className="mt-1 text-[14px] font-semibold text-[#F5F4F1]">{value || 'learning'}</div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <div className="flex items-center justify-between gap-3 mb-4">
            <GravityLabel gold>Best Hashtags</GravityLabel>
            <Hash className="w-4 h-4 text-[#F5A623]" />
          </div>
          <div className="flex flex-wrap gap-2">
            {bestHashtags.length ? bestHashtags.slice(0, 18).map((tag: string) => (
              <span key={tag} className="inline-flex items-center gap-1 rounded-full border border-[#F5A623]/25 bg-[#F5A623]/[0.08] px-2.5 py-1 text-[12px] text-[#F5A623]">
                <Hash className="w-3 h-3" />
                {tag.replace(/^#/, '')}
              </span>
            )) : (
              <p className="text-[12.5px] text-white/45">Hashtag memory will appear after generation and analytics.</p>
            )}
          </div>
        </Panel>
      </div>

      <Panel>
        <div className="flex items-center justify-between gap-3 mb-4">
          <GravityLabel gold>Reusable AI Context</GravityLabel>
          <GravityButton variant="ghost" onClick={copyContext} className="!px-3 !py-1.5 !text-[12px]">
            <Copy className="w-3.5 h-3.5" />
            {copied ? 'Copied' : 'Copy'}
          </GravityButton>
        </div>
        <pre className="max-h-56 overflow-auto rounded-lg border border-white/[0.06] bg-black/30 p-4 text-[12.5px] leading-relaxed text-white/70 whitespace-pre-wrap">
          {data?.reusableContext || 'No memory context generated yet.'}
        </pre>
      </Panel>

      <div className="grid gap-3 md:grid-cols-3">
        {[
          { to: '/ai-history', label: 'Campaign history' },
          { to: '/ai-history?type=video', label: 'Video history' },
          { to: '/ai-performance', label: 'Performance learning' },
        ].map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className="group flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-5 py-4 text-[13.5px] font-semibold text-[#F5F4F1] transition-all hover:bg-white/[0.05] hover:border-white/[0.12]"
          >
            {link.label}
            <ArrowRight className="w-4 h-4 text-white/30 group-hover:text-[#F5A623] transition-colors" />
          </Link>
        ))}
      </div>
    </div>
  );
};

export default AIMemory;
