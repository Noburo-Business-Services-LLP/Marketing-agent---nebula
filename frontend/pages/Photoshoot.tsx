import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { BookmarkPlus, Camera, Check, Download, ImagePlus, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import CoverTile from '../components/CoverTile';
import { PackProductArt, PackMarketplaceArt, PackFestivalArt, PackLifestyleArt, PackFlatLayArt, PackWhiteArt } from '../components/art/packs';
import { photoshootAPI } from '../services/api';
import { setPrefill } from '../utils/prefill';
import {
  PACK_PALETTE, createState, isFinished, lockedNote, minutesFor, minutesText, newKey, packTileLines, photoAlt, photoTotal,
  photosLine, priceLine, progressText, redoLabel, resultNotice, selectionFor, toggleProduct, uploadProblem, versionOf,
  type PhotoshootJob, type PhotoshootOptions, type PhotoshootPack, type PhotoshootPhoto, type PhotoshootSelection,
} from '../utils/photoshoot';
import '../components/photoshoot/photoshoot.css';

const PACK_ART: Record<string, React.ReactNode> = {
  product: <PackProductArt />, marketplace: <PackMarketplaceArt />, festival: <PackFestivalArt />,
  lifestyle: <PackLifestyleArt />, flatlay: <PackFlatLayArt />, white: <PackWhiteArt />,
};
const SHAPE_BOX: Record<string, [number, number]> = { '1:1': [12, 12], '4:5': [11, 14], '9:16': [9, 15], '16:9': [16, 9] };
const POLL_MS = 4000;
const messageOf = (e: any, fallback: string) => String((e && e.data && e.data.message) || (e && e.message) || fallback);

const readFile = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result || ''));
  r.onerror = () => reject(new Error('We could not read that photo. Please choose another one.'));
  r.readAsDataURL(file);
});

/** Product photos in ready-made packs, from the customer's own product photos. Product only: no people appear. */
const Photoshoot: React.FC = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [opts, setOpts] = useState<PhotoshootOptions | null>(null);
  const [loadError, setLoadError] = useState('');
  const [sel, setSel] = useState<PhotoshootSelection>({ pack: null, productIds: [], count: 0, aspectRatio: '', background: '', placeId: '' });
  const [job, setJob] = useState<PhotoshootJob | null>(null);
  const [recent, setRecent] = useState<PhotoshootJob[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [photoError, setPhotoError] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [upName, setUpName] = useState('');
  const [upFile, setUpFile] = useState<File | null>(null);
  const [upBusy, setUpBusy] = useState(false);
  const [upError, setUpError] = useState('');
  const resultsRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const [o, l] = await Promise.all([photoshootAPI.options(), photoshootAPI.list().catch(() => ({ success: false, jobs: [] as PhotoshootJob[] }))]);
      setOpts(o); setLoadError('');
      const jobs = (l && l.jobs) || [];
      setRecent(jobs);
      // The one being made, otherwise the newest finished one, so the last results are always on the page.
      const shownJob = jobs.find((j) => j.status === 'running') || jobs[0] || null;
      if (shownJob) setJob((cur) => cur || shownJob);
      const wanted = params.get('pack');
      const pack = (o.packs || []).find((p) => p.key === wanted);
      if (pack) setSel((s) => (s.pack ? s : selectionFor(pack)));
    } catch (e: any) {
      setLoadError(messageOf(e, 'We could not load the photoshoot packs. Please try again.'));
    }
  }, [params]);
  useEffect(() => { load(); }, [load]);

  // Keep checking while photos (or a new version of one) are being made.
  const versionRunning = Boolean(job && (job.versions || []).some((v) => v.status === 'running'));
  const polling = Boolean(job && (job.status === 'running' || versionRunning));
  useEffect(() => {
    if (!polling || !job) return;
    const id = window.setInterval(async () => {
      try {
        const r = await photoshootAPI.get(job.id);
        if (r && r.job) {
          setJob(r.job);
          if (isFinished(r.job) && !(r.job.versions || []).some((v) => v.status === 'running')) {
            photoshootAPI.options().then(setOpts).catch(() => undefined);
            photoshootAPI.list().then((l) => setRecent(l.jobs || [])).catch(() => undefined);
          }
        }
      } catch { /* the next check tries again */ }
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [polling, job?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const costs = opts?.costs || null;
  const postsOnly = Boolean(opts?.postsOnly);
  const perPhoto = opts?.perPhoto?.quarks || 0;
  const total = photoTotal(sel);
  const busyJob = Boolean(job && (job.status === 'running' || versionRunning));
  const state = createState(opts, sel, busyJob);
  const locked = lockedNote(opts);
  const products = opts?.products || [];
  const places = opts?.places || [];
  const productsWithPhoto = products.filter((p) => p.hasPhoto);
  const chosenNames = useMemo(() => products.filter((p) => sel.productIds.includes(p.id)).map((p) => p.name), [products, sel.productIds]);

  const pickPack = (p: PhotoshootPack) => setSel((s) => selectionFor(p, { productIds: s.productIds }));
  const pickProduct = (id: string) => setSel((s) => ({ ...s, productIds: toggleProduct(s.productIds, id, opts?.maxProducts || 3) }));

  const start = async () => {
    if (!state.ok || !sel.pack || starting) return;
    setStarting(true); setError('');
    try {
      const r = await photoshootAPI.create({
        key: newKey(), pack: sel.pack.key, productIds: sel.productIds, count: sel.count, aspectRatio: sel.aspectRatio,
        ...(sel.background ? { background: sel.background } : {}), ...(sel.placeId ? { placeId: sel.placeId } : {}),
      });
      if (r && r.job) {
        setJob(r.job);
        window.setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
      }
    } catch (e: any) {
      setError(messageOf(e, 'We could not start the photoshoot. Please try again.'));
    } finally { setStarting(false); }
  };

  const redo = async (p: PhotoshootPhoto) => {
    if (!job) return;
    setPhotoError('');
    try {
      const r = await photoshootAPI.redo(job.id, p.index, newKey());
      if (r && r.job) {
        const parent = await photoshootAPI.get(job.id);
        if (parent && parent.job) setJob(parent.job);
      }
    } catch (e: any) { setPhotoError(messageOf(e, 'We could not make that photo again. Please try again.')); }
  };

  const toggleLibrary = async (jobId: string, index: number, on: boolean, version = false) => {
    setJob((j) => {
      if (!j) return j;
      if (version) return { ...j, versions: j.versions.map((v) => (v.id === jobId ? { ...v, inLibrary: on } : v)) };
      return { ...j, photos: j.photos.map((p) => (p.index === index ? { ...p, inLibrary: on } : p)) };
    });
    try { await photoshootAPI.setInLibrary(jobId, index, on); }
    catch (e: any) { setPhotoError(messageOf(e, 'We could not change that just now. Please try again.')); }
  };

  const openInCreate = (url: string, product: string) => {
    setPrefill('carousel', { mode: 'single', topic: product ? `A post about ${product}` : '', source: 'home', photo: { name: product || 'Photoshoot photo', imageUrl: url } });
    navigate('/campaigns');
  };

  const upload = async () => {
    const problem = uploadProblem(upFile);
    if (!upName.trim()) { setUpError('Please give the product a name.'); return; }
    if (problem) { setUpError(problem); return; }
    setUpBusy(true); setUpError('');
    try {
      const data = await readFile(upFile as File);
      const r = await photoshootAPI.upload(upName.trim(), data);
      if (r && r.product) {
        const made = r.product;
        setOpts((o) => (o ? { ...o, products: [made, ...(o.products || [])] } : o));
        setSel((s) => ({ ...s, productIds: toggleProduct(s.productIds, made.id, opts?.maxProducts || 3) }));
        setShowUpload(false); setUpName(''); setUpFile(null);
      }
    } catch (e: any) { setUpError(messageOf(e, 'We could not save that photo. Please try again.')); }
    finally { setUpBusy(false); }
  };

  const priceOf = (q: number) => priceLine(q, costs, postsOnly);
  const redoText = redoLabel(perPhoto, costs, postsOnly);
  const summaryWhat = sel.pack
    ? `${photosLine(sel.count, Math.max(1, sel.productIds.length))} of ${chosenNames.length ? chosenNames.join(', ') : 'your products'}, ${sel.pack.aspectRatios.find((a) => a.key === sel.aspectRatio)?.label.toLowerCase() || 'square'}${sel.background ? `, ${sel.pack.backgrounds.find((b) => b.key === sel.background)?.label.toLowerCase()}` : ''}${sel.placeId ? `, in ${places.find((p) => p.id === sel.placeId)?.name || 'your space'}` : ''}`
    : 'Choose a pack to see what you get';

  if (loadError && !opts) {
    return (
      <div className="nb-ps">
        <div className="nb-ps-note" data-tone="bad" role="alert">{loadError}<button type="button" className="nb-ps-btn" data-small="true" onClick={load}>Try again</button></div>
      </div>
    );
  }
  if (!opts) {
    return <div className="nb-ps"><p className="nb-ps-meta" role="status"><Loader2 className="inline w-4 h-4 animate-spin mr-2" aria-hidden="true" />Loading the photoshoot packs</p></div>;
  }

  return (
    <div className="nb-ps" data-testid="photoshoot-page">
      <header className="nb-ps-head">
        <div>
          <p className="nb-ps-eyebrow">Photoshoot</p>
          <h1 className="nb-ps-title">Product photos, <em>ready in minutes</em></h1>
          <p className="nb-ps-line">Pick a pack, choose your products and see the price before anything is made. Only your product appears in the photos, never a person.</p>
        </div>
        {perPhoto > 0 && <span className="nb-ps-chip"><Camera size={14} aria-hidden="true" />{priceOf(perPhoto)} for each photo</span>}
      </header>

      {locked && (
        <div className="nb-ps-note" data-tone="warn">
          <span>{locked.text}</span>
          {locked.to && <Link to={locked.to} className="nb-ps-btn" data-small="true">{locked.action}</Link>}
        </div>
      )}
      {!locked && opts.enabled === false && <div className="nb-ps-note" data-tone="warn">Photoshoots open soon. You can look at the packs and prices now.</div>}
      {opts.staff && !opts.pass && <div className="nb-ps-note">Staff accounts cannot make photoshoots here. Open a client to make one for them.</div>}

      <section className="nb-ps-step" aria-labelledby="ps-step-pack">
        <div className="nb-ps-step-head">
          <h2 id="ps-step-pack"><span className="nb-ps-num" aria-hidden="true">1</span>Choose a pack</h2>
          <span>{opts.packs.length} packs</span>
        </div>
        <div className="nb-ps-packs" role="group" aria-label="Photoshoot packs">
          {opts.packs.map((p) => {
            const lines = packTileLines(p, costs, postsOnly);
            return (
              <CoverTile key={p.key} title={p.title} subtitle={`${p.subtitle}. ${lines.subtitle}`} price={lines.price || undefined}
                palette={PACK_PALETTE[p.key] || 'gold'} art={PACK_ART[p.key] || <PackProductArt />}
                selected={sel.pack?.key === p.key} onClick={() => pickPack(p)} dataAttrs={{ 'data-pack': p.key }} />
            );
          })}
        </div>
      </section>

      <section className="nb-ps-step" aria-labelledby="ps-step-products">
        <div className="nb-ps-step-head">
          <h2 id="ps-step-products"><span className="nb-ps-num" aria-hidden="true">2</span>Choose products</h2>
          <span>Up to {opts.maxProducts || 3}, each needs a photo</span>
        </div>
        {products.length === 0 && !showUpload ? (
          <div className="nb-ps-note">
            <span>Add a product photo to start. A clear photo of the product on its own works best.</span>
            <button type="button" className="nb-ps-btn" data-small="true" onClick={() => setShowUpload(true)}><ImagePlus size={14} aria-hidden="true" />Add a product</button>
            <Link to="/brand-assets?tab=products" className="nb-ps-link">Open your products</Link>
          </div>
        ) : (
          <div className="nb-ps-products" role="group" aria-label="Your products">
            {products.map((p) => {
              const on = sel.productIds.includes(p.id);
              return (
                <button key={p.id} type="button" className="nb-ps-product" aria-pressed={on} disabled={!p.hasPhoto} onClick={() => pickProduct(p.id)}>
                  {p.thumbnail ? <img className="nb-ps-thumb" src={p.thumbnail} alt="" loading="lazy" decoding="async" width={120} height={120} />
                    : <span className="nb-ps-thumb-empty" aria-hidden="true"><Camera size={20} /></span>}
                  <span className="nb-ps-product-name">{p.name}</span>
                  {!p.hasPhoto && <span className="nb-ps-product-note">Needs a photo</span>}
                  {on && <span className="nb-ps-tick" aria-hidden="true"><Check size={12} strokeWidth={3} /></span>}
                </button>
              );
            })}
            <button type="button" className="nb-ps-product nb-ps-add" aria-expanded={showUpload} onClick={() => setShowUpload((v) => !v)}>
              <ImagePlus size={20} aria-hidden="true" />Add a product
            </button>
          </div>
        )}
        {products.length > 0 && productsWithPhoto.length === 0 && (
          <p className="nb-ps-meta" style={{ marginTop: 10 }}>None of your products has a photo yet. Add one here, or <Link to="/brand-assets?tab=products" className="nb-ps-link">add photos in Brand assets</Link>.</p>
        )}
        {showUpload && (
          <div className="nb-ps-upload">
            <label className="nb-ps-field">Product name
              <input type="text" value={upName} maxLength={100} onChange={(e) => setUpName(e.target.value)} placeholder="For example Mango pickle 500 g" />
            </label>
            <label className="nb-ps-field">Photo (PNG, JPEG or WEBP, up to 6 MB)
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setUpFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)} />
            </label>
            <button type="button" className="nb-ps-btn" onClick={upload} disabled={upBusy}>{upBusy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}Save product</button>
            {upError && <p role="alert" className="nb-ps-meta" style={{ color: '#7A2E12' }}>{upError}</p>}
          </div>
        )}
      </section>

      {sel.pack && (
        <section className="nb-ps-step" aria-labelledby="ps-step-look">
          <div className="nb-ps-step-head">
            <h2 id="ps-step-look"><span className="nb-ps-num" aria-hidden="true">3</span>Choose the look</h2>
            <span className="nb-ps-scenes">{sel.pack.scenes.slice(0, sel.count).map((s) => s.label).join(', ')}</span>
          </div>
          <div className="nb-ps-rows">
            {sel.pack.counts.length > 1 && (
              <div className="nb-ps-row" role="group" aria-label="Photos for each product">
                <span className="nb-ps-row-label">Photos</span>
                {sel.pack.counts.map((n) => <button key={n} type="button" className="nb-ps-choice" aria-pressed={sel.count === n} onClick={() => setSel((s) => ({ ...s, count: n }))}>{n} photos</button>)}
              </div>
            )}
            <div className="nb-ps-row" role="group" aria-label="Shape">
              <span className="nb-ps-row-label">Shape</span>
              {sel.pack.aspectRatios.map((a) => {
                const [w, h] = SHAPE_BOX[a.key] || [12, 12];
                return <button key={a.key} type="button" className="nb-ps-choice" aria-pressed={sel.aspectRatio === a.key} onClick={() => setSel((s) => ({ ...s, aspectRatio: a.key }))}><span className="nb-ps-shape" style={{ width: w, height: h }} aria-hidden="true" />{a.label}</button>;
              })}
            </div>
            {sel.pack.backgrounds.length > 0 && (
              <div className="nb-ps-row" role="group" aria-label="Background">
                <span className="nb-ps-row-label">Background</span>
                {sel.pack.backgrounds.map((b) => <button key={b.key} type="button" className="nb-ps-choice" aria-pressed={sel.background === b.key} onClick={() => setSel((s) => ({ ...s, background: b.key }))}>{b.label}</button>)}
              </div>
            )}
            {sel.pack.place && places.length > 0 && (
              <div className="nb-ps-row" role="group" aria-label="Your space">
                <span className="nb-ps-row-label">Your space</span>
                <button type="button" className="nb-ps-choice" aria-pressed={!sel.placeId} onClick={() => setSel((s) => ({ ...s, placeId: '' }))}>Our scenes</button>
                {places.map((p) => <button key={p.id} type="button" className="nb-ps-choice" aria-pressed={sel.placeId === p.id} onClick={() => setSel((s) => ({ ...s, placeId: p.id }))}><img src={p.thumbnail} alt="" loading="lazy" decoding="async" width={22} height={22} />{p.name}</button>)}
              </div>
            )}
          </div>
        </section>
      )}

      <section className="nb-ps-summary" aria-label="Summary">
        <div>
          <p className="nb-ps-summary-what">{summaryWhat}</p>
          {total > 0 && <p className="nb-ps-summary-price"><b>{priceOf(perPhoto * total)}</b>{` · ${minutesText(minutesFor(total))}`}</p>}
          {state.reason && <p className="nb-ps-summary-why">{state.reason}</p>}
          {typeof opts.left === 'number' && opts.entitled !== false && <p className="nb-ps-meta" style={{ marginTop: 4 }}>{opts.left} of {opts.perDay} photos left today.</p>}
        </div>
        <button type="button" className="nb-ps-btn" data-primary="true" onClick={start} disabled={!state.ok || starting}>
          {starting ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}
          {total > 0 ? `Create ${photosLine(total)}` : 'Create photos'}
        </button>
      </section>
      {error && <div className="nb-ps-note" data-tone="bad" role="alert">{error}</div>}

      {job && (
        <section className="nb-ps-step" aria-labelledby="ps-results" ref={resultsRef}>
          <div className="nb-ps-step-head">
            <h2 id="ps-results">{job.packTitle || 'Your photos'}</h2>
            <span>{new Date(job.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
          </div>
          <div className="nb-ps-progress" role="status" aria-live="polite">
            <span className="nb-ps-meta">{progressText(job)}{job.status === 'running' ? `. ${minutesText(job.minutes)} in all; you can leave this page and come back.` : ''}</span>
            {job.status === 'running' && <div className="nb-ps-bar" aria-hidden="true"><span style={{ width: `${Math.round((100 * (job.done + job.failed)) / Math.max(1, job.photoCount))}%` }} /></div>}
          </div>
          {resultNotice(job) && <div className="nb-ps-note" data-tone="warn" style={{ marginTop: 10 }}>{resultNotice(job)}</div>}
          {photoError && <div className="nb-ps-note" data-tone="bad" role="alert" style={{ marginTop: 10 }}>{photoError}</div>}
          <ul className="nb-ps-results" style={{ listStyle: 'none', margin: '12px 0 0', padding: 0 }}>
            {job.photos.map((p) => {
              const v = versionOf(job, p.index);
              const shown = v.latest ? { url: v.latest.url, inLibrary: v.latest.inLibrary, id: v.latest.id, idx: 0, version: true } : { url: p.url, inLibrary: p.inLibrary, id: job.id, idx: p.index, version: false };
              const done = Boolean(shown.url);
              return (
                <li key={p.index} className="nb-ps-photo">
                  <div className="nb-ps-photo-frame">
                    {done ? <img src={shown.url} alt={photoAlt(p, job.photoCount)} loading="lazy" decoding="async" width={400} height={400} />
                      : p.status === 'failed' && !v.running ? <div className="nb-ps-photo-fail"><span>This photo could not be made. You were not charged for it.</span></div>
                      : <div className="nb-ps-photo-wait">{v.running ? 'Making it again' : p.status === 'making' ? 'Making this photo' : 'Waiting its turn'}</div>}
                    {p.sceneLabel && <span className="nb-ps-photo-tag">{p.sceneLabel}{v.latest ? ', new version' : ''}</span>}
                  </div>
                  <div className="nb-ps-photo-body">
                    <span className="nb-ps-photo-name">{p.product}</span>
                    {v.failed && !v.running && <span className="nb-ps-meta">The new version could not be made. You were not charged for it.</span>}
                    {done && (
                      <div className="nb-ps-photo-actions">
                        <button type="button" className="nb-ps-btn" data-small="true" data-grow="true" onClick={() => openInCreate(shown.url, p.product)}>Use in Create</button>
                        <a className="nb-ps-btn" data-small="true" data-icon="true" href={shown.url} download target="_blank" rel="noreferrer" aria-label={`Download photo ${p.index + 1}`} title="Download"><Download size={14} aria-hidden="true" /></a>
                        <button type="button" className="nb-ps-btn" data-small="true" data-icon="true" aria-pressed={shown.inLibrary} aria-label={shown.inLibrary ? `Saved to Library: photo ${p.index + 1}` : `Save to Library: photo ${p.index + 1}`} title={shown.inLibrary ? 'Saved to Library' : 'Save to Library'} onClick={() => toggleLibrary(shown.id, shown.idx, !shown.inLibrary, shown.version)}>
                          {shown.inLibrary ? <Check size={14} aria-hidden="true" /> : <BookmarkPlus size={14} aria-hidden="true" />}
                        </button>
                      </div>
                    )}
                    {done && <span className="nb-ps-meta">{shown.inLibrary ? 'Saved to Library' : 'Not in your Library'}</span>}
                    {isFinished(job) && !v.running && opts.entitled !== false && opts.enabled !== false && (
                      <button type="button" className="nb-ps-link" onClick={() => redo(p)} disabled={busyJob} style={{ alignSelf: 'flex-start' }}>
                        <RefreshCw size={12} aria-hidden="true" style={{ display: 'inline', marginRight: 4 }} />{redoText}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {recent.length > 1 && (
        <section aria-label="Earlier photoshoots">
          <p className="nb-ps-meta" style={{ marginBottom: 8 }}>Earlier photoshoots</p>
          <div className="nb-ps-recent">
            {recent.map((j) => (
              <button key={j.id} type="button" className="nb-ps-btn" data-small="true" aria-pressed={job?.id === j.id} onClick={() => setJob(j)}>
                {j.packTitle} · {new Date(j.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · {j.done} photos
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

export default Photoshoot;
