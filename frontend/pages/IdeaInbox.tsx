import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  ImageIcon,
  Link2,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  X
} from 'lucide-react';
import { GravityHero, GravityEmphasis } from '../components/gravity';
import { ideasAPI, draftsAPI } from '../services/api';
import { useConfirm } from '../context/ConfirmContext';

interface Idea {
  _id: string;
  text: string;
  imageUrl?: string;
  sourceUrl?: string;
  targetDate?: string | null;
  source: 'manual' | 'bulk_paste' | 'bulk_file';
  status: 'new' | 'expanded' | 'dismissed';
  draftId?: string | null;
  createdAt: string;
}

const SOURCE_LABEL: Record<Idea['source'], string> = {
  manual: '',
  bulk_paste: 'Pasted list',
  bulk_file: 'Spreadsheet'
};

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('The file could not be read.'));
    reader.readAsDataURL(file);
  });

const IdeaInbox: React.FC = () => {
  const confirm = useConfirm();
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Single-add form
  const [text, setText] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Bulk paste
  const [bulkText, setBulkText] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Per-idea busy state, so "Turn into a post" on one card doesn't disable
  // every other button on the page while it runs.
  const [expandingId, setExpandingId] = useState<string | null>(null);

  const loadIdeas = async () => {
    setLoading(true);
    try {
      const res = await ideasAPI.getAll();
      setIdeas(Array.isArray(res?.ideas) ? res.ideas : []);
    } catch (err: any) {
      setError(err?.message || 'The ideas could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadIdeas(); }, []);

  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(''), 3000);
    return () => clearTimeout(t);
  }, [success]);

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setImagePreview(await fileToBase64(file));
    } catch (err: any) {
      setError(err?.message || 'The image could not be read.');
    }
  };

  const addIdea = async () => {
    if (!text.trim()) {
      setError('Enter an idea before you add it.');
      return;
    }
    setAdding(true);
    setError('');
    try {
      const res = await ideasAPI.create({
        text: text.trim(),
        imageData: imagePreview || undefined,
        sourceUrl: sourceUrl.trim() || undefined,
        targetDate: targetDate || undefined
      });
      if (!res?.success) throw new Error(res?.message || 'The idea could not be saved.');
      setText('');
      setSourceUrl('');
      setTargetDate('');
      setImagePreview(null);
      setSuccess('The idea was added.');
      await loadIdeas();
    } catch (err: any) {
      setError(err?.message || 'The idea could not be saved.');
    } finally {
      setAdding(false);
    }
  };

  const bulkPreviewCount = useMemo(
    () => bulkText.split('\n').map((l) => l.trim()).filter(Boolean).length,
    [bulkText]
  );

  const submitBulkPaste = async () => {
    const items = bulkText.split('\n').map((l) => l.trim()).filter(Boolean);
    if (items.length === 0) return;
    setBulkBusy(true);
    setError('');
    try {
      const res = await ideasAPI.bulkCreate(items, 'bulk_paste');
      if (!res?.success) throw new Error(res?.message || 'The import failed.');
      setBulkText('');
      setBulkOpen(false);
      setSuccess(`${res.count} idea${res.count === 1 ? ' was' : 's were'} added.`);
      await loadIdeas();
    } catch (err: any) {
      setError(err?.message || 'The import failed.');
    } finally {
      setBulkBusy(false);
    }
  };

  // Reads the FIRST column of every row. Deliberately doesn't try to detect
  // and skip a header row — that heuristic is exactly the kind of thing
  // that's right 90% of the time and silently wrong the other 10%. A stray
  // "Idea" or "Content Ideas" header importing as one extra row is a
  // one-click dismiss; a real idea silently dropped because it looked like
  // a header is a lost idea nobody notices.
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBulkBusy(true);
    setError('');
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows: any[][] = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
      const items = rows
        .map((row) => (Array.isArray(row) ? row[0] : row))
        .map((v) => String(v ?? '').trim())
        .filter(Boolean);

      if (items.length === 0) {
        setError('No text was found in the first column of that file.');
        return;
      }

      const res = await ideasAPI.bulkCreate(items, 'bulk_file');
      if (!res?.success) throw new Error(res?.message || 'The import failed.');
      setSuccess(`${res.count} idea${res.count === 1 ? '' : 's'} from ${file.name} ${res.count === 1 ? 'was' : 'were'} added.`);
      await loadIdeas();
    } catch (err: any) {
      setError(err?.message || 'That file could not be read.');
    } finally {
      setBulkBusy(false);
      e.target.value = '';
    }
  };

  const dismissIdea = async (idea: Idea) => {
    try {
      await ideasAPI.update(idea._id, { status: 'dismissed' });
      setIdeas((prev) => prev.filter((i) => i._id !== idea._id));
    } catch (err: any) {
      setError(err?.message || 'The idea could not be dismissed.');
    }
  };

  const deleteIdea = async (idea: Idea) => {
    if (!(await confirm("This idea will be deleted permanently. This cannot be undone.", { title: 'Delete this idea?', confirmLabel: 'Delete', danger: true }))) return;
    try {
      await ideasAPI.remove(idea._id);
      setIdeas((prev) => prev.filter((i) => i._id !== idea._id));
    } catch (err: any) {
      setError(err?.message || 'The idea could not be deleted.');
    }
  };

  // Reuses the same single-post pipeline everything else on Gravity goes
  // through (Creative Director -> Art Director -> image) rather than a
  // second generation path — an idea from the inbox gets exactly the same
  // quality bar as anything the AI originates on its own.
  const expandIdea = async (idea: Idea) => {
    setExpandingId(idea._id);
    setError('');
    try {
      const res = await draftsAPI.generateImageBg({
        type: 'post',
        title: idea.text.slice(0, 60),
        caption: '',
        hashtags: [],
        prompt: '',
        aspectRatio: '1:1',
        campaignContext: idea.text
      });
      if (!res?.success || !res?.draftId) throw new Error(res?.message || 'Post generation could not be started.');

      await ideasAPI.update(idea._id, { status: 'expanded', draftId: res.draftId });
      setIdeas((prev) => prev.filter((i) => i._id !== idea._id));
      setSuccess('The idea is now a post. It will appear in Review and approve when it is ready.');
    } catch (err: any) {
      setError(err?.message || 'This idea could not be turned into a post.');
    } finally {
      setExpandingId(null);
    }
  };

  return (
    <div className="max-w-[1100px] mx-auto pb-16">
      <GravityHero
        eyebrow="Content ideas"
        headline={<>Save ideas for <GravityEmphasis>future posts</GravityEmphasis></>}
        subcopy="Add a thought, a link or an ad you liked, or paste a list of ideas. You can turn any idea into a post when you are ready."
        align="left"
      />

      {error && (
        <div className="mb-5 flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/25 text-red-300 text-[13px]">
          <span>{error}</span>
          <button onClick={() => setError('')}><X className="w-3.5 h-3.5" /></button>
        </div>
      )}
      {success && (
        <div className="mb-5 px-4 py-3 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-[13px]">
          {success}
        </div>
      )}

      {/* Drop-an-idea form */}
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 mb-4">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="For example: Create a post like the ad I saw about founder burnout, but for our onboarding flow."
          rows={3}
          className="w-full bg-transparent text-[14px] text-[#F5F4F1] placeholder-white/30 outline-none resize-none"
        />
        <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-white/[0.06]">
          <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-[12.5px] font-semibold border border-white/[0.10] text-white/70 hover:bg-white/[0.04] cursor-pointer">
            <ImageIcon className="w-3.5 h-3.5" />
            {imagePreview ? 'Image attached' : 'Attach image'}
            <input type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
          </label>
          {imagePreview && (
            <button onClick={() => setImagePreview(null)} className="text-[11px] text-white/40 hover:text-white/70">
              Remove image
            </button>
          )}
          <input
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="Link (optional)"
            className="flex-1 min-w-[140px] px-3 py-2 rounded-lg text-[12.5px] bg-white/[0.03] border border-white/[0.08] text-white/80 placeholder-white/30 outline-none focus:border-[#F5A623]/40"
          />
          <input
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            className="px-3 py-2 rounded-lg text-[12.5px] bg-white/[0.03] border border-white/[0.08] text-white/80 outline-none focus:border-[#F5A623]/40"
          />
          <button
            onClick={addIdea}
            disabled={adding || !text.trim()}
            className="ml-auto inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold bg-[#F5A623] text-black disabled:opacity-40"
          >
            {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Add idea
          </button>
        </div>
      </div>

      {/* Bulk import */}
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 mb-8">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[13.5px] font-semibold text-[#F5F4F1]">Import a list of ideas</div>
            <div className="text-[12px] text-white/45">Paste rows or upload a spreadsheet. Use one idea per row, in the first column.</div>
          </div>
          <div className="flex items-center gap-2">
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-[12.5px] font-semibold border border-white/[0.10] text-white/70 hover:bg-white/[0.04] cursor-pointer">
              {bulkBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              Upload file
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileUpload} disabled={bulkBusy} />
            </label>
            <button
              onClick={() => setBulkOpen((v) => !v)}
              className="px-3 py-2 rounded-lg text-[12.5px] font-semibold border border-white/[0.10] text-white/70 hover:bg-white/[0.04]"
            >
              {bulkOpen ? 'Hide paste box' : 'Paste a list'}
            </button>
          </div>
        </div>

        {bulkOpen && (
          <div className="mt-4 pt-4 border-t border-white/[0.06]">
            <textarea
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder={'Enter one idea per line, for example:\nBehind-the-scenes of our office\nCustomer testimonial: the Sharma account\nA comparison of our service with spreadsheets'}
              rows={5}
              className="w-full px-3 py-2.5 rounded-lg text-[13px] bg-white/[0.03] border border-white/[0.08] text-white/85 placeholder-white/25 outline-none focus:border-[#F5A623]/40 resize-none"
            />
            <div className="flex items-center justify-between mt-2">
              <span className="text-[11.5px] text-white/40">
                {bulkPreviewCount > 0 ? `${bulkPreviewCount} idea${bulkPreviewCount === 1 ? '' : 's'} found` : ''}
              </span>
              <button
                onClick={submitBulkPaste}
                disabled={bulkBusy || bulkPreviewCount === 0}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold bg-[#F5A623] text-black disabled:opacity-40"
              >
                {bulkBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                Add {bulkPreviewCount || ''} idea{bulkPreviewCount === 1 ? '' : 's'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* The inbox itself */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-white/40">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading ideas…
        </div>
      ) : ideas.length === 0 ? (
        <div className="text-center py-16 rounded-xl border border-dashed border-white/[0.08]">
          <div className="text-[13.5px] text-white/50">No ideas have been added yet.</div>
          <div className="text-[12px] text-white/30 mt-1">Ideas you add above will appear here until you turn them into posts.</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {ideas.map((idea) => (
            <div key={idea._id} className="rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden flex flex-col">
              {idea.imageUrl && (
                <div className="aspect-video bg-black/30">
                  <img src={idea.imageUrl} alt="" className="w-full h-full object-cover" />
                </div>
              )}
              <div className="p-4 flex-1 flex flex-col">
                <p className="text-[13.5px] text-[#F5F4F1] leading-relaxed flex-1">{idea.text}</p>
                <div className="flex flex-wrap items-center gap-2 mt-3 text-[11px] text-white/40">
                  {idea.targetDate && (
                    <span>Around {new Date(idea.targetDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                  )}
                  {idea.sourceUrl && (
                    <a href={idea.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#F5A623]/80 hover:text-[#F5A623]">
                      <Link2 className="w-3 h-3" /> Link
                    </a>
                  )}
                  {SOURCE_LABEL[idea.source] && (
                    <span className="px-1.5 py-0.5 rounded bg-white/[0.05]">{SOURCE_LABEL[idea.source]}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-4 pt-3 border-t border-white/[0.06]">
                  <button
                    onClick={() => expandIdea(idea)}
                    disabled={expandingId === idea._id}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[12.5px] font-semibold bg-[#F5A623] text-black disabled:opacity-50"
                  >
                    {expandingId === idea._id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    Turn into a post
                  </button>
                  <button
                    onClick={() => dismissIdea(idea)}
                    title="Dismiss this idea. It is kept but removed from this list."
                    className="px-2.5 py-2 rounded-lg text-[12px] font-semibold border border-white/[0.10] text-white/60 hover:bg-white/[0.04]"
                  >
                    Dismiss
                  </button>
                  <button
                    onClick={() => deleteIdea(idea)}
                    title="Delete permanently"
                    className="p-2 rounded-lg text-red-400/70 hover:bg-red-500/10 hover:text-red-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default IdeaInbox;
