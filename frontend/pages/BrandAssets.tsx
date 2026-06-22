import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BrainCircuit,
  CheckCircle,
  ImageIcon,
  Loader2,
  Palette,
  Plus,
  RefreshCw,
  Sparkles,
  Star,
  StarOff,
  Trash2,
  Upload,
  Wand2,
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

interface ConfidenceScores {
  tone?: number;
  writingStyle?: number;
  ctaStyle?: number;
  visualStyle?: number;
  overall?: number;
}

interface PatternEntry {
  value: string;
  count: number;
}

interface PastPostSample {
  _id?: string;
  source?: string;
  platform?: string;
  caption?: string;
  imageUrl?: string;
  createdAt?: string;
}

interface BrandIntelligenceProfile {
  _id?: string;
  brandName?: string;
  brandDescription?: string;
  assets?: {
    primaryLogoUrl?: string;
    primaryColor?: string;
    secondaryColor?: string;
    fontType?: string;
  };
  detectedProfile?: {
    tone?: string;
    writingStyle?: string;
    ctaStyle?: string;
    visualStyle?: string;
  };
  customProfile?: {
    tone?: string;
    writingStyle?: string;
    ctaStyle?: string;
    visualStyle?: string;
  };
  effectiveProfile?: {
    tone?: string;
    writingStyle?: string;
    ctaStyle?: string;
    visualStyle?: string;
  };
  confidence?: ConfidenceScores;
  patterns?: {
    formatSignals?: string[];
    topHashtags?: PatternEntry[];
    commonOpeners?: PatternEntry[];
    ctaExamples?: string[];
  };
  pastPosts?: PastPostSample[];
  enforcementMode?: 'strict' | 'adaptive' | 'off';
  hasBrandAssets?: boolean;
  hasPastPosts?: boolean;
  isUserCustomized?: boolean;
  lastAnalyzedAt?: string;
}

const TONE_OPTIONS = ['fun', 'professional', 'luxury', 'simple', 'normal'];
const WRITING_STYLE_OPTIONS = ['short', 'storytelling', 'formal', 'casual'];
const CTA_STYLE_OPTIONS = ['direct', 'soft', 'community', 'value_first', 'balanced'];
const VISUAL_STYLE_OPTIONS = ['clean-minimal', 'premium-luxury', 'vibrant-playful'];
const FONT_OPTIONS = [
  { value: 'Inter', label: 'Inter', css: "'Inter', sans-serif" },
  { value: 'Montserrat', label: 'Montserrat', css: "'Montserrat', sans-serif" },
  { value: 'Poppins', label: 'Poppins', css: "'Poppins', sans-serif" },
  { value: 'Playfair Display', label: 'Playfair Display', css: "'Playfair Display', serif" },
  { value: 'Lora', label: 'Lora', css: "'Lora', serif" },
  { value: 'Roboto', label: 'Roboto', css: "'Roboto', sans-serif" }
];
const PLATFORM_OPTIONS = ['instagram', 'facebook', 'linkedin', 'twitter'];

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });

const toPercent = (value?: number) => Math.max(0, Math.min(100, Math.round((Number(value) || 0) * 100)));

const getFontFamilyForPreview = (value?: string) => {
  const selected = FONT_OPTIONS.find((font) => font.value === String(value || '').trim());
  if (selected) return selected.css;
  const cleaned = String(value || '').trim();
  return cleaned ? `'${cleaned}', serif` : "'Inter', sans-serif";
};

const BrandAssets: React.FC = () => {
  const [logos, setLogos] = useState<BrandAsset[]>([]);
  const [profile, setProfile] = useState<BrandIntelligenceProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [analyzingProfile, setAnalyzingProfile] = useState(false);
  const [addingPastPost, setAddingPastPost] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [logoName, setLogoName] = useState('');
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [isPrimaryLogo, setIsPrimaryLogo] = useState(false);

  const [brandName, setBrandName] = useState('');
  const [brandDescription, setBrandDescription] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#111111');
  const [secondaryColor, setSecondaryColor] = useState('#FFCC29');
  const [fontType, setFontType] = useState('');
  const [enforcementMode, setEnforcementMode] = useState<'strict' | 'adaptive' | 'off'>('strict');
  const [customTone, setCustomTone] = useState('');
  const [customWritingStyle, setCustomWritingStyle] = useState('');
  const [customCtaStyle, setCustomCtaStyle] = useState('');
  const [customVisualStyle, setCustomVisualStyle] = useState('');

  const [pastCaption, setPastCaption] = useState('');
  const [pastPlatform, setPastPlatform] = useState('instagram');
  const [pastImagePreview, setPastImagePreview] = useState<string | null>(null);

  const isDarkMode = document.documentElement.classList.contains('dark');
  const primaryLogo = useMemo(() => logos.find((l) => l.isPrimary) || logos[0] || null, [logos]);

  const hydrateFormFromProfile = useCallback((p: BrandIntelligenceProfile | null) => {
    if (!p) return;
    setBrandName(p.brandName || '');
    setBrandDescription(p.brandDescription || '');
    setPrimaryColor(p.assets?.primaryColor || '#111111');
    setSecondaryColor(p.assets?.secondaryColor || '#FFCC29');
    setFontType(p.assets?.fontType || '');
    setEnforcementMode((p.enforcementMode as 'strict' | 'adaptive' | 'off') || 'strict');
    setCustomTone(p.customProfile?.tone || p.effectiveProfile?.tone || p.detectedProfile?.tone || '');
    setCustomWritingStyle(
      p.customProfile?.writingStyle || p.effectiveProfile?.writingStyle || p.detectedProfile?.writingStyle || ''
    );
    setCustomCtaStyle(p.customProfile?.ctaStyle || p.effectiveProfile?.ctaStyle || p.detectedProfile?.ctaStyle || '');
    setCustomVisualStyle(
      p.customProfile?.visualStyle || p.effectiveProfile?.visualStyle || p.detectedProfile?.visualStyle || ''
    );
  }, []);

  const loadData = useCallback(async (showRefreshing = false) => {
    try {
      if (showRefreshing) setRefreshing(true);
      else setLoading(true);

      const [logosRes, profileRes] = await Promise.all([
        brandAssetsAPI.getLogos(),
        brandAssetsAPI.getIntelligenceProfile()
      ]);

      if (logosRes?.success) {
        setLogos(Array.isArray(logosRes.logos) ? logosRes.logos : []);
      }

      if (profileRes?.success && profileRes.profile) {
        setProfile(profileRes.profile);
        hydrateFormFromProfile(profileRes.profile);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load brand data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [hydrateFormFromProfile]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(t);
  }, [error]);

  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(null), 3000);
    return () => clearTimeout(t);
  }, [success]);

  const handleLogoSelect = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file for the logo');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('Logo must be less than 10MB');
      return;
    }
    const base64 = await fileToBase64(file);
    setLogoPreview(base64);
    if (!logoName) {
      setLogoName(file.name.replace(/\.[^/.]+$/, ''));
    }
  }, [logoName]);

  const handleLogoInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const file = event.target.files?.[0];
      if (!file) return;
      await handleLogoSelect(file);
    } catch (err: any) {
      setError(err?.message || 'Failed to read logo');
    }
  };

  const handleLogoDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      const file = event.dataTransfer.files?.[0];
      if (!file) return;
      await handleLogoSelect(file);
    } catch (err: any) {
      setError(err?.message || 'Failed to read logo');
    }
  };

  const uploadLogo = async () => {
    if (!logoPreview || !logoName.trim()) {
      setError('Please choose a logo and enter its name');
      return;
    }

    try {
      setUploadingLogo(true);
      setError(null);
      const response = await brandAssetsAPI.upload({
        imageData: logoPreview,
        type: 'logo',
        name: logoName.trim(),
        isPrimary: isPrimaryLogo || logos.length === 0
      });

      if (!response?.success) {
        setError(response?.message || 'Logo upload failed');
        return;
      }

      setSuccess('Logo uploaded');
      setLogoPreview(null);
      setLogoName('');
      setIsPrimaryLogo(false);
      await loadData(true);
    } catch (err: any) {
      setError(err?.message || 'Logo upload failed');
    } finally {
      setUploadingLogo(false);
    }
  };

  const setPrimaryLogo = async (logoId: string) => {
    try {
      const response = await brandAssetsAPI.setPrimary(logoId);
      if (!response?.success) {
        setError(response?.message || 'Failed to set primary logo');
        return;
      }
      setSuccess('Primary logo updated');
      await loadData(true);
    } catch (err: any) {
      setError(err?.message || 'Failed to set primary logo');
    }
  };

  const deleteLogo = async (asset: BrandAsset) => {
    if (!window.confirm(`Delete logo "${asset.name}"?`)) return;
    try {
      const response = await brandAssetsAPI.delete(asset._id);
      if (!response?.success) {
        setError(response?.message || 'Failed to delete logo');
        return;
      }
      setSuccess('Logo deleted');
      await loadData(true);
    } catch (err: any) {
      setError(err?.message || 'Failed to delete logo');
    }
  };

  const saveProfile = async () => {
    try {
      setSavingProfile(true);
      setError(null);
      const response = await brandAssetsAPI.updateIntelligenceProfile({
        brandName,
        brandDescription,
        primaryColor,
        secondaryColor,
        fontType,
        enforcementMode,
        customProfile: {
          tone: customTone,
          writingStyle: customWritingStyle,
          ctaStyle: customCtaStyle,
          visualStyle: customVisualStyle
        }
      });

      if (!response?.success) {
        setError(response?.message || 'Failed to save brand profile');
        return;
      }

      setProfile(response.profile || null);
      hydrateFormFromProfile(response.profile || null);
      setSuccess('Brand profile saved');
    } catch (err: any) {
      setError(err?.message || 'Failed to save brand profile');
    } finally {
      setSavingProfile(false);
    }
  };

  const analyzeProfile = async () => {
    try {
      setAnalyzingProfile(true);
      setError(null);
      const response = await brandAssetsAPI.analyzeIntelligenceProfile({
        brandName,
        brandDescription,
        primaryColor,
        secondaryColor,
        fontType
      });

      if (!response?.success) {
        setError(response?.message || 'Failed to analyze brand profile');
        return;
      }

      setProfile(response.profile || null);
      hydrateFormFromProfile(response.profile || null);
      setSuccess(`Brand profile analyzed (${response.confidenceScore || 0}% confidence)`);
    } catch (err: any) {
      setError(err?.message || 'Failed to analyze brand profile');
    } finally {
      setAnalyzingProfile(false);
    }
  };

  const handlePastPostImageSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const file = event.target.files?.[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        setError('Past post file must be an image');
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        setError('Past post image must be less than 10MB');
        return;
      }
      const base64 = await fileToBase64(file);
      setPastImagePreview(base64);
    } catch (err: any) {
      setError(err?.message || 'Failed to read past post image');
    }
  };

  const addPastPost = async () => {
    if (!pastCaption.trim() && !pastImagePreview) {
      setError('Add a caption or image sample');
      return;
    }
    try {
      setAddingPastPost(true);
      setError(null);
      const response = await brandAssetsAPI.addPastPostSample({
        caption: pastCaption.trim(),
        imageData: pastImagePreview || undefined,
        platform: pastPlatform
      });
      if (!response?.success) {
        setError(response?.message || 'Failed to add past post');
        return;
      }
      setProfile(response.profile || null);
      hydrateFormFromProfile(response.profile || null);
      setPastCaption('');
      setPastImagePreview(null);
      setSuccess('Past post sample added');
    } catch (err: any) {
      setError(err?.message || 'Failed to add past post');
    } finally {
      setAddingPastPost(false);
    }
  };

  const deletePastPost = async (postId?: string) => {
    if (!postId) return;
    if (!window.confirm('Delete this past post sample?')) return;
    try {
      const response = await brandAssetsAPI.deletePastPostSample(postId);
      if (!response?.success) {
        setError(response?.message || 'Failed to delete sample');
        return;
      }
      setProfile(response.profile || null);
      hydrateFormFromProfile(response.profile || null);
      setSuccess('Past post sample removed');
    } catch (err: any) {
      setError(err?.message || 'Failed to delete sample');
    }
  };

  const confidenceRows = useMemo(() => {
    const c = profile?.confidence || {};
    return [
      { key: 'tone', label: 'Tone Match', value: toPercent(c.tone) },
      { key: 'writingStyle', label: 'Writing Style Match', value: toPercent(c.writingStyle) },
      { key: 'ctaStyle', label: 'CTA Style Match', value: toPercent(c.ctaStyle) },
      { key: 'visualStyle', label: 'Visual Style Match', value: toPercent(c.visualStyle) },
      { key: 'overall', label: 'Overall Brand Match', value: toPercent(c.overall) }
    ];
  }, [profile]);

  if (loading) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${isDarkMode ? 'bg-[#070A12]' : 'bg-gray-100'}`}>
        <Loader2 className="w-8 h-8 animate-spin text-[#FFCC29]" />
      </div>
    );
  }

  return (
    <div className={`min-h-screen p-6 ${isDarkMode ? 'bg-[#070A12]' : 'bg-gray-100'}`}>
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className={`text-3xl font-bold flex items-center gap-3 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              <Palette className="w-8 h-8 text-[#FFCC29]" />
              Brand Intelligence & Assets
            </h1>
            <p className={`mt-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Save your brand identity once and auto-apply it in every campaign.
            </p>
          </div>
          <button
            onClick={() => loadData(true)}
            disabled={refreshing}
            className="px-4 py-2 rounded-lg bg-[#FFCC29] text-[#070A12] font-semibold hover:bg-[#FFCC29]/90 disabled:opacity-60 flex items-center gap-2"
          >
            {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Refresh
          </button>
        </div>

        {error && (
          <div className="p-4 rounded-lg border border-red-500/40 bg-red-500/10 text-red-400 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {success && (
          <div className="p-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-emerald-400 flex items-center gap-3">
            <CheckCircle className="w-5 h-5 flex-shrink-0" />
            <span>{success}</span>
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <section className={`xl:col-span-1 rounded-2xl border p-5 ${isDarkMode ? 'bg-[#0D1117] border-slate-700/60' : 'bg-white border-gray-200'}`}>
            <div className="flex items-center justify-between mb-4">
              <h2 className={`text-lg font-semibold flex items-center gap-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                <ImageIcon className="w-5 h-5 text-[#FFCC29]" />
                Brand Logos
              </h2>
              <span className={`text-xs px-2 py-1 rounded-full ${isDarkMode ? 'bg-slate-800 text-gray-300' : 'bg-gray-100 text-gray-700'}`}>
                {logos.length} saved
              </span>
            </div>

            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleLogoDrop}
              className={`border-2 border-dashed rounded-xl p-4 text-center transition-colors ${isDarkMode ? 'border-slate-600 bg-slate-800/40 hover:border-[#FFCC29]/60' : 'border-gray-300 bg-gray-50 hover:border-[#FFCC29]'
                }`}
            >
              {logoPreview ? (
                <div className="space-y-3">
                  <img src={logoPreview} alt="Logo preview" className="mx-auto max-h-28 object-contain rounded-lg" />
                  <button
                    onClick={() => {
                      setLogoPreview(null);
                      setLogoName('');
                    }}
                    className={`text-sm ${isDarkMode ? 'text-gray-400 hover:text-red-400' : 'text-gray-600 hover:text-red-500'}`}
                  >
                    Remove logo preview
                  </button>
                </div>
              ) : (
                <label className="cursor-pointer block">
                  <Upload className={`mx-auto w-8 h-8 mb-2 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                  <p className={`font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Drop or upload logo</p>
                  <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>PNG recommended, max 10MB</p>
                  <input type="file" accept="image/*" className="hidden" onChange={handleLogoInputChange} />
                </label>
              )}
            </div>

            {logoPreview && (
              <div className="mt-4 space-y-3">
                <input
                  value={logoName}
                  onChange={(e) => setLogoName(e.target.value)}
                  placeholder="Logo name"
                  className={`w-full px-3 py-2 rounded-lg border ${isDarkMode ? 'bg-slate-800 border-slate-600 text-white placeholder-gray-500' : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
                    }`}
                />
                <label className={`text-sm flex items-center gap-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <input type="checkbox" checked={isPrimaryLogo} onChange={(e) => setIsPrimaryLogo(e.target.checked)} />
                  Set as primary logo
                </label>
                <button
                  onClick={uploadLogo}
                  disabled={uploadingLogo}
                  className="w-full px-4 py-2 rounded-lg bg-[#FFCC29] text-[#070A12] font-semibold hover:bg-[#FFCC29]/90 disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {uploadingLogo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  {uploadingLogo ? 'Uploading...' : 'Upload Logo'}
                </button>
              </div>
            )}

            <div className="mt-5 space-y-3">
              {logos.length === 0 && (
                <p className={`text-sm text-center py-6 ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>No logos yet</p>
              )}
              {logos.length > 0 && (
                <div className="grid grid-cols-2 gap-3">
                  {logos.map((logo) => (
                    <div
                      key={logo._id}
                      className={`group border rounded-lg overflow-hidden ${isDarkMode ? 'border-slate-700 bg-slate-800/50' : 'border-gray-200 bg-gray-50'
                        } ${logo.isPrimary ? 'ring-2 ring-[#FFCC29]' : ''}`}
                    >
                      <div className="aspect-square p-3 flex items-center justify-center">
                        <img src={logo.url} alt={logo.name} className="max-w-full max-h-full object-contain" />
                      </div>
                      <div className="p-2 border-t text-xs flex items-center justify-between gap-2">
                        <span className={`truncate ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{logo.name}</span>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setPrimaryLogo(logo._id)}
                            className={`p-1 rounded ${logo.isPrimary ? 'bg-[#FFCC29] text-[#070A12]' : isDarkMode ? 'text-gray-300 hover:bg-slate-700' : 'text-gray-700 hover:bg-gray-200'}`}
                            title={logo.isPrimary ? 'Primary' : 'Set primary'}
                          >
                            {logo.isPrimary ? <Star className="w-3.5 h-3.5 fill-current" /> : <StarOff className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            onClick={() => deleteLogo(logo)}
                            className="p-1 rounded text-red-400 hover:bg-red-500/20"
                            title="Delete logo"
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
          </section>

          <section className={`xl:col-span-2 rounded-2xl border p-5 ${isDarkMode ? 'bg-[#0D1117] border-slate-700/60' : 'bg-white border-gray-200'}`}>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h2 className={`text-lg font-semibold flex items-center gap-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                <BrainCircuit className="w-5 h-5 text-[#FFCC29]" />
                Brand Profile
              </h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={analyzeProfile}
                  disabled={analyzingProfile}
                  className={`px-3 py-2 rounded-lg border font-medium flex items-center gap-2 ${isDarkMode ? 'border-slate-600 text-gray-200 hover:bg-slate-800' : 'border-gray-300 text-gray-800 hover:bg-gray-100'
                    } disabled:opacity-60`}
                >
                  {analyzingProfile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                  Analyze
                </button>
                <button
                  onClick={saveProfile}
                  disabled={savingProfile}
                  className="px-4 py-2 rounded-lg bg-[#FFCC29] text-[#070A12] font-semibold hover:bg-[#FFCC29]/90 disabled:opacity-60 flex items-center gap-2"
                >
                  {savingProfile ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                  Save Profile
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-3">
                <label className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Brand Name</label>
                <input
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  placeholder="Nebulaa"
                  className={`w-full px-3 py-2 rounded-lg border ${isDarkMode ? 'bg-slate-800 border-slate-600 text-white placeholder-gray-500' : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
                    }`}
                />
              </div>
              <div className="space-y-3">
                <label className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Font Type</label>
                <select
                  value={fontType}
                  onChange={(e) => setFontType(e.target.value)}
                  className={`w-full px-3 py-2 rounded-lg border ${isDarkMode ? 'bg-slate-800 border-slate-600 text-white' : 'bg-white border-gray-300 text-gray-900'
                    }`}
                >
                  <option value="">Select brand font</option>
                  {FONT_OPTIONS.map((font) => (
                    <option key={font.value} value={font.value}>
                      {font.label}
                    </option>
                  ))}
                  {fontType && !FONT_OPTIONS.some((font) => font.value === fontType) && (
                    <option value={fontType}>{fontType} (Custom)</option>
                  )}
                </select>
              </div>
              <div className="space-y-3">
                <label className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Primary Color</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={primaryColor || '#111111'} onChange={(e) => setPrimaryColor(e.target.value)} className="h-10 w-12 p-1 rounded border bg-transparent" />
                  <input
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    placeholder="#111111"
                    className={`flex-1 px-3 py-2 rounded-lg border ${isDarkMode ? 'bg-slate-800 border-slate-600 text-white' : 'bg-white border-gray-300 text-gray-900'
                      }`}
                  />
                </div>
              </div>
              <div className="space-y-3">
                <label className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Secondary Color</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={secondaryColor || '#FFCC29'} onChange={(e) => setSecondaryColor(e.target.value)} className="h-10 w-12 p-1 rounded border bg-transparent" />
                  <input
                    value={secondaryColor}
                    onChange={(e) => setSecondaryColor(e.target.value)}
                    placeholder="#FFCC29"
                    className={`flex-1 px-3 py-2 rounded-lg border ${isDarkMode ? 'bg-slate-800 border-slate-600 text-white' : 'bg-white border-gray-300 text-gray-900'
                      }`}
                  />
                </div>
              </div>
            </div>

            <div className="mt-4">
              <label className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Brand Description</label>
              <textarea
                value={brandDescription}
                onChange={(e) => setBrandDescription(e.target.value)}
                rows={4}
                placeholder="Describe your brand values, audience, and positioning..."
                className={`mt-2 w-full px-3 py-2 rounded-lg border ${isDarkMode ? 'bg-slate-800 border-slate-600 text-white placeholder-gray-500' : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
                  }`}
              />
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Enforcement Mode</label>
                <select
                  value={enforcementMode}
                  onChange={(e) => setEnforcementMode(e.target.value as 'strict' | 'adaptive' | 'off')}
                  className={`mt-2 w-full px-3 py-2 rounded-lg border ${isDarkMode ? 'bg-slate-800 border-slate-600 text-white' : 'bg-white border-gray-300 text-gray-900'
                    }`}
                >
                  <option value="strict">Strict (always follow brand)</option>
                  <option value="adaptive">Adaptive (follow, but flexible)</option>
                  <option value="off">Off (use AI defaults)</option>
                </select>
              </div>
              <div className={`rounded-lg border p-3 ${isDarkMode ? 'border-slate-700 bg-slate-800/40 text-gray-300' : 'border-gray-200 bg-gray-50 text-gray-700'}`}>
                <div className="text-sm font-medium mb-1">Applied Campaign Identity</div>
                <div className="text-xs space-y-1">
                  <div>Logo: {primaryLogo ? primaryLogo.name : 'Not set'}</div>
                  <div>Tone: {profile?.effectiveProfile?.tone || customTone || 'professional'}</div>
                  <div>Style: {profile?.effectiveProfile?.writingStyle || customWritingStyle || 'formal'}</div>
                </div>
              </div>
            </div>

            <div className="mt-5">
              <h3 className={`text-sm font-semibold uppercase tracking-wide mb-3 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Profile Overrides
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Tone</label>
                  <select
                    value={customTone}
                    onChange={(e) => setCustomTone(e.target.value)}
                    className={`mt-1 w-full px-3 py-2 rounded-lg border ${isDarkMode ? 'bg-slate-800 border-slate-600 text-white' : 'bg-white border-gray-300 text-gray-900'
                      }`}
                  >
                    <option value="">Auto detect</option>
                    {TONE_OPTIONS.map((tone) => (
                      <option key={tone} value={tone}>
                        {tone}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Writing Style</label>
                  <select
                    value={customWritingStyle}
                    onChange={(e) => setCustomWritingStyle(e.target.value)}
                    className={`mt-1 w-full px-3 py-2 rounded-lg border ${isDarkMode ? 'bg-slate-800 border-slate-600 text-white' : 'bg-white border-gray-300 text-gray-900'
                      }`}
                  >
                    <option value="">Auto detect</option>
                    {WRITING_STYLE_OPTIONS.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>CTA Style</label>
                  <select
                    value={customCtaStyle}
                    onChange={(e) => setCustomCtaStyle(e.target.value)}
                    className={`mt-1 w-full px-3 py-2 rounded-lg border ${isDarkMode ? 'bg-slate-800 border-slate-600 text-white' : 'bg-white border-gray-300 text-gray-900'
                      }`}
                  >
                    <option value="">Auto detect</option>
                    {CTA_STYLE_OPTIONS.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Visual Style</label>
                  <select
                    value={customVisualStyle}
                    onChange={(e) => setCustomVisualStyle(e.target.value)}
                    className={`mt-1 w-full px-3 py-2 rounded-lg border ${isDarkMode ? 'bg-slate-800 border-slate-600 text-white' : 'bg-white border-gray-300 text-gray-900'
                      }`}
                  >
                    <option value="">Auto detect</option>
                    {VISUAL_STYLE_OPTIONS.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

          </section>
        </div>

        <section className={`rounded-2xl border p-5 ${isDarkMode ? 'bg-[#0D1117] border-slate-700/60' : 'bg-white border-gray-200'}`}>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className={`text-lg font-semibold flex items-center gap-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              <Sparkles className="w-5 h-5 text-[#FFCC29]" />
              Past Campaign Learning
            </h2>
            <span className={`text-xs px-2 py-1 rounded-full ${isDarkMode ? 'bg-slate-800 text-gray-300' : 'bg-gray-100 text-gray-700'}`}>
              {(profile?.pastPosts || []).length} samples
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-1 space-y-3">
              <label className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Platform</label>
              <select
                value={pastPlatform}
                onChange={(e) => setPastPlatform(e.target.value)}
                className={`w-full px-3 py-2 rounded-lg border ${isDarkMode ? 'bg-slate-800 border-slate-600 text-white' : 'bg-white border-gray-300 text-gray-900'
                  }`}
              >
                {PLATFORM_OPTIONS.map((platform) => (
                  <option key={platform} value={platform}>
                    {platform}
                  </option>
                ))}
              </select>

              <label className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Caption Sample</label>
              <textarea
                value={pastCaption}
                onChange={(e) => setPastCaption(e.target.value)}
                rows={6}
                placeholder="Paste a past post caption to teach structure and tone..."
                className={`w-full px-3 py-2 rounded-lg border ${isDarkMode ? 'bg-slate-800 border-slate-600 text-white placeholder-gray-500' : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
                  }`}
              />

              <label className="block">
                <span className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Image Sample (Optional)</span>
                <input type="file" accept="image/*" className="mt-2 block w-full text-sm" onChange={handlePastPostImageSelect} />
              </label>

              {pastImagePreview && (
                <div className="relative rounded-lg overflow-hidden border border-slate-600/50">
                  <img src={pastImagePreview} alt="Past post preview" className="w-full h-40 object-cover" />
                  <button
                    onClick={() => setPastImagePreview(null)}
                    className="absolute top-2 right-2 p-1 rounded bg-black/60 text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              <button
                onClick={addPastPost}
                disabled={addingPastPost}
                className="w-full px-4 py-2 rounded-lg bg-[#FFCC29] text-[#070A12] font-semibold hover:bg-[#FFCC29]/90 disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {addingPastPost ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                {addingPastPost ? 'Adding...' : 'Add Sample'}
              </button>
            </div>

            <div className="lg:col-span-2 space-y-4">
              <div className={`rounded-xl border p-4 ${isDarkMode ? 'border-slate-700 bg-slate-800/30' : 'border-gray-200 bg-gray-50'}`}>
                <h3 className={`text-sm font-semibold uppercase tracking-wide mb-3 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Detected Pattern Summary
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className={`font-medium mb-2 ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>Format Signals</p>
                    <div className="flex flex-wrap gap-2">
                      {(profile?.patterns?.formatSignals || []).length === 0 && (
                        <span className={isDarkMode ? 'text-gray-500' : 'text-gray-500'}>No signals yet</span>
                      )}
                      {(profile?.patterns?.formatSignals || []).map((signal) => (
                        <span key={signal} className={`px-2 py-1 rounded-full text-xs ${isDarkMode ? 'bg-slate-700 text-gray-200' : 'bg-white border border-gray-300 text-gray-700'}`}>
                          {signal}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className={`font-medium mb-2 ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>Top Hashtags</p>
                    <div className="flex flex-wrap gap-2">
                      {(profile?.patterns?.topHashtags || []).length === 0 && (
                        <span className={isDarkMode ? 'text-gray-500' : 'text-gray-500'}>No hashtags yet</span>
                      )}
                      {(profile?.patterns?.topHashtags || []).map((entry) => (
                        <span key={`${entry.value}-${entry.count}`} className={`px-2 py-1 rounded-full text-xs ${isDarkMode ? 'bg-slate-700 text-gray-200' : 'bg-white border border-gray-300 text-gray-700'}`}>
                          {entry.value}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {(profile?.pastPosts || []).slice().reverse().map((post) => (
                  <div
                    key={post._id || `${post.platform}-${post.createdAt || ''}-${post.caption || ''}`}
                    className={`rounded-xl border overflow-hidden ${isDarkMode ? 'border-slate-700 bg-slate-800/40' : 'border-gray-200 bg-white'}`}
                  >
                    {post.imageUrl && <img src={post.imageUrl} alt="Past post sample" className="w-full h-36 object-cover" />}
                    <div className="p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-xs px-2 py-1 rounded-full ${isDarkMode ? 'bg-slate-700 text-gray-200' : 'bg-gray-100 text-gray-700'}`}>
                          {post.platform || 'instagram'}
                        </span>
                        <button onClick={() => deletePastPost(post._id)} className="text-red-400 hover:text-red-300">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <p className={`text-sm line-clamp-4 whitespace-pre-wrap ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        {post.caption || 'Image-only sample'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {(profile?.pastPosts || []).length === 0 && (
                <p className={`text-sm text-center py-8 ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                  Add past posts to teach your preferred message format, CTA flow, and visual structure.
                </p>
              )}
            </div>
          </div>
        </section>

        {!profile?.hasBrandAssets && !profile?.hasPastPosts && (
          <section className={`rounded-2xl border p-4 ${isDarkMode ? 'border-slate-700 bg-slate-800/30 text-gray-300' : 'border-gray-200 bg-gray-50 text-gray-700'}`}>
            <p className="text-sm">
              Campaign generation is currently in fallback mode. Add brand assets or past posts to enforce a consistent on-brand style.
            </p>
          </section>
        )}
      </div>
    </div>
  );
};

export default BrandAssets;
