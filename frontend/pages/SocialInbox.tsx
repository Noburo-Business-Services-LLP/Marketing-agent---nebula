import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { apiService, inboxAPI, type AutoReplySettings } from '../services/api';
import UnifiedInbox from './UnifiedInbox';
import AutoReplySettingsPage from './AutoReplySettingsPage';
import ReviewsPanel from '../components/ReviewsPanel';
import ListeningCard from '../components/ListeningCard';
import { InboxPartTiles, AutoReplyExplainer, InboxNote } from '../components/inbox/InboxOverview';
import { InboxArt } from '../components/art/Inbox';
import { ReviewsArt } from '../components/art/Reviews';
import '../components/inbox/inbox.css';
import { inboxConnectedCount } from '../utils/inbox';
import { upgradeInfoOf } from '../utils/plans';
import {
  ADDON_NOTE, explainerAction, isGoogleConnected, overviewTiles, partFromParam, type InboxPart, type ReplySettingsLike,
} from '../utils/inboxOverview';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * The inbox is its own place in the app: every comment and message from Instagram and Facebook in one list,
 * the replies waiting for your approval, Google reviews with a drafted reply, and the rules for replying automatically.
 * The three parts open from small tiles that say their status in words, computed from data the page already reads.
 */
const SocialInbox: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState<LoadState>('loading');
  const [entitled, setEntitled] = useState(true);
  const [connectedCount, setConnectedCount] = useState(0);
  const [inboxStatus, setInboxStatus] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [pending, setPending] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [googleConnected, setGoogleConnected] = useState<boolean | null>(null);
  const [settings, setSettings] = useState<ReplySettingsLike | null>(null);

  const part = partFromParam(params.get('tab'));

  const load = useCallback(async (isCancelled: () => boolean = () => false) => {
    setState('loading');
    // Three reads, all from our own database. The Google reviews list itself is only fetched when that part is opened.
    const [summary, replySettings, home] = await Promise.allSettled([
      apiService.getSocialInboxSummary(),
      inboxAPI.getSettings(),
      apiService.getHomeSummary(),
    ]);
    if (isCancelled()) return;
    if (summary.status === 'rejected') {
      if (upgradeInfoOf(summary.reason)) {
        setEntitled(false);
        setState('ready');
      } else {
        setState('error');
      }
      return;
    }
    const s = summary.value;
    setEntitled(true);
    setConnectedCount(inboxConnectedCount(s.connectedPlatforms));
    setInboxStatus(s.inboxStatus || null);
    setUnread(s.unreadMessageCount ?? 0);
    setPending(s.pendingCount ?? 0);
    setLastSyncAt(s.syncStatus?.lastSyncAt ?? null);
    setSettings(replySettings.status === 'fulfilled' ? (replySettings.value.settings || null) : null);
    setGoogleConnected(home.status === 'fulfilled' && home.value && home.value.connected ? isGoogleConnected(home.value.connected.platforms) : null);
    setState('ready');
  }, []);

  useEffect(() => {
    let cancelled = false;
    load(() => cancelled);
    return () => { cancelled = true; };
  }, [load]);

  const onPendingChange = useCallback((n: number) => setPending(n), []);
  const onSettingsSaved = useCallback((s: AutoReplySettings) => setSettings(s), []);

  const open = (next: InboxPart) => {
    setParams(next === 'messages' ? {} : { tab: next });
    // The robot toggle in a conversation can change the reply settings, so read them again (one small call).
    if (entitled && next !== part) inboxAPI.getSettings().then((r) => setSettings(r.settings || null)).catch(() => undefined);
  };

  const tiles = useMemo(
    () => overviewTiles({ entitled, connectedCount, inboxStatus, pending, unread, googleConnected, settings }),
    [entitled, connectedCount, inboxStatus, pending, unread, googleConnected, settings],
  );

  if (state === 'loading') {
    return <div className="flex justify-center py-20" role="status" aria-label="Loading"><Loader2 className="w-6 h-6 animate-spin motion-reduce:animate-none text-[var(--gv-accent-text)]" /></div>;
  }

  if (state === 'error') {
    return (
      <div className="nb-ix">
        <header className="nb-ix-head"><h1>Inbox</h1></header>
        <InboxNote
          role="alert"
          title="We could not load your inbox"
          text="Please check your connection and try again."
          art={<InboxArt />}
          action={{ label: 'Try again', onClick: () => load() }}
        />
      </div>
    );
  }

  const lede = !entitled
    ? 'Comments, messages and Google reviews in one place, with a reply drafted for each.'
    : connectedCount === 0
      ? 'Connect Instagram or Facebook to see its comments and messages here.'
      : `Comments and messages from your ${connectedCount} connected ${connectedCount === 1 ? 'account' : 'accounts'}, in one list.${unread > 0 ? ` ${unread} ${unread === 1 ? 'is' : 'are'} waiting for a reply.` : ''}`;
  const action = explainerAction({ entitled, connectedCount });

  let body: React.ReactNode;
  if (!entitled) {
    // Without the add-on: what the chosen part does, with the one button, then the explainer that sells automatic replies.
    body = part === 'auto-reply'
      ? <AutoReplyExplainer action={action} />
      : (
        <>
          <InboxNote title="Part of the Inbox add-on" text={ADDON_NOTE[part]} art={part === 'reviews' ? <ReviewsArt /> : <InboxArt />} action={action} />
          <AutoReplyExplainer />
        </>
      );
  } else if (part === 'reviews') {
    body = <ReviewsPanel />;
  } else if (part === 'auto-reply') {
    body = (
      <>
        <AutoReplyExplainer action={action} showSafety />
        <AutoReplySettingsPage onSaved={onSettingsSaved} />
      </>
    );
  } else if (connectedCount === 0) {
    body = (
      <InboxNote
        title="Your inbox is empty for now"
        text="Once your Instagram or Facebook account is connected, its comments and messages appear here, and you can reply to all of them from one place."
        art={<InboxArt />}
        action={{ label: 'Connect an account', to: '/connect-socials' }}
      />
    );
  } else {
    body = (
      <>
        <ListeningCard showRecent />
        <UnifiedInbox lastSyncAt={lastSyncAt} onPendingChange={onPendingChange} />
      </>
    );
  }

  return (
    <div className="nb-ix">
      <header className="nb-ix-head">
        <div>
          <h1>Inbox</h1>
          <p className="nb-ix-lede">{lede}</p>
        </div>
      </header>
      <InboxPartTiles tiles={tiles} current={part} onOpen={open} />
      {body}
    </div>
  );
};

export default SocialInbox;
