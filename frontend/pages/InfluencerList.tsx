import React, { useEffect, useState } from 'react';
import { apiService } from '../services/api';
import { useTheme } from '../context/ThemeContext';
import InfluencerPortalTabs from '../components/InfluencerPortalTabs';

const InfluencerList: React.FC = () => {
  const { isDarkMode } = useTheme();
  const [items, setItems] = useState<any[]>([]);
  const [form, setForm] = useState({ name: '', email: '', niche: '', username: '', platform: 'instagram', followers: 0, engagementRate: 0 });

  const load = async () => {
    const res = await apiService.getInfluencerPortalInfluencers();
    setItems(res.influencers || []);
  };

  useEffect(() => { load(); }, []);

  const create = async () => {
    await apiService.createInfluencerPortalInfluencer({
      name: form.name,
      email: form.email,
      niche: form.niche,
      platforms: [{ platform: form.platform, username: form.username, followers: Number(form.followers), engagementRate: Number(form.engagementRate) }],
      status: 'invited'
    });
    setForm({ name: '', email: '', niche: '', username: '', platform: 'instagram', followers: 0, engagementRate: 0 });
    load();
  };

  const cardClass = isDarkMode
    ? 'bg-[#0f1419] border border-slate-700/60'
    : 'bg-white border border-slate-200';
  const inputClass = isDarkMode
    ? 'w-full p-2.5 rounded-lg bg-[#070A12] border border-slate-700 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-[#ffcc29]'
    : 'w-full p-2.5 rounded-lg bg-white border border-slate-300 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#ffcc29]';
  const tableHeaderClass = isDarkMode
    ? 'text-slate-100 border-b border-slate-700/70'
    : 'text-slate-800 border-b border-slate-200';
  const rowClass = isDarkMode
    ? 'border-b border-slate-800 text-slate-200'
    : 'border-b border-slate-100 text-slate-700';

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      <InfluencerPortalTabs />
      <div>
        <h1 className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Influencer Management</h1>
        <p className={`text-sm mt-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>Create and manage multi-platform influencer profiles in one place.</p>
      </div>

      <div className={`grid md:grid-cols-3 gap-3 rounded-xl p-4 ${cardClass}`}>
        <input className={inputClass} placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className={inputClass} placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <input className={inputClass} placeholder="Niche" value={form.niche} onChange={(e) => setForm({ ...form, niche: e.target.value })} />
        <input className={inputClass} placeholder="@username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
        <select className={inputClass} value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}>
          {['instagram', 'youtube', 'linkedin', 'facebook', 'twitter', 'x'].map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button className="bg-[#ffcc29] text-[#070A12] rounded-lg px-4 py-2.5 font-semibold hover:bg-[#ffd84f] transition-colors" onClick={create}>Add Influencer</button>
      </div>

      <div className={`rounded-xl overflow-auto ${cardClass}`}>
        <table className="w-full text-sm">
          <thead>
            <tr className={`text-left ${tableHeaderClass}`}>
              <th className="p-3 font-semibold">Name</th>
              <th className="p-3 font-semibold">Email</th>
              <th className="p-3 font-semibold">Niche</th>
              <th className="p-3 font-semibold">Platforms</th>
              <th className="p-3 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item._id} className={rowClass}>
                <td className="p-3">{item.name}</td>
                <td className="p-3">{item.email || '-'}</td>
                <td className="p-3">{Array.isArray(item.niche) ? item.niche.join(', ') : item.niche}</td>
                <td className="p-3">{(item.platforms || []).map((p: any) => p.platform).join(', ') || item.platform}</td>
                <td className="p-3">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'
                  }`}>
                    {item.status}
                  </span>
                </td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td className={`p-5 text-center ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`} colSpan={5}>
                  No influencers yet. Add your first creator above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default InfluencerList;
