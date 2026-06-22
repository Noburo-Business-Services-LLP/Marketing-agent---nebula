import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Loader2, Pencil, Plus, RotateCw, Target, Trash2, X } from 'lucide-react';
import { adCampaignsAPI, apiService } from '../services/api';
import { getThemeClasses, useTheme } from '../context/ThemeContext';
import { AdCampaign, Campaign } from '../types';

type PlatformKey = 'meta' | 'google';
type MetaPostOption = 'facebook' | 'instagram';
type SelectedMetaPosts = Record<MetaPostOption, boolean>;
type MetaPostSelectionMode = '' | 'facebook' | 'instagram' | 'both';
type CtaSourcePlatform = 'facebook' | 'instagram' | '';
type MetaReadiness = {
  canCreateAd: boolean;
  accountReady: boolean;
  paymentMethodAdded: boolean;
  adAccountActive: boolean;
  phoneVerificationRequired: boolean;
  phoneVerified: boolean;
  campaignPublished: boolean;
  facebookPostIdAvailable: boolean;
  postReady?: boolean;
  postStatus?: string;
  message: string;
};

type LocationState = {
  campaignId?: string;
  campaign?: Campaign;
};

const formatDateInput = (date: Date) => date.toISOString().slice(0, 10);

const normalizeCampaignCaption = (campaign?: Campaign | null) =>
  String(campaign?.creative?.captions || campaign?.creative?.textContent || campaign?.description || '').trim();

const normalizeCampaignImage = (campaign?: Campaign | null) =>
  String(
    (Array.isArray(campaign?.creative?.imageUrls) && campaign?.creative?.imageUrls[0]) ||
    campaign?.creative?.videoUrl ||
    ''
  ).trim();

const normalizeFacebookPostIdInput = (value?: string | null) => String(value || '').trim();
const normalizeInstagramPostIdInput = (value?: string | null) => String(value || '').trim();
const isValidFacebookPostId = (value?: string | null) => /^\d{5,}_\d{5,}$/.test(normalizeFacebookPostIdInput(value));
const isCampaignPublishedForAds = (campaign?: Campaign | null) => {
  const status = String(campaign?.status || '').trim().toLowerCase();
  return status === 'posted' || status === 'published';
};

const normalizeCampaignHashtags = (campaign?: Campaign | null) => {
  const rawTags = Array.isArray(campaign?.creative?.hashtags) ? campaign?.creative?.hashtags : [];
  if (rawTags.length > 0) {
    return rawTags
      .map((tag) => String(tag || '').trim())
      .filter(Boolean)
      .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`));
  }

  const caption = normalizeCampaignCaption(campaign);
  return (caption.match(/#[A-Za-z0-9_]+/g) || []).slice(0, 12);
};

const platformLabel = (selection: string) => {
  if (selection === 'meta') return 'Meta Ads';
  if (selection === 'google') return 'Google Ads';
  if (selection === 'both') return 'Meta + Google';
  return selection;
};

const getMetaPostSelectionMode = (selectedPosts: SelectedMetaPosts): MetaPostSelectionMode => {
  if (selectedPosts.facebook && selectedPosts.instagram) return 'both';
  if (selectedPosts.facebook) return 'facebook';
  if (selectedPosts.instagram) return 'instagram';
  return '';
};

const selectedPlatformsLabel = (mode: MetaPostSelectionMode) => {
  if (mode === 'facebook') return 'Facebook Ads';
  if (mode === 'instagram') return 'Instagram Ads';
  if (mode === 'both') return 'Meta Ads (FB + IG)';
  return 'None';
};

const getMetaModeFromSourcePostIds = (item?: { sourcePostIds?: { facebook?: string; instagram?: string } | null }): MetaPostSelectionMode => {
  const hasFacebook = Boolean(String(item?.sourcePostIds?.facebook || '').trim());
  const hasInstagram = Boolean(String(item?.sourcePostIds?.instagram || '').trim());
  if (hasFacebook && hasInstagram) return 'both';
  if (hasFacebook) return 'facebook';
  if (hasInstagram) return 'instagram';
  return '';
};

const getAdPlatformDisplayLabel = (item: AdCampaign) => {
  if (item.platformSelection !== 'meta') return platformLabel(item.platformSelection);
  const mode = getMetaModeFromSourcePostIds(item);
  if (mode) return selectedPlatformsLabel(mode);
  return 'Meta Ads';
};

const compactDate = (value?: string) => {
  const ts = new Date(String(value || '')).getTime();
  if (!Number.isFinite(ts)) return '';
  return new Date(ts).toISOString().slice(0, 10);
};

const formatShortDate = (value?: string) => {
  const ts = new Date(String(value || '')).getTime();
  if (!Number.isFinite(ts)) return '--';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short'
  }).format(new Date(ts));
};

const campaignSourceLabel = (campaign: Campaign) => {
  const name = String(campaign?.name || 'Campaign').trim();
  const platform = String(campaign?.platforms?.[0] || 'platform').trim().toLowerCase();
  const stamp =
    compactDate(campaign?.scheduling?.startDate) ||
    compactDate((campaign as any)?.createdAt) ||
    formatDateInput(new Date());
  return `${name} - ${platform} ${stamp}`;
};

type CampaignUiState = 'failed' | 'partial' | 'success';

const getSelectedPlatforms = (item: AdCampaign): PlatformKey[] =>
  item.platformSelection === 'both' ? ['meta', 'google'] : [item.platformSelection];

const getFailedPlatforms = (item: AdCampaign) => {
  const selected = getSelectedPlatforms(item);
  return selected.filter((name) => item?.platformStatus?.[name]?.status === 'failed');
};

const getCampaignUiState = (item: AdCampaign): CampaignUiState => {
  const selected = getSelectedPlatforms(item);
  const failed = getFailedPlatforms(item);
  const success = selected.filter((name) => item?.platformStatus?.[name]?.status === 'success');
  const rawStatus = String(item?.status || '').toLowerCase();

  if (failed.length === selected.length && failed.length > 0) return 'failed';
  if (failed.length > 0 && success.length > 0) return 'partial';
  if (rawStatus === 'failed') return 'failed';
  if (rawStatus === 'partial') return 'partial';
  return 'success';
};

const statusPillClass = (uiState: CampaignUiState, isDarkMode: boolean) => {
  if (uiState === 'failed') return 'bg-red-500/20 text-red-400';
  if (uiState === 'partial') return 'bg-amber-500/20 text-amber-400';
  if (uiState === 'success') return 'bg-emerald-500/20 text-emerald-400';
  return isDarkMode ? 'bg-slate-700 text-slate-300' : 'bg-slate-100 text-slate-700';
};

const cleanFailureReason = (value?: string) =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .split('|')[0]
    .trim();

const toUserFriendlyAdMessage = (reason?: string, value?: string) => {
  const reasonToken = String(reason || '').trim().toUpperCase();
  if (reasonToken === 'POST_NOT_READY') {
    return 'Your post is still being processed. Please try again shortly.';
  }
  if (reasonToken === 'DUPLICATE_CONTENT') {
    return 'This content was already posted recently. Please modify the content.';
  }
  if (reasonToken === 'INVALID_POST_ID') {
    return 'No valid Facebook post found. Please publish the campaign first.';
  }

  const raw = String(value || '').trim();
  if (!raw) return 'Unable to continue right now. Please try again.';
  return raw;
};

const formatAdCreationFailure = (reason?: string, value?: string) => {
  const detail = String(value || '').trim() || toUserFriendlyAdMessage(reason, '');
  if (!detail) return 'Ad creation failed.';
  if (/^ad creation failed\b/i.test(detail)) return detail;
  return `Ad creation failed\n${detail}`;
};

const getFailedEntries = (item: AdCampaign) => {
  const seen = new Set<string>();
  const selected = getSelectedPlatforms(item);
  const entries: Array<{ platform: PlatformKey; message: string }> = [];

  for (const platform of selected) {
    if (item?.platformStatus?.[platform]?.status !== 'failed') continue;
    const reason = cleanFailureReason(item?.platformStatus?.[platform]?.message || 'Failed to process ad campaign');
    const key = `${platform}:${reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ platform, message: reason });
  }

  return entries;
};

const getPrimaryFailure = (item: AdCampaign) => getFailedEntries(item)[0] || null;

const getSummaryBanner = (uiState: CampaignUiState) => {
  if (uiState === 'failed') return '🔴 Ad Campaign Failed to Launch';
  if (uiState === 'partial') return '🟡 Ad Created with Issues';
  return '🟢 Ad Campaign Created and Running';
};

const getSummaryBannerClass = (uiState: CampaignUiState, isDarkMode: boolean) => {
  if (uiState === 'failed') {
    return isDarkMode ? 'border-red-500/30 bg-red-500/10 text-red-300' : 'border-red-200 bg-red-50 text-red-700';
  }
  if (uiState === 'partial') {
    return isDarkMode ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-amber-200 bg-amber-50 text-amber-700';
  }
  return isDarkMode ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-emerald-200 bg-emerald-50 text-emerald-700';
};

const toTwoLineCaption = (value?: string) => {
  const lines = String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 2);
  return lines.join('\n');
};

const formatAmount = (currency: string, amount: number) => {
  if (String(currency || '').toUpperCase() === 'INR') {
    return `₹${Number(amount || 0).toLocaleString('en-IN')}`;
  }
  return `${String(currency || '').toUpperCase()} ${Number(amount || 0).toLocaleString()}`;
};

const formatDateRange = (startDate: string, endDate: string) =>
  `${formatShortDate(startDate)} -> ${formatShortDate(endDate)}`;

const INSTAGRAM_META_REQUIRED_MESSAGE =
  'Instagram post is not available. Publish this campaign to Instagram to enable Meta Ads.';

const AdCampaigns: React.FC = () => {
  const { isDarkMode } = useTheme();
  const theme = getThemeClasses(isDarkMode);
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = (location.state || {}) as LocationState;

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [pageError, setPageError] = useState('');
  const [pageSuccess, setPageSuccess] = useState('');
  const [modalError, setModalError] = useState('');
  const [deleteModalItem, setDeleteModalItem] = useState<AdCampaign | null>(null);
  const [createdSummary, setCreatedSummary] = useState<AdCampaign | null>(null);
  const [ctaPreviewLoading, setCtaPreviewLoading] = useState(false);
  const [ctaPreviewText, setCtaPreviewText] = useState('');
  const [ctaPreviewLink, setCtaPreviewLink] = useState('');
  const [ctaPreviewSourcePlatform, setCtaPreviewSourcePlatform] = useState<CtaSourcePlatform>('');
  const [ctaPreviewError, setCtaPreviewError] = useState('');

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [adCampaigns, setAdCampaigns] = useState<AdCampaign[]>([]);

  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [budget, setBudget] = useState('500');
  const [currency, setCurrency] = useState('INR');
  const [startDate, setStartDate] = useState(formatDateInput(new Date()));
  const [endDate, setEndDate] = useState(formatDateInput(new Date(Date.now() + 1000 * 60 * 60 * 24 * 7)));
  const [metaReadinessLoading, setMetaReadinessLoading] = useState(false);
  const [metaReadiness, setMetaReadiness] = useState<MetaReadiness | null>(null);
  const [metaReadinessError, setMetaReadinessError] = useState('');

  const stateCampaignId = String(locationState?.campaignId || '').trim();
  const stateCampaign = locationState?.campaign;

  const campaignNameMap = useMemo(() => new Map(campaigns.map((campaign) => [campaign._id, campaign.name])), [campaigns]);

  const selectedCampaign = useMemo(
    () => campaigns.find((campaign) => campaign._id === selectedCampaignId) || null,
    [campaigns, selectedCampaignId]
  );

  const effectiveCampaign = selectedCampaign || stateCampaign || null;
  const prefilledTitle = String(effectiveCampaign?.name || '').trim();
  const prefilledDescription = normalizeCampaignCaption(effectiveCampaign);
  const prefilledHashtags = normalizeCampaignHashtags(effectiveCampaign);
  const prefilledCreative = normalizeCampaignImage(effectiveCampaign);
  const campaignSocialPostIds =
    selectedCampaign?.socialPostIds && typeof selectedCampaign.socialPostIds === 'object'
      ? selectedCampaign.socialPostIds
      : null;
  const resolvedFacebookPostId = normalizeFacebookPostIdInput(
    selectedCampaign?.facebookPostId || String(campaignSocialPostIds?.facebook || '')
  );
  const resolvedInstagramPostId = normalizeInstagramPostIdInput(
    selectedCampaign?.instagramPostId || String(campaignSocialPostIds?.instagram || '')
  );
  const isFacebookPostAvailable = isValidFacebookPostId(resolvedFacebookPostId);
  const isInstagramPostAvailable = Boolean(resolvedInstagramPostId);
  const inferredSelectedPosts: SelectedMetaPosts = {
    facebook: isFacebookPostAvailable,
    instagram: isInstagramPostAvailable
  };
  const selectedPostMode = getMetaPostSelectionMode(inferredSelectedPosts);
  const hasDetectedPost = isFacebookPostAvailable || isInstagramPostAvailable;
  const campaignHasCreativeAndCaption = Boolean(prefilledCreative) && Boolean(prefilledDescription);
  const campaignAyrshareStatus = String(selectedCampaign?.ayrshareStatus || '').trim().toLowerCase();
  const campaignPostReadyForMeta = campaignAyrshareStatus === 'success';
  const campaignPublishedForMeta = isCampaignPublishedForAds(selectedCampaign);
  const campaignReadyForAds =
    Boolean(selectedCampaignId) &&
    campaignHasCreativeAndCaption &&
    hasDetectedPost &&
    campaignPublishedForMeta &&
    campaignPostReadyForMeta &&
    Boolean(metaReadiness?.canCreateAd);
  const selectedPlatformLabel = selectedPostMode ? selectedPlatformsLabel(selectedPostMode) : 'Not Available';

  const loadCtaPreview = async () => {
    try {
      setCtaPreviewLoading(true);
      setCtaPreviewError('');

      const response = await adCampaignsAPI.getCtaPreview();
      if (!response?.success || !response?.cta?.link) {
        setCtaPreviewLink('');
        setCtaPreviewText('');
        setCtaPreviewSourcePlatform('');
        setCtaPreviewError(response?.message || 'Please connect your social account to enable CTA link');
        return false;
      }

      const sourcePlatform = String(response?.cta?.sourcePlatform || '').toLowerCase() as CtaSourcePlatform;
      const fallbackTarget = sourcePlatform === 'instagram' ? 'Instagram profile' : 'Facebook page';
      setCtaPreviewLink(String(response.cta.link || '').trim());
      setCtaPreviewSourcePlatform(sourcePlatform);
      setCtaPreviewText(String(response?.previewText || `Learn More -> opens your ${fallbackTarget}`).trim());
      return true;
    } catch (err: any) {
      setCtaPreviewLink('');
      setCtaPreviewText('');
      setCtaPreviewSourcePlatform('');
      setCtaPreviewError(err?.message || 'Please connect your social account to enable CTA link');
      return false;
    } finally {
      setCtaPreviewLoading(false);
    }
  };

  const loadMetaReadiness = async (): Promise<MetaReadiness | null> => {
    try {
      setMetaReadinessLoading(true);
      setMetaReadinessError('');
      const response = await adCampaignsAPI.getMetaReadiness();
      const readiness = (response?.readiness || null) as MetaReadiness | null;

      if (!readiness) {
        setMetaReadiness(null);
        setMetaReadinessError('Complete ad account setup to proceed.');
        return null;
      }

      setMetaReadiness(readiness);
      if (!readiness.canCreateAd) {
        setMetaReadinessError('Complete ad account setup to proceed.');
      } else {
        setMetaReadinessError('');
      }
      return readiness;
    } catch (err: any) {
      setMetaReadiness(null);
      setMetaReadinessError('Complete ad account setup to proceed.');
      return null;
    } finally {
      setMetaReadinessLoading(false);
    }
  };

  const loadData = async () => {
    try {
      setLoading(true);
      setPageError('');

      const [campaignRes, adRes] = await Promise.all([apiService.getCampaigns(), adCampaignsAPI.getAll()]);
      const nextCampaigns = Array.isArray(campaignRes?.campaigns) ? campaignRes.campaigns : [];
      const nextAds = Array.isArray(adRes?.adCampaigns) ? adRes.adCampaigns : [];

      setCampaigns(nextCampaigns);
      setAdCampaigns(nextAds);

      if (stateCampaignId && nextCampaigns.some((campaign) => campaign._id === stateCampaignId)) {
        setSelectedCampaignId(stateCampaignId);
        setIsCreateModalOpen(true);
      } else if (!selectedCampaignId && nextCampaigns.length > 0) {
        setSelectedCampaignId(nextCampaigns[0]._id);
      }
    } catch (err: any) {
      setPageError(err?.message || 'Failed to load ad campaigns.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!stateCampaignId || campaigns.length === 0) return;
    if (campaigns.some((campaign) => campaign._id === stateCampaignId)) {
      setSelectedCampaignId(stateCampaignId);
    }
  }, [campaigns, stateCampaignId]);

  useEffect(() => {
    if (!isCreateModalOpen) return;

    loadCtaPreview();
    loadMetaReadiness();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCreateModalOpen]);

  const closeCreateModal = () => {
    if (submitting) return;
    setIsCreateModalOpen(false);
    setModalError('');
    setCtaPreviewLoading(false);
    setCtaPreviewText('');
    setCtaPreviewLink('');
    setCtaPreviewSourcePlatform('');
    setCtaPreviewError('');
    setMetaReadinessLoading(false);
    setMetaReadiness(null);
    setMetaReadinessError('');
  };

  const createAdCampaign = async () => {
    try {
      setSubmitting(true);
      setModalError('');
      setPageError('');
      setPageSuccess('');

      const response = await adCampaignsAPI.create({
        campaignId: selectedCampaignId,
        platformSelection: 'meta',
        selectedPosts: inferredSelectedPosts,
        budget: Number(budget),
        currency: currency.toUpperCase(),
        startDate,
        endDate
      });

      if (!response?.success || !response?.adCampaign) {
        const reason = String((response as any)?.reason || (response as any)?.errorCode || '').trim();
        setModalError(
          formatAdCreationFailure(reason, response?.message || 'Failed to create ad campaign.')
        );
        return;
      }

      const nextItem = response.adCampaign as AdCampaign;
      setAdCampaigns((prev) => [nextItem, ...prev]);
      setPageSuccess(String(response?.message || '').trim());
      setCreatedSummary(nextItem);
      setIsCreateModalOpen(false);
    } catch (err: any) {
      const reason = String(err?.reason || err?.data?.reason || err?.errorCode || err?.data?.errorCode || '').trim();
      setModalError(
        formatAdCreationFailure(
          reason,
          err?.data?.message || err?.message || 'Failed to create ad campaign.'
        )
      );
    } finally {
      setSubmitting(false);
    }
  };

  const retryCampaign = async (item: AdCampaign) => {
    try {
      setRetryingId(item._id);
      setPageError('');
      setPageSuccess('');

      const response = await adCampaignsAPI.retry(item._id);
      if (!response?.success || !response?.adCampaign) {
        setPageError(response?.message || 'Failed to retry campaign.');
        return;
      }

      const updated = response.adCampaign as AdCampaign;
      setAdCampaigns((prev) => prev.map((entry) => (entry._id === updated._id ? updated : entry)));
      setPageSuccess(response?.message || 'Campaign retried successfully.');
    } catch (err: any) {
      setPageError(err?.message || 'Failed to retry campaign.');
    } finally {
      setRetryingId(null);
    }
  };

  const closeDeleteModal = () => {
    if (deletingId) return;
    setDeleteModalItem(null);
  };

  const deleteCampaign = async () => {
    if (!deleteModalItem?._id) return;
    try {
      setDeletingId(deleteModalItem._id);
      setPageError('');
      setPageSuccess('');

      const response = await adCampaignsAPI.remove(deleteModalItem._id);
      if (!response?.success) {
        setPageError(response?.message || 'Failed to delete campaign.');
        return;
      }

      setAdCampaigns((prev) => prev.filter((entry) => entry._id !== deleteModalItem._id));
      setPageSuccess(response?.message || 'Campaign deleted successfully.');
      setDeleteModalItem(null);
    } catch (err: any) {
      setPageError(err?.message || 'Failed to delete campaign.');
    } finally {
      setDeletingId(null);
    }
  };

  const renderCreateModal = () => {
    if (!isCreateModalOpen) return null;

    return (
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto"
        onClick={(e) => e.target === e.currentTarget && closeCreateModal()}
      >
        <div
          className={`w-full max-w-3xl rounded-2xl shadow-2xl max-h-[90vh] flex flex-col overflow-hidden ${isDarkMode ? 'bg-[#161b22]' : 'bg-white'
            }`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className={`p-4 border-b flex items-center justify-between ${isDarkMode ? 'border-slate-700/50' : 'border-slate-200'}`}>
            <h3 className={`font-bold text-lg ${theme.text}`}>Create Ad Campaign</h3>
            <button
              type="button"
              onClick={closeCreateModal}
              className={`p-1 rounded-lg hover:bg-slate-500/20 ${theme.textSecondary}`}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            <section className={`rounded-xl border p-4 ${isDarkMode ? 'border-slate-700 bg-[#0d1117]' : 'border-slate-200 bg-slate-50'}`}>
              <p className={`text-xs font-semibold uppercase tracking-wide mb-3 ${theme.textSecondary}`}>Source Campaign</p>
              <select
                value={selectedCampaignId}
                onChange={(e) => setSelectedCampaignId(e.target.value)}
                className={`w-full px-3 py-2 rounded-lg border text-sm ${isDarkMode ? 'bg-[#0d1117] border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-800'
                  }`}
              >
                <option value="">Select campaign</option>
                {campaigns.map((campaign) => (
                  <option key={campaign._id} value={campaign._id}>
                    {campaignSourceLabel(campaign)}
                  </option>
                ))}
              </select>
              <p className={`text-xs mt-2 ${theme.textMuted}`}>
                Select one published campaign to load creative and available social posts. Platform is auto-detected from post availability.
              </p>

              {selectedCampaignId && (
                <div className={`mt-3 rounded-lg border p-3 ${isDarkMode ? 'border-slate-700 bg-[#111827]' : 'border-slate-200 bg-white'}`}>
                  {metaReadinessLoading ? (
                    <p className={`text-xs inline-flex items-center gap-2 ${theme.textSecondary}`}>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Checking ad account readiness...
                    </p>
                  ) : campaignReadyForAds ? (
                    <p className="text-xs text-emerald-400 font-medium">Campaign ready for ads</p>
                  ) : (
                    <div className="space-y-1 text-xs text-amber-400">
                      {!campaignHasCreativeAndCaption && <p>Campaign must have an image and caption before creating ads.</p>}
                      {!hasDetectedPost && <p>Please select a campaign that has at least one published social post.</p>}
                      {!campaignPublishedForMeta && <p>Campaign must be posted before creating ads.</p>}
                      {!campaignPostReadyForMeta && <p>Your post is still being processed. Please try again shortly.</p>}
                      {!metaReadiness?.canCreateAd && <p>{metaReadinessError || 'Complete ad account setup to proceed.'}</p>}
                      {!isInstagramPostAvailable && <p>{INSTAGRAM_META_REQUIRED_MESSAGE}</p>}
                    </div>
                  )}
                </div>
              )}
            </section>

            <section className={`rounded-xl border p-4 ${isDarkMode ? 'border-slate-700 bg-[#0d1117]' : 'border-slate-200 bg-slate-50'}`}>
              <p className={`text-xs font-semibold uppercase tracking-wide mb-3 ${theme.textSecondary}`}>Prefilled from Campaign</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div>
                  <p className={`text-[11px] uppercase tracking-wide ${theme.textMuted}`}>Campaign Name</p>
                  <p className={`mt-1 font-semibold ${theme.text}`}>{prefilledTitle || 'No campaign selected'}</p>
                </div>
                <div>
                  <p className={`text-[11px] uppercase tracking-wide ${theme.textMuted}`}>Hashtags</p>
                  <p className={`mt-1 ${theme.textSecondary}`}>
                    {prefilledHashtags.length > 0 ? prefilledHashtags.join(' ') : 'No hashtags available'}
                  </p>
                </div>
                <div className="md:col-span-2">
                  <p className={`text-[11px] uppercase tracking-wide ${theme.textMuted}`}>Caption</p>
                  <p className={`mt-1 ${theme.textSecondary}`}>
                    {prefilledDescription || 'Campaign caption will be prefilled automatically.'}
                  </p>
                </div>
                <div className="md:col-span-2">
                  <p className={`text-[11px] uppercase tracking-wide mb-2 ${theme.textMuted}`}>Creative Preview</p>
                  {prefilledCreative ? (
                    <img src={prefilledCreative} alt="Campaign creative preview" className="w-full h-44 object-cover rounded-lg border border-slate-200/40" />
                  ) : (
                    <div className={`h-32 rounded-lg border flex items-center justify-center text-xs ${isDarkMode ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-500'}`}>
                      Creative preview unavailable
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section className={`rounded-xl border p-4 ${isDarkMode ? 'border-slate-700 bg-[#0d1117]' : 'border-slate-200 bg-slate-50'}`}>
              <p className={`text-xs font-semibold uppercase tracking-wide mb-3 ${theme.textSecondary}`}>Ad Configuration</p>

              <div>
                <p className={`text-xs font-semibold uppercase tracking-wide ${theme.textSecondary}`}>Platform</p>
                <div className={`mt-2 rounded-xl border p-3 ${isDarkMode ? 'border-slate-700 bg-[#111827]' : 'border-slate-300 bg-white'}`}>
                  <p className={`text-sm ${theme.textSecondary}`}>
                    Platform: <span className={`font-semibold ${theme.text}`}>Auto-detected ({selectedPlatformLabel})</span>
                  </p>
                  <p className={`mt-1 text-xs ${theme.textMuted}`}>
                    Based on available Facebook and Instagram posts in the selected source campaign.
                  </p>
                </div>
              </div>

              <div className="mt-4">
                <p className={`text-xs font-semibold uppercase tracking-wide ${theme.textSecondary}`}>Post Status</p>
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {([
                    {
                      id: 'facebook' as const,
                      shortLabel: 'FB',
                      label: 'Facebook Post',
                      postId: resolvedFacebookPostId,
                      isAvailable: isFacebookPostAvailable
                    },
                    {
                      id: 'instagram' as const,
                      shortLabel: 'IG',
                      label: 'Instagram Post',
                      postId: resolvedInstagramPostId,
                      isAvailable: isInstagramPostAvailable
                    }
                  ] as Array<{
                    id: MetaPostOption;
                    shortLabel: string;
                    label: string;
                    postId: string;
                    isAvailable: boolean;
                  }>).map((postOption) => (
                    <div
                      key={postOption.id}
                      className={`rounded-xl border p-3 ${isDarkMode ? 'border-slate-700 bg-[#111827]' : 'border-slate-300 bg-white'}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-[11px] font-bold ${postOption.id === 'facebook'
                              ? 'bg-[#1877F2]/20 text-[#1877F2]'
                              : 'bg-pink-500/20 text-pink-400'
                              }`}
                          >
                            {postOption.shortLabel}
                          </span>
                          <p className={`text-sm font-semibold ${theme.text}`}>{postOption.label}</p>
                        </div>
                        <span className={`text-[11px] px-2 py-0.5 rounded-full border ${postOption.isAvailable
                          ? 'border-emerald-500/40 text-emerald-400'
                          : isDarkMode
                            ? 'border-slate-700 text-slate-400'
                            : 'border-slate-300 text-slate-500'
                          }`}>
                          {postOption.isAvailable ? 'Ready' : 'Not Available'}
                        </span>
                      </div>

                      {postOption.isAvailable ? (
                        <p className={`mt-2 text-[11px] break-all ${theme.textMuted}`}>{postOption.postId}</p>
                      ) : (
                        <p className="mt-2 text-xs text-red-400">
                          {postOption.id === 'instagram' ? INSTAGRAM_META_REQUIRED_MESSAGE : 'Facebook post not available.'}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={`text-xs font-semibold uppercase tracking-wide ${theme.textSecondary}`}>Budget</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                    className={`mt-2 w-full px-3 py-2 rounded-lg border text-sm ${isDarkMode ? 'bg-[#0d1117] border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-800'
                      }`}
                    placeholder="500"
                  />
                </div>
                <div>
                  <label className={`text-xs font-semibold uppercase tracking-wide ${theme.textSecondary}`}>Currency</label>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                    className={`mt-2 w-full px-3 py-2 rounded-lg border text-sm ${isDarkMode ? 'bg-[#0d1117] border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-800'
                      }`}
                  >
                    {['INR', 'USD'].map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={`text-xs font-semibold uppercase tracking-wide ${theme.textSecondary}`}>Start Date</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className={`mt-2 w-full px-3 py-2 rounded-lg border text-sm ${isDarkMode ? 'bg-[#0d1117] border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-800'
                      }`}
                  />
                </div>
                <div>
                  <label className={`text-xs font-semibold uppercase tracking-wide ${theme.textSecondary}`}>End Date</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className={`mt-2 w-full px-3 py-2 rounded-lg border text-sm ${isDarkMode ? 'bg-[#0d1117] border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-800'
                      }`}
                  />
                </div>
              </div>
              <div className={`mt-4 rounded-lg border p-3 ${isDarkMode ? 'border-slate-700 bg-[#111827]' : 'border-slate-200 bg-white'}`}>
                <p className={`text-[11px] uppercase tracking-wide ${theme.textMuted}`}>CTA Preview</p>

                {ctaPreviewLoading ? (
                  <p className={`mt-2 text-xs inline-flex items-center gap-2 ${theme.textSecondary}`}>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Validating connected profile link...
                  </p>
                ) : ctaPreviewLink ? (
                  <>
                    <p className={`mt-2 text-xs ${theme.text}`}>
                      {ctaPreviewText ||
                        `Learn More -> opens your ${ctaPreviewSourcePlatform === 'instagram' ? 'Instagram profile' : 'Facebook page'
                        }`}
                    </p>
                    <p className={`mt-1 text-xs break-all ${theme.textSecondary}`}>{ctaPreviewLink}</p>
                  </>
                ) : (
                  <p className="mt-2 text-xs text-red-400">
                    {ctaPreviewError || 'Please connect your social account to enable CTA link'}
                  </p>
                )}
              </div>
            </section>

            {modalError && (
              <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 text-sm flex items-start gap-2 whitespace-pre-line">
                <AlertCircle className="w-4 h-4" />
                {modalError}
              </div>
            )}
          </div>

          <div className={`p-4 border-t flex items-center justify-end gap-2 ${isDarkMode ? 'border-slate-700/50' : 'border-slate-200'}`}>
            <button
              type="button"
              onClick={closeCreateModal}
              className={`px-4 py-2 rounded-lg text-sm font-medium border ${isDarkMode ? 'border-slate-700 text-slate-300 hover:border-slate-500' : 'border-slate-300 text-slate-700 hover:border-slate-400'
                }`}
            >
              Cancel
            </button>
            <button
              onClick={createAdCampaign}
              disabled={submitting}
              className="px-5 py-2 rounded-lg bg-[#ffcc29] text-[#070A12] font-semibold hover:bg-[#ffcc29]/90 disabled:opacity-60 flex items-center gap-2"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />}
              Create Ad Campaign
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderDeleteModal = () => {
    if (!deleteModalItem) return null;

    return (
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={(e) => e.target === e.currentTarget && closeDeleteModal()}
      >
        <div
          className={`w-full max-w-md rounded-2xl shadow-2xl overflow-hidden ${isDarkMode ? 'bg-[#161b22]' : 'bg-white'
            }`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className={`p-4 border-b ${isDarkMode ? 'border-slate-700/50' : 'border-slate-200'}`}>
            <h3 className={`font-bold text-lg ${theme.text}`}>Delete Campaign</h3>
          </div>
          <div className="p-4">
            <p className={`text-sm ${theme.textSecondary}`}>
              Are you sure you want to delete this campaign?
            </p>
          </div>
          <div className={`p-4 border-t flex justify-end gap-2 ${isDarkMode ? 'border-slate-700/50' : 'border-slate-200'}`}>
            <button
              type="button"
              onClick={closeDeleteModal}
              className={`px-4 py-2 rounded-lg text-sm font-medium border ${isDarkMode
                ? 'border-slate-700 text-slate-300 hover:border-slate-500'
                : 'border-slate-300 text-slate-700 hover:border-slate-400'
                }`}
              disabled={!!deletingId}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={deleteCampaign}
              disabled={!!deletingId}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white hover:bg-red-500 disabled:opacity-60 inline-flex items-center gap-2"
            >
              {deletingId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              Delete Campaign
            </button>
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className={`min-h-[60vh] flex items-center justify-center ${theme.text}`}>
        <Loader2 className="w-6 h-6 animate-spin text-[#ffcc29]" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto min-h-screen">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <h1 className={`text-2xl font-bold ${theme.text}`}>Ad Campaigns</h1>
        <button
          onClick={() => {
            setModalError('');
            setPageSuccess('');
            setCreatedSummary(null);
            setMetaReadiness(null);
            setMetaReadinessError('');
            setIsCreateModalOpen(true);
          }}
          className="px-4 py-2.5 rounded-lg bg-[#ffcc29] text-[#070A12] font-semibold hover:bg-[#ffcc29]/90 inline-flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Create Ad Campaign
        </button>
      </div>

      {pageError && (
        <div className="mb-4 p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {pageError}
        </div>
      )}

      {pageSuccess && (
        <div className="mb-4 p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-sm flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          {pageSuccess}
        </div>
      )}

      {createdSummary && (() => {
        const summaryState = getCampaignUiState(createdSummary);
        const summaryFailure = getPrimaryFailure(createdSummary);
        const summaryCaption = toTwoLineCaption(createdSummary.adDescription);
        const hasFacebookSource = Boolean(String(createdSummary?.sourcePostIds?.facebook || '').trim());
        const hasInstagramSource = Boolean(String(createdSummary?.sourcePostIds?.instagram || '').trim());
        const summaryCampaignId =
          typeof createdSummary.campaignId === 'object'
            ? String(createdSummary.campaignId?._id || '')
            : String(createdSummary.campaignId || '');

        return (
          <div className={`mb-5 p-4 rounded-xl border ${getSummaryBannerClass(summaryState, isDarkMode)}`}>
            <p className="text-sm font-semibold">{getSummaryBanner(summaryState)}</p>

            <div className="mt-3 grid grid-cols-1 lg:grid-cols-3 gap-3">
              <div className={`lg:col-span-2 rounded-xl border p-3 ${isDarkMode ? 'border-slate-700/60 bg-[#0d1117]' : 'border-slate-200 bg-white'}`}>
                <p className={`text-[11px] uppercase tracking-wide ${theme.textMuted}`}>Ad Preview</p>
                <div className="mt-2 flex gap-3">
                  {createdSummary.adCreativeUrl ? (
                    <img
                      src={createdSummary.adCreativeUrl}
                      alt="Ad creative preview"
                      className="w-24 h-24 rounded-lg object-cover border border-slate-300/30 shrink-0"
                    />
                  ) : (
                    <div className={`w-24 h-24 rounded-lg border text-xs flex items-center justify-center shrink-0 ${isDarkMode ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-500'}`}>
                      No image
                    </div>
                  )}

                  <div className="min-w-0">
                    <p className={`text-xs whitespace-pre-line ${theme.text}`}>
                      {summaryCaption || 'Caption not available'}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      {hasFacebookSource && (
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#1877F2]/20 text-[#1877F2] text-[10px] font-bold">FB</span>
                      )}
                      {hasInstagramSource && (
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-pink-500/20 text-pink-400 text-[10px] font-bold">IG</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className={`rounded-xl border p-3 ${isDarkMode ? 'border-slate-700/60 bg-[#0d1117]' : 'border-slate-200 bg-white'}`}>
                <p className={`text-[11px] uppercase tracking-wide ${theme.textMuted}`}>Campaign Info</p>
                <p className={`mt-2 text-xs ${theme.textSecondary}`}>Campaign: <span className={theme.text}>{createdSummary.adTitle}</span></p>
                <p className={`mt-1 text-xs ${theme.textSecondary}`}>Platform: <span className={theme.text}>{getAdPlatformDisplayLabel(createdSummary)}</span></p>
                <p className={`mt-1 text-xs ${theme.textSecondary}`}>Budget: <span className={theme.text}>{formatAmount(createdSummary.budget.currency, Number(createdSummary.budget.amount || 0))}</span></p>
                <p className={`mt-1 text-xs ${theme.textSecondary}`}>Duration: <span className={theme.text}>{formatDateRange(createdSummary.schedule.startDate, createdSummary.schedule.endDate)}</span></p>
                <div className="mt-2">
                  <span className={`text-[11px] font-bold uppercase px-2 py-1 rounded-full ${statusPillClass(summaryState, isDarkMode)}`}>
                    {summaryState === 'success' ? '🟢 Active' : summaryState === 'failed' ? '🔴 Failed' : '🟡 Partial'}
                  </span>
                </div>
              </div>
            </div>

            {summaryFailure && (
              <div className={`mt-3 rounded-xl border p-3 ${isDarkMode ? 'border-red-500/30 bg-red-500/10 text-red-200' : 'border-red-200 bg-red-50 text-red-700'}`}>
                <p className="text-sm font-semibold">❌ {platformLabel(summaryFailure.platform)} Failed</p>
                <p className="text-xs mt-1">Reason: {summaryFailure.message || 'Ad creation failed.'}</p>
                <div className="text-xs mt-2">
                  <p className="font-semibold">Fix:</p>
                  <p>• Ensure campaign is published</p>
                  <p>• Wait for campaign processing to complete</p>
                  <p>• Confirm ad account setup is complete</p>
                </div>
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              {summaryState !== 'success' && (
                <button
                  onClick={() => retryCampaign(createdSummary)}
                  disabled={retryingId === createdSummary._id}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#ffcc29] text-[#070A12] hover:bg-[#ffcc29]/90 disabled:opacity-60 inline-flex items-center gap-1"
                >
                  {retryingId === createdSummary._id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />}
                  Retry
                </button>
              )}
              <button
                onClick={() => navigate('/campaigns', { state: { campaignId: summaryCampaignId } })}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border inline-flex items-center gap-1 ${isDarkMode ? 'border-slate-700 text-slate-300 hover:border-slate-500' : 'border-slate-300 text-slate-700 hover:border-slate-400'
                  }`}
              >
                <Pencil className="w-3.5 h-3.5" />
                Edit Campaign
              </button>
              <button
                onClick={() => setDeleteModalItem(createdSummary)}
                disabled={deletingId === createdSummary._id}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border inline-flex items-center gap-1 ${isDarkMode ? 'border-red-500/40 text-red-300 hover:bg-red-500/10' : 'border-red-300 text-red-700 hover:bg-red-50'
                  } disabled:opacity-60`}
              >
                {deletingId === createdSummary._id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                Delete
              </button>
              {summaryState === 'success' && (
                <button
                  onClick={() => navigate('/analytics', { state: { adCampaignId: createdSummary._id } })}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#ffcc29]/15 text-[#ffcc29] hover:bg-[#ffcc29]/25"
                >
                  View Insights
                </button>
              )}
            </div>
          </div>
        );
      })()}

      <section className={`rounded-2xl border p-5 ${theme.bgCard} ${isDarkMode ? 'border-slate-700/50' : 'border-slate-200'}`}>
        {adCampaigns.length === 0 && (
          <div className={`p-4 rounded-xl border text-sm ${isDarkMode ? 'border-slate-700 bg-[#0d1117] text-slate-400' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
            No ad campaigns yet. Create one from an existing campaign
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
          {adCampaigns.map((item) => {
            const uiState = getCampaignUiState(item);
            const primaryFailure = getPrimaryFailure(item);
            const linkedCampaignId = typeof item.campaignId === 'object' ? String(item.campaignId?._id || '') : String(item.campaignId || '');
            const linkedCampaignName =
              typeof item.campaignId === 'object'
                ? item.campaignId?.name || campaignNameMap.get(linkedCampaignId) || 'Campaign'
                : campaignNameMap.get(linkedCampaignId) || 'Campaign';
            const statusLabel = uiState === 'success' ? 'Active' : uiState === 'failed' ? 'Failed' : 'Partial';
            const statusBadgeClass =
              uiState === 'success'
                ? 'bg-emerald-500/90 text-white'
                : uiState === 'failed'
                  ? 'bg-red-500/90 text-white'
                  : 'bg-amber-500/90 text-[#111]';

            return (
              <article
                key={item._id}
                className={`group rounded-2xl border overflow-hidden transition-transform duration-200 hover:scale-[1.02] ${isDarkMode
                  ? 'border-slate-700 bg-[#0d1117] shadow-sm shadow-black/20 hover:shadow-lg hover:shadow-black/35'
                  : 'border-slate-200 bg-white shadow-sm shadow-slate-200/80 hover:shadow-lg hover:shadow-slate-300/60'
                  }`}
              >
                <div className="relative h-48">
                  {item.adCreativeUrl ? (
                    <img
                      src={item.adCreativeUrl}
                      alt={`${item.adTitle} creative`}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className={`w-full h-full flex items-center justify-center text-sm ${isDarkMode ? 'bg-slate-900 text-slate-400' : 'bg-slate-100 text-slate-500'}`}>
                      No Preview Available
                    </div>
                  )}
                  <span className={`absolute top-3 right-3 text-[11px] font-semibold px-2.5 py-1 rounded-full backdrop-blur-sm ${statusBadgeClass}`}>
                    {statusLabel}
                  </span>
                </div>

                <div className="p-4 flex flex-col min-h-[220px]">
                  <p className={`text-base font-semibold truncate ${theme.text}`}>{linkedCampaignName}</p>
                  <p className={`text-xs mt-1 ${theme.textSecondary}`}>
                    {getAdPlatformDisplayLabel(item)} • {formatAmount(item.budget.currency, Number(item.budget.amount || 0))}
                  </p>
                  <p className={`text-xs mt-1 ${theme.textSecondary}`}>
                    {formatDateRange(item.schedule.startDate, item.schedule.endDate)}
                  </p>

                  {primaryFailure && (
                    <div className={`mt-3 rounded-lg border px-2.5 py-2 text-xs flex items-start gap-2 ${isDarkMode ? 'border-red-500/30 bg-red-500/10 text-red-200' : 'border-red-200 bg-red-50 text-red-700'}`}>
                      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="font-semibold">❌ {platformLabel(primaryFailure.platform)} Failed</p>
                        <p className="truncate">"{primaryFailure.message || 'Unable to launch ad'}"</p>
                      </div>
                      <span
                        className={`ml-auto text-[10px] px-1.5 py-0.5 rounded border ${isDarkMode ? 'border-red-400/40 text-red-200' : 'border-red-300 text-red-700'
                          }`}
                        title="Fix: ensure campaign is published and ad account setup is complete."
                      >
                        Fix
                      </span>
                    </div>
                  )}

                  <div className="mt-auto pt-4 flex flex-wrap gap-2">
                    {(uiState === 'failed' || uiState === 'partial') && (
                      <button
                        onClick={() => retryCampaign(item)}
                        disabled={retryingId === item._id}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#ffcc29] text-[#070A12] hover:bg-[#ffcc29]/90 disabled:opacity-60 inline-flex items-center gap-1"
                      >
                        {retryingId === item._id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />}
                        Retry
                      </button>
                    )}

                    <button
                      onClick={() => navigate('/campaigns', { state: { campaignId: linkedCampaignId } })}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border inline-flex items-center gap-1 ${isDarkMode ? 'border-slate-700 text-slate-300 hover:border-slate-500' : 'border-slate-300 text-slate-700 hover:border-slate-400'
                        }`}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Edit
                    </button>

                    <button
                      onClick={() => setDeleteModalItem(item)}
                      disabled={deletingId === item._id}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border inline-flex items-center gap-1 ${isDarkMode
                        ? 'border-red-500/40 text-red-300 hover:bg-red-500/10'
                        : 'border-red-300 text-red-700 hover:bg-red-50'
                        } disabled:opacity-60`}
                    >
                      {deletingId === item._id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      Delete
                    </button>

                    {uiState === 'success' && (
                      <button
                        onClick={() => navigate('/analytics', { state: { adCampaignId: item._id } })}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#ffcc29]/15 text-[#ffcc29] hover:bg-[#ffcc29]/25"
                      >
                        View Insights
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {renderCreateModal()}
      {renderDeleteModal()}
    </div>
  );
};

export default AdCampaigns;
