import React, { useEffect, useState } from 'react';
import { apiService } from '../services/api';
import { useTheme } from '../context/ThemeContext';
import InfluencerPortalTabs from '../components/InfluencerPortalTabs';
import { Plus, Pencil, Trash2, X } from 'lucide-react';

const InfluencerList: React.FC = () => {
  const { isDarkMode } = useTheme();
  const [items, setItems] = useState<any[]>([]);
  const [form, setForm] = useState({ name: '', email: '', category: '', username: '', platform: 'instagram', followers: 0, engagementRate: 0 });
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = async () => {
    const res = await apiService.getInfluencerPortalInfluencers();
    setItems(res.influencers || []);
  };

  useEffect(() => { load(); }, []);

  const saveInfluencer = async () => {
    const payload = {
      name: form.name,
      email: form.email,
      niche: form.category,
      platforms: [{ platform: form.platform, username: form.username, followers: Number(form.followers), engagementRate: Number(form.engagementRate) }],
      status: 'invited'
    };

    if (editingId) {
      await apiService.updateInfluencerPortalInfluencer(editingId, payload);
    } else {
      await apiService.createInfluencerPortalInfluencer(payload);
    }

    setForm({ name: '', email: '', category: '', username: '', platform: 'instagram', followers: 0, engagementRate: 0 });
    setEditingId(null);
    setShowModal(false);
    load();
  };

  const openCreateModal = () => {
    setEditingId(null);
    setForm({ name: '', email: '', category: '', username: '', platform: 'instagram', followers: 0, engagementRate: 0 });
    setShowModal(true);
  };

  const openEditModal = (item: any) => {
    const primaryPlatform = item.platforms?.[0] || {};
    setEditingId(item._id);
    setForm({
      name: item.name || '',
      email: item.email || '',
      category: Array.isArray(item.niche) ? item.niche[0] || '' : item.niche || '',
      username: primaryPlatform.username || item.handle || '',
      platform: primaryPlatform.platform || item.platform || 'instagram',
      followers: Number(primaryPlatform.followers ?? item.followerCount ?? 0),
      engagementRate: Number(primaryPlatform.engagementRate ?? item.engagementRate ?? 0)
    });
    setShowModal(true);
  };

  const removeInfluencer = async (id: string) => {
    const confirmed = window.confirm('Delete this influencer?');
    if (!confirmed) return;
    await apiService.deleteInfluencerPortalInfluencer(id);
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
      <div className={`rounded-xl p-4 md:p-5 ${cardClass}`}>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Influencer Management</h1>
            <p className={`text-sm mt-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>Create and manage multi-platform influencer profiles in one place.</p>
          </div>
          <button
            className="inline-flex items-center justify-center gap-2 bg-[#ffcc29] text-[#070A12] rounded-lg px-4 py-2.5 font-semibold hover:bg-[#ffd84f] transition-colors"
            onClick={openCreateModal}
          >
            <Plus className="w-4 h-4" />
            Add Influencer
          </button>
        </div>
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
              <th className="p-3 font-semibold text-right">Action</th>
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
                <td className="p-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      className={`inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                        isDarkMode ? 'bg-slate-800 text-slate-200 hover:bg-slate-700' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                      onClick={() => openEditModal(item)}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Edit
                    </button>
                    <button
                      className={`inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                        isDarkMode ? 'bg-red-500/10 text-red-300 hover:bg-red-500/20' : 'bg-red-50 text-red-600 hover:bg-red-100'
                      }`}
                      onClick={() => removeInfluencer(item._id)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td className={`p-5 text-center ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`} colSpan={6}>
                  No influencers yet. Add your first creator above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowModal(false)} />
          <div className={`relative w-full max-w-3xl rounded-2xl p-5 md:p-6 ${cardClass}`}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className={`text-xl font-bold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                  {editingId ? 'Edit Influencer' : 'Add Influencer'}
                </h2>
                <p className={`text-sm mt-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                  Create or update a multi-platform creator profile.
                </p>
              </div>
              <button className={`p-2 rounded-lg ${isDarkMode ? 'hover:bg-slate-800 text-slate-300' : 'hover:bg-slate-100 text-slate-600'}`} onClick={() => setShowModal(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid md:grid-cols-2 gap-3">
              <input className={inputClass} placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input className={inputClass} placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              <input className={inputClass} placeholder="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
              <input className={inputClass} placeholder="@username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
              <select className={inputClass} value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}>
                {['instagram', 'youtube', 'linkedin', 'facebook', 'twitter', 'x'].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <input className={inputClass} type="number" min="0" placeholder="Followers" value={form.followers} onChange={(e) => setForm({ ...form, followers: Number(e.target.value) })} />
              <input className={inputClass} type="number" min="0" step="0.1" placeholder="Engagement Rate" value={form.engagementRate} onChange={(e) => setForm({ ...form, engagementRate: Number(e.target.value) })} />
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button
                className={`px-4 py-2 rounded-lg font-medium ${isDarkMode ? 'bg-slate-800 text-slate-200 hover:bg-slate-700' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                onClick={() => setShowModal(false)}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 rounded-lg font-semibold bg-[#ffcc29] text-[#070A12] hover:bg-[#ffd84f]"
                onClick={saveInfluencer}
              >
                {editingId ? 'Save Changes' : 'Add Influencer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InfluencerList;
