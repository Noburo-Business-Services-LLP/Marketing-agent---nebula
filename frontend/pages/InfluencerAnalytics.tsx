import React, { useEffect, useState } from 'react';
import { apiService } from '../services/api';
import { useTheme } from '../context/ThemeContext';
import InfluencerPortalTabs from '../components/InfluencerPortalTabs';

const InfluencerAnalytics: React.FC = () => {
  const { isDarkMode } = useTheme();
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    apiService.getInfluencerPortalAnalytics().then(setData);
  }, []);

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      <InfluencerPortalTabs />
      <h1 className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Influencer Analytics</h1>
      <div className={`rounded-xl p-4 border overflow-auto ${isDarkMode ? 'bg-[#0f1419] border-slate-700/60' : 'bg-white border-slate-200'}`}>
        <table className="w-full text-sm">
          <thead><tr className={`text-left border-b ${isDarkMode ? 'border-slate-700 text-slate-200' : 'border-slate-200 text-slate-800'}`}><th className="p-3">Platform</th><th>Impressions</th><th>Engagement</th><th>Clicks</th><th>Conversions</th></tr></thead>
          <tbody>
            {(data?.dashboard?.platformAnalytics || []).map((row: any) => (
              <tr key={row._id} className={isDarkMode ? 'border-b border-slate-800 text-slate-200' : 'border-b border-slate-100 text-slate-700'}>
                <td className="p-3">{row._id}</td><td>{row.impressions}</td><td>{row.engagement}</td><td>{row.clicks}</td><td>{row.conversions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default InfluencerAnalytics;
