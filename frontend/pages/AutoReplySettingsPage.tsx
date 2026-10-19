import React, { useEffect, useState } from 'react';
import { AlertCircle, Bot, Loader2, Plus, Save, ShieldAlert, Sparkles, Trash2 } from 'lucide-react';
import { AutoReplySettings, inboxAPI } from '../services/api';
import UpgradePrompt from '../components/UpgradePrompt';
import InboxConfirmDialog from '../components/InboxConfirmDialog';
import { BTN, BTN_MAIN, CARD, ERROR_TEXT, FIELD, MUTED, TEXT } from '../components/inboxStyles';
import { UpgradeInfo, upgradeInfoOf } from '../utils/plans';
import { customerMessage } from '../utils/errors';
import { needsAutoConfirm, settingsPlatformsText } from '../utils/inbox';

const defaultSettings: AutoReplySettings = {
  enabled: false,
  automationMode: 'suggested',
  channels: { messages: true, comments: false, mentions: false, replies: false },
  platforms: { instagram: true, facebook: true, linkedin: false, x: false, youtube: false },
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

const CHANNEL_LABELS: Record<string, string> = {
  messages: 'Direct messages',
  comments: 'Comments on your posts',
  mentions: 'Times you are mentioned',
  replies: 'Replies to your comments',
};

// Only these two can receive and answer. The others are never shown.
const PLATFORM_ROWS: Array<{ key: 'instagram' | 'facebook'; label: string }> = [
  { key: 'instagram', label: 'Instagram' },
  { key: 'facebook', label: 'Facebook' },
];

/** `onSaved` tells the Inbox page the saved settings, so its Automatic replies tile shows the new status. */
const AutoReplySettingsPage: React.FC<{ onSaved?: (settings: AutoReplySettings) => void }> = ({ onSaved }) => {
  const [settings, setSettings] = useState<AutoReplySettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [upgrade, setUpgrade] = useState<UpgradeInfo | null>(null);
  // The mode the server has now, and whether the owner just agreed to Fully automatic (sent as confirm on the next save).
  const [savedMode, setSavedMode] = useState<string>('suggested');
  const [confirmedAuto, setConfirmedAuto] = useState(false);
  const [askAuto, setAskAuto] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res = await inboxAPI.getSettings();
        setSettings({ ...defaultSettings, ...(res.settings || {}) });
        setSavedMode(res.settings?.automationMode || 'suggested');
      } catch (e: any) {
        setUpgrade(upgradeInfoOf(e));
        if (!upgradeInfoOf(e)) setSaveError(customerMessage(e, 'We could not load your settings. Please try again.'));
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

  const chooseMode = (mode: AutoReplySettings['automationMode']) => {
    if (needsAutoConfirm(settings.automationMode, mode) && needsAutoConfirm(savedMode, mode)) {
      setAskAuto(true);
      return;
    }
    setSettings(prev => ({ ...prev, automationMode: mode }));
    if (mode !== 'fully_automatic') setConfirmedAuto(false);
  };

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setSaveError('');
    try {
      const sendConfirm = confirmedAuto && needsAutoConfirm(savedMode, settings.automationMode);
      const res = await inboxAPI.updateSettings(settings, sendConfirm);
      const next = { ...defaultSettings, ...(res.settings || {}) };
      setSettings(next);
      onSaved?.(next);
      setSavedMode(res.settings?.automationMode || settings.automationMode);
      setConfirmedAuto(false);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1600);
    } catch (e: any) {
      const up = upgradeInfoOf(e);
      if (up) setUpgrade(up);
      else setSaveError(customerMessage(e, 'We could not save your settings. Please try again.'));
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
    return <div className={`${CARD} p-8`} role="status" aria-label="Loading"><Loader2 className="h-6 w-6 animate-spin motion-reduce:animate-none text-[var(--gv-accent-text)]" /></div>;
  }

  if (upgrade) return <UpgradePrompt reason={upgrade.reason} feature={upgrade.feature} />;

  const section = `${CARD} p-5`;
  const tile = 'rounded-lg bg-[var(--gv-surface-1)] p-3';

  return (
    <div className="space-y-5">
      <div className={section}>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-[var(--gv-accent)] p-3 text-[var(--gv-accent-ink)]">
              <Bot className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className={`text-xl font-semibold ${TEXT}`}>Automatic replies</h2>
              <p className={`mt-1 text-sm ${MUTED}`}>Choose how Nebulaa answers comments and messages for you: suggest, ask you first, or send on its own.</p>
            </div>
          </div>
          <button onClick={save} disabled={saving} className={BTN_MAIN}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Save className="h-4 w-4" aria-hidden="true" />}
            {saved ? 'Saved' : 'Save settings'}
          </button>
        </div>
        {saveError && (
          <p role="alert" className={`mt-3 flex items-start gap-1.5 text-[13px] font-semibold ${ERROR_TEXT}`}>
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{saveError}
          </p>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <section className={section}>
          <h3 className={`font-semibold ${TEXT}`}>How replies are sent</h3>
          <label className="mt-4 flex items-center justify-between gap-3">
            <span className={`text-sm ${MUTED}`}>Use automatic replies</span>
            <input type="checkbox" checked={settings.enabled} onChange={(e) => setSettings(prev => ({ ...prev, enabled: e.target.checked }))} />
          </label>
          <label className={`mt-4 block text-xs font-semibold ${MUTED}`} htmlFor="auto-mode">When a new message arrives</label>
          <select id="auto-mode" className={`${FIELD} mt-1`} value={settings.automationMode} onChange={(e) => chooseMode(e.target.value as AutoReplySettings['automationMode'])}>
            <option value="suggested">Only suggest a reply</option>
            <option value="approval_required">Ask me before sending</option>
            <option value="fully_automatic">Send automatically</option>
          </select>
          <label className={`mt-3 block text-xs font-semibold ${MUTED}`} htmlFor="auto-tone">Tone of voice</label>
          <select id="auto-tone" className={`${FIELD} mt-1`} value={settings.businessTone} onChange={(e) => setSettings(prev => ({ ...prev, businessTone: e.target.value }))}>
            <option value="professional">Professional</option>
            <option value="friendly">Friendly</option>
            <option value="luxury">Luxury</option>
            <option value="playful">Playful</option>
            <option value="supportive">Supportive</option>
          </select>
          <label className={`mt-3 block text-xs font-semibold ${MUTED}`} htmlFor="auto-style">Reply style</label>
          <select id="auto-style" className={`${FIELD} mt-1`} value={settings.replyStyle} onChange={(e) => setSettings(prev => ({ ...prev, replyStyle: e.target.value as any }))}>
            <option value="friendly">Friendly</option>
            <option value="concise">Short</option>
            <option value="detailed">Detailed</option>
            <option value="sales">Sales</option>
            <option value="support">Helpful support</option>
          </select>
          <label className={`mt-3 block text-xs font-semibold ${MUTED}`} htmlFor="auto-sign">Sign-off added to every reply (optional)</label>
          <input id="auto-sign" className={`${FIELD} mt-1`} value={settings.guardrails.signature || ''} onChange={(e) => updateNested('guardrails', 'signature', e.target.value)} placeholder="For example: Team Nebulaa" />
        </section>

        <section className={section}>
          <h3 className={`font-semibold ${TEXT}`}>What to answer</h3>
          {Object.entries(settings.channels).map(([key, value]) => (
            <label key={key} className="mt-3 flex items-center justify-between gap-3">
              <span className={`text-sm ${MUTED}`}>{CHANNEL_LABELS[key] || key}</span>
              <input type="checkbox" checked={Boolean(value)} onChange={(e) => updateNested('channels', key, e.target.checked)} />
            </label>
          ))}
        </section>

        <section className={section}>
          <h3 className={`font-semibold ${TEXT}`}>Where</h3>
          <p className={`mt-1 text-xs ${MUTED}`}>Nebulaa can answer on {settingsPlatformsText} for now.</p>
          {PLATFORM_ROWS.map(({ key, label }) => (
            <label key={key} className="mt-3 flex items-center justify-between gap-3">
              <span className={`text-sm ${MUTED}`}>{label}</span>
              <input type="checkbox" checked={Boolean(settings.platforms[key])} onChange={(e) => updateNested('platforms', key, e.target.checked)} />
            </label>
          ))}
        </section>
      </div>

      <section className={section}>
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-[var(--gv-accent-text)]" aria-hidden="true" />
          <h3 className={`font-semibold ${TEXT}`}>Safety checks</h3>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className={tile}>
            <span className={`block text-sm ${MUTED}`}>Ask me first when someone sounds unhappy</span>
            <input className="mt-2" type="checkbox" checked={settings.guardrails.requireApprovalForNegative} onChange={(e) => updateNested('guardrails', 'requireApprovalForNegative', e.target.checked)} />
          </label>
          <label className={tile}>
            <span className={`block text-sm ${MUTED}`}>Ask me first when a message is important</span>
            <input className="mt-2" type="checkbox" checked={settings.guardrails.requireApprovalForHighPriority} onChange={(e) => updateNested('guardrails', 'requireApprovalForHighPriority', e.target.checked)} />
          </label>
          <label className={tile}>
            <span className={`block text-sm ${MUTED}`}>Do not answer messages that look like spam</span>
            <input className="mt-2" type="checkbox" checked={settings.guardrails.skipSpam} onChange={(e) => updateNested('guardrails', 'skipSpam', e.target.checked)} />
          </label>
          <label className={tile}>
            <span className={`block text-sm ${MUTED}`}>Most automatic replies to one person in a day</span>
            <input className={`${FIELD} mt-2`} type="number" min={0} max={20} value={settings.guardrails.maxAutoRepliesPerConversationPerDay} onChange={(e) => updateNested('guardrails', 'maxAutoRepliesPerConversationPerDay', Number(e.target.value))} />
          </label>
        </div>
      </section>

      <section className={section}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className={`font-semibold ${TEXT}`}>Your own rules</h3>
            <p className={`text-sm ${MUTED}`}>Decide what happens for certain words, moods, platforms or kinds of message.</p>
          </div>
          <button onClick={addRule} className={BTN}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Add a rule
          </button>
        </div>
        <div className="mt-4 space-y-3">
          {settings.responseRules.map((rule, index) => (
            <div key={rule._id || index} className={`grid gap-2 md:grid-cols-[1fr_150px_1fr_170px_44px] ${tile}`}>
              <input className={FIELD} aria-label="Rule name" value={rule.name} onChange={(e) => updateRule(index, 'name', e.target.value)} placeholder="Rule name" />
              <select className={FIELD} aria-label="Match on" value={rule.matchType} onChange={(e) => updateRule(index, 'matchType', e.target.value)}>
                <option value="contains">Contains the words</option>
                <option value="sentiment">Mood</option>
                <option value="messageType">Kind of message</option>
                <option value="platform">Platform</option>
                {rule.matchType === 'regex' && <option value="regex" disabled>Old pattern rule</option>}
              </select>
              <input className={FIELD} aria-label="Match value" value={rule.value} onChange={(e) => updateRule(index, 'value', e.target.value)} placeholder="What to look for" />
              <select className={FIELD} aria-label="What to do" value={rule.action} onChange={(e) => updateRule(index, 'action', e.target.value)}>
                <option value="suggest_only">Suggest a reply</option>
                <option value="needs_approval">Ask me first</option>
                <option value="auto_reply">Reply automatically</option>
                <option value="skip">Do not reply</option>
              </select>
              <button onClick={() => removeRule(index)} aria-label="Delete this rule" className={`${BTN} !px-2 text-[var(--gv-coral-text)]`}><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          {!settings.responseRules.length && (
            <div className="rounded-lg border border-dashed border-[var(--gv-border-default)] p-6 text-center">
              <Sparkles className="mx-auto h-6 w-6 text-[var(--gv-accent-text)]" aria-hidden="true" />
              <p className={`mt-2 text-sm ${MUTED}`}>No rules of your own yet. The safety checks above decide what Nebulaa does.</p>
            </div>
          )}
        </div>
      </section>

      {askAuto && (
        <InboxConfirmDialog
          where={settingsPlatformsText}
          onCancel={() => setAskAuto(false)}
          onConfirm={() => {
            setSettings(prev => ({ ...prev, automationMode: 'fully_automatic' }));
            setConfirmedAuto(true);
            setAskAuto(false);
          }}
        />
      )}
    </div>
  );
};

export default AutoReplySettingsPage;
