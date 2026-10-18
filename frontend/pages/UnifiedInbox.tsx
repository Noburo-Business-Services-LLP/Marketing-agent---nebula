import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  Bot,
  CheckCheck,
  Facebook,
  Instagram,
  Loader2,
  MessageCircle,
  RefreshCw,
  Search,
  Send,
  Sparkles,
} from 'lucide-react';
import { AutoReplySettings, inboxAPI, InboxConversation, InboxMessage } from '../services/api';
import UpgradePrompt from '../components/UpgradePrompt';
import PendingApprovals from '../components/PendingApprovals';
import InboxConfirmDialog from '../components/InboxConfirmDialog';
import { BTN, BTN_MAIN, ERROR_TEXT, FIELD, FOCUS, MUTED, PILL, TEXT } from '../components/inboxStyles';
import { UpgradeInfo, upgradeInfoOf } from '../utils/plans';
import { conversationIdFromSearch, pickSelectedId } from '../utils/listening';
import { customerMessage } from '../utils/errors';
import {
  ARRIVE_LINE, INBOX_PLATFORMS, REPLY_BOX_HINT, REPLY_PLACEHOLDER, conversationKind, failureFromError, isInboxPlatform, kindLabel,
  lastReceivedLine, messageKindLabel, notSentLine, platformLabel, replySucceeded, replyingToLine, sendState, timeAgo,
} from '../utils/inbox';

// The Simulate button is for developers only: it exists in a dev build and is gone from the live site.
// @ts-ignore import.meta.env is added by the build tool
const SHOW_SIMULATE: boolean = Boolean(import.meta.env && import.meta.env.DEV);

const platformIcon = (p: string): React.ElementType => (p === 'instagram' ? Instagram : p === 'facebook' ? Facebook : MessageCircle);

const priorities = ['all', 'low', 'normal', 'high', 'urgent'];
const priorityWord: Record<string, string> = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' };

const SELECT = `px-2 py-2 rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-panel)] text-[12px] text-[var(--gv-text-primary)] ${FOCUS}`;
const ICON_BTN = `p-2 rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-panel)] text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-2)] ${FOCUS}`;

const priorityClass = (p: string) =>
  p === 'urgent' ? 'bg-[var(--gv-peach)] text-[var(--gv-coral-text)]'
    : p === 'high' ? 'bg-[var(--gv-accent-fill)] text-[var(--gv-accent-text)]'
      : 'bg-[var(--gv-surface-2)] text-[var(--gv-text-secondary)]';

const UnifiedInbox: React.FC<{ lastSyncAt?: string | null; onPendingChange?: (count: number) => void }> = ({ lastSyncAt, onPendingChange }) => {
  const [conversations, setConversations] = useState<InboxConversation[]>([]);
  // /inbox?conversation=<id> (the links on the comment card) opens that conversation once it is in the loaded list. It is read
  // again on every navigation (the key changes even for the same link), so a click while already on this page works too.
  const location = useLocation();
  const linkedId = conversationIdFromSearch(location.search);
  const wantedId = useRef(linkedId);
  const [selectedId, setSelectedId] = useState('');
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [status, setStatus] = useState('all');
  const [platform, setPlatform] = useState('all');
  const [priority, setPriority] = useState('all');
  const [search, setSearch] = useState('');
  const [reply, setReply] = useState('');
  const [notifications, setNotifications] = useState<Array<{ id: string; title: string; message: string; type: string; createdAt: string }>>([]);
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
        status: status === 'all' ? '' : status,
        platform: platform === 'all' ? '' : platform,
        priority: priority === 'all' ? '' : priority,
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
    if (conversationsRef.current.some(item => item.id === linkedId)) {
      wantedId.current = '';
      setSelectedId(linkedId);
    } else if (status !== 'all' || platform !== 'all' || priority !== 'all' || search) {
      setStatus('all'); setPlatform('all'); setPriority('all'); setSearch('');
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
            title: payload.data?.title || 'New activity',
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

  return (
    <div className="space-y-4">
      <PendingApprovals onChanged={onPendingChange} />

      <div className="min-h-[650px] h-[calc(100vh-8rem)] rounded-2xl border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)] overflow-hidden flex flex-col">
        <div className="flex-1 flex flex-col lg:flex-row min-h-0 divide-[var(--gv-border-subtle)] lg:divide-x">
          <aside className="w-full lg:w-[360px] flex flex-col min-h-0">
            <div className="shrink-0 p-4 border-b border-[var(--gv-border-subtle)]">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <h2 className={`text-[20px] font-semibold ${TEXT}`}>Inbox</h2>
                  <p className={`text-xs ${MUTED}`}>{unreadCount} unread {unreadCount === 1 ? 'conversation' : 'conversations'}</p>
                </div>
                <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs ${live ? 'border-[var(--gv-border-default)] bg-[var(--gv-mint)] text-[var(--gv-text-primary)]' : 'border-[var(--gv-border-subtle)] text-[var(--gv-text-tertiary)]'}`}>
                  <span className={`h-2 w-2 rounded-full ${live ? 'bg-emerald-600' : 'bg-[var(--gv-text-muted)]'}`} />
                  Live
                </div>
              </div>

              <div className={`mb-3 rounded-lg bg-[var(--gv-surface-1)] px-3 py-2 text-[12px] leading-relaxed ${MUTED}`}>
                <p>{ARRIVE_LINE}</p>
                {lastLine && <p>{lastLine}</p>}
                <button type="button" onClick={loadConversations} className={`mt-1 inline-flex items-center gap-1 rounded font-semibold underline underline-offset-2 text-[var(--gv-text-primary)] ${FOCUS}`}>
                  <RefreshCw className="w-3 h-3" aria-hidden="true" /> Refresh
                </button>
              </div>

              <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-panel)]">
                <Search className="w-4 h-4 text-[var(--gv-text-tertiary)]" aria-hidden="true" />
                <input
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder="Search conversations"
                  aria-label="Search conversations"
                  className="gravity-bare w-full bg-transparent outline-none text-sm text-[var(--gv-text-primary)]"
                />
              </div>

              <div className="grid grid-cols-3 gap-2 mt-3">
                <select aria-label="Show" value={status} onChange={event => setStatus(event.target.value)} className={SELECT}>
                  <option value="all">All</option>
                  <option value="unread">Unread</option>
                  <option value="read">Read</option>
                  <option value="replied">Replied</option>
                </select>
                <select aria-label="Where from" value={platform} onChange={event => setPlatform(event.target.value)} className={SELECT}>
                  <option value="all">Everywhere</option>
                  {INBOX_PLATFORMS.map(item => <option key={item} value={item}>{platformLabel(item)}</option>)}
                </select>
                <select aria-label="How important" value={priority} onChange={event => setPriority(event.target.value)} className={SELECT}>
                  {priorities.map(item => <option key={item} value={item}>{item === 'all' ? 'Importance' : priorityWord[item]}</option>)}
                </select>
              </div>
              {SHOW_SIMULATE && (
                <button
                  onClick={simulateTestEvent}
                  disabled={simulating}
                  className={`mt-2 ${BTN} w-full`}
                >
                  {simulating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  Simulate (developers only)
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="h-full flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin motion-reduce:animate-none text-[var(--gv-accent-text)]" /></div>
              ) : upgrade ? (
                <div className="p-4"><UpgradePrompt reason={upgrade.reason} feature={upgrade.feature} /></div>
              ) : error ? (
                <div className="h-full flex items-center justify-center p-6 text-center">
                  <div>
                    <AlertTriangle className="w-9 h-9 mx-auto text-[var(--gv-coral-text)] mb-3" />
                    <p className={`font-semibold ${TEXT}`}>Your inbox did not load</p>
                    <p className={`text-sm mt-1 ${MUTED}`}>{error}</p>
                    <button onClick={loadConversations} className={`mt-4 ${BTN_MAIN}`}>Try again</button>
                  </div>
                </div>
              ) : conversations.length === 0 ? (
                <div className="h-full flex items-center justify-center p-6 text-center">
                  <div>
                    <MessageCircle className="w-10 h-10 mx-auto text-[var(--gv-text-muted)] mb-3" />
                    <p className={`font-semibold ${TEXT}`}>No comments or messages yet</p>
                    <p className={`text-sm mt-1 ${MUTED}`}>New comments and messages from Instagram and Facebook will show up here.</p>
                  </div>
                </div>
              ) : conversations.map(item => {
                const Icon = platformIcon(item.platform);
                const active = selected?.id === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setSelectedId(item.id)}
                    className={`w-full text-left p-4 border-b border-[var(--gv-border-subtle)] transition-colors hover:bg-[var(--gv-surface-1)] ${FOCUS} ${active ? 'bg-[var(--gv-accent-fill)]' : ''}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-[var(--gv-surface-2)] text-[var(--gv-text-primary)] flex items-center justify-center shrink-0">
                        <Icon className="w-5 h-5" aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className={`font-semibold text-sm truncate ${TEXT}`}>{item.participant_name || item.participant_username || 'Someone'}</p>
                          {item.status === 'unread' && <span className="w-2 h-2 rounded-full bg-[var(--gv-accent)] shrink-0" aria-label="Unread" />}
                          <span className={`ml-auto text-[11px] ${MUTED}`}>{timeAgo(item.last_message_at)}</span>
                        </div>
                        <p className={`text-xs truncate mt-1 ${MUTED}`}>{item.last_message_preview}</p>
                        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                          <span className={PILL}>{kindLabel(conversationKind(item.message_types))}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${priorityClass(item.priority)}`}>{priorityWord[item.priority] || item.priority}</span>
                          {(item.unread_count || 0) > 0 && <span className="px-2 py-0.5 rounded-full text-[11px] bg-[var(--gv-accent-fill)] text-[var(--gv-accent-text)]">{item.unread_count} unread</span>}
                          {item.tags?.slice(0, 2).map(tag => <span key={tag} className="px-2 py-0.5 rounded-full text-[11px] bg-[var(--gv-accent-fill)] text-[var(--gv-accent-text)]">{tag}</span>)}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="flex-1 flex flex-col min-w-0 min-h-0">
            {selected ? (
              <>
                <header className="shrink-0 p-4 border-b border-[var(--gv-border-subtle)] flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    {(() => {
                      const Icon = platformIcon(selected.platform);
                      return <div className="w-11 h-11 rounded-lg bg-[var(--gv-surface-2)] text-[var(--gv-text-primary)] flex items-center justify-center"><Icon className="w-5 h-5" aria-hidden="true" /></div>;
                    })()}
                    <div className="min-w-0">
                      <h3 className={`font-semibold truncate ${TEXT}`}>{selected.participant_name || 'Someone'}</h3>
                      <p className={`text-xs truncate ${MUTED}`}>
                        {selected.participant_username ? `@${selected.participant_username} on ` : 'On '}{platformLabel(selected.platform)} · {kindLabel(selectedChannelType)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {canReply && (
                      <button
                        onClick={onToggleClick}
                        disabled={autoReplySaving}
                        aria-pressed={selectedAutoReplyEnabled}
                        className={`h-9 px-3 rounded-lg border text-xs font-semibold flex items-center gap-2 transition-colors text-[var(--gv-text-primary)] ${FOCUS} ${selectedAutoReplyEnabled ? 'bg-[var(--gv-mint)] border-[var(--gv-border-default)]' : 'bg-[var(--gv-panel)] border-[var(--gv-border-default)]'}`}
                        title={`Automatic replies for ${platformLabel(selected.platform)} ${selectedChannelType === 'comment' ? 'comments' : 'messages'}`}
                      >
                        {autoReplySaving ? <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" /> : <Bot className="w-4 h-4" aria-hidden="true" />}
                        <span>Automatic replies {selectedAutoReplyEnabled ? 'on' : 'off'}</span>
                        <span className={`w-8 h-4 rounded-full p-0.5 flex ${selectedAutoReplyEnabled ? 'justify-end bg-emerald-600' : 'justify-start bg-[var(--gv-surface-4)]'}`}>
                          <span className="h-3 w-3 rounded-full bg-[var(--gv-panel)]" />
                        </span>
                      </button>
                    )}
                    <button onClick={() => markStatus('read')} className={ICON_BTN} title="Mark as read" aria-label="Mark as read"><CheckCheck className="w-4 h-4" /></button>
                    <button onClick={loadConversations} className={ICON_BTN} title="Refresh" aria-label="Refresh"><RefreshCw className="w-4 h-4" /></button>
                  </div>
                </header>

                <div className="flex-1 grid xl:grid-cols-[1fr_320px] min-h-0">
                  <div className="flex flex-col min-h-0">
                    <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-[var(--gv-bg)]">
                      {threadLoading ? (
                        <div className="h-full flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin motion-reduce:animate-none text-[var(--gv-accent-text)]" /></div>
                      ) : threadError ? (
                        <div className="h-full flex items-center justify-center text-center">
                          <div>
                            <AlertTriangle className="w-9 h-9 mx-auto text-[var(--gv-coral-text)] mb-3" />
                            <p className={`font-semibold ${TEXT}`}>This conversation did not open</p>
                            <p className={`text-sm mt-1 ${MUTED}`}>{threadError}</p>
                          </div>
                        </div>
                      ) : shownMessages.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-center">
                          <div>
                            <MessageCircle className="w-10 h-10 mx-auto text-[var(--gv-text-muted)] mb-3" />
                            <p className={`font-semibold ${TEXT}`}>Nothing here yet</p>
                            <p className={`text-sm mt-1 ${MUTED}`}>Messages in this conversation will show here.</p>
                          </div>
                        </div>
                      ) : shownMessages.map(message => {
                        const outbound = message.direction === 'outbound';
                        const state = outbound ? sendState(message) : 'sent';
                        const failed = state === 'failed';
                        return (
                          <div key={message.id} className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[78%] rounded-xl px-4 py-3 border text-[var(--gv-text-primary)] ${failed ? 'bg-[var(--gv-peach)] border-[var(--gv-coral)]' : outbound ? 'bg-[var(--gv-accent-fill)] border-[var(--gv-border-default)]' : 'bg-[var(--gv-panel)] border-[var(--gv-border-subtle)]'}`}>
                              <div className="flex items-center flex-wrap gap-2 mb-1">
                                <span className="text-xs font-semibold">{outbound ? 'You (Nebulaa)' : message.author_name}</span>
                                <span className={`text-[11px] ${MUTED}`}>{timeAgo(message.created_at)}</span>
                                <span className={PILL}>{messageKindLabel(message.message_type)}</span>
                                {outbound && (message.auto_sent || message.auto_replied || message.sender_type === 'ai') && (
                                  <span className={`${PILL} gap-1`}><Bot className="w-3 h-3" aria-hidden="true" /> Replied automatically</span>
                                )}
                                {message.sentiment && !outbound && message.sentiment !== 'neutral' && (
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${message.sentiment === 'positive' ? 'bg-[var(--gv-mint)] text-[var(--gv-text-primary)]' : 'bg-[var(--gv-peach)] text-[var(--gv-coral-text)]'}`}>
                                    {message.sentiment === 'positive' ? 'Happy' : 'Unhappy'}
                                  </span>
                                )}
                              </div>
                              <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.body}</p>
                              {failed && (
                                <div className="mt-2">
                                  <p role="alert" className={`flex items-start gap-1.5 text-[13px] font-semibold leading-relaxed ${ERROR_TEXT}`}>
                                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{notSentLine(message.error_message)}
                                  </p>
                                  <button type="button" onClick={() => retry(message)} disabled={sending} className={`mt-2 ${BTN}`}>
                                    {sending ? <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" /> : <RefreshCw className="w-4 h-4" aria-hidden="true" />}
                                    Try again
                                  </button>
                                </div>
                              )}
                              {outbound && state === 'sent' && <p className={`mt-1 text-[11px] ${MUTED}`}>Sent</p>}
                              {!outbound && ['comment', 'mention'].includes(message.message_type || '') && canReply && (
                                <div className="mt-2 text-right">
                                  <button
                                    onClick={() => setReplyingTo({ id: message.provider_message_id || message.id, author: message.author_name })}
                                    className={`text-[12px] font-semibold flex items-center gap-1 ml-auto rounded ${MUTED} hover:text-[var(--gv-text-primary)] ${FOCUS}`}
                                  >
                                    <MessageCircle className="w-3 h-3" aria-hidden="true" /> Reply to this comment
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="shrink-0 p-4 border-t border-[var(--gv-border-subtle)] bg-[var(--gv-panel)]">
                      {canReply ? (
                        <div className="rounded-xl border border-[var(--gv-border-default)] p-3">
                          <p className={`mb-1 text-[12px] font-semibold ${MUTED}`}>
                            {replyingTo ? replyingToLine('comment', replyingTo.author) : replyingToLine(selectedChannelType)}
                            {replyingTo && (
                              <button onClick={() => setReplyingTo(null)} className={`ml-2 rounded px-2 py-0.5 bg-[var(--gv-surface-2)] ${TEXT} ${FOCUS}`}>
                                Cancel
                              </button>
                            )}
                          </p>
                          <textarea
                            value={reply}
                            onChange={event => setReply(event.target.value)}
                            rows={3}
                            aria-label="Your reply"
                            placeholder={REPLY_PLACEHOLDER}
                            className="gravity-bare w-full bg-transparent outline-none resize-none text-sm text-[var(--gv-text-primary)] placeholder:text-[var(--gv-text-tertiary)]"
                          />
                          {sendError && (
                            <p role="alert" className={`mb-1 flex items-start gap-1.5 text-[13px] font-semibold ${ERROR_TEXT}`}>
                              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{sendError}
                            </p>
                          )}
                          <div className="flex items-center justify-between gap-3 pt-2">
                            <p className={`text-xs ${MUTED}`}>{REPLY_BOX_HINT}</p>
                            <button onClick={sendReply} disabled={sending || !reply.trim()} className={BTN_MAIN}>
                              {sending ? <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" /> : <Send className="w-4 h-4" aria-hidden="true" />}
                              Send
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className={`text-sm ${MUTED}`}>Replies are only available for Instagram and Facebook.</p>
                      )}
                    </div>
                  </div>

                  <aside className="hidden xl:flex flex-col min-h-0 border-l border-[var(--gv-border-subtle)] bg-[var(--gv-panel)]">
                    <div className="shrink-0 p-4 border-b border-[var(--gv-border-subtle)]">
                      <h4 className={`font-semibold flex items-center gap-2 ${TEXT}`}><Sparkles className="w-4 h-4 text-[var(--gv-accent-text)]" aria-hidden="true" /> Suggested reply</h4>
                      <p className={`text-xs mt-1 ${MUTED}`}>Pick a suggestion to put it in your reply box. You can change it before sending.</p>
                    </div>
                    <div className="flex-1 p-4 space-y-4 overflow-y-auto min-h-0">
                      <div className="rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-surface-1)] p-3">
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          <div><p className={MUTED}>Mood</p><p className={`font-semibold ${TEXT}`}>{selected.sentiment === 'positive' ? 'Happy' : selected.sentiment === 'negative' ? 'Unhappy' : 'Neutral'}</p></div>
                          <div><p className={MUTED}>Looks like spam</p><p className={`font-semibold ${TEXT}`}>{Math.round((selected.spam_score || 0) * 100)}%</p></div>
                          <div><p className={MUTED}>Importance</p><p className={`font-semibold ${TEXT}`}>{priorityWord[selected.priority] || selected.priority}</p></div>
                          <div><p className={MUTED}>Status</p><p className={`font-semibold capitalize ${TEXT}`}>{selected.status}</p></div>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <p className={`text-xs font-semibold uppercase tracking-wide ${MUTED}`}>Alerts</p>
                        {notifications.length ? notifications.map(notification => (
                          <div key={notification.id} className="rounded-xl border border-[var(--gv-border-subtle)] p-3">
                            <p className={`text-sm font-semibold ${TEXT}`}>{notification.title}</p>
                            <p className={`mt-1 text-xs ${MUTED}`}>{notification.message}</p>
                          </div>
                        )) : (
                          <div className={`rounded-xl border border-[var(--gv-border-subtle)] p-3 text-sm ${MUTED}`}>New activity will show up here.</div>
                        )}
                      </div>

                      <div className="space-y-2">
                        <p className={`text-xs font-semibold uppercase tracking-wide ${MUTED}`}>{selectedAutoReplyEnabled ? 'Automatic replies' : 'Suggestions'}</p>
                        {selectedAutoReplyEnabled ? (
                          <div className={`rounded-xl border border-[var(--gv-border-subtle)] p-3 text-sm ${MUTED}`}>Automatic replies are on for {selectedChannelType === 'comment' ? 'comments' : 'direct messages'} on {platformLabel(selected.platform)}. Replies that go out are saved in this conversation.</div>
                        ) : suggestions.length ? suggestions.map(suggestion => (
                          <button key={suggestion} onClick={() => setReply(suggestion)} disabled={!canReply} className={`w-full text-left rounded-xl border border-[var(--gv-border-subtle)] p-3 text-sm leading-relaxed text-[var(--gv-text-primary)] hover:border-[var(--gv-accent)] ${FOCUS}`}>
                            <Bot className="w-4 h-4 text-[var(--gv-accent-text)] mb-2" aria-hidden="true" />
                            {suggestion}
                          </button>
                        )) : (
                          <div className={`rounded-xl border border-[var(--gv-border-subtle)] p-3 text-sm ${MUTED}`}>There is no suggested reply for this conversation yet.</div>
                        )}
                      </div>
                    </div>
                  </aside>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-center p-8">
                <div>
                  <MessageCircle className="w-10 h-10 mx-auto text-[var(--gv-text-muted)] mb-3" />
                  <p className={`font-semibold ${TEXT}`}>Pick a conversation</p>
                  <p className={`text-sm ${MUTED}`}>Comments and messages from Instagram and Facebook appear on the left.</p>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>

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
