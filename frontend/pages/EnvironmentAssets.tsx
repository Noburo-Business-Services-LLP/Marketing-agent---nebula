import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, Trash2, AlertCircle, Store } from 'lucide-react';
import { brandAssetsAPI } from '../services/api';
import { useConfirm } from '../context/ConfirmContext';

interface EnvironmentAsset {
  _id: string;
  name: string;
  url: string;
  createdAt?: string;
}

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });

/**
 * Photos of the actual premises — shop, showroom, workshop, storefront.
 *
 * These are stored as BrandAsset records with type 'environment'. The Reels
 * Environment step reads that same collection through
 * GET /video-generation/brand-assets/images, so anything added here shows up
 * in its "pick from brand assets" picker without further plumbing.
 */
const EnvironmentAssets: React.FC = () => {
  const confirm = useConfirm();
  const [assets, setAssets] = useState<EnvironmentAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await brandAssetsAPI.getAll('environment');
      const list = res?.assets || res?.logos || res?.data || [];
      setAssets(Array.isArray(list) ? list : []);
    } catch (err: any) {
      setError(err?.message || 'Could not load environment images');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleFiles = async (fileList: FileList | null) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setError('');
    setUploading(true);
    try {
      for (const file of files) {
        if (!file.type.startsWith('image/')) {
          setError(`${file.name} is not an image`);
          continue;
        }
        if (file.size > 10 * 1024 * 1024) {
          setError(`${file.name} is larger than 10MB`);
          continue;
        }
        const imageData = await fileToBase64(file);
        const res = await brandAssetsAPI.upload({
          imageData,
          type: 'environment',
          name: file.name.replace(/\.[^.]+$/, '')
        });
        if (!res?.success) setError(res?.message || `Could not upload ${file.name}`);
      }
      await load();
    } catch (err: any) {
      setError(err?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const remove = async (id: string, name: string) => {
    if (!(await confirm(`Remove "${name}"?`, { title: 'Remove image?', confirmLabel: 'Remove', danger: true }))) return;
    try {
      const res = await brandAssetsAPI.delete(id);
      if (res?.success) setAssets(prev => prev.filter(a => a._id !== id));
      else setError(res?.message || 'Could not remove image');
    } catch (err: any) {
      setError(err?.message || 'Could not remove image');
    }
  };

  return (
    <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="font-serif-display text-[20px] text-[#F5F4F1] flex items-center gap-2">
            <Store className="w-5 h-5 text-[#F5A623]" />
            Your space
          </h2>
          <p className="text-[12.5px] text-white/45 mt-1 max-w-[600px]">
            Photos of your shop, showroom, workshop or storefront. Gravity renders scenes inside
            your real space instead of inventing one — pick these in the Videos Environment step.
          </p>
        </div>
        <span className="text-[11px] px-2.5 py-1 rounded-full border border-white/[0.10] bg-white/[0.03] text-white/55">
          {assets.length} saved
        </span>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl border border-red-500/30 bg-red-500/[0.08] text-[12.5px] text-red-200/90 flex items-center gap-2.5 mb-4">
          <AlertCircle className="w-4 h-4 flex-shrink-0 text-red-400/80" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="w-6 h-6 animate-spin text-[#F5A623]" />
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          {assets.map((asset) => (
            <div key={asset._id} className="relative group w-36 h-28 rounded-xl overflow-hidden border border-white/[0.10]">
              <img src={asset.url} alt={asset.name} className="w-full h-full object-cover" />
              <div className="absolute inset-x-0 bottom-0 px-2 py-1 bg-black/60 text-[10px] text-white/80 truncate">
                {asset.name}
              </div>
              <button
                type="button"
                onClick={() => remove(asset._id, asset.name)}
                title="Remove"
                className="absolute top-1.5 right-1.5 p-1.5 rounded-md bg-black/60 text-white/80 opacity-0 group-hover:opacity-100 hover:bg-red-500 hover:text-white transition-all"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="w-36 h-28 rounded-xl border border-dashed border-white/[0.15] hover:border-[#F5A623]/50 hover:bg-white/[0.03] flex flex-col items-center justify-center gap-1.5 text-white/40 hover:text-[#F5A623] transition-all disabled:opacity-50"
          >
            {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ImagePlus className="w-5 h-5" />}
            <span className="text-[11px] font-semibold">{uploading ? 'Uploading' : 'Add photos'}</span>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }}
          />
        </div>
      )}

      {!loading && assets.length === 0 && (
        <p className="text-[12.5px] text-white/40 mt-4">
          A wide shot of the space plus a detail or two works best — shot in the light you want your videos to feel like.
        </p>
      )}
    </section>
  );
};

export default EnvironmentAssets;
