import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  CheckCheck,
  Loader2,
  RefreshCw,
  Search,
  Send,
  Sparkles,
} from 'lucide-react';
import { AutoReplySettings, inboxAPI, InboxConversation, InboxMessage } from '../services/api';
import UpgradePrompt from '../components/UpgradePrompt';
import PendingApprovals from '../components/PendingApprovals';
import InboxConfirmDialog from '../components/InboxConfirmDialog';
import { InboxAvatar, InboxChips, InboxWelcome } from '../components/inbox/InboxOverview';
import { InboxArt } from '../components/art/Inbox';
import '../components/inbox/inbox.css';
import { UpgradeInfo, upgradeInfoOf } from '../utils/plans';
import { conversationIdFromSearch, pickSelectedId } from '../utils/listening';
import { customerMessage } from '../utils/errors';
import {
  ARRIVE_LINE, INBOX_PLATFORMS, REPLY_BOX_HINT, REPLY_PLACEHOLDER, conversationKind, failureFromError, isInboxPlatform, kindLabel,
  lastReceivedLine, messageKindLabel, notSentLine, platformLabel, replySucceeded, replyingToLine, sendState, timeAgo,
} from '../utils/inbox';
import { INBOX_VIEWS, alertTitle, conversationChips, inboxFilterFor, suggestionsHeading, threadFacts, threadLine, type InboxView } from '../utils/inboxView';
import { PlatformMark } from '../components/plan/PlanMarks';

// The Simulate tool is for developers only and never shows on a customer screen (owner, 2026-10-19): it needs a
// development build AND ?devtools=1 in the address. The backend's developer routes answer 404 in production anyway.
const DEV_BUILD: boolean = Boolean(import.meta.env && import.meta.env.DEV);
const SHOW_SIMULATE: boolean = DEV_BUILD && typeof window !== 'undefined' && /[?&#]devtools=1\b/.test(window.location.href);

/**
 * The conversations: a list of compact rows with platform marks on the left, the thread and the reply sheet on the right.
 * Below 760 px of room one shows at a time (the thread opens over the list, with Back to list).
 * `liveUpdates` is the summary's 'on', 'off' or 'failed'; the page above shows the note when it is not on.
 */
const UnifiedInbox: React.FC<{ lastSyncAt?: string | null; liveUpdates?: string | null; onPendingChange?: (count: number) => void }> = ({ lastSyncAt, liveUpdates, onPendingChange }) => {
  const [conversations, setConversations] = useState<InboxConversation[]>([]);
  // /inbox?conversation=<id> (the links on the comment card) opens that conversation once it is in the loaded list. It is read
  // again on every navigation (the key changes even for the same link), so a click while already on this page works too.
  const location = useLocation();
  const linkedId = conversationIdFromSearch(location.search);
  const wantedId = useRef(linkedId);
  const [selectedId, setSelectedId] = useState('');
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionsSource, setSuggestionsSource] = useState<string | undefined>(undefined);
  // On a narrow screen only the list or the thread shows; picking a row opens the thread.
  const [view, setView] = useState<'list' | 'thread'>('list');
  // The filter bar: one of All / Needs reply / Important, and where from (everywhere, Instagram or Facebook).
  const [show, setShow] = useState<InboxView>('all');
  const [platform, setPlatform] = useState('all');
  const { status, priority } = inboxFilterFor(show);
  const [search, setSearch] = useState('');
  const [reply, setReply] = useState('');
  const [notifications, setNotifications] = useState<Array<{ id: string; title: string; message: string; type: string; createdAt: string }>>([]);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const [loading, setLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [live, setLive] = useState(false);
  const [replyingTo, setReplyingTo] = useState<{ id: string; author: string } | null>(null);
  const [autoReplySettings, setAutoReplySettings] = useState<AutoReplySettings | null>(null);
  const [autoReplySaving, setAutoReplySaving] = useState(false);
  const [confirmAuto, setConfirmAuto] = useState(false);
  const [error, setError] = useState('');
  const [upgrade, setUpgrade] = useState<UpgradeInfo | null>(null);
  const [threadError, setThreadError] = useState('');
  const [sendError, setSendError] = useState('');
  const [hidden, setHidden] = useState<string[]>([]);
  // The comment a failed reply was meant for, so Try again answers the same comment.
  const failedTargets = useRef<Record<string, string>>({});
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const selected = conversations.find(item => item.id === selectedId) || null;
  const selectedChannelType = conversationKind(selected?.message_types);
  const canReply = Boolean(selected && isInboxPlatform(selected.platform));
  const selectedAutoReplyEnabled = Boolean(selected && (() => {
    const override = autoReplySettings?.channelOverrides?.find(toggle =>
      toggle.platform === selected.platform && toggle.channelType === selectedChannelType
    );
    if (override) return override.enabled;
    const channelKey = selectedChannelType === 'comment' ? 'comments' : 'messages';
    return Boolean(
      autoReplySettings?.enabled &&
      autoReplySettings.platforms?.[selected.platform] &&
      autoReplySettings.channels?.[channelKey]
    );
  })());

  const loadConversations = async () => {
    setLoading(true);
    try {
      const result = await inboxAPI.getConversations({
        status,
        platform: platform === 'all' ? '' : platform,
        priority,
        search,
      });
      const list = result.conversations || [];
      setConversations(list);
      const wanted = wantedId.current;
      if (wanted && list.some(item => item.id === wanted)) wantedId.current = '';
      setSelectedId(current => pickSelectedId(list, current, wanted));
      setError('');
      setUpgrade(null);
    } catch (err: any) {
      setUpgrade(upgradeInfoOf(err));
      setConversations([]);
      setSelectedId('');
      setMessages([]);
      setError(customerMessage(err, 'We could not load your inbox. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConversations();
  }, [status, platform, priority]);

  // A new link to a conversation: show it when it is already loaded, otherwise clear the filters so it can be found.
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  useEffect(() => {
    if (!linkedId) return;
    wantedId.current = linkedId;
    setView('thread');
    if (conversationsRef.current.some(item => item.id === linkedId)) {
      wantedId.current = '';
      setSelectedId(linkedId);
    } else if (show !== 'all' || platform !== 'all' || search) {
      setShow('all'); setPlatform('all'); setSearch('');
    }
  }, [location.key, linkedId]);

  useEffect(() => {
    const loadAutoReplySettings = async () => {
      try {
        const result = await inboxAPI.getSettings();
        setAutoReplySettings(result.settings);
      } catch {
        setAutoReplySettings(null);
      }
    };
    loadAutoReplySettings();
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(loadConversations, 250);
    return () => window.clearTimeout(handle);
  }, [search]);

  useEffect(() => {
    setReplyingTo(null);
    setSendError('');
    if (!selected?.id) return;
    const loadThread = async () => {
      setThreadLoading(true);
      try {
        const result = await inboxAPI.getMessages(selected.id);
        setMessages(result.messages || []);
        setSuggestions(result.ai?.suggestions || []);
        setSuggestionsSource(result.ai?.suggestionsSource);
        setThreadError('');
      } catch (err: any) {
        setMessages([]);
        setSuggestions([]);
        setThreadError(customerMessage(err, 'We could not open this conversation. Please try again.'));
      } finally {
        setThreadLoading(false);
      }
    };
    loadThread();
  }, [selected?.id]);

  useEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTo({
        top: messagesContainerRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [messages]);

  useEffect(() => {
    const ws = inboxAPI.openSocket();
    if (!ws) return;
    ws.onopen = () => setLive(true);
    ws.onclose = () => setLive(false);
    ws.onerror = () => setLive(false);
    ws.onmessage = event => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'inbox.message.created' || ['message:new', 'comment:new', 'reply:new'].includes(payload.type)) {
          const conversation = payload.data?.conversation as InboxConversation;
          const message = payload.data?.message as InboxMessage;

          if (conversation && message) {
            setConversations(current => [conversation, ...current.filter(item => item.id !== conversation.id)]);
            if (conversation.id === selectedId) {
              setMessages(current => {
                if (current.some(m => m.id === message.id)) return current;
                return [...current, message];
              });
            }
          }
        }
        if (payload.type === 'inbox.notification') {
          setNotifications(current => [{
            id: `${Date.now()}`,
            title: alertTitle(payload.data?.type, payload.data?.conversation?.platform),
            message: payload.data?.message || '',
            type: payload.data?.type || 'inbox',
            createdAt: new Date().toISOString(),
          }, ...current].slice(0, 8));
        }
        if (payload.type === 'inbox.message.replied') {
          const message = payload.data as InboxMessage;
          if (message.conversation_id === selectedId) {
            setMessages(current => current.some(m => m.id === message.id) ? current : [...current, message]);
          }
        }
      } catch {
        setLive(false);
      }
    };
    return () => ws.close();
  }, [selectedId]);

  const unreadCount = useMemo(() => conversations.filter(item => item.status === 'unread').length, [conversations]);
  const shownMessages = useMemo(() => messages.filter(m => !hidden.includes(m.id)), [messages, hidden]);

  // One place sends a reply, for the Send button and for Try again. "Sent" is shown only when the server says it was sent.
  const deliver = async (body: string, commentId: string | undefined, retryOfId?: string) => {
    if (!selected || !body.trim()) return;
    const conversationId = selected.id;
    setSending(true);
    setSendError('');
    const addMessage = (message: InboxMessage) => {
      setMessages(current => current.some(m => m.id === message.id) ? current : [...current, message]);
      if (retryOfId) setHidden(current => [...current, retryOfId]);
    };
    try {
      const result = await inboxAPI.reply(conversationId, body, commentId);
      if (replySucceeded(result)) {
        addMessage(result.message);
        setConversations(current => current.map(item => item.id === conversationId ? { ...item, status: 'replied', last_message_preview: body } : item));
        setReplyingTo(null);
        if (!retryOfId) setReply('');
      } else {
        if (result?.message) {
          if (commentId) failedTargets.current[result.message.id] = commentId;
          addMessage(result.message);
          if (!retryOfId) setReply('');
        } else {
          setSendError(notSentLine());
        }
      }
    } catch (err: any) {
      const failure = failureFromError(err);
      if (failure.sentMessage) {
        if (commentId) failedTargets.current[failure.sentMessage.id] = commentId;
        addMessage(failure.sentMessage as InboxMessage);
        if (!retryOfId) setReply('');
        setReplyingTo(null);
      } else {
        setSendError(notSentLine(failure.reason));
      }
    } finally {
      setSending(false);
    }
  };

  const sendReply = () => deliver(reply.trim(), replyingTo?.id || undefined);

  const retry = (message: InboxMessage) => {
    const target = failedTargets.current[message.id] || (['comment', 'reply'].includes(message.message_type || '') ? message.provider_parent_id : undefined);
    deliver(message.body, target || undefined, message.id);
  };

  // Developer tool: add a made-up comment. Never offered to customers.
  const [simulating, setSimulating] = useState(false);
  const simulateTestEvent = async () => {
    setSimulating(true);
    try {
      const result = await inboxAPI.createTestEvent({
        platform: platform === 'all' ? 'instagram' : platform,
        type: 'comment',
        message: 'Hi, I am interested. Can you share pricing and availability?',
        author_name: 'Demo Lead',
        author_username: 'demo.lead',
        thread_id: `demo-thread-${Date.now()}`,
        message_id: `demo-message-${Date.now()}`
      });
      if (result?.conversation) {
        setConversations(current => [result.conversation, ...current.filter(item => item.id !== result.conversation.id)]);
        setSelectedId(result.conversation.id);
      }
    } catch (err: any) {
      setError('Simulation failed: ' + (err?.message || err));
    } finally {
      setSimulating(false);
    }
  };

  const markStatus = async (nextStatus: string) => {
    if (!selected) return;
    setConversations(current => current.map(item => item.id === selected.id ? { ...item, status: nextStatus } : item));
    try {
      await inboxAPI.updateStatus(selected.id, nextStatus);
    } catch (err: any) {
      setThreadError(customerMessage(err, 'We could not update this conversation. Please try again.'));
    }
  };

  const applyToggle = async (enabled: boolean) => {
    if (!selected) return;
    setAutoReplySaving(true);
    setSendError('');
    try {
      const result = await inboxAPI.toggleAutoReply({
        platform: selected.platform,
        channelType: selectedChannelType,
        enabled,
        ...(enabled ? { confirm: true } : {}),
      });
      setAutoReplySettings(result.settings);
      if (enabled) setSuggestions([]);
    } catch (err: any) {
      setSendError(customerMessage(err, 'We could not change automatic replies. Please try again.'));
      try {
        const result = await inboxAPI.getSettings();
        setAutoReplySettings(result.settings);
      } catch { /* the toggle keeps showing what it showed before */ }
    } finally {
      setAutoReplySaving(false);
      setConfirmAuto(false);
    }
  };

  // Turning automatic replies on asks first; turning them off does not.
  const onToggleClick = () => {
    if (selectedAutoReplyEnabled) applyToggle(false);
    else setConfirmAuto(true);
  };

  const lastLine = lastReceivedLine(lastSyncAt);
  const filtering = show !== 'all' || platform !== 'all' || Boolean(search.trim());
  const openConversation = (id: string) => { setSelectedId(id); setView('thread'); };
  const pickSuggestion = (text: string) => { setReply(text); window.setTimeout(() => replyRef.current?.focus(), 0); };
  const facts = threadFacts(selected);

  // Connected, nothing stored yet and no filter on: show what will appear here instead of two empty panes.
  if (!loading && !error && !upgrade && conversations.length === 0 && !filtering) {
    return (
      <div className="nb-ix-unified flex flex-col gap-4">
        <PendingApprovals onChanged={onPendingChange} />
        <InboxWelcome />
        {SHOW_SIMULATE && <button type="button" onClick={simulateTestEvent} disabled={simulating} className="nb-ix-btn2 self-start">{simulating ? <Loader2 className="animate-spin" /> : <Sparkles />} Add a test comment</button>}
      </div>
    );
  }

  return (
    <div className="nb-ix-unified flex flex-col gap-4">
      <PendingApprovals onChanged={onPendingChange} />

      <section className="nb-ix-card nb-ix-box" data-view={view} aria-label="Conversations">
        <aside className="nb-ix-list">
          <div className="nb-ix-list-head">
            <div className="nb-ix-section-head">
              <h2>
                Conversations
                <span className="nb-ix-count" data-zero={unreadCount ? 'false' : 'true'} aria-label={`${unreadCount} unread`}>{unreadCount > 99 ? '99+' : unreadCount}</span>
              </h2>
              <button type="button" onClick={loadConversations} className="nb-ix-btn2 nb-ix-iconbtn" title="Refresh the list" aria-label="Refresh the list"><RefreshCw aria-hidden="true" /></button>
            </div>
            <p className="nb-ix-arrive">
              <span className="nb-ix-livedot" data-on={live ? 'true' : 'false'} title="Whether this page is getting new messages without a reload">{live ? 'Updating live' : 'Refresh for new messages'}</span>
              <span>{liveUpdates === 'off' || liveUpdates === 'failed' ? 'Live updates are not on yet.' : lastLine ? `${lastLine}.` : ARRIVE_LINE}</span>
            </p>
            <label className="nb-ix-search">
              <Search aria-hidden="true" />
              <input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Search names and messages"
                aria-label="Search conversations"
                className="gravity-bare"
              />
            </label>
            <div className="nb-ix-filterbar">
              <div className="nb-ix-fgroup" role="group" aria-labelledby="nb-ix-f-show">
                <span id="nb-ix-f-show" className="nb-ix-flabel">Show</span>
                <span className="nb-ix-seg">
                  {INBOX_VIEWS.map(v => (
                    <button key={v.key} type="button" aria-pressed={show === v.key} onClick={() => setShow(v.key)} className="nb-ix-segbtn">{v.label}</button>
                  ))}
                </span>
              </div>
              <div className="nb-ix-fgroup" role="group" aria-labelledby="nb-ix-f-where">
                <span id="nb-ix-f-where" className="nb-ix-flabel">From</span>
                <span className="nb-ix-pchips">
                  <button type="button" aria-pressed={platform === 'all'} onClick={() => setPlatform('all')} className="nb-ix-pchip">All</button>
                  {INBOX_PLATFORMS.map(item => (
                    <button key={item} type="button" aria-pressed={platform === item} onClick={() => setPlatform(item)} className="nb-ix-pchip">
                      <PlatformMark platform={item === 'facebook' ? 'facebook' : 'instagram'} size={18} />{platformLabel(item)}
                    </button>
                  ))}
                </span>
              </div>
            </div>
            {notifications.length > 0 && (
              <details className="nb-ix-alerts">
                <summary>New activity ({notifications.length})</summary>
                <ul>
                  {notifications.map(n => <li key={n.id}><strong>{n.title}</strong>{n.message ? `: ${n.message}` : ''}</li>)}
                </ul>
              </details>
            )}
            {SHOW_SIMULATE && (
              <button type="button" onClick={simulateTestEvent} disabled={simulating} className="nb-ix-btn2">
                {simulating ? <Loader2 className="animate-spin" /> : <Sparkles />}
                Add a test comment
              </button>
            )}
          </div>

          {loading ? (
            <div className="nb-ix-empty" role="status" aria-label="Loading"><Loader2 className="w-6 h-6 animate-spin motion-reduce:animate-none text-[var(--gv-accent-text)]" /></div>
          ) : upgrade ? (
            <div className="p-4"><UpgradePrompt reason={upgrade.reason} feature={upgrade.feature} /></div>
          ) : error ? (
            <div className="nb-ix-empty" role="alert">
              <InboxArt />
              <strong>Your inbox did not load</strong>
              <p>{error}</p>
              <button type="button" onClick={loadConversations} className="nb-ix-btn">Try again</button>
            </div>
          ) : conversations.length === 0 ? (
            <div className="nb-ix-empty">
              <strong>Nothing matches</strong>
              <p>No conversation matches these filters or this search.</p>
              <button type="button" className="nb-ix-btn2" onClick={() => { setShow('all'); setPlatform('all'); setSearch(''); }}>Show everything</button>
            </div>
          ) : (
            <ul className="nb-ix-rows" aria-label="Conversations">
              {conversations.map(item => {
                const active = selected?.id === item.id;
                const name = item.participant_name || item.participant_username || 'Someone';
                const unread = item.status === 'unread';
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => openConversation(item.id)}
                      aria-current={active ? 'true' : undefined}
                      data-unread={unread ? 'true' : 'false'}
                      className="nb-ix-row"
                    >
                      <span className="nb-ix-row-dot" aria-hidden="true" />
                      <InboxAvatar name={name} platform={item.platform} />
                      <span className="nb-ix-row-main">
                        <span className="nb-ix-row-top">
                          <span className="nb-ix-row-name">{name}</span>
                          {unread && <span className="sr-only">Unread.</span>}
                          <span className="nb-ix-row-time">{timeAgo(item.last_message_at)}</span>
                        </span>
                        <span className="nb-ix-row-text">{item.last_message_preview}</span>
                        <InboxChips chips={conversationChips(item)} />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <section className="nb-ix-thread" aria-label="Conversation">
          {selected ? (
            <>
              <header className="nb-ix-thread-head">
                <button type="button" className="nb-ix-btn2 nb-ix-back" onClick={() => setView('list')}><ArrowLeft aria-hidden="true" /> Back to list</button>
                <div className="nb-ix-thread-who">
                  <InboxAvatar name={selected.participant_name || selected.participant_username} platform={selected.platform} size="lg" />
                  <div>
                    <h3>{selected.participant_name || selected.participant_username || 'Someone'}</h3>
                    <p className="nb-ix-thread-line">
                      {threadLine(selected, kindLabel(selectedChannelType)).map((part, i) => <span key={i}>{part}</span>)}
                      {facts.filter(f => f.label !== 'Status').map(f => (
                        <span key={f.label} className="nb-ix-chip" data-tone={f.value.includes('unhappy') || f.value.includes('urgent') ? 'alert' : f.label === 'Spam' ? 'muted' : f.value.includes('positive') ? 'good' : 'warn'}>{f.value}</span>
                      ))}
                    </p>
                  </div>
                </div>
                <div className="nb-ix-thread-tools">
                  {canReply && (
                    <button
                      type="button"
                      role="switch"
                      onClick={onToggleClick}
                      disabled={autoReplySaving}
                      aria-checked={selectedAutoReplyEnabled}
                      aria-pressed={selectedAutoReplyEnabled}
                      className="nb-ix-toggle"
                      aria-label={`Automatic replies for ${platformLabel(selected.platform)} ${selectedChannelType === 'comment' ? 'comments' : 'messages'}`}
                    >
                      {autoReplySaving ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Bot aria-hidden="true" />}
                      <span className="nb-ix-toggle-text"><span>Automatic replies</span><small>{selectedAutoReplyEnabled ? 'On' : 'Off'}</small></span>
                      <span className="nb-ix-switch" aria-hidden="true" />
                    </button>
                  )}
                  <button type="button" onClick={() => markStatus('read')} className="nb-ix-btn2 nb-ix-iconbtn" title="Mark as read" aria-label="Mark as read"><CheckCheck aria-hidden="true" /></button>
                </div>
              </header>

              <div ref={messagesContainerRef} className="nb-ix-msgs" aria-live="polite">
                {threadLoading ? (
                  <div className="nb-ix-empty" role="status" aria-label="Loading"><Loader2 className="w-6 h-6 animate-spin motion-reduce:animate-none text-[var(--gv-accent-text)]" /></div>
                ) : threadError ? (
                  <div className="nb-ix-empty" role="alert">
                    <strong>This conversation did not open</strong>
                    <p>{threadError}</p>
                  </div>
                ) : shownMessages.length === 0 ? (
                  <div className="nb-ix-empty">
                    <strong>Nothing here yet</strong>
                    <p>Messages in this conversation will show here.</p>
                  </div>
                ) : shownMessages.map(message => {
                  const outbound = message.direction === 'outbound';
                  const state = outbound ? sendState(message) : 'sent';
                  const failed = state === 'failed';
                  return (
                    <div key={message.id} className="nb-ix-bubble-row" data-out={outbound ? 'true' : 'false'}>
                      <div className="nb-ix-bubble" data-failed={failed ? 'true' : 'false'}>
                        <div className="nb-ix-bubble-meta">
                          <strong>{outbound ? 'You' : message.author_name}</strong>
                          <span>{timeAgo(message.created_at)}</span>
                          <span className="nb-ix-chip">{messageKindLabel(message.message_type)}</span>
                          {outbound && (message.auto_sent || message.auto_replied || message.sender_type === 'ai') && (
                            <span className="nb-ix-chip"><Bot aria-hidden="true" /> Replied automatically</span>
                          )}
                          {!outbound && message.sentiment === 'negative' && <span className="nb-ix-chip" data-tone="alert">Unhappy</span>}
                          {!outbound && message.sentiment === 'positive' && <span className="nb-ix-chip" data-tone="good">Positive</span>}
                        </div>
                        <p className="nb-ix-bubble-text">{message.body}</p>
                        {failed && (
                          <div className="mt-2">
                            <p role="alert" className="nb-ix-alert"><AlertCircle aria-hidden="true" />{notSentLine(message.error_message)}</p>
                            <button type="button" onClick={() => retry(message)} disabled={sending} className="nb-ix-btn2 mt-2">
                              {sending ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <RefreshCw aria-hidden="true" />}
                              Try again
                            </button>
                          </div>
                        )}
                        {outbound && state === 'sent' && <p className="nb-ix-bubble-foot">Sent</p>}
                        {outbound && state === 'sending' && <p className="nb-ix-bubble-foot">Sending</p>}
                        {!outbound && ['comment', 'mention'].includes(message.message_type || '') && canReply && (
                          <div className="nb-ix-bubble-act">
                            <button
                              type="button"
                              onClick={() => { setReplyingTo({ id: message.provider_message_id || message.id, author: message.author_name }); replyRef.current?.focus(); }}
                              className="nb-ix-linkbtn"
                            >
                              Reply to this comment
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="nb-ix-sheet">
                {canReply ? (
                  <>
                    <p className="nb-ix-sheet-to">
                      {replyingTo ? replyingToLine('comment', replyingTo.author) : replyingToLine(selectedChannelType)}
                      {replyingTo && <button type="button" onClick={() => setReplyingTo(null)} className="nb-ix-btn2" style={{ minHeight: 26 }}>Cancel</button>}
                    </p>
                    {selectedAutoReplyEnabled ? (
                      <p className="nb-ix-note-inline">Automatic replies are switched on for {selectedChannelType === 'comment' ? 'comments' : 'direct messages'} on {platformLabel(selected.platform)}. Any reply that goes out is saved in this conversation. You can still write one yourself.</p>
                    ) : suggestions.length > 0 && (
                      <div className="nb-ix-suggest">
                        <p><Sparkles aria-hidden="true" /> {suggestionsHeading(suggestionsSource)}</p>
                        <ul aria-label={`${suggestionsHeading(suggestionsSource)}: pick one to put it in your reply box`}>
                          {suggestions.map(suggestion => (
                            <li key={suggestion}>
                              <button type="button" onClick={() => pickSuggestion(suggestion)} aria-pressed={reply === suggestion}>
                                <span>{suggestion}</span>
                                <small>{reply === suggestion ? 'In your reply box' : 'Use this'}</small>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="nb-ix-compose">
                      <textarea
                        ref={replyRef}
                        value={reply}
                        onChange={event => setReply(event.target.value)}
                        rows={4}
                        aria-label="Your reply"
                        placeholder={REPLY_PLACEHOLDER}
                        className="gravity-bare"
                      />
                    </div>
                    {sendError && <p role="alert" className="nb-ix-alert"><AlertCircle aria-hidden="true" />{sendError}</p>}
                    <div className="nb-ix-sheet-foot">
                      <p>{REPLY_BOX_HINT}</p>
                      <button type="button" onClick={sendReply} disabled={sending || !reply.trim()} className="nb-ix-btn">
                        {sending ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Send aria-hidden="true" />}
                        Send
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="nb-ix-muted">Replies are only available for Instagram and Facebook.</p>
                )}
              </div>
            </>
          ) : (
            <div className="nb-ix-empty nb-ix-empty-thread">
              <InboxArt />
              <strong>Pick a conversation to read it here</strong>
              <p>Comments and messages from Instagram and Facebook are listed on the left. Open one to see the whole thread, suggested replies and your reply box.</p>
            </div>
          )}
        </section>
      </section>

      {confirmAuto && selected && (
        <InboxConfirmDialog
          where={platformLabel(selected.platform)}
          busy={autoReplySaving}
          onCancel={() => setConfirmAuto(false)}
          onConfirm={() => applyToggle(true)}
        />
      )}
    </div>
  );
};

export default UnifiedInbox;
