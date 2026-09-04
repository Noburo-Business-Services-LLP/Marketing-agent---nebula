import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, X, RotateCcw, Check, Copy, AlertTriangle } from 'lucide-react';
import { promptsAPI, EditablePrompt } from '../services/api';

/**
 * Read and edit the prompts that drive generation.
 *
 * Opened from where generation happens rather than living on a settings page
 * of its own: the point is to change a prompt, run it, look at the result and
 * change it again, and a separate page turns that loop into navigation.
 */
const PromptStudio: React.FC<{
  open: boolean;
  onClose: () => void;
  /** Which prompt to open on. Falls back to the first. */
  focus?: string;
}> = ({ open, onClose, focus }) => {
  const [prompts, setPrompts] = useState<EditablePrompt[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await promptsAPI.list();
        if (cancelled) return;
        const list = res.prompts || [];
        setPrompts(list);
        setDrafts(Object.fromEntries(list.map((p) => [p.id, p.template])));
        setActiveId(list.some((p) => p.id === focus) ? focus! : list[0]?.id || '');
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Could not load your prompts.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open, focus]);

  const active = useMemo(() => prompts.find((p) => p.id === activeId), [prompts, activeId]);
  const draft = active ? drafts[active.id] ?? '' : '';
  const dirty = Boolean(active && draft !== active.template);

  // A placeholder the template no longer mentions is dropped silently at
  // render time, so it is worth pointing out before the next generation runs.
  const missing = useMemo(() => {
    if (!active) return [];
    const used = new Set(Array.from(draft.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g), (m) => m[1]));
    return Object.keys(active.variables).filter((v) => !used.has(v));
  }, [active, draft]);

  const setDraft = (value: string) => {
    if (!active) return;
    setDrafts((d) => ({ ...d, [active.id]: value }));
  };

  const applyResult = (template: string, isEdited: boolean) => {
    if (!active) return;
    setPrompts((ps) => ps.map((p) => (p.id === active.id ? { ...p, template, isEdited } : p)));
    setDrafts((d) => ({ ...d, [active.id]: template }));
    setSavedAt(Date.now());
  };

  const handleSave = async () => {
    if (!active || !dirty) return;
    setSaving(true);
    setError('');
    try {
      const res = await promptsAPI.save(active.id, draft);
      applyResult(res.template, res.isEdited);
    } catch (err: any) {
      setError(err?.message || 'Could not save that prompt.');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!active) return;
    setSaving(true);
    setError('');
    try {
      const res = await promptsAPI.reset(active.id);
      applyResult(res.template, false);
    } catch (err: any) {
      setError(err?.message || 'Could not reset that prompt.');
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError('Could not copy. Select the text and copy it by hand.');
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4">
      <div className="gravity-glow w-full max-w-5xl rounded-2xl">
        <div className="relative w-full rounded-2xl border border-white/[0.08] bg-[#111111] shadow-2xl flex flex-col max-h-[88vh] overflow-hidden">

          <div className="px-6 py-5 border-b border-white/[0.06] flex items-start justify-between gap-4">
            <div>
              <h3 className="font-serif-display text-[22px] text-[#F5F4F1]">The prompts behind your posts</h3>
              <p className="text-[12.5px] text-white/45 mt-1">
                Edit these and the next thing you generate uses your version. Changes apply to your account only.
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-white/40 hover:text-white hover:bg-white/[0.06]"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 animate-spin text-[#F5A623]" />
            </div>
          ) : prompts.length === 0 ? (
            <div className="text-center py-16 px-6">
              <p className="text-[13.5px] text-[#F5F4F1]">{error || 'No prompts available.'}</p>
            </div>
          ) : (
            <>
              <div className="px-6 py-3.5 border-b border-white/[0.06] flex flex-wrap gap-2">
                {prompts.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setActiveId(p.id)}
                    className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${
                      p.id === activeId
                        ? 'bg-[#F5A623] text-[#1A1208]'
                        : 'text-white/55 hover:text-[#F5F4F1] hover:bg-white/[0.05] border border-white/[0.08]'
                    }`}
                  >
                    {p.label}
                    {p.isEdited && (
                      <span className={p.id === activeId ? 'ml-1.5 opacity-70' : 'ml-1.5 text-[#F5A623]'}>· edited</span>
                    )}
                  </button>
                ))}
              </div>

              {active && (
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                  <p className="text-[12.5px] text-white/55 leading-relaxed">{active.summary}</p>

                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    spellCheck={false}
                    rows={18}
                    className="gravity-bare w-full p-4 rounded-xl bg-white/[0.03] border border-white/[0.08] text-[12.5px] leading-relaxed text-[#F5F4F1] font-mono outline-none focus:border-[#F5A623]/40 resize-y"
                  />

                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-white/30 mb-2">
                      Placeholders you can use
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5">
                      {Object.entries(active.variables).map(([name, meaning]) => (
                        <div key={name} className="flex gap-2 text-[11.5px]">
                          <button
                            onClick={() => setDraft(`${draft}{{${name}}}`)}
                            className="font-mono text-[#F5A623] hover:underline shrink-0"
                            title="Add to the end of the prompt"
                          >
                            {`{{${name}}}`}
                          </button>
                          <span className="text-white/40">{meaning}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {missing.length > 0 && (
                    <div className="flex gap-2.5 rounded-lg border border-[#F5A623]/25 bg-[#F5A623]/[0.06] px-3.5 py-2.5">
                      <AlertTriangle className="w-4 h-4 text-[#F5A623] shrink-0 mt-0.5" />
                      <p className="text-[11.5px] text-white/60 leading-relaxed">
                        Not used any more: <span className="font-mono text-white/80">{missing.join(', ')}</span>.
                        That is fine if you meant it — the model simply will not be told those things.
                      </p>
                    </div>
                  )}

                  {error && <p className="text-[12px] text-red-400">{error}</p>}
                </div>
              )}

              <div className="px-6 py-4 border-t border-white/[0.06] flex items-center gap-3">
                <button
                  onClick={handleCopy}
                  className="px-3 py-2 rounded-lg text-[12.5px] text-white/60 hover:text-[#F5F4F1] hover:bg-white/[0.05] border border-white/[0.08] transition-all inline-flex items-center gap-2"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-[#F5A623]" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>

                <button
                  onClick={handleReset}
                  disabled={saving || !active?.isEdited}
                  className="px-3 py-2 rounded-lg text-[12.5px] text-white/60 hover:text-[#F5F4F1] hover:bg-white/[0.05] border border-white/[0.08] transition-all inline-flex items-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset to default
                </button>

                <div className="ml-auto flex items-center gap-3">
                  {savedAt > 0 && !dirty && (
                    <span className="text-[11.5px] text-white/40">Saved</span>
                  )}
                  <button
                    onClick={handleSave}
                    disabled={!dirty || saving}
                    className="px-4 py-2 rounded-lg text-[12.5px] font-semibold bg-[#F5A623] text-[#1A1208] hover:brightness-110 transition-all inline-flex items-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Save
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default PromptStudio;
