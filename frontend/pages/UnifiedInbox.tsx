import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCheck,
  Clock,
  Facebook,
  Filter,
  Hash,
  Instagram,
  Linkedin,
  Loader2,
  MessageCircle,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  Star,
  Tag,
  Twitter,
  Youtube,
} from 'lucide-react';
import { inboxAPI, InboxConversation, InboxMessage } from '../services/api';
import { useTheme } from '../context/ThemeContext';

type Platform = 'instagram' | 'facebook' | 'linkedin' | 'x' | 'youtube';

const fallbackConversations: InboxConversation[] = [
  {
    id: 'demo-ig-1',
    platform: 'instagram',
    participant_name: 'Priya Sharma',
    participant_username: 'priya.shop',
    last_message_preview: 'Is the blue variant available this week?',
    last_message_at: new Date(Date.now() - 1000 * 60 * 14).toISOString(),
    status: 'unread',
    priority: 'high',
    tags: ['lead', 'product'],
    sentiment: 'neutral',
    spam_score: 0.03,
    social_account_id: 'demo',
  },
  {
    id: 'demo-fb-1',
    platform: 'facebook',
    participant_name: 'Arjun Mehta',
    participant_username: 'arjun.m',
    last_message_preview: 'Thanks, the campaign offer looks great.',
    last_message_at: new Date(Date.now() - 1000 * 60 * 78).toISOString(),
    status: 'read',
    priority: 'normal',
    tags: ['support'],
    sentiment: 'positive',
    spam_score: 0.01,
    social_account_id: 'demo',
  },
  {
    id: 'demo-x-1',
    platform: 'x',
    participant_name: 'Growth Pulse',
    participant_username: 'growthpulse',
    last_message_preview: 'Urgent: can your team clarify the pricing?',
    last_message_at: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
    status: 'unread',
    priority: 'urgent',
    tags: ['pricing'],
    sentiment: 'negative',
    spam_score: 0.08,
    social_account_id: 'demo',
  },
];

const fallbackMessages: Record<string, InboxMessage[]> = {
  'demo-ig-1': [
    {
      id: 'm1',
      conversation_id: 'demo-ig-1',
      platform: 'instagram',
      direction: 'inbound',
      message_type: 'comment',
      author_name: 'Priya Sharma',
      body: 'Is the blue variant available this week?',
      created_at: new Date(Date.now() - 1000 * 60 * 14).toISOString(),
      sentiment: 'neutral',
      spam_score: 0.03,
    },
  ],
  'demo-fb-1': [
    {
      id: 'm2',
      conversation_id: 'demo-fb-1',
      platform: 'facebook',
      direction: 'inbound',
      message_type: 'message',
      author_name: 'Arjun Mehta',
      body: 'Thanks, the campaign offer looks great.',
      created_at: new Date(Date.now() - 1000 * 60 * 78).toISOString(),
      sentiment: 'positive',
      spam_score: 0.01,
    },
  ],
  'demo-x-1': [
    {
      id: 'm3',
      conversation_id: 'demo-x-1',
      platform: 'x',
      direction: 'inbound',
      message_type: 'mention',
      author_name: 'Growth Pulse',
      body: 'Urgent: can your team clarify the pricing?',
      created_at: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
      sentiment: 'negative',
      spam_score: 0.08,
    },
  ],
};

const platformMeta: Record<Platform, { label: string; icon: React.ElementType; className: string }> = {
  instagram: { label: 'Instagram', icon: Instagram, className: 'bg-pink-500/10 text-pink-400 border-pink-500/25' },
  facebook: { label: 'Facebook', icon: Facebook, className: 'bg-blue-500/10 text-blue-400 border-blue-500/25' },
  linkedin: { label: 'LinkedIn', icon: Linkedin, className: 'bg-sky-500/10 text-sky-400 border-sky-500/25' },
  x: { label: 'X', icon: Twitter, className: 'bg-slate-500/10 text-slate-300 border-slate-500/25' },
  youtube: { label: 'YouTube', icon: Youtube, className: 'bg-red-500/10 text-red-400 border-red-500/25' },
};

const priorities = ['all', 'low', 'normal', 'high', 'urgent'];
const platforms = ['all', 'instagram', 'facebook', 'linkedin', 'x', 'youtube'];

function timeAgo(value?: string) {
  if (!value) return '';
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.floor(diff / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

const UnifiedInbox: React.FC = () => {
  const { isDarkMode } = useTheme();
  const [conversations, setConversations] = useState<InboxConversation[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [status, setStatus] = useState('all');
  const [platform, setPlatform] = useState('all');
  const [priority, setPriority] = useState('all');
  const [search, setSearch] = useState('');
  const [reply, setReply] = useState('');
  const [loading, setLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [live, setLive] = useState(false);
  const threadEndRef = useRef<HTMLDivElement>(null);

  const selected = conversations.find(item => item.id === selectedId) || conversations[0];

  const loadConversations = async () => {
    setLoading(true);
    try {
      const result = await inboxAPI.getConversations({
        status: status === 'all' ? '' : status,
        platform: platform === 'all' ? '' : platform,
        priority: priority === 'all' ? '' : priority,
        search,
      });
      const list = result.conversations?.length ? result.conversations : fallbackConversations;
      setConversations(list);
      setSelectedId(current => current || list[0]?.id || '');
    } catch {
      setConversations(fallbackConversations);
      setSelectedId(current => current || fallbackConversations[0].id);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConversations();
  }, [status, platform, priority]);

  useEffect(() => {
    const handle = window.setTimeout(loadConversations, 250);
    return () => window.clearTimeout(handle);
  }, [search]);

  useEffect(() => {
    if (!selected?.id) return;
    const loadThread = async () => {
      setThreadLoading(true);
      try {
        const result = await inboxAPI.getMessages(selected.id);
        setMessages(result.messages?.length ? result.messages : fallbackMessages[selected.id] || []);
        setSuggestions(result.ai?.suggestions || []);
      } catch {
        setMessages(fallbackMessages[selected.id] || []);
        setSuggestions([
          'Thanks for reaching out. This is available, and we can help you choose the right option.',
          'Happy to clarify. Could you share your preferred size or budget range?',
        ]);
      } finally {
        setThreadLoading(false);
      }
    };
    loadThread();
  }, [selected?.id]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const ws = inboxAPI.openSocket('demo-user');
    if (!ws) return;
    ws.onopen = () => setLive(true);
    ws.onclose = () => setLive(false);
    ws.onerror = () => setLive(false);
    ws.onmessage = event => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'inbox.message.created') {
          const conversation = payload.data?.conversation as InboxConversation;
          const message = payload.data?.message as InboxMessage;
          setConversations(current => [conversation, ...current.filter(item => item.id !== conversation.id)]);
          if (conversation.id === selectedId) setMessages(current => [...current, message]);
        }
        if (payload.type === 'inbox.message.replied') {
          const message = payload.data as InboxMessage;
          if (message.conversation_id === selectedId) setMessages(current => [...current, message]);
        }
      } catch {
        setLive(false);
      }
    };
    return () => ws.close();
  }, [selectedId]);

  const unreadCount = useMemo(() => conversations.filter(item => item.status === 'unread').length, [conversations]);

  const sendReply = async () => {
    if (!reply.trim() || !selected) return;
    setSending(true);
    const body = reply.trim();
    setReply('');
    try {
      const result = await inboxAPI.reply(selected.id, body);
      setMessages(current => [...current, result.message]);
      setConversations(current => current.map(item => item.id === selected.id ? { ...item, status: 'replied', last_message_preview: body } : item));
    } catch {
      setMessages(current => [...current, {
        id: `local-${Date.now()}`,
        conversation_id: selected.id,
        platform: selected.platform,
        direction: 'outbound',
        message_type: 'reply',
        author_name: 'Nebulaa',
        body,
        created_at: new Date().toISOString(),
        sentiment: 'neutral',
        spam_score: 0,
      }]);
    } finally {
      setSending(false);
    }
  };

  const markStatus = async (nextStatus: string) => {
    if (!selected) return;
    setConversations(current => current.map(item => item.id === selected.id ? { ...item, status: nextStatus } : item));
    try {
      await inboxAPI.updateStatus(selected.id, nextStatus);
    } catch {
      // Keep optimistic UI for demo mode.
    }
  };

  const shell = isDarkMode ? 'bg-[#0b0f18] border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-900';
  const muted = isDarkMode ? 'text-slate-400' : 'text-slate-500';
  const panel = isDarkMode ? 'bg-[#0d1117] border-slate-800' : 'bg-white border-slate-200';

  return (
    <div className={`min-h-[calc(100vh-7rem)] rounded-lg border overflow-hidden ${shell}`}>
      <div className={`flex flex-col lg:flex-row h-[calc(100vh-8rem)] min-h-[720px] ${isDarkMode ? 'divide-slate-800' : 'divide-slate-200'} lg:divide-x`}>
        <aside className="w-full lg:w-[360px] flex flex-col min-h-0">
          <div className={`p-4 border-b ${isDarkMode ? 'border-slate-800' : 'border-slate-200'}`}>
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-lg font-semibold">Unified Inbox</h2>
                <p className={`text-xs ${muted}`}>{unreadCount} unread conversations</p>
              </div>
              <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs ${live ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10' : 'border-slate-500/20 text-slate-400'}`}>
                <span className={`h-2 w-2 rounded-full ${live ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                Live
              </div>
            </div>

            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${panel}`}>
              <Search className="w-4 h-4 text-slate-400" />
              <input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Search conversations"
                className="w-full bg-transparent outline-none text-sm"
              />
            </div>

            <div className="grid grid-cols-3 gap-2 mt-3">
              <select value={status} onChange={event => setStatus(event.target.value)} className={`px-2 py-2 rounded-lg border text-xs outline-none ${panel}`}>
                <option value="all">All</option>
                <option value="unread">Unread</option>
                <option value="read">Read</option>
                <option value="replied">Replied</option>
              </select>
              <select value={platform} onChange={event => setPlatform(event.target.value)} className={`px-2 py-2 rounded-lg border text-xs outline-none ${panel}`}>
                {platforms.map(item => <option key={item} value={item}>{item === 'all' ? 'Platform' : platformMeta[item as Platform].label}</option>)}
              </select>
              <select value={priority} onChange={event => setPriority(event.target.value)} className={`px-2 py-2 rounded-lg border text-xs outline-none ${panel}`}>
                {priorities.map(item => <option key={item} value={item}>{item === 'all' ? 'Priority' : item}</option>)}
              </select>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="h-full flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-[#ffcc29]" /></div>
            ) : conversations.map(item => {
              const meta = platformMeta[item.platform as Platform];
              const Icon = meta?.icon || MessageCircle;
              const active = selected?.id === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                  className={`w-full text-left p-4 border-b transition-colors ${isDarkMode ? 'border-slate-800 hover:bg-slate-900/80' : 'border-slate-100 hover:bg-slate-50'} ${active ? isDarkMode ? 'bg-slate-900' : 'bg-[#ffcc29]/10' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-lg border flex items-center justify-center shrink-0 ${meta?.className}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-sm truncate">{item.participant_name || item.participant_username || 'Social user'}</p>
                        {item.status === 'unread' && <span className="w-2 h-2 rounded-full bg-[#ffcc29] shrink-0" />}
                        <span className={`ml-auto text-[11px] ${muted}`}>{timeAgo(item.last_message_at)}</span>
                      </div>
                      <p className={`text-xs truncate mt-1 ${muted}`}>{item.last_message_preview}</p>
                      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                        <span className={`px-2 py-0.5 rounded-full text-[11px] capitalize ${item.priority === 'urgent' ? 'bg-red-500/15 text-red-400' : item.priority === 'high' ? 'bg-amber-500/15 text-amber-400' : 'bg-slate-500/10 text-slate-400'}`}>{item.priority}</span>
                        {item.tags?.slice(0, 2).map(tag => <span key={tag} className="px-2 py-0.5 rounded-full text-[11px] bg-[#ffcc29]/10 text-[#d8ad20]">{tag}</span>)}
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
              <header className={`p-4 border-b flex flex-wrap items-center justify-between gap-3 ${isDarkMode ? 'border-slate-800' : 'border-slate-200'}`}>
                <div className="flex items-center gap-3 min-w-0">
                  {(() => {
                    const meta = platformMeta[selected.platform as Platform];
                    const Icon = meta?.icon || MessageCircle;
                    return <div className={`w-11 h-11 rounded-lg border flex items-center justify-center ${meta?.className}`}><Icon className="w-5 h-5" /></div>;
                  })()}
                  <div className="min-w-0">
                    <h3 className="font-semibold truncate">{selected.participant_name || 'Social user'}</h3>
                    <p className={`text-xs truncate ${muted}`}>@{selected.participant_username || selected.platform} on {platformMeta[selected.platform as Platform]?.label}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => markStatus('read')} className={`p-2 rounded-lg border ${panel}`} title="Mark read"><CheckCheck className="w-4 h-4" /></button>
                  <button onClick={loadConversations} className={`p-2 rounded-lg border ${panel}`} title="Refresh"><RefreshCw className="w-4 h-4" /></button>
                </div>
              </header>

              <div className="flex-1 grid xl:grid-cols-[1fr_320px] min-h-0">
                <div className="flex flex-col min-h-0">
                  <div className={`flex-1 overflow-y-auto p-4 space-y-4 ${isDarkMode ? 'bg-[#080b12]' : 'bg-slate-50'}`}>
                    {threadLoading ? (
                      <div className="h-full flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-[#ffcc29]" /></div>
                    ) : messages.map(message => {
                      const outbound = message.direction === 'outbound';
                      return (
                        <div key={message.id} className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[78%] rounded-lg px-4 py-3 border ${outbound ? 'bg-[#ffcc29] text-[#070A12] border-[#ffcc29]' : panel}`}>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-semibold">{outbound ? 'Nebulaa' : message.author_name}</span>
                              <span className="text-[11px] opacity-60">{timeAgo(message.created_at)}</span>
                            </div>
                            <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.body}</p>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={threadEndRef} />
                  </div>

                  <div className={`p-4 border-t ${isDarkMode ? 'border-slate-800 bg-[#0d1117]' : 'border-slate-200 bg-white'}`}>
                    <div className={`rounded-lg border ${panel} p-3`}>
                      <textarea
                        value={reply}
                        onChange={event => setReply(event.target.value)}
                        rows={3}
                        placeholder="Reply across the original social platform"
                        className="w-full bg-transparent outline-none resize-none text-sm"
                      />
                      <div className="flex items-center justify-between pt-2">
                        <div className={`flex items-center gap-2 text-xs ${muted}`}>
                          <ShieldAlert className="w-4 h-4" />
                          Sends through the connected platform API
                        </div>
                        <button
                          onClick={sendReply}
                          disabled={sending || !reply.trim()}
                          className="px-4 py-2 rounded-lg bg-[#ffcc29] text-[#070A12] font-semibold text-sm flex items-center gap-2 disabled:opacity-50"
                        >
                          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                          Send
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <aside className={`hidden xl:flex flex-col border-l ${isDarkMode ? 'border-slate-800 bg-[#0d1117]' : 'border-slate-200 bg-white'}`}>
                  <div className="p-4 border-b border-inherit">
                    <h4 className="font-semibold flex items-center gap-2"><Sparkles className="w-4 h-4 text-[#ffcc29]" /> AI Assist</h4>
                    <p className={`text-xs mt-1 ${muted}`}>Reply suggestions, sentiment, spam risk, and priority tagging.</p>
                  </div>
                  <div className="p-4 space-y-4 overflow-y-auto">
                    <div className={`rounded-lg border p-3 ${panel}`}>
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div><p className={muted}>Sentiment</p><p className="font-semibold capitalize">{selected.sentiment || 'neutral'}</p></div>
                        <div><p className={muted}>Spam</p><p className="font-semibold">{Math.round((selected.spam_score || 0) * 100)}%</p></div>
                        <div><p className={muted}>Priority</p><p className="font-semibold capitalize">{selected.priority}</p></div>
                        <div><p className={muted}>Status</p><p className="font-semibold capitalize">{selected.status}</p></div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Suggestions</p>
                      {suggestions.map(suggestion => (
                        <button key={suggestion} onClick={() => setReply(suggestion)} className={`w-full text-left rounded-lg border p-3 text-sm leading-relaxed ${panel} hover:border-[#ffcc29]/60`}>
                          <Bot className="w-4 h-4 text-[#ffcc29] mb-2" />
                          {suggestion}
                        </button>
                      ))}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {[Filter, Hash, Tag, Star, Clock, AlertTriangle].map((Icon, index) => (
                        <button key={index} className={`p-3 rounded-lg border flex items-center justify-center ${panel}`}>
                          <Icon className="w-4 h-4" />
                        </button>
                      ))}
                    </div>
                  </div>
                </aside>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-center p-8">
              <div>
                <MessageCircle className="w-10 h-10 mx-auto text-slate-400 mb-3" />
                <p className="font-semibold">No conversations yet</p>
                <p className={`text-sm ${muted}`}>Connect social accounts and webhooks to start receiving messages.</p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default UnifiedInbox;
