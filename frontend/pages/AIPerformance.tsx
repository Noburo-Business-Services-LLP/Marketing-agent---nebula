import React, { useEffect, useState } from 'react';
import { Award, BarChart3, Hash, Target } from 'lucide-react';
import { aiMemoryAPI } from '../services/api';
import { useTheme, getThemeClasses } from '../context/ThemeContext';

const AIPerformance: React.FC = () => {
  const { isDarkMode } = useTheme();
  const tc = getThemeClasses(isDarkMode);
  const [platform, setPlatform] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await aiMemoryAPI.getPerformance({ platform: platform || undefined, limit: 60 });
      setItems(res.items || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [platform]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className={`text-2xl font-bold ${tc.text}`}>AI Performance</h1>
          <p className={tc.textMuted}>See what Nebulaa learned from engagement, CTR, hashtags, tones, and CTAs.</p>
        </div>
        <select value={platform} onChange={(e) => setPlatform(e.target.value)} className={`rounded-lg border px-3 py-2 ${isDarkMode ? 'bg-[#0d1117] border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'}`}>
          <option value="">All platforms</option>
          <option value="instagram">Instagram</option>
          <option value="facebook">Facebook</option>
          <option value="linkedin">LinkedIn</option>
          <option value="twitter">X / Twitter</option>
        </select>
      </div>

      {loading ? <div className={tc.text}>Loading performance memory...</div> : (
        <div className="grid gap-4">
          {items.map((item) => (
            <article key={item._id} className={`rounded-lg border p-5 ${isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-white border-slate-200'}`}>
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className={`flex items-center gap-2 text-sm ${tc.textMuted}`}>
                    <Award className="w-4 h-4 text-[#ffcc29]" />
                    <span>{item.platform}</span>
                    <span>{item.learning?.tier}</span>
                    <span>{new Date(item.measuredAt || item.createdAt).toLocaleDateString()}</span>
                  </div>
                  <h2 className={`mt-2 font-semibold ${tc.text}`}>{item.caption || 'Performance memory'}</h2>
                </div>
                <div className="rounded-lg bg-[#ffcc29] px-4 py-2 text-center font-bold text-black">
                  {item.learning?.score || 0}
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-4">
                {[
                  ['Engagement', item.metrics?.engagement, BarChart3],
                  ['Views', item.metrics?.views, Target],
                  ['CTR', item.metrics?.ctr, Target],
                  ['Rate', item.metrics?.engagementRate, BarChart3]
                ].map(([label, value, Icon]: any) => (
                  <div key={label} className={`rounded-lg p-3 ${isDarkMode ? 'bg-slate-900/70' : 'bg-slate-50'}`}>
                    <div className={`flex items-center gap-2 text-xs ${tc.textMuted}`}><Icon className="w-3 h-3" />{label}</div>
                    <div className={`mt-1 font-semibold ${tc.text}`}>{value || 0}</div>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {(item.learning?.winningHashtags || item.hashtags || []).slice(0, 12).map((tag: string) => (
                  <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-[#ffcc29]/15 px-3 py-1 text-sm text-[#d4a800]">
                    <Hash className="w-3 h-3" />
                    {tag.replace(/^#/, '')}
                  </span>
                ))}
              </div>
            </article>
          ))}
          {!items.length && <div className={tc.textMuted}>No performance records yet. Open post analytics after publishing to teach the AI.</div>}
        </div>
      )}
    </div>
  );
};

export default AIPerformance;
