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
import { AutoReplyArt } from '../components/art/AutoReply';
import { LiveUpdatesArt } from '../components/art/inbox/Live';
import '../components/inbox/inbox.css';
import { inboxConnectedCount } from '../utils/inbox';
import { upgradeInfoOf } from '../utils/plans';
import {
  ADDON_NOTE, ADDON_NOTE_CLIENT, explainerAction, isGoogleConnected, overviewTiles, partFromParam, type InboxPart, type ReplySettingsLike,
} from '../utils/inboxOverview';
import { holdsClientPass, liveNote, messagesBodyState } from '../utils/inboxView';
import { customerMessage } from '../utils/errors';

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
  const [liveUpdates, setLiveUpdates] = useState<string | null>(null);
  const [liveBusy, setLiveBusy] = useState(false);
  const [liveError, setLiveError] = useState('');
  // Inside a client's account (agency) or with a staff pass nobody can buy the add-on here.
  const clientPass = useMemo(() => holdsClientPass(typeof window !== 'undefined' ? window.localStorage : null), []);

  const part = partFromParam(params.get('tab'));

  const load = useCallback(async (isCancelled: () => boolean = () => false, quiet = false) => {
    if (!quiet) setState('loading');
    // Reads from our own database only. The Google reviews list itself is fetched when that part is opened.
    const [summary, replySettings] = await Promise.allSettled([
      apiService.getSocialInboxSummary(),
      inboxAPI.getSettings(),
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
    setLiveUpdates(typeof s.liveUpdates === 'string' ? s.liveUpdates : null);
    setSettings(replySettings.status === 'fulfilled' ? (replySettings.value.settings || null) : null);
    if (typeof s.reviewsConnected === 'boolean') {
      setGoogleConnected(s.reviewsConnected);
    } else {
      // An older server: read the connected accounts from the Home summary instead.
      const home = await apiService.getHomeSummary().catch(() => null);
      if (isCancelled()) return;
      setGoogleConnected(home && home.connected ? isGoogleConnected(home.connected.platforms) : null);
    }
    setState('ready');
  }, []);

  useEffect(() => {
    let cancelled = false;
    load(() => cancelled);
    return () => { cancelled = true; };
  }, [load]);

  const onPendingChange = useCallback((n: number) => setPending(n), []);

  // Switch on live updates (registers this account's comment and message hooks), then read the summary again.
  const switchOnLive = async () => {
    setLiveBusy(true);
    setLiveError('');
    try {
      const res = await apiService.registerWebhook();
      if (!res || res.success === false) setLiveError(customerMessage(res?.message, 'Live updates could not be switched on. Please try again in a few minutes.'));
      await load(undefined, true);
    } finally {
      setLiveBusy(false);
    }
  };
  const onSettingsSaved = useCallback((s: AutoReplySettings) => setSettings(s), []);

  const open = (next: InboxPart) => {
    setParams(next === 'messages' ? {} : { tab: next });
    // The robot toggle in a conversation can change the reply settings, so read them again (one small call).
    if (entitled && next !== part) inboxAPI.getSettings().then((r) => setSettings(r.settings || null)).catch(() => undefined);
  };

  const tiles = useMemo(
    () => overviewTiles({ entitled, connectedCount, inboxStatus, pending, unread, googleConnected, settings, liveUpdates, lastAt: lastSyncAt }),
    [entitled, connectedCount, inboxStatus, pending, unread, googleConnected, settings, liveUpdates, lastSyncAt],
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
  const action = explainerAction({ entitled, connectedCount, clientPass });
  const bodyState = messagesBodyState({ entitled, connectedCount, liveUpdates });
  const live = liveNote(liveUpdates);

  let body: React.ReactNode;
  if (!entitled) {
    // Without the add-on: a calm note for the chosen part (See plans, except inside a client or staff pass), then the explainer.
    const noteText = clientPass ? ADDON_NOTE_CLIENT : ADDON_NOTE[part];
    const noteArt = part === 'reviews' ? <ReviewsArt /> : part === 'auto-reply' ? <AutoReplyArt /> : <InboxArt />;
    body = part === 'auto-reply'
      ? (
        <>
          {clientPass && <InboxNote title="Part of the Inbox add-on" text={noteText} art={noteArt} />}
          <AutoReplyExplainer action={action} />
        </>
      )
      : (
        <>
          <InboxNote title="Part of the Inbox add-on" text={noteText} art={noteArt} action={action} />
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
  } else if (bodyState === 'connect') {
    body = (
      <InboxNote
        title="Connect Instagram or Facebook"
        text="Once an account is connected, its comments and direct messages appear here with a reply drafted for each, and you can answer all of them from one place."
        art={<InboxArt />}
        marks={['instagram', 'facebook']}
        action={{ label: 'Connect an account', to: '/connect-socials' }}
      />
    );
  } else {
    body = (
      <>
        {live && (
          <InboxNote
            role="status"
            tone="warn"
            title={live.title}
            text={liveError || live.text}
            art={<LiveUpdatesArt />}
            action={{ label: liveBusy ? 'Switching on' : live.action, onClick: switchOnLive, busy: liveBusy }}
          />
        )}
        <UnifiedInbox lastSyncAt={lastSyncAt} liveUpdates={liveUpdates} onPendingChange={onPendingChange} />
        <ListeningCard showRecent />
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
