import React, { useEffect, useState } from 'react';
import { apiService } from '../services/api';
import { useTheme } from '../context/ThemeContext';
import { Plus, X, Sparkles, Trash2, Calendar } from 'lucide-react';
import InfluencerPortalTabs from '../components/InfluencerPortalTabs';

const Collaborations: React.FC = () => {
  const { isDarkMode } = useTheme();
  const [items, setItems] = useState<any[]>([]);
  const [influencers, setInfluencers] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [form, setForm] = useState({ campaignId: '', influencerId: '', platform: 'instagram', contentType: 'Campaign Post', dueDate: '' });

  const load = async () => {
    const [cRes, iRes, camRes] = await Promise.all([
      apiService.getCollaborations(),
      apiService.getInfluencerPortalInfluencers(),
      apiService.getCampaigns()
    ]);
    setItems(cRes.collaborations || []);
    setInfluencers(iRes.influencers || []);
    setCampaigns(camRes.campaigns || []);
  };

  useEffect(() => { load(); }, []);

  const invite = async () => {
    await apiService.inviteCollaboration(form);
    setForm({ campaignId: '', influencerId: '', platform: 'instagram', contentType: 'Campaign Post', dueDate: '' });
    setShowCreateModal(false);
    load();
  };

  const remove = async (id: string) => {
    const confirmed = window.confirm('Delete this collaboration?');
    if (!confirmed) return;
    await apiService.deleteCollaboration(id);
    load();
  };

  const cardClass = isDarkMode
    ? 'bg-[#0f1419] border border-slate-700/60'
    : 'bg-white border border-slate-200';
  const inputClass = isDarkMode
    ? 'w-full p-2.5 rounded-lg bg-[#070A12] border border-slate-700 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-[#ffcc29]'
    : 'w-full p-2.5 rounded-lg bg-white border border-slate-300 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#ffcc29]';
  const headerClass = isDarkMode ? 'text-slate-100 border-b border-slate-700/70' : 'text-slate-800 border-b border-slate-200';
  const rowClass = isDarkMode ? 'border-b border-slate-800 text-slate-200' : 'border-b border-slate-100 text-slate-700';
  const contentTypeOptions = ['Campaign Post', 'Social Post', 'Instagram Reel', 'YouTube Video', 'LinkedIn Post', 'Facebook Post', 'X Thread', 'AI Video'];

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      <InfluencerPortalTabs />
      <div className={`rounded-xl p-4 md:p-5 ${cardClass}`}>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Campaign Collaborations</h1>
            <p className={`text-sm mt-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
              Manage multi-platform influencer partnerships from one collaboration queue.
            </p>
          </div>
          <button
            className="inline-flex items-center justify-center gap-2 bg-[#ffcc29] text-[#070A12] rounded-lg px-4 py-2.5 font-semibold hover:bg-[#ffd84f] transition-colors"
            onClick={() => setShowCreateModal(true)}
          >
            <Plus className="w-4 h-4" />
            Create Collaboration
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-4">
          <div className={`rounded-lg p-3 ${isDarkMode ? 'bg-[#070A12] border border-slate-800' : 'bg-slate-50 border border-slate-200'}`}>
            <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>Total Collaborations</p>
            <p className={`text-xl font-bold mt-1 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{items.length}</p>
          </div>
          <div className={`rounded-lg p-3 ${isDarkMode ? 'bg-[#070A12] border border-slate-800' : 'bg-slate-50 border border-slate-200'}`}>
            <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>Influencers</p>
            <p className={`text-xl font-bold mt-1 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{influencers.length}</p>
          </div>
          <div className={`rounded-lg p-3 col-span-2 md:col-span-1 ${isDarkMode ? 'bg-[#070A12] border border-slate-800' : 'bg-slate-50 border border-slate-200'}`}>
            <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>Campaigns</p>
            <p className={`text-xl font-bold mt-1 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{campaigns.length}</p>
          </div>
        </div>
      </div>

      <div className={`rounded-xl overflow-auto ${cardClass}`}>
        <table className="w-full text-sm">
          <thead>
            <tr className={`text-left ${headerClass}`}>
              <th className="p-3 font-semibold">Campaign</th>
              <th className="p-3 font-semibold">Influencer</th>
              <th className="p-3 font-semibold">Platform</th>
              <th className="p-3 font-semibold">Content</th>
              <th className="p-3 font-semibold">Due Date</th>
              <th className="p-3 font-semibold">Status</th>
              <th className="p-3 font-semibold text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item._id} className={rowClass}>
                <td className="p-3">{item.campaignId?.title || item.campaignId?.name || '-'}</td>
                <td className="p-3">{item.influencerId?.name || '-'}</td>
                <td className="p-3 capitalize">{item.platform}</td>
                <td className="p-3">{item.contentType}</td>
                <td className="p-3">{item.dueDate ? new Date(item.dueDate).toLocaleDateString() : '-'}</td>
                <td className="p-3">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'}`}>
                    {item.status}
                  </span>
                </td>
                <td className="p-3 text-right">
                  <button
                    className={`inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                      isDarkMode ? 'bg-red-500/10 text-red-300 hover:bg-red-500/20' : 'bg-red-50 text-red-600 hover:bg-red-100'
                    }`}
                    onClick={() => remove(item._id)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td className={`p-6 text-center ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`} colSpan={7}>
                  No collaborations yet. Click Create Collaboration to start.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowCreateModal(false)} />
          <div className={`relative w-full max-w-3xl rounded-2xl p-5 md:p-6 ${cardClass}`}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className={`text-xl font-bold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Create Collaboration</h2>
                <p className={`text-sm mt-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                  Pick campaign, influencer, platform, content type, and due date.
                </p>
              </div>
              <button className={`p-2 rounded-lg ${isDarkMode ? 'hover:bg-slate-800 text-slate-300' : 'hover:bg-slate-100 text-slate-600'}`} onClick={() => setShowCreateModal(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid md:grid-cols-2 gap-3">
              <select className={inputClass} value={form.campaignId} onChange={(e) => setForm({ ...form, campaignId: e.target.value })}>
                <option value="">Select Campaign</option>
                {campaigns.map((c: any) => <option key={c._id} value={c._id}>{c.title || c.name || c.campaignName}</option>)}
              </select>
              <select className={inputClass} value={form.influencerId} onChange={(e) => setForm({ ...form, influencerId: e.target.value })}>
                <option value="">Select Influencer</option>
                {influencers.map((i: any) => <option key={i._id} value={i._id}>{i.name}</option>)}
              </select>
              <select className={inputClass} value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}>
                {['instagram', 'youtube', 'linkedin', 'facebook', 'twitter', 'x'].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <select className={inputClass} value={form.contentType} onChange={(e) => setForm({ ...form, contentType: e.target.value })}>
                {contentTypeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
              <label className={`flex items-center gap-2 rounded-lg px-3 py-2.5 border ${isDarkMode ? 'border-slate-700 bg-[#070A12]' : 'border-slate-300 bg-white'}`}>
                <Calendar className={`w-4 h-4 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`} />
                <input
                  className={`w-full bg-transparent outline-none ${isDarkMode ? 'text-slate-100' : 'text-slate-900'}`}
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                />
              </label>
            </div>

            <div className={`flex items-center gap-2 mt-3 text-xs ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
              <Sparkles className="w-3.5 h-3.5 text-[#ffcc29]" />
              <span>MVP-ready for AI matching, scoring, and ROI prediction in Phase 2.</span>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button
                className={`px-4 py-2 rounded-lg font-medium ${isDarkMode ? 'bg-slate-800 text-slate-200 hover:bg-slate-700' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                onClick={() => setShowCreateModal(false)}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 rounded-lg font-semibold bg-[#ffcc29] text-[#070A12] hover:bg-[#ffd84f]"
                onClick={invite}
              >
                Invite Collaborator
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Collaborations;
