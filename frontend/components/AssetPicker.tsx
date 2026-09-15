import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, X, Search, Check, Upload, Package, Image as ImageIcon } from 'lucide-react';
import { inventoryAPI, brandAssetsAPI } from '../services/api';

export interface PickedAsset {
  /** Catalogue id, or '' for something uploaded here and now. */
  id: string;
  name: string;
  imageUrl: string;
  description?: string;
  /** Present only for uploads, which have no catalogue record to point at. */
  dataUrl?: string;
}

type Source = 'products' | 'environment';

/**
 * Pick products, services or environments from what the brand already has.
 *
 * Shared by Videos and Create so the two cannot drift apart. Both previously
 * offered upload only, which meant re-uploading an image of a product that was
 * already catalogued in Brand Assets.
 *
 * Multi-select because a creative often features more than one item — a
 * bundle, a range, a before and after.
 */
const AssetPicker: React.FC<{
  open: boolean;
  onClose: () => void;
  source: Source;
  /** Currently chosen, so reopening shows what is already selected. */
  selected: PickedAsset[];
  onChange: (assets: PickedAsset[]) => void;
  /** Cap selection. Videos anchors on one environment. */
  max?: number;
}> = ({ open, onClose, source, selected, onChange, max }) => {
  const [items, setItems] = useState<PickedAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<PickedAsset[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setPicked(selected);
  }, [open, selected]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError('');
      try {
        if (source === 'products') {
          const res: any = await inventoryAPI.getProducts();
          const list = res?.data || res?.products || [];
          if (cancelled) return;
          setItems(list.map((p: any) => ({
            id: p._id,
            name: p.name || 'Untitled',
            imageUrl: p.imageUrl || (Array.isArray(p.images) ? p.images[0] : '') || '',
            description: p.description || ''
          })));
        } else {
          const res: any = await brandAssetsAPI.getAll('environment');
          const list = res?.assets || res?.data || [];
          if (cancelled) return;
          setItems(list.map((a: any) => ({
            id: a._id,
            name: a.name || a.label || 'Environment',
            imageUrl: a.url || a.imageUrl || '',
            description: a.description || ''
          })));
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Could not load your assets.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open, source]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => `${i.name} ${i.description || ''}`.toLowerCase().includes(q));
  }, [items, query]);

  const isPicked = (id: string) => picked.some((p) => p.id === id && id !== '');

  const toggle = (asset: PickedAsset) => {
    setPicked((prev) => {
      const already = prev.some((p) => p.id === asset.id && asset.id !== '');
      if (already) return prev.filter((p) => p.id !== asset.id);
      if (max === 1) return [asset];
      if (max && prev.length >= max) return prev;
      return [...prev, asset];
    });
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || '');
        if (!dataUrl) return;
        setPicked((prev) => {
          const next: PickedAsset = { id: '', name: file.name, imageUrl: dataUrl, dataUrl };
          if (max === 1) return [next];
          if (max && prev.length >= max) return prev;
          return [...prev, next];
        });
      };
      reader.readAsDataURL(file);
    });
    // Same file twice in a row should still fire onChange.
    e.target.value = '';
  };

  if (!open) return null;

  const label = source === 'products' ? 'products and services' : 'environments';

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-md p-4">
      <div className="gravity-glow w-full max-w-4xl rounded-2xl">
        <div className="relative w-full rounded-2xl border border-white/[0.08] bg-[#111111] shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">

          <div className="px-6 py-5 border-b border-white/[0.06] flex items-start justify-between gap-4">
            <div>
              <h3 className="font-serif-display text-[22px] text-[#F5F4F1] flex items-center gap-2.5">
                {source === 'products'
                  ? <Package className="w-5 h-5 text-[#F5A623]" />
                  : <ImageIcon className="w-5 h-5 text-[#F5A623]" />}
                {source === 'products' ? 'Products & services' : 'Environments'}
              </h3>
              <p className="text-[12.5px] text-white/45 mt-1">
                {max === 1
                  ? `Pick one from your brand assets, or upload an image.`
                  : `Pick as many as should appear, or upload images. These come from your ${label} in Brand Assets.`}
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

          <div className="px-6 py-3.5 border-b border-white/[0.06] flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                className="gravity-bare w-full pl-8 pr-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.08] text-[12.5px] text-[#F5F4F1] placeholder:text-white/25 outline-none"
              />
            </div>
            <button
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white/60 hover:text-[#F5F4F1] hover:bg-white/[0.05] border border-white/[0.08] transition-all"
            >
              <Upload className="w-3.5 h-3.5" />
              Upload image
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple={max !== 1}
              onChange={handleUpload}
              className="hidden"
            />
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-6 h-6 animate-spin text-[#F5A623]" />
              </div>
            ) : error ? (
              <p className="text-center py-14 text-[13px] text-red-400">{error}</p>
            ) : shown.length === 0 ? (
              <div className="text-center py-14">
                <p className="text-[13.5px] text-[#F5F4F1]">
                  {items.length === 0 ? `No ${label} yet.` : 'Nothing matches that search.'}
                </p>
                <p className="text-[12.5px] text-white/45 mt-1">
                  {items.length === 0
                    ? `Add them under Brand Assets, or upload an image above.`
                    : 'Try a different search.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {shown.map((item) => {
                  const on = isPicked(item.id);
                  return (
                    <button
                      key={item.id}
                      onClick={() => toggle(item)}
                      className={`relative text-left rounded-xl border overflow-hidden transition-all ${
                        on
                          ? 'border-[#F5A623] bg-[#F5A623]/[0.06]'
                          : 'border-white/[0.08] bg-white/[0.02] hover:border-[#F5A623]/40 hover:bg-white/[0.04]'
                      }`}
                    >
                      <div className="aspect-square bg-black/40">
                        {item.imageUrl ? (
                          <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-white/20">
                            <Package className="w-6 h-6" />
                          </div>
                        )}
                      </div>
                      {on && (
                        <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-[#F5A623] text-[#1A1208] flex items-center justify-center">
                          <Check className="w-3 h-3" strokeWidth={3} />
                        </div>
                      )}
                      <div className="p-2.5">
                        <div className="text-[12px] font-semibold text-[#F5F4F1] line-clamp-1">{item.name}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {picked.some((p) => p.id === '') && (
              <div className="mt-5 pt-5 border-t border-white/[0.06]">
                <div className="gravity-label text-white/30 mb-2.5">Uploaded just now</div>
                <div className="flex flex-wrap gap-2.5">
                  {picked.filter((p) => p.id === '').map((p, i) => (
                    <div key={`up-${i}`} className="relative w-20 h-20 rounded-lg overflow-hidden border border-[#F5A623]/40">
                      <img src={p.imageUrl} alt={p.name} className="w-full h-full object-cover" />
                      <button
                        onClick={() => setPicked((prev) => prev.filter((x) => x !== p))}
                        className="absolute top-1 right-1 p-0.5 rounded bg-black/70 text-white/70 hover:text-white"
                        title="Remove"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="px-6 py-4 border-t border-white/[0.06] flex items-center gap-3">
            <span className="text-[12px] text-white/40">
              {picked.length === 0 ? 'Nothing selected' : `${picked.length} selected`}
            </span>
            <div className="ml-auto flex items-center gap-3">
              {picked.length > 0 && (
                <button
                  onClick={() => setPicked([])}
                  className="px-3 py-2 rounded-lg text-[12.5px] text-white/60 hover:text-[#F5F4F1] hover:bg-white/[0.05] border border-white/[0.08] transition-all"
                >
                  Clear
                </button>
              )}
              <button
                onClick={onClose}
                className="px-3 py-2 rounded-lg text-[12.5px] text-white/60 hover:text-[#F5F4F1] hover:bg-white/[0.05] border border-white/[0.08] transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => { onChange(picked); onClose(); }}
                className="px-4 py-2 rounded-lg text-[12.5px] font-semibold bg-[#F5A623] text-[#1A1208] hover:brightness-110 transition-all"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AssetPicker;
