import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Users, Link2, FileText, BarChart3 } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

type TabItem = {
  path: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

const tabs: TabItem[] = [
  { path: '/influencer-portal', label: 'Overview', icon: LayoutDashboard },
  { path: '/influencer-portal/list', label: 'Influencer List', icon: Users },
  { path: '/influencer-portal/collaborations', label: 'Collaborations', icon: Link2 },
  { path: '/influencer-portal/submissions', label: 'Submissions', icon: FileText },
  { path: '/influencer-portal/analytics', label: 'Analytics', icon: BarChart3 },
];

const InfluencerPortalTabs: React.FC = () => {
  const location = useLocation();
  const { isDarkMode } = useTheme();

  return (
    <div className={`rounded-2xl border p-2 md:p-2.5 ${isDarkMode ? 'bg-[#0f1419] border-slate-700/60' : 'bg-white border-slate-200'}`}>
      <div className="flex items-center gap-2 overflow-x-auto hide-scrollbar">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = location.pathname === tab.path || (tab.path !== '/influencer-portal' && location.pathname.startsWith(tab.path));

          return (
            <Link
              key={tab.path}
              to={tab.path}
              className={`inline-flex items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors border ${
                isActive
                  ? 'bg-[#ffcc29] text-[#070A12] border-[#ffcc29] shadow-sm'
                  : isDarkMode
                    ? 'bg-transparent text-slate-300 border-transparent hover:bg-slate-800/70 hover:text-white'
                    : 'bg-transparent text-slate-700 border-transparent hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Icon className={`w-4 h-4 ${isActive ? 'text-[#070A12]' : 'text-[#ffcc29]'}`} />
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
};

export default InfluencerPortalTabs;
