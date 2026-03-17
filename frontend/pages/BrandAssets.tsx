import React, { useState, useEffect, useCallback } from 'react';
import {
  ImageIcon,
  Upload,
  Trash2,
  Star,
  StarOff,
  Loader2,
  CheckCircle,
  AlertCircle,
  Palette,
  X
} from 'lucide-react';
import { brandAssetsAPI } from '../services/api';

interface BrandAsset {
  _id: string;
  type: 'logo' | 'template';
  name: string;
  url: string;
  cloudinaryPublicId: string;
  width: number;
  height: number;
  fileSize: number;
  format: string;
  defaultPosition: string;
  defaultSize: string;
  isPrimary: boolean;
  createdAt: string;
}

const BrandAssets: React.FC = () => {
  const [logos, setLogos] = useState<BrandAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<'logo' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Upload form state
  const [logoName, setLogoName] = useState('');
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [isPrimaryLogo, setIsPrimaryLogo] = useState(false);

  const isDarkMode = document.documentElement.classList.contains('dark');

  // Fetch assets on mount
  useEffect(() => {
    fetchAssets();
  }, []);

  const fetchAssets = async () => {
    try {
      setLoading(true);
      const logosRes = await brandAssetsAPI.getLogos();
      if (logosRes.success) setLogos(logosRes.logos || []);
    } catch (err) {
      console.error('Error fetching brand assets:', err);
      setError('Failed to load brand assets');
    } finally {
      setLoading(false);
    }
  };

  // Handle file selection
  const handleFileSelect = useCallback((
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please select an image file (PNG, JPG, etc.)');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError('File size must be less than 10MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target?.result as string;
      setLogoPreview(base64);
      if (!logoName) setLogoName(file.name.replace(/\.[^/.]+$/, ''));
    };
    reader.readAsDataURL(file);
  }, [logoName]);

  // Handle drag and drop
  const handleDrop = useCallback((
    event: React.DragEvent<HTMLDivElement>
  ) => {
    event.preventDefault();
    event.stopPropagation();

    const file = event.dataTransfer.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please drop an image file (PNG, JPG, etc.)');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target?.result as string;
      setLogoPreview(base64);
      if (!logoName) setLogoName(file.name.replace(/\.[^/.]+$/, ''));
    };
    reader.readAsDataURL(file);
  }, [logoName]);

  // Upload logo
  const handleUpload = async () => {
    if (!logoPreview || !logoName.trim()) {
      setError('Please select an image and enter a name for the logo');
      return;
    }

    try {
      setUploading('logo');
      setError(null);

      const response = await brandAssetsAPI.upload({
        imageData: logoPreview,
        type: 'logo',
        name: logoName.trim(),
        isPrimary: isPrimaryLogo || logos.length === 0
      });

      if (response.success) {
        setSuccess('Logo uploaded successfully!');
        setLogoPreview(null);
        setLogoName('');
        setIsPrimaryLogo(false);
        await fetchAssets();
      } else {
        setError(response.message || 'Failed to upload');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to upload logo');
    } finally {
      setUploading(null);
    }
  };

  // Delete asset
  const handleDelete = async (asset: BrandAsset) => {
    if (!confirm(`Are you sure you want to delete "${asset.name}"?`)) return;

    try {
      const response = await brandAssetsAPI.delete(asset._id);
      if (response.success) {
        setSuccess(`${asset.type === 'logo' ? 'Logo' : 'Template'} deleted successfully`);
        await fetchAssets();
      } else {
        setError(response.message || 'Failed to delete');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to delete asset');
    }
  };

  // Set primary logo
  const handleSetPrimary = async (logoId: string) => {
    try {
      const response = await brandAssetsAPI.setPrimary(logoId);
      if (response.success) {
        setSuccess('Primary logo updated');
        await fetchAssets();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to set primary logo');
    }
  };

  // Clear alerts after timeout
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  // Format file size
  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (loading) {
    return (
      <div className={`p-6 ${isDarkMode ? 'bg-[#070A12]' : 'bg-gray-100'} min-h-screen flex items-center justify-center`}>
        <Loader2 className="w-8 h-8 animate-spin text-[#ffcc29]" />
      </div>
    );
  }

  return (
    <div className={`p-6 ${isDarkMode ? 'bg-[#070A12]' : 'bg-gray-100'} min-h-screen`}>
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className={`text-3xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'} mb-2 flex items-center gap-3`}>
            <Palette className="w-8 h-8 text-[#ffcc29]" />
            Brand Assets
          </h1>
          <p className={`${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Upload your brand logos — AI will automatically place them in the best position on generated images
          </p>
        </div>

        {/* Alerts */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-3 text-red-500">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {success && (
          <div className="mb-6 p-4 bg-green-500/10 border border-green-500/30 rounded-lg flex items-center gap-3 text-green-500">
            <CheckCircle className="w-5 h-5 flex-shrink-0" />
            <span>{success}</span>
          </div>
        )}

        <div className="max-w-xl">
          {/* Logos Section */}
          <div className={`${isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-white border-gray-200'} border rounded-xl p-6`}>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-[#ffcc29]/20 flex items-center justify-center">
                <ImageIcon className="w-5 h-5 text-[#ffcc29]" />
              </div>
              <div>
                <h2 className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                  Brand Logos
                </h2>
                <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  {logos.length} logo{logos.length !== 1 ? 's' : ''} saved
                </p>
              </div>
            </div>

            {/* Upload Zone */}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => handleDrop(e)}
              className={`border-2 border-dashed rounded-lg p-6 mb-4 text-center transition-colors
                ${isDarkMode 
                  ? 'border-slate-600 hover:border-[#ffcc29]/50 bg-slate-800/30' 
                  : 'border-gray-300 hover:border-[#ffcc29] bg-gray-50'
                } cursor-pointer`}
            >
              {logoPreview ? (
                <div className="space-y-4">
                  <img 
                    src={logoPreview} 
                    alt="Logo preview" 
                    className="max-h-32 mx-auto object-contain rounded-lg"
                  />
                  <button 
                    onClick={() => { setLogoPreview(null); setLogoName(''); }}
                    className={`text-sm ${isDarkMode ? 'text-gray-400 hover:text-red-400' : 'text-gray-500 hover:text-red-500'}`}
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <label className="cursor-pointer">
                  <Upload className={`w-10 h-10 mx-auto mb-3 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                  <p className={`font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Drop logo here or click to browse
                  </p>
                  <p className={`text-sm ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                    PNG with transparent background recommended
                  </p>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => handleFileSelect(e)}
                  />
                </label>
              )}
            </div>

            {/* Upload Form */}
            {logoPreview && (
              <div className="space-y-4 mb-6">
                <input
                  type="text"
                  placeholder="Logo name (e.g., Primary Logo)"
                  value={logoName}
                  onChange={(e) => setLogoName(e.target.value)}
                  className={`w-full px-4 py-2 rounded-lg border ${
                    isDarkMode 
                      ? 'bg-slate-800 border-slate-600 text-white placeholder-gray-500' 
                      : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
                  } focus:outline-none focus:ring-2 focus:ring-[#ffcc29]/50`}
                />

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isPrimaryLogo}
                    onChange={(e) => setIsPrimaryLogo(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-[#ffcc29] focus:ring-[#ffcc29]"
                  />
                  <span className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Set as primary logo
                  </span>
                </label>

                <button
                  onClick={() => handleUpload()}
                  disabled={uploading === 'logo'}
                  className="w-full py-2.5 bg-[#ffcc29] text-[#070A12] font-semibold rounded-lg hover:bg-[#ffcc29]/90 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {uploading === 'logo' ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Uploading...</>
                  ) : (
                    <><Upload className="w-4 h-4" /> Upload Logo</>
                  )}
                </button>
              </div>
            )}

            {/* Existing Logos */}
            <div className="space-y-3">
              <h3 className={`text-sm font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-600'} uppercase tracking-wide`}>
                Saved Logos
              </h3>
              {logos.length === 0 ? (
                <p className={`text-sm ${isDarkMode ? 'text-gray-500' : 'text-gray-400'} py-4 text-center`}>
                  No logos uploaded yet
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {logos.map((logo) => (
                    <div 
                      key={logo._id}
                      className={`relative group rounded-lg border overflow-hidden ${
                        isDarkMode ? 'border-slate-700 bg-slate-800/50' : 'border-gray-200 bg-gray-50'
                      } ${logo.isPrimary ? 'ring-2 ring-[#ffcc29]' : ''}`}
                    >
                      <div className="aspect-square p-4 flex items-center justify-center">
                        <img 
                          src={logo.url} 
                          alt={logo.name}
                          className="max-w-full max-h-full object-contain"
                        />
                      </div>
                      
                      {/* Overlay Actions */}
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <button
                          onClick={() => handleSetPrimary(logo._id)}
                          className={`p-2 rounded-lg ${logo.isPrimary ? 'bg-[#ffcc29] text-[#070A12]' : 'bg-white/20 text-white hover:bg-white/30'}`}
                          title={logo.isPrimary ? 'Primary Logo' : 'Set as Primary'}
                        >
                          {logo.isPrimary ? <Star className="w-4 h-4 fill-current" /> : <StarOff className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => handleDelete(logo)}
                          className="p-2 rounded-lg bg-red-500/80 text-white hover:bg-red-500"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Name Badge */}
                      <div className={`px-3 py-2 text-xs truncate ${isDarkMode ? 'bg-slate-900/80 text-gray-300' : 'bg-white text-gray-700'}`}>
                        {logo.name}
                        {logo.isPrimary && (
                          <span className="ml-2 px-1.5 py-0.5 bg-[#ffcc29]/20 text-[#ffcc29] rounded text-[10px] font-medium">
                            PRIMARY
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

export default BrandAssets;
