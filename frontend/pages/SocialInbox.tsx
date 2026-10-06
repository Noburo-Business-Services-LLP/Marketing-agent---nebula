import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Inbox, Sparkles, ArrowRight, Loader2, Star } from 'lucide-react';
import { apiService } from '../services/api';
import { useTheme, getThemeClasses } from '../context/ThemeContext';
import UnifiedInbox from './UnifiedInbox';
import AutoReplySettingsPage from './AutoReplySettingsPage';
import ReviewsPanel from '../components/ReviewsPanel';

const TABS = [
  { id: 'messages', label: 'Messages and comments', icon: Inbox },
  { id: 'reviews', label: 'Google reviews', icon: Star },
  { id: 'auto-reply', label: 'Automatic replies', icon: Sparkles },
] as const;

/**
 * The inbox is its own place in the app: every comment and message from the connected
 * accounts in one list, plus the rules for replying automatically. It used to live
 * inside Connected accounts, which is where you set things up, not where you work.
 */
const SocialInbox: React.FC = () => {
  const { isDarkMode } = useTheme();
  const theme = getThemeClasses(isDarkMode);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [connectedCount, setConnectedCount] = useState<number | null>(null);
  const [unread, setUnread] = useState(0);

  const requestedTab = params.get('tab');
  const tab = requestedTab === 'auto-reply' || requestedTab === 'reviews' ? requestedTab : 'messages';

  useEffect(() => {
    let cancelled = false;
    apiService.getSocialInboxSummary()
      .then((summary) => {
        if (cancelled) return;
        setConnectedCount(summary.connectedPlatformCount ?? 0);
        setUnread(summary.unreadMessageCount ?? 0);
      })
      .catch(() => { if (!cancelled) setConnectedCount(0); });
    return () => { cancelled = true; };
  }, []);

  if (connectedCount === null) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-[#F5A623]" /></div>;
  }

  if (connectedCount === 0) {
    return (
      <div className={`max-w-xl mx-auto rounded-2xl border p-8 text-center ${theme.bgCard} ${isDarkMode ? 'border-slate-700/50' : 'border-slate-200'}`}>
        <Inbox className="w-10 h-10 mx-auto text-[#F5A623]" />
        <h2 className={`mt-3 text-xl font-semibold ${theme.text}`}>Your inbox is empty for now</h2>
        <p className={`mt-1 text-sm ${theme.textSecondary}`}>
          Once a social account is connected, its comments and messages appear here, and you can reply to all of them from one place.
        </p>
        <button onClick={() => navigate('/connect-socials')} className="mt-5 px-5 py-3 rounded-lg bg-[#F5A623] text-[#070A12] font-bold inline-flex items-center gap-2">
          Connect an account <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div>
        <h1 className={`text-2xl font-semibold ${theme.text}`}>Inbox</h1>
        <p className={`text-sm mt-1 ${theme.textSecondary}`}>
          Comments and messages from your {connectedCount} connected {connectedCount === 1 ? 'account' : 'accounts'}, in one list.
          {unread > 0 ? ` ${unread} ${unread === 1 ? 'is' : 'are'} waiting for a reply.` : ''}
        </p>
      </div>
      <div className="flex gap-2 border-b border-slate-200/60">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setParams(t.id === 'messages' ? {} : { tab: t.id })}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px ${active ? 'border-[#F5A623] text-[#F5A623]' : `border-transparent ${theme.textSecondary}`}`}
            >
              <Icon className="w-4 h-4" /> {t.label}
            </button>
          );
        })}
      </div>
      {tab === 'messages' ? <UnifiedInbox /> : tab === 'reviews' ? <ReviewsPanel /> : <AutoReplySettingsPage />}
    </div>
  );
};

export default SocialInbox;
