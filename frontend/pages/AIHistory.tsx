import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Copy, ImageIcon, PlayCircle, Search } from 'lucide-react';
import { aiMemoryAPI } from '../services/api';
import { useTheme, getThemeClasses } from '../context/ThemeContext';

const AIHistory: React.FC = () => {
  const { isDarkMode } = useTheme();
  const tc = getThemeClasses(isDarkMode);
  const [params] = useSearchParams();
  const [type, setType] = useState<'campaign' | 'video'>(params.get('type') === 'video' ? 'video' : 'campaign');
  const [platform, setPlatform] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = type === 'video'
        ? await aiMemoryAPI.getVideoHistory({ limit: 50 })
        : await aiMemoryAPI.getCampaignHistory({ platform: platform || undefined, limit: 50 });
      setItems(res.items || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [type, platform]);

  const reuse = async (id: string) => {
    const res = await aiMemoryAPI.reuseMemory(type, id);
    await navigator.clipboard.writeText(res.prompt || '');
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className={`text-2xl font-bold ${tc.text}`}>AI History</h1>
          <p className={tc.textMuted}>Review prompts, captions, generated assets, scripts, scenes, and reusable outputs.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setType('campaign')} className={`rounded-lg px-4 py-2 font-semibold ${type === 'campaign' ? 'bg-[#ffcc29] text-black' : `${tc.bgCard} ${tc.text}`}`}>Campaigns</button>
          <button onClick={() => setType('video')} className={`rounded-lg px-4 py-2 font-semibold ${type === 'video' ? 'bg-[#ffcc29] text-black' : `${tc.bgCard} ${tc.text}`}`}>Videos</button>
        </div>
      </div>

      {type === 'campaign' && (
        <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-white border-slate-200'}`}>
          <Search className="w-4 h-4 text-slate-400" />
          <select value={platform} onChange={(e) => setPlatform(e.target.value)} className={`w-full bg-transparent outline-none ${tc.text}`}>
            <option value="">All platforms</option>
            <option value="instagram">Instagram</option>
            <option value="facebook">Facebook</option>
            <option value="linkedin">LinkedIn</option>
            <option value="twitter">X / Twitter</option>
          </select>
        </div>
      )}

      {loading ? (
        <div className={tc.text}>Loading history...</div>
      ) : (
        <div className="grid gap-4">
          {items.map((item) => (
            <article key={item._id} className={`rounded-lg border p-5 ${isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-white border-slate-200'}`}>
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className={`flex items-center gap-2 text-sm ${tc.textMuted}`}>
                    {type === 'video' ? <PlayCircle className="w-4 h-4" /> : <ImageIcon className="w-4 h-4" />}
                    <span>{item.action}</span>
                    <span>{new Date(item.createdAt).toLocaleString()}</span>
                  </div>
                  <h2 className={`mt-2 font-semibold ${tc.text}`}>{item.campaignName || item.jobId || item.userInput?.description || 'AI memory item'}</h2>
                </div>
                <button onClick={() => reuse(item._id)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#ffcc29] px-3 py-2 text-sm font-semibold text-black">
                  <Copy className="w-4 h-4" />
                  Reuse prompt
                </button>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div>
                  <p className={`text-xs uppercase ${tc.textMuted}`}>Prompt</p>
                  <p className={`mt-1 line-clamp-4 text-sm ${tc.text}`}>{item.prompt || item.script || 'No prompt stored'}</p>
                </div>
                <div>
                  <p className={`text-xs uppercase ${tc.textMuted}`}>Output</p>
                  <p className={`mt-1 line-clamp-4 text-sm ${tc.text}`}>
                    {(item.generatedCaptions || item.captions || []).join('\n\n') || item.script || 'No output stored'}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {(item.hashtags || []).slice(0, 12).map((tag: string) => (
                  <span key={tag} className="rounded-full bg-[#ffcc29]/15 px-3 py-1 text-sm text-[#d4a800]">{tag}</span>
                ))}
              </div>
            </article>
          ))}
          {!items.length && <div className={tc.textMuted}>No AI history yet. Generate a campaign or video to create memory.</div>}
        </div>
      )}
    </div>
  );
};

export default AIHistory;
