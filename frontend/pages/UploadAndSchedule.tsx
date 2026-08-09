import React, { useRef, useState } from 'react';
import { UploadCloud, Loader2, Sparkles, Calendar, Send, X, Instagram, Facebook, Linkedin, Twitter, Check } from 'lucide-react';
import { draftsAPI, apiService } from '../services/api';

const PLATFORMS = [
  { key: 'instagram', label: 'Instagram', Icon: Instagram },
  { key: 'facebook',  label: 'Facebook',  Icon: Facebook },
  { key: 'linkedin',  label: 'LinkedIn',  Icon: Linkedin },
  { key: 'twitter',   label: 'X',         Icon: Twitter },
];

/**
 * Upload & Schedule — bring your own image or video, let AI write the
 * caption, then publish or schedule it.
 *
 * Nothing new server-side beyond the upload itself: the file becomes a Draft,
 * and every downstream action (caption, schedule, publish) reuses the
 * endpoints the generated-post flow already uses.
 */
const UploadAndSchedule: React.FC = () => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [isVideo, setIsVideo] = useState(false);

  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [platforms, setPlatforms] = useState<string[]>(['instagram']);
  const [when, setWhen] = useState('');

  const [draftId, setDraftId] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [dragging, setDragging] = useState(false);

  const reset = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null); setPreviewUrl(''); setIsVideo(false);
    setTitle(''); setCaption(''); setWhen('');
    setDraftId(''); setMediaUrl(''); setError(''); setDone('');
  };

  const take = (f?: File | null) => {
    if (!f) return;
    if (!/^(image|video)\//i.test(f.type)) { setError('Pick an image or a video.'); return; }
    if (f.size > 120 * 1024 * 1024) { setError('That file is over 120MB.'); return; }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setError(''); setDone(''); setDraftId(''); setMediaUrl('');
    setFile(f);
    setIsVideo(/^video\//i.test(f.type));
    setPreviewUrl(URL.createObjectURL(f));
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''));
  };

  // Uploads once, then reuses the same draft for every later action.
  const ensureDraft = async (): Promise<string> => {
    if (draftId) return draftId;
    if (!file) throw new Error('Choose a file first');
    const res = await draftsAPI.uploadMedia(file, { title, caption, platforms });
    if (!res?.draft?._id) throw new Error('Upload did not return a draft');
    setDraftId(res.draft._id);
    setMediaUrl(res.mediaUrl);
    return res.draft._id;
  };

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setError(''); setDone('');
    try { await fn(); } catch (e: any) { setError(e?.message || 'That did not work'); }
    finally { setBusy(''); }
  };

  const writeCaption = () => run('caption', async () => {
    const id = await ensureDraft();
    const url = mediaUrl || (await draftsAPI.getDraft(id))?.draft?.imageUrl || '';
    if (isVideo || !url) {
      // No vision pass for video — write from the title instead.
      const r: any = await apiService.generateCaption(title || 'social post');
      const next = r?.caption || '';
      if (!next) throw new Error('No caption came back');
      setCaption(next);
    } else {
      const r: any = await apiService.generateCaptionFromImage(url, platforms[0] || 'instagram');
      const next = r?.caption || r?.data?.caption || '';
      if (!next) throw new Error('No caption came back');
      setCaption(next);
    }
    setDone('Caption written.');
  });

  const saveDraft = () => run('save', async () => {
    const id = await ensureDraft();
    await draftsAPI.updateDraft(id, { title, caption, platforms });
    setDone('Saved to Drafts.');
  });

  const schedule = () => run('schedule', async () => {
    if (!when) throw new Error('Pick a date and time');
    const id = await ensureDraft();
    await draftsAPI.updateDraft(id, { title, caption, platforms });
    await draftsAPI.scheduleDraft(id, new Date(when).toISOString());
    setDone('Scheduled.');
  });

  const publish = () => run('publish', async () => {
    if (platforms.length === 0) throw new Error('Pick at least one platform');
    const id = await ensureDraft();
    await draftsAPI.updateDraft(id, { title, caption, platforms });
    await draftsAPI.publishDraft(id, platforms);
    setDone('Published.');
  });

  const togglePlatform = (k: string) =>
    setPlatforms((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));

  return (
    <div className="max-w-[900px] mx-auto pb-24">
      <div className="text-center mb-10 mt-4">
        <div className="gravity-label text-[#F5A623] mb-4">Upload · your own media</div>
        <h1 className="font-serif-display text-[52px] leading-[1.05] tracking-[-0.02em] text-[#F5F4F1] mb-5">
          Already have <span className="italic text-[#F5A623]">something</span>?
        </h1>
        <p className="text-[15px] text-white/55 max-w-[520px] mx-auto leading-relaxed">
          Drop in a photo or a video. Gravity writes the caption and puts it out.
        </p>
      </div>

      {!file ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); take(e.dataTransfer.files?.[0]); }}
          onClick={() => fileRef.current?.click()}
          className={`cursor-pointer rounded-2xl border-2 border-dashed transition-colors px-8 py-20 text-center ${
            dragging ? 'border-[#F5A623] bg-[#F5A623]/[0.06]' : 'border-white/[0.14] hover:border-white/30 bg-white/[0.02]'
          }`}
        >
          <UploadCloud className={`w-10 h-10 mx-auto mb-4 ${dragging ? 'text-[#F5A623]' : 'text-white/35'}`} />
          <p className="text-[15px] font-semibold text-[#F5F4F1]">Drop a file, or click to choose</p>
          <p className="text-[12.5px] text-white/40 mt-1.5">Images and video · up to 120MB</p>
        </div>
      ) : (
        <div className="grid lg:grid-cols-[1fr_1fr] gap-7">
          {/* Preview */}
          <div>
            <div className="relative rounded-2xl overflow-hidden bg-black border border-white/[0.08]" style={{ aspectRatio: '4 / 5' }}>
              {isVideo
                ? <video src={previewUrl} controls className="w-full h-full object-contain" />
                : <img src={previewUrl} alt={title} className="w-full h-full object-contain" />}
              <button
                onClick={reset}
                className="absolute top-2.5 right-2.5 w-8 h-8 grid place-items-center rounded-full bg-black/70 border border-white/[0.12] text-white/70 hover:text-white transition-colors"
                title="Remove"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[11.5px] text-white/35 mt-2 truncate">
              {file.name} · {(file.size / 1024 / 1024).toFixed(1)}MB
            </p>
          </div>

          {/* Controls */}
          <div className="flex flex-col gap-5">
            <div>
              <label className="gravity-label block mb-2">Title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-0 py-2 bg-transparent border-0 border-b border-white/[0.12] text-[18px] font-semibold text-[#F5F4F1] placeholder:text-white/20 focus:outline-none focus:border-[#F5A623] transition-colors"
                placeholder="Give it a name…"
              />
            </div>

            <div>
              <label className="gravity-label block mb-2">Caption</label>
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                rows={5}
                placeholder="Write it, or let Gravity."
                className="w-full px-4 py-3 rounded-xl bg-black/40 border border-white/[0.09] text-[14px] leading-relaxed text-[#F5F4F1] placeholder:text-white/20 focus:outline-none focus:border-[#F5A623]/60 transition-colors resize-none"
              />
              <button
                onClick={writeCaption}
                disabled={!!busy}
                className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#F5A623] hover:text-[#ffb833] disabled:opacity-40"
              >
                {busy === 'caption' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {isVideo ? 'Write caption from title' : 'Write caption from image'}
              </button>
            </div>

            <div>
              <label className="gravity-label block mb-2">Posting to</label>
              <div className="flex flex-wrap gap-2">
                {PLATFORMS.map(({ key, label, Icon }) => {
                  const active = platforms.includes(key);
                  return (
                    <button
                      key={key}
                      onClick={() => togglePlatform(key)}
                      className={`inline-flex items-center gap-2 h-10 pl-3 pr-3.5 rounded-full border text-[12.5px] font-semibold transition-all ${
                        active
                          ? 'bg-[#F5A623] border-[#F5A623] text-black'
                          : 'bg-white/[0.03] border-white/[0.10] text-white/55 hover:text-white/85 hover:border-white/25'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="gravity-label block mb-2">Schedule for</label>
              <input
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl bg-black/40 border border-white/[0.09] text-[13px] text-[#F5F4F1] focus:outline-none focus:border-[#F5A623]/60 transition-colors"
              />
            </div>

            {error && <p className="text-[12.5px] text-red-300 bg-red-500/[0.08] border border-red-400/20 px-3.5 py-2.5 rounded-xl">{error}</p>}
            {done && (
              <p className="text-[12.5px] text-emerald-300 bg-emerald-500/[0.08] border border-emerald-400/20 px-3.5 py-2.5 rounded-xl flex items-center gap-2">
                <Check className="w-3.5 h-3.5" /> {done}
              </p>
            )}

            <div className="flex flex-wrap gap-2.5 pt-1">
              <button
                onClick={saveDraft}
                disabled={!!busy}
                className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-white/[0.06] hover:bg-white/[0.11] border border-white/[0.09] text-[13px] font-semibold text-[#F5F4F1] transition-colors disabled:opacity-40"
              >
                {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                Save to drafts
              </button>
              <button
                onClick={schedule}
                disabled={!!busy || !when}
                className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-[#F5A623]/[0.10] border border-[#F5A623]/30 text-[#F5A623] hover:bg-[#F5A623]/20 text-[13px] font-semibold transition-colors disabled:opacity-40"
              >
                {busy === 'schedule' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calendar className="w-4 h-4" />}
                Schedule
              </button>
              <button
                onClick={publish}
                disabled={!!busy}
                className="inline-flex items-center gap-2 h-11 px-6 rounded-xl bg-[#F5A623] hover:bg-[#ffb833] text-black text-[13px] font-bold shadow-[0_8px_28px_rgba(245,166,35,0.28)] transition-colors disabled:opacity-40"
              >
                {busy === 'publish' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Publish now
              </button>
            </div>
          </div>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={(e) => take(e.target.files?.[0])}
      />
    </div>
  );
};

export default UploadAndSchedule;
