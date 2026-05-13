import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Brain, Database, Hash, Megaphone, PlayCircle, TrendingUp, Copy, RefreshCw } from 'lucide-react';
import { aiMemoryAPI } from '../services/api';
import { useTheme, getThemeClasses } from '../context/ThemeContext';

const StatCard: React.FC<{ icon: React.ElementType; label: string; value: string | number }> = ({ icon: Icon, label, value }) => {
  const { isDarkMode } = useTheme();
  return (
    <div className={`p-4 rounded-lg border ${isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-white border-slate-200'}`}>
      <div className="flex items-center justify-between">
        <span className={isDarkMode ? 'text-slate-400' : 'text-slate-500'}>{label}</span>
        <Icon className="w-5 h-5 text-[#ffcc29]" />
      </div>
      <div className={`mt-3 text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{value}</div>
    </div>
  );
};

const AIMemory: React.FC = () => {
  const { isDarkMode } = useTheme();
  const tc = getThemeClasses(isDarkMode);
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
    return <div className={`p-8 ${tc.text}`}>Loading AI memory...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className={`text-2xl font-bold ${tc.text}`}>AI Memory</h1>
          <p className={tc.textMuted}>Create, store, learn, and reuse content intelligence across Nebulaa.</p>
        </div>
        <button onClick={load} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#ffcc29] px-4 py-2 font-semibold text-black">
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard icon={Megaphone} label="Campaign memories" value={summary.campaignMemories || 0} />
        <StatCard icon={PlayCircle} label="Video memories" value={summary.videoMemories || 0} />
        <StatCard icon={TrendingUp} label="Performance records" value={summary.performanceMemories || 0} />
        <StatCard icon={Database} label="Vector status" value={summary.embeddingReady?.status || 'ready'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className={`rounded-lg border p-5 lg:col-span-2 ${isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-white border-slate-200'}`}>
          <div className="flex items-center justify-between gap-3">
            <h2 className={`font-semibold ${tc.text}`}>Brand Intelligence</h2>
            <Brain className="w-5 h-5 text-[#ffcc29]" />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {[
              ['Tone', summary.brandTone],
              ['Writing', summary.writingStyle || 'learning'],
              ['CTA style', summary.ctaStyle || 'learning'],
              ['Visual style', summary.visualStyle || 'learning']
            ].map(([label, value]) => (
              <div key={label} className={`rounded-lg p-3 ${isDarkMode ? 'bg-slate-900/70' : 'bg-slate-50'}`}>
                <div className={tc.textMuted}>{label}</div>
                <div className={`mt-1 font-semibold ${tc.text}`}>{value || 'learning'}</div>
              </div>
            ))}
          </div>
        </section>

        <section className={`rounded-lg border p-5 ${isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-white border-slate-200'}`}>
          <h2 className={`font-semibold ${tc.text}`}>Best Hashtags</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {bestHashtags.length ? bestHashtags.slice(0, 18).map((tag: string) => (
              <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-[#ffcc29]/15 px-3 py-1 text-sm text-[#d4a800]">
                <Hash className="w-3 h-3" />
                {tag.replace(/^#/, '')}
              </span>
            )) : <p className={tc.textMuted}>Hashtag memory will appear after generation and analytics.</p>}
          </div>
        </section>
      </div>

      <section className={`rounded-lg border p-5 ${isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-white border-slate-200'}`}>
        <div className="flex items-center justify-between gap-3">
          <h2 className={`font-semibold ${tc.text}`}>Reusable AI Context</h2>
          <button onClick={copyContext} className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${isDarkMode ? 'border-slate-700 text-slate-200' : 'border-slate-200 text-slate-700'}`}>
            <Copy className="w-4 h-4" />
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <pre className={`mt-4 max-h-56 overflow-auto rounded-lg p-4 text-sm whitespace-pre-wrap ${isDarkMode ? 'bg-slate-950 text-slate-300' : 'bg-slate-50 text-slate-700'}`}>
          {data?.reusableContext || 'No memory context generated yet.'}
        </pre>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <Link to="/ai-history" className="rounded-lg bg-[#ffcc29] p-4 font-semibold text-black">View campaign history</Link>
        <Link to="/ai-history?type=video" className={`rounded-lg border p-4 font-semibold ${tc.text} ${isDarkMode ? 'border-slate-700' : 'border-slate-200'}`}>View video history</Link>
        <Link to="/ai-performance" className={`rounded-lg border p-4 font-semibold ${tc.text} ${isDarkMode ? 'border-slate-700' : 'border-slate-200'}`}>View performance learning</Link>
      </div>
    </div>
  );
};

export default AIMemory;
