import React, { useEffect, useState } from 'react';
import { Bot, Loader2, Plus, Save, ShieldAlert, Sparkles, Trash2 } from 'lucide-react';
import { AutoReplySettings, inboxAPI } from '../services/api';
import { useTheme, getThemeClasses } from '../context/ThemeContext';

const defaultSettings: AutoReplySettings = {
  enabled: false,
  automationMode: 'suggested',
  channels: { messages: true, comments: false, mentions: false, replies: false },
  platforms: { instagram: true, facebook: true, linkedin: true, x: true, youtube: true },
  businessTone: 'professional',
  replyStyle: 'friendly',
  responseRules: [],
  guardrails: {
    requireApprovalForNegative: true,
    requireApprovalForHighPriority: true,
    skipSpam: true,
    maxAutoRepliesPerConversationPerDay: 3,
    signature: ''
  }
};

const AutoReplySettingsPage: React.FC = () => {
  const { isDarkMode } = useTheme();
  const theme = getThemeClasses(isDarkMode);
  const [settings, setSettings] = useState<AutoReplySettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res = await inboxAPI.getSettings();
        setSettings({ ...defaultSettings, ...(res.settings || {}) });
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const updateNested = (section: 'channels' | 'platforms' | 'guardrails', key: string, value: any) => {
    setSettings(prev => ({
      ...prev,
      [section]: {
        ...(prev as any)[section],
        [key]: value
      }
    }));
  };

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const res = await inboxAPI.updateSettings(settings);
      setSettings({ ...defaultSettings, ...(res.settings || {}) });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1600);
    } finally {
      setSaving(false);
    }
  };

  const addRule = () => {
    setSettings(prev => ({
      ...prev,
      responseRules: [
        ...(prev.responseRules || []),
        {
          name: 'New rule',
          enabled: true,
          matchType: 'contains',
          value: '',
          action: 'suggest_only',
          priority: 0
        }
      ]
    }));
  };

  const updateRule = (index: number, key: string, value: any) => {
    setSettings(prev => ({
      ...prev,
      responseRules: prev.responseRules.map((rule, i) => i === index ? { ...rule, [key]: value } : rule)
    }));
  };

  const removeRule = (index: number) => {
    setSettings(prev => ({
      ...prev,
      responseRules: prev.responseRules.filter((_, i) => i !== index)
    }));
  };

  if (loading) {
    return <div className={`rounded-lg border p-8 ${theme.bgCard} ${theme.border}`}><Loader2 className="h-6 w-6 animate-spin text-[#ffcc29]" /></div>;
  }

  const inputClass = `w-full rounded-lg border px-3 py-2 text-sm outline-none ${theme.input}`;

  return (
    <div className="space-y-5">
      <div className={`rounded-lg border p-5 ${theme.bgCard} ${theme.border}`}>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-[#ffcc29] p-3 text-[#070A12]">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <h2 className={`text-xl font-bold ${theme.text}`}>AI Automatic Replies</h2>
              <p className={`mt-1 text-sm ${theme.textSecondary}`}>Configure suggested replies, approval workflows, and safe automatic responses.</p>
            </div>
          </div>
          <button onClick={save} disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#ffcc29] px-4 py-2.5 text-sm font-bold text-[#070A12] disabled:opacity-60">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saved ? 'Saved' : 'Save Settings'}
          </button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <section className={`rounded-lg border p-5 ${theme.bgCard} ${theme.border}`}>
          <h3 className={`font-semibold ${theme.text}`}>Automation Mode</h3>
          <label className="mt-4 flex items-center justify-between gap-3">
            <span className={`text-sm ${theme.textSecondary}`}>Enable automation</span>
            <input type="checkbox" checked={settings.enabled} onChange={(e) => setSettings(prev => ({ ...prev, enabled: e.target.checked }))} />
          </label>
          <select className={`${inputClass} mt-4`} value={settings.automationMode} onChange={(e) => setSettings(prev => ({ ...prev, automationMode: e.target.value as any }))}>
            <option value="suggested">Suggested replies only</option>
            <option value="approval_required">Approval before sending</option>
            <option value="fully_automatic">Fully automatic</option>
          </select>
          <select className={`${inputClass} mt-3`} value={settings.businessTone} onChange={(e) => setSettings(prev => ({ ...prev, businessTone: e.target.value }))}>
            <option value="professional">Professional</option>
            <option value="friendly">Friendly</option>
            <option value="luxury">Luxury</option>
            <option value="playful">Playful</option>
            <option value="supportive">Supportive</option>
          </select>
          <select className={`${inputClass} mt-3`} value={settings.replyStyle} onChange={(e) => setSettings(prev => ({ ...prev, replyStyle: e.target.value as any }))}>
            <option value="friendly">Friendly</option>
            <option value="concise">Concise</option>
            <option value="detailed">Detailed</option>
            <option value="sales">Sales</option>
            <option value="support">Support</option>
          </select>
        </section>

        <section className={`rounded-lg border p-5 ${theme.bgCard} ${theme.border}`}>
          <h3 className={`font-semibold ${theme.text}`}>Channels</h3>
          {Object.entries(settings.channels).map(([key, value]) => (
            <label key={key} className="mt-3 flex items-center justify-between gap-3 capitalize">
              <span className={`text-sm ${theme.textSecondary}`}>{key}</span>
              <input type="checkbox" checked={Boolean(value)} onChange={(e) => updateNested('channels', key, e.target.checked)} />
            </label>
          ))}
        </section>

        <section className={`rounded-lg border p-5 ${theme.bgCard} ${theme.border}`}>
          <h3 className={`font-semibold ${theme.text}`}>Platforms</h3>
          {Object.entries(settings.platforms).map(([key, value]) => (
            <label key={key} className="mt-3 flex items-center justify-between gap-3 capitalize">
              <span className={`text-sm ${theme.textSecondary}`}>{key === 'x' ? 'X/Twitter' : key}</span>
              <input type="checkbox" checked={Boolean(value)} onChange={(e) => updateNested('platforms', key, e.target.checked)} />
            </label>
          ))}
        </section>
      </div>

      <section className={`rounded-lg border p-5 ${theme.bgCard} ${theme.border}`}>
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-[#ffcc29]" />
          <h3 className={`font-semibold ${theme.text}`}>Safety Guardrails</h3>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className={`rounded-lg p-3 ${isDarkMode ? 'bg-slate-900/70' : 'bg-slate-50'}`}>
            <span className={`block text-sm ${theme.textSecondary}`}>Require approval for negative sentiment</span>
            <input className="mt-2" type="checkbox" checked={settings.guardrails.requireApprovalForNegative} onChange={(e) => updateNested('guardrails', 'requireApprovalForNegative', e.target.checked)} />
          </label>
          <label className={`rounded-lg p-3 ${isDarkMode ? 'bg-slate-900/70' : 'bg-slate-50'}`}>
            <span className={`block text-sm ${theme.textSecondary}`}>Require approval for high priority</span>
            <input className="mt-2" type="checkbox" checked={settings.guardrails.requireApprovalForHighPriority} onChange={(e) => updateNested('guardrails', 'requireApprovalForHighPriority', e.target.checked)} />
          </label>
          <label className={`rounded-lg p-3 ${isDarkMode ? 'bg-slate-900/70' : 'bg-slate-50'}`}>
            <span className={`block text-sm ${theme.textSecondary}`}>Skip spam-like messages</span>
            <input className="mt-2" type="checkbox" checked={settings.guardrails.skipSpam} onChange={(e) => updateNested('guardrails', 'skipSpam', e.target.checked)} />
          </label>
          <label className={`rounded-lg p-3 ${isDarkMode ? 'bg-slate-900/70' : 'bg-slate-50'}`}>
            <span className={`block text-sm ${theme.textSecondary}`}>Max auto replies per conversation per day</span>
            <input className={`${inputClass} mt-2`} type="number" min={0} max={20} value={settings.guardrails.maxAutoRepliesPerConversationPerDay} onChange={(e) => updateNested('guardrails', 'maxAutoRepliesPerConversationPerDay', Number(e.target.value))} />
          </label>
        </div>
      </section>

      <section className={`rounded-lg border p-5 ${theme.bgCard} ${theme.border}`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className={`font-semibold ${theme.text}`}>Response Rules</h3>
            <p className={`text-sm ${theme.textSecondary}`}>Override automation behavior for specific words, sentiment, platforms, or message types.</p>
          </div>
          <button onClick={addRule} className="inline-flex items-center gap-2 rounded-lg border border-[#ffcc29]/60 px-3 py-2 text-sm font-semibold text-[#ffcc29]">
            <Plus className="h-4 w-4" /> Rule
          </button>
        </div>
        <div className="mt-4 space-y-3">
          {settings.responseRules.map((rule, index) => (
            <div key={rule._id || index} className={`grid gap-2 rounded-lg p-3 md:grid-cols-[1fr_130px_1fr_150px_80px_40px] ${isDarkMode ? 'bg-slate-900/70' : 'bg-slate-50'}`}>
              <input className={inputClass} value={rule.name} onChange={(e) => updateRule(index, 'name', e.target.value)} placeholder="Rule name" />
              <select className={inputClass} value={rule.matchType} onChange={(e) => updateRule(index, 'matchType', e.target.value)}>
                <option value="contains">Contains</option>
                <option value="regex">Regex</option>
                <option value="sentiment">Sentiment</option>
                <option value="messageType">Message Type</option>
                <option value="platform">Platform</option>
              </select>
              <input className={inputClass} value={rule.value} onChange={(e) => updateRule(index, 'value', e.target.value)} placeholder="Match value" />
              <select className={inputClass} value={rule.action} onChange={(e) => updateRule(index, 'action', e.target.value)}>
                <option value="suggest_only">Suggest</option>
                <option value="needs_approval">Approval</option>
                <option value="auto_reply">Auto reply</option>
                <option value="skip">Skip</option>
              </select>
              <input className={inputClass} type="number" value={rule.priority} onChange={(e) => updateRule(index, 'priority', Number(e.target.value))} />
              <button onClick={() => removeRule(index)} className="rounded-lg p-2 text-red-400 hover:bg-red-500/10"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          {!settings.responseRules.length && (
            <div className={`rounded-lg border border-dashed p-6 text-center ${theme.border}`}>
              <Sparkles className="mx-auto h-6 w-6 text-[#ffcc29]" />
              <p className={`mt-2 text-sm ${theme.textSecondary}`}>No custom rules yet. Default guardrails will control AI replies.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default AutoReplySettingsPage;
