import React, { useEffect, useState } from 'react';
import { apiService } from '../services/api';
import { useTheme } from '../context/ThemeContext';
import InfluencerPortalTabs from '../components/InfluencerPortalTabs';

const SubmissionReview: React.FC = () => {
  const { isDarkMode } = useTheme();
  const [items, setItems] = useState<any[]>([]);

  const load = async () => {
    const res = await apiService.getSubmissions();
    setItems(res.submissions || []);
  };

  useEffect(() => { load(); }, []);

  const update = async (id: string, action: 'approve' | 'reject' | 'request-changes') => {
    await apiService.updateSubmissionStatus(id, action);
    load();
  };

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      <InfluencerPortalTabs />
      <h1 className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Submission Review</h1>
      <div className="space-y-3">
        {items.map((item) => (
          <div key={item._id} className={`rounded-xl p-4 border ${isDarkMode ? 'bg-[#0f1419] border-slate-700/60' : 'bg-white border-slate-200'}`}>
            <p className="font-semibold">{item.collaborationId?.influencerId?.name || 'Influencer'} - {item.collaborationId?.platform}</p>
            <p className={`text-sm ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>{item.caption || 'No caption'}</p>
            <p className={`text-xs mt-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>Status: {item.approvalStatus}</p>
            <div className="flex gap-2 mt-3">
              <button className="px-3 py-1 rounded bg-green-600 text-white text-xs" onClick={() => update(item._id, 'approve')}>Approve</button>
              <button className="px-3 py-1 rounded bg-red-600 text-white text-xs" onClick={() => update(item._id, 'reject')}>Reject</button>
              <button className="px-3 py-1 rounded bg-amber-500 text-black text-xs" onClick={() => update(item._id, 'request-changes')}>Need Changes</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SubmissionReview;
