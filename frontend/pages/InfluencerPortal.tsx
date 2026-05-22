import React, { useEffect, useState } from 'react';
import { Users, Clock3, Link2, BarChart3 } from 'lucide-react';
import { apiService } from '../services/api';
import InfluencerPortalTabs from '../components/InfluencerPortalTabs';
import { useTheme } from '../context/ThemeContext';

const InfluencerPortal: React.FC = () => {
  const { isDarkMode } = useTheme();
  const [loading, setLoading] = useState(true);
  const [dashboard, setDashboard] = useState<any>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const result = await apiService.getInfluencerPortalAnalytics();
        setDashboard(result.dashboard || null);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const cards = [
    { title: 'Total Influencers', value: dashboard?.totalInfluencers ?? 0, icon: Users },
    { title: 'Pending Approvals', value: dashboard?.pendingApprovals ?? 0, icon: Clock3 },
    { title: 'Active Collaborations', value: dashboard?.activeCollaborations ?? 0, icon: Link2 },
    { title: 'Platform Analytics', value: (dashboard?.platformAnalytics || []).length, icon: BarChart3 }
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className={`rounded-2xl p-5 md:p-6 border ${isDarkMode ? 'bg-[#0f1419] border-slate-700/60' : 'bg-white border-slate-200'}`}>
        <h1 className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Influencer Portal</h1>
        <p className={`text-sm mt-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>Unified multi-platform creator collaboration workflow.</p>
      </div>
      <InfluencerPortalTabs />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.title} className={`rounded-xl p-4 border ${isDarkMode ? 'bg-[#0f1419] border-slate-700/60' : 'bg-white border-slate-200'}`}>
              <div className="flex items-center justify-between">
                <p className={`text-sm ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>{card.title}</p>
                <Icon className="w-4 h-4 text-[#ffcc29]" />
              </div>
              <p className={`text-2xl font-bold mt-2 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{loading ? '...' : card.value}</p>
            </div>
          );
        })}
      </div>
      <div className={`rounded-xl p-5 border ${isDarkMode ? 'bg-[#0f1419] border-slate-700/60' : 'bg-white border-slate-200'}`}>
        <h2 className={`font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Workflow</h2>
        <p className={`text-sm ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>Brand Creates Campaign | Invite Influencer | Influencer Accepts | Upload Content | Brand Reviews | Approve/Reject | Track Analytics</p>
      </div>
    </div>
  );
};

export default InfluencerPortal;
