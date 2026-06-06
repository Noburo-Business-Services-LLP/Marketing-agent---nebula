import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  CheckCircle2,
  Copy,
  FileText,
  Gauge,
  Globe2,
  Hash,
  History,
  Lightbulb,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  TrendingUp
} from 'lucide-react';
import { seoAPI } from '../services/api';
import { useTheme, getThemeClasses } from '../context/ThemeContext';

type SeoTab = 'dashboard' | 'keywords' | 'metadata' | 'hashtags' | 'competitor';

const tabConfig: Array<{ id: SeoTab; label: string; path: string; icon: React.ElementType }> = [
  { id: 'dashboard', label: 'Dashboard', path: '/seo', icon: Gauge },
  { id: 'keywords', label: 'Keyword Research', path: '/seo/keywords', icon: Search },
  { id: 'metadata', label: 'Metadata', path: '/seo/metadata', icon: FileText },
  { id: 'hashtags', label: 'Hashtags', path: '/seo/hashtags', icon: Hash },
  { id: 'competitor', label: 'Competitors', path: '/seo/competitor', icon: Globe2 }
];

const reportTypeLabels: Record<string, string> = {
  keyword_research: 'Keyword Research',
  metadata: 'Metadata',
  hashtags: 'Hashtags',
  competitor_analysis: 'Competitor Analysis',
  dashboard: 'Dashboard'
};

const getTabFromPath = (pathname: string): SeoTab => {
  if (pathname.includes('/seo/keywords')) return 'keywords';
  if (pathname.includes('/seo/metadata')) return 'metadata';
  if (pathname.includes('/seo/hashtags')) return 'hashtags';
  if (pathname.includes('/seo/competitor')) return 'competitor';
  return 'dashboard';
};

const ScoreCard: React.FC<{ label: string; value: number; icon: React.ElementType }> = ({ label, value, icon: Icon }) => {
  const { isDarkMode } = useTheme();
  const score = Math.max(0, Math.min(100, Number(value || 0)));
  return (
    <div className={`rounded-lg border p-4 ${isDarkMode ? 'bg-[#0f1419] border-slate-700/50' : 'bg-white border-slate-200'}`}>
      <div className="flex items-center justify-between gap-3">
        <span className={isDarkMode ? 'text-sm text-slate-400' : 'text-sm text-slate-500'}>{label}</span>
        <Icon className="h-5 w-5 text-[#ffcc29]" />
      </div>
      <div className="mt-3 flex items-end justify-between gap-4">
        <div className={isDarkMode ? 'text-3xl font-bold text-white' : 'text-3xl font-bold text-slate-950'}>{score}</div>
        <div className={isDarkMode ? 'text-xs text-slate-500' : 'text-xs text-slate-500'}>/100</div>
      </div>
      <div className={isDarkMode ? 'mt-3 h-2 rounded-full bg-slate-800' : 'mt-3 h-2 rounded-full bg-slate-100'}>
        <div className="h-full rounded-full bg-[#ffcc29]" style={{ width: `${score}%` }} />
      </div>
    </div>
  );
};

const Panel: React.FC<{ title: string; icon?: React.ElementType; children: React.ReactNode; className?: string }> = ({ title, icon: Icon, children, className = '' }) => {
  const { isDarkMode } = useTheme();
  const theme = getThemeClasses(isDarkMode);
  return (
    <section className={`rounded-lg border p-5 ${theme.bgCard} ${theme.border} ${className}`}>
      <div className="mb-4 flex items-center gap-2">
        {Icon && <Icon className="h-5 w-5 text-[#ffcc29]" />}
        <h2 className={`font-semibold ${theme.text}`}>{title}</h2>
      </div>
      {children}
    </section>
  );
};

const ChipList: React.FC<{ items?: string[]; empty?: string }> = ({ items = [], empty = 'No items yet.' }) => {
  const { isDarkMode } = useTheme();
  if (!items.length) {
    return <p className={isDarkMode ? 'text-sm text-slate-500' : 'text-sm text-slate-500'}>{empty}</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span key={item} className={isDarkMode ? 'rounded-full bg-[#ffcc29]/10 px-3 py-1 text-sm text-[#ffcc29]' : 'rounded-full bg-[#ffcc29]/30 px-3 py-1 text-sm text-[#070A12]'}>
          {item}
        </span>
      ))}
    </div>
  );
};

const CopyButton: React.FC<{ value: string; label?: string }> = ({ value, label = 'Copy' }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(value || '');
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };
  return (
    <button type="button" onClick={handleCopy} className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#ffcc29]/50 px-3 py-2 text-xs font-semibold text-[#ffcc29] hover:bg-[#ffcc29]/10">
      <Copy className="h-3.5 w-3.5" />
      {copied ? 'Copied' : label}
    </button>
  );
};

const Recommendations: React.FC<{ items?: string[] }> = ({ items = [] }) => {
  const { isDarkMode } = useTheme();
  const theme = getThemeClasses(isDarkMode);
  return (
    <div className="space-y-2">
      {items.length ? items.map((item) => (
        <div key={item} className={`flex gap-3 rounded-lg p-3 ${isDarkMode ? 'bg-slate-900/70' : 'bg-slate-50'}`}>
          <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#ffcc29]" />
          <p className={`text-sm ${theme.textSecondary}`}>{item}</p>
        </div>
      )) : (
        <p className={theme.textMuted}>Run an SEO tool to generate recommendations.</p>
      )}
    </div>
  );
};

const LoadingButton: React.FC<{ loading: boolean; children: React.ReactNode; disabled?: boolean }> = ({ loading, children, disabled }) => (
  <button
    type="submit"
    disabled={loading || disabled}
    className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#ffcc29] px-4 py-2.5 text-sm font-semibold text-[#070A12] transition hover:bg-[#e6b825] disabled:cursor-not-allowed disabled:opacity-60"
  >
    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
    {children}
  </button>
);

const SEOAssistant: React.FC = () => {
  const { isDarkMode } = useTheme();
  const theme = getThemeClasses(isDarkMode);
  const location = useLocation();
  const navigate = useNavigate();
  const activeTab = getTabFromPath(location.pathname);

  const [dashboard, setDashboard] = useState<any>(null);
  const [reports, setReports] = useState<any[]>([]);
  const [loadingDashboard, setLoadingDashboard] = useState(true);

  const [keywordTopic, setKeywordTopic] = useState('');
  const [keywordResult, setKeywordResult] = useState<any>(null);
  const [keywordLoading, setKeywordLoading] = useState(false);

  const [metadataTopic, setMetadataTopic] = useState('');
  const [pageType, setPageType] = useState('landing page');
  const [focusKeyword, setFocusKeyword] = useState('');
  const [metadataResult, setMetadataResult] = useState<any>(null);
  const [metadataLoading, setMetadataLoading] = useState(false);

  const [hashtagContent, setHashtagContent] = useState('');
  const [selectedPlatforms, setSelectedPlatforms] = useState(['facebook', 'instagram', 'linkedin', 'x', 'youtube']);
  const [hashtagResult, setHashtagResult] = useState<any>(null);
  const [hashtagLoading, setHashtagLoading] = useState(false);

  const [competitorUrl, setCompetitorUrl] = useState('');
  const [competitorResult, setCompetitorResult] = useState<any>(null);
  const [competitorLoading, setCompetitorLoading] = useState(false);
  const [error, setError] = useState('');

  const scores = dashboard?.scores || { seo: 0, content: 0, hashtag: 0, competitor: 0 };

  const refreshDashboard = async () => {
    setLoadingDashboard(true);
    try {
      const [dashboardRes, reportsRes] = await Promise.all([
        seoAPI.getDashboard(),
        seoAPI.getReports()
      ]);
      setDashboard(dashboardRes.data);
      setReports(reportsRes.reports || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load SEO dashboard');
    } finally {
      setLoadingDashboard(false);
    }
  };

  useEffect(() => {
    refreshDashboard();
  }, []);

  const latestRecommendations = useMemo(() => {
    const fromResults = [
      ...(keywordResult?.recommendations || []),
      ...(metadataResult?.recommendations || []),
      ...(hashtagResult?.recommendations || []),
      ...(competitorResult?.recommendations || [])
    ];
    return fromResults.length ? fromResults.slice(0, 8) : (dashboard?.recommendations || []);
  }, [keywordResult, metadataResult, hashtagResult, competitorResult, dashboard]);

  const handleKeywordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keywordTopic.trim()) return;
    setKeywordLoading(true);
    setError('');
    try {
      const res = await seoAPI.keywordResearch({ topic: keywordTopic.trim() });
      setKeywordResult(res.data);
      await refreshDashboard();
    } catch (err: any) {
      setError(err.message || 'Failed to generate keyword research');
    } finally {
      setKeywordLoading(false);
    }
  };

  const handleMetadataSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!metadataTopic.trim()) return;
    setMetadataLoading(true);
    setError('');
    try {
      const res = await seoAPI.generateMetadata({
        topic: metadataTopic.trim(),
        pageType,
        focusKeyword: focusKeyword.trim()
      });
      setMetadataResult(res.data);
      await refreshDashboard();
    } catch (err: any) {
      setError(err.message || 'Failed to generate metadata');
    } finally {
      setMetadataLoading(false);
    }
  };

  const handleHashtagSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hashtagContent.trim()) return;
    setHashtagLoading(true);
    setError('');
    try {
      const res = await seoAPI.generateHashtags({
        content: hashtagContent.trim(),
        platforms: selectedPlatforms
      });
      setHashtagResult(res.data);
      await refreshDashboard();
    } catch (err: any) {
      setError(err.message || 'Failed to generate hashtags');
    } finally {
      setHashtagLoading(false);
    }
  };

  const handleCompetitorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!competitorUrl.trim()) return;
    setCompetitorLoading(true);
    setError('');
    try {
      const res = await seoAPI.analyzeCompetitor({ competitorUrl: competitorUrl.trim() });
      setCompetitorResult(res.data);
      await refreshDashboard();
    } catch (err: any) {
      setError(err.message || 'Failed to analyze competitor');
    } finally {
      setCompetitorLoading(false);
    }
  };

  const togglePlatform = (platform: string) => {
    setSelectedPlatforms(prev => (
      prev.includes(platform)
        ? prev.filter(item => item !== platform)
        : [...prev, platform]
    ));
  };

  const inputClass = `w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition ${theme.input}`;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className={`text-2xl font-bold ${theme.text}`}>AI SEO Assistant</h1>
          <p className={theme.textSecondary}>Optimize visibility across websites, campaigns, and social posts.</p>
        </div>
        <button type="button" onClick={refreshDashboard} className={`inline-flex items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold ${theme.btnOutline}`}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {tabConfig.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <Link
              key={tab.id}
              to={tab.path}
              className={`inline-flex flex-shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                active ? 'bg-[#ffcc29] text-[#070A12]' : isDarkMode ? 'bg-[#0f1419] text-slate-300 hover:bg-slate-800' : 'bg-white text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </Link>
          );
        })}
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>
      )}

      {(activeTab === 'dashboard' || loadingDashboard) && (
        <div className="space-y-5">
          {loadingDashboard ? (
            <Panel title="Loading SEO Dashboard" icon={Loader2}>
              <p className={theme.textMuted}>Loading scores and recent SEO intelligence...</p>
            </Panel>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-4">
                <ScoreCard label="SEO Score" value={scores.seo} icon={Gauge} />
                <ScoreCard label="Content Score" value={scores.content} icon={FileText} />
                <ScoreCard label="Hashtag Score" value={scores.hashtag} icon={Hash} />
                <ScoreCard label="Competitor Score" value={scores.competitor} icon={TrendingUp} />
              </div>
              <div className="grid gap-4 lg:grid-cols-3">
                <Panel title="Growth Recommendations" icon={Lightbulb} className="lg:col-span-2">
                  <Recommendations items={latestRecommendations} />
                </Panel>
                <Panel title="Saved Reports" icon={History}>
                  <div className="space-y-3">
                    {reports.slice(0, 6).map((report) => (
                      <button
                        key={report._id || `${report.reportType}-${report.createdAt}`}
                        type="button"
                        onClick={() => {
                          const target = report.reportType === 'keyword_research' ? '/seo/keywords' : report.reportType === 'competitor_analysis' ? '/seo/competitor' : `/seo/${report.reportType}`;
                          navigate(target);
                        }}
                        className={`w-full rounded-lg p-3 text-left ${isDarkMode ? 'bg-slate-900/70 hover:bg-slate-800' : 'bg-slate-50 hover:bg-slate-100'}`}
                      >
                        <div className={`text-sm font-semibold ${theme.text}`}>{reportTypeLabels[report.reportType] || report.reportType}</div>
                        <div className={`mt-1 line-clamp-1 text-xs ${theme.textMuted}`}>{report.query}</div>
                      </button>
                    ))}
                    {!reports.length && <p className={theme.textMuted}>Generated keyword, metadata, hashtag, and competitor reports will appear here.</p>}
                  </div>
                </Panel>
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === 'keywords' && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title="Keyword Research" icon={Search}>
            <form className="space-y-4" onSubmit={handleKeywordSubmit}>
              <input className={inputClass} value={keywordTopic} onChange={(e) => setKeywordTopic(e.target.value)} placeholder="Business, product, campaign, or topic" />
              <LoadingButton loading={keywordLoading}>Generate Keywords</LoadingButton>
            </form>
          </Panel>
          <Panel title="Keyword Report" icon={BarChart3} className="lg:col-span-2">
            {keywordResult ? (
              <div className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <h3 className={`mb-2 text-sm font-semibold ${theme.text}`}>Primary Keywords</h3>
                    <ChipList items={keywordResult.primaryKeywords} />
                  </div>
                  <div>
                    <h3 className={`mb-2 text-sm font-semibold ${theme.text}`}>Related Keywords</h3>
                    <ChipList items={keywordResult.relatedKeywords} />
                  </div>
                  <div>
                    <h3 className={`mb-2 text-sm font-semibold ${theme.text}`}>Long-tail Keywords</h3>
                    <ChipList items={keywordResult.longTailKeywords} />
                  </div>
                  <div className={`rounded-lg p-4 ${isDarkMode ? 'bg-slate-900/70' : 'bg-slate-50'}`}>
                    <div className={theme.textMuted}>Search Intent</div>
                    <div className={`mt-1 font-semibold ${theme.text}`}>{keywordResult.searchIntent}</div>
                    <div className="mt-3 text-sm text-[#ffcc29]">Difficulty: {keywordResult.keywordDifficulty}/100</div>
                  </div>
                </div>
                <Recommendations items={keywordResult.recommendations} />
              </div>
            ) : <p className={theme.textMuted}>Enter a topic to generate primary, related, and long-tail keyword ideas.</p>}
          </Panel>
        </div>
      )}

      {activeTab === 'metadata' && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title="Metadata Generator" icon={FileText}>
            <form className="space-y-4" onSubmit={handleMetadataSubmit}>
              <input className={inputClass} value={metadataTopic} onChange={(e) => setMetadataTopic(e.target.value)} placeholder="Website page, blog, product, or campaign" />
              <select className={inputClass} value={pageType} onChange={(e) => setPageType(e.target.value)}>
                <option value="landing page">Landing page</option>
                <option value="blog">Blog</option>
                <option value="product page">Product page</option>
                <option value="campaign page">Campaign page</option>
              </select>
              <input className={inputClass} value={focusKeyword} onChange={(e) => setFocusKeyword(e.target.value)} placeholder="Optional focus keyword" />
              <LoadingButton loading={metadataLoading}>Generate Metadata</LoadingButton>
            </form>
          </Panel>
          <Panel title="Generated Metadata" icon={Sparkles} className="lg:col-span-2">
            {metadataResult ? (
              <div className="space-y-4">
                {[
                  ['SEO Title', metadataResult.seoTitle],
                  ['Meta Description', metadataResult.metaDescription],
                  ['Focus Keyword', metadataResult.focusKeyword]
                ].map(([label, value]) => (
                  <div key={label} className={`rounded-lg p-4 ${isDarkMode ? 'bg-slate-900/70' : 'bg-slate-50'}`}>
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className={`text-sm font-semibold ${theme.text}`}>{label}</span>
                      <CopyButton value={String(value || '')} />
                    </div>
                    <p className={theme.textSecondary}>{value}</p>
                  </div>
                ))}
                <div>
                  <h3 className={`mb-2 text-sm font-semibold ${theme.text}`}>URL Slug Suggestions</h3>
                  <ChipList items={metadataResult.urlSlugSuggestions} />
                </div>
                <Recommendations items={metadataResult.recommendations} />
              </div>
            ) : <p className={theme.textMuted}>Generate titles, descriptions, focus keywords, and URL slug ideas.</p>}
          </Panel>
        </div>
      )}

      {activeTab === 'hashtags' && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title="AI Hashtag Generator" icon={Hash}>
            <form className="space-y-4" onSubmit={handleHashtagSubmit}>
              <textarea className={`${inputClass} min-h-32 resize-none`} value={hashtagContent} onChange={(e) => setHashtagContent(e.target.value)} placeholder="Paste post content or describe your campaign" />
              <div className="grid grid-cols-2 gap-2">
                {['facebook', 'instagram', 'linkedin', 'x', 'youtube'].map(platform => (
                  <button
                    key={platform}
                    type="button"
                    onClick={() => togglePlatform(platform)}
                    className={`rounded-lg border px-3 py-2 text-sm font-semibold capitalize ${selectedPlatforms.includes(platform) ? 'border-[#ffcc29] bg-[#ffcc29] text-[#070A12]' : theme.btnOutline}`}
                  >
                    {platform}
                  </button>
                ))}
              </div>
              <LoadingButton loading={hashtagLoading} disabled={!selectedPlatforms.length}>Generate Hashtags</LoadingButton>
            </form>
          </Panel>
          <Panel title="Platform Hashtags" icon={TrendingUp} className="lg:col-span-2">
            {hashtagResult ? (
              <div className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  {Object.entries(hashtagResult.platformHashtags || {}).map(([platform, tags]: [string, any]) => (
                    <div key={platform} className={`rounded-lg p-4 ${isDarkMode ? 'bg-slate-900/70' : 'bg-slate-50'}`}>
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <h3 className={`text-sm font-semibold capitalize ${theme.text}`}>{platform}</h3>
                        <CopyButton value={(tags || []).join(' ')} />
                      </div>
                      <ChipList items={tags || []} />
                    </div>
                  ))}
                </div>
                <div>
                  <h3 className={`mb-2 text-sm font-semibold ${theme.text}`}>Trending and Relevant</h3>
                  <ChipList items={[...(hashtagResult.trending || []), ...(hashtagResult.relevant || [])]} />
                </div>
                <Recommendations items={hashtagResult.recommendations} />
              </div>
            ) : <p className={theme.textMuted}>Generate platform-specific hashtags for Facebook, Instagram, LinkedIn, X, and YouTube.</p>}
          </Panel>
        </div>
      )}

      {activeTab === 'competitor' && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title="Competitor Analysis" icon={Globe2}>
            <form className="space-y-4" onSubmit={handleCompetitorSubmit}>
              <input className={inputClass} value={competitorUrl} onChange={(e) => setCompetitorUrl(e.target.value)} placeholder="https://competitor.com" />
              <LoadingButton loading={competitorLoading}>Analyze Competitor</LoadingButton>
            </form>
          </Panel>
          <Panel title="Competitor Insights" icon={BarChart3} className="lg:col-span-2">
            {competitorResult ? (
              <div className="space-y-5">
                <div>
                  <h3 className={`mb-2 text-sm font-semibold ${theme.text}`}>Competitor Keywords</h3>
                  <ChipList items={competitorResult.competitorKeywords} />
                </div>
                <div className={`rounded-lg p-4 ${isDarkMode ? 'bg-slate-900/70' : 'bg-slate-50'}`}>
                  <div className={theme.textMuted}>Content Strategy</div>
                  <p className={`mt-1 ${theme.textSecondary}`}>{competitorResult.contentStrategy}</p>
                  <div className="mt-3 text-sm text-[#ffcc29]">Posting Frequency: {competitorResult.postingFrequency}</div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <h3 className={`mb-2 text-sm font-semibold ${theme.text}`}>SEO Opportunities</h3>
                    <Recommendations items={competitorResult.seoOpportunities} />
                  </div>
                  <div>
                    <h3 className={`mb-2 text-sm font-semibold ${theme.text}`}>Content Recommendations</h3>
                    <Recommendations items={competitorResult.contentRecommendations} />
                  </div>
                </div>
              </div>
            ) : <p className={theme.textMuted}>Analyze a competitor URL to identify keyword gaps, content strategy, and SEO opportunities.</p>}
          </Panel>
        </div>
      )}
    </div>
  );
};

export default SEOAssistant;
