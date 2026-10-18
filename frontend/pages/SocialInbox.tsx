import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Inbox, Sparkles, ArrowRight, Loader2, Star } from 'lucide-react';
import { apiService } from '../services/api';
import UnifiedInbox from './UnifiedInbox';
import AutoReplySettingsPage from './AutoReplySettingsPage';
import ReviewsPanel from '../components/ReviewsPanel';
import ListeningCard from '../components/ListeningCard';
import { BTN_MAIN, CARD, FOCUS, MUTED, TEXT } from '../components/inboxStyles';
import { inboxConnectedCount, pendingBadge } from '../utils/inbox';

const TABS = [
  { id: 'messages', label: 'Messages and comments', icon: Inbox },
  { id: 'reviews', label: 'Google reviews', icon: Star },
  { id: 'auto-reply', label: 'Automatic replies', icon: Sparkles },
] as const;

/**
 * The inbox is its own place in the app: every comment and message from Instagram and Facebook in one list,
 * the replies waiting for your approval, and the rules for replying automatically.
 */
const SocialInbox: React.FC = () => {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [connectedCount, setConnectedCount] = useState<number | null>(null);
  const [unread, setUnread] = useState(0);
  const [pending, setPending] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  const requestedTab = params.get('tab');
  const tab = requestedTab === 'auto-reply' || requestedTab === 'reviews' ? requestedTab : 'messages';

  useEffect(() => {
    let cancelled = false;
    apiService.getSocialInboxSummary()
      .then((summary) => {
        if (cancelled) return;
        setConnectedCount(inboxConnectedCount(summary.connectedPlatforms));
        setUnread(summary.unreadMessageCount ?? 0);
        setPending(summary.pendingCount ?? 0);
        setLastSyncAt(summary.syncStatus?.lastSyncAt ?? null);
      })
      .catch(() => { if (!cancelled) setConnectedCount(0); });
    return () => { cancelled = true; };
  }, []);

  const onPendingChange = useCallback((n: number) => setPending(n), []);

  if (connectedCount === null) {
    return <div className="flex justify-center py-20" role="status" aria-label="Loading"><Loader2 className="w-6 h-6 animate-spin motion-reduce:animate-none text-[var(--gv-accent-text)]" /></div>;
  }

  if (connectedCount === 0) {
    return (
      <div className={`max-w-xl mx-auto p-8 text-center ${CARD}`}>
        <Inbox className="w-10 h-10 mx-auto text-[var(--gv-accent-text)]" aria-hidden="true" />
        <h2 className={`mt-3 text-xl font-semibold ${TEXT}`}>Your inbox is empty for now</h2>
        <p className={`mt-1 text-sm ${MUTED}`}>
          Once your Instagram or Facebook account is connected, its comments and messages appear here, and you can reply to all of them from one place.
        </p>
        <button onClick={() => navigate('/connect-socials')} className={`mt-5 ${BTN_MAIN}`}>
          Connect an account <ArrowRight className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div>
        <h1 className={`text-2xl font-semibold ${TEXT}`}>Inbox</h1>
        <p className={`text-sm mt-1 ${MUTED}`}>
          Comments and messages from your {connectedCount} connected {connectedCount === 1 ? 'account' : 'accounts'}, in one list.
          {unread > 0 ? ` ${unread} ${unread === 1 ? 'is' : 'are'} waiting for a reply.` : ''}
        </p>
      </div>
      <div className="flex gap-2 overflow-x-auto border-b border-[var(--gv-border-subtle)]">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setParams(t.id === 'messages' ? {} : { tab: t.id })}
              aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap ${FOCUS} ${active ? 'border-[var(--gv-accent)] text-[var(--gv-text-primary)]' : 'border-transparent text-[var(--gv-text-secondary)]'}`}
            >
              <Icon className="w-4 h-4" aria-hidden="true" /> {t.label}
              {t.id === 'messages' && pending > 0 && (
                <span className="rounded-full bg-[var(--gv-accent)] px-1.5 text-[11px] font-bold text-[var(--gv-accent-ink)]" aria-label={`${pending} waiting for your approval`}>{pendingBadge(pending)}</span>
              )}
            </button>
          );
        })}
      </div>
      {tab === 'messages' && <ListeningCard showRecent />}
      {tab === 'messages' ? <UnifiedInbox lastSyncAt={lastSyncAt} onPendingChange={onPendingChange} /> : tab === 'reviews' ? <ReviewsPanel /> : <AutoReplySettingsPage />}
    </div>
  );
};

export default SocialInbox;
