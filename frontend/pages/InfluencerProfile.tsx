import React from 'react';
import InfluencerPortalTabs from '../components/InfluencerPortalTabs';
import { useTheme } from '../context/ThemeContext';

const InfluencerProfile: React.FC = () => {
  const { isDarkMode } = useTheme();
  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <InfluencerPortalTabs />
      <div className={`rounded-xl p-5 border ${isDarkMode ? 'bg-[#0f1419] border-slate-700/60' : 'bg-white border-slate-200'}`}>
        <h1 className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Influencer Profile</h1>
        <p className={`text-sm mt-2 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>Profile detail view scaffold for multi-platform influencer account data, activity timeline, and AI recommendation insights.</p>
      </div>
    </div>
  );
};

export default InfluencerProfile;
