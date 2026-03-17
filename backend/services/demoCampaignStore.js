const crypto = require('crypto');

const campaignsByUserId = new Map();

function normalizeUserId(userId) {
  return String(userId || '');
}

function ensureUserStore(userId) {
  const normalized = normalizeUserId(userId);
  if (!campaignsByUserId.has(normalized)) {
    campaignsByUserId.set(normalized, new Map());
  }
  return campaignsByUserId.get(normalized);
}

function generateId() {
  return crypto.randomBytes(12).toString('hex');
}

function toDate(value) {
  if (!value) return undefined;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function mergeNested(existing, update) {
  if (!update || typeof update !== 'object') return existing;
  return { ...(existing || {}), ...update };
}

function createCampaign(userId, data) {
  const now = new Date();
  const id = generateId();

  const campaign = {
    _id: id,
    userId: normalizeUserId(userId),
    name: String(data?.name || '').trim() || 'Untitled Campaign',
    objective: data?.objective || 'awareness',
    platforms: Array.isArray(data?.platforms) ? data.platforms : [],
    status: data?.status || 'draft',
    priority: data?.priority || 'medium',
    notes: data?.notes || '',
    creative: mergeNested(
      {
        type: 'image',
        textContent: '',
        imageUrls: [],
        videoUrl: '',
        captions: '',
        hashtags: [],
        callToAction: '',
      },
      data?.creative
    ),
    scheduling: mergeNested(
      {
        startDate: undefined,
        endDate: undefined,
        postTime: '',
        timezone: 'UTC',
        frequency: 'once',
      },
      data?.scheduling
    ),
    targeting: mergeNested(
      {
        demographics: '',
        ageRange: { min: 18, max: 65 },
        gender: 'all',
        locations: [],
        interests: [],
      },
      data?.targeting
    ),
    budget: mergeNested(
      {
        amount: 0,
        total: 0,
        daily: 0,
        spent: 0,
        currency: 'USD',
      },
      data?.budget
    ),
    performance: mergeNested(
      {
        impressions: 0,
        clicks: 0,
        ctr: 0,
        engagement: 0,
        reach: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        conversions: 0,
        spend: 0,
      },
      data?.performance
    ),
    aiGenerated: Boolean(data?.aiGenerated),
    aiSuggestions: mergeNested({}, data?.aiSuggestions),
    createdAt: now,
    updatedAt: now,
  };

  campaign.scheduling.startDate = toDate(campaign.scheduling.startDate);
  campaign.scheduling.endDate = toDate(campaign.scheduling.endDate);

  const store = ensureUserStore(userId);
  store.set(id, campaign);
  return campaign;
}

function listCampaigns(userId, { status, platform, startDate, endDate, limit } = {}) {
  const store = ensureUserStore(userId);
  let campaigns = Array.from(store.values());

  if (status && status !== 'all') {
    campaigns = campaigns.filter((c) => c.status === status);
  }

  if (platform) {
    campaigns = campaigns.filter((c) => Array.isArray(c.platforms) && c.platforms.includes(platform));
  }

  if (startDate || endDate) {
    const start = toDate(startDate);
    const end = toDate(endDate);
    campaigns = campaigns.filter((c) => {
      const d = toDate(c?.scheduling?.startDate);
      if (!d) return false;
      if (start && d < start) return false;
      if (end && d > end) return false;
      return true;
    });
  }

  campaigns.sort((a, b) => {
    const aTime = toDate(a.createdAt)?.getTime() || 0;
    const bTime = toDate(b.createdAt)?.getTime() || 0;
    return bTime - aTime;
  });

  if (limit !== undefined) {
    const n = Number(limit);
    if (Number.isFinite(n) && n > 0) campaigns = campaigns.slice(0, n);
  }

  return campaigns;
}

function getCounts(userId) {
  const store = ensureUserStore(userId);
  const counts = {
    all: 0,
    draft: 0,
    scheduled: 0,
    active: 0,
    posted: 0,
    archived: 0,
  };

  for (const campaign of store.values()) {
    counts.all += 1;
    if (campaign?.status && Object.prototype.hasOwnProperty.call(counts, campaign.status)) {
      counts[campaign.status] += 1;
    }
  }

  return counts;
}

function findCampaign(userId, id) {
  const store = ensureUserStore(userId);
  return store.get(String(id || '')) || null;
}

function updateCampaign(userId, id, updates) {
  const store = ensureUserStore(userId);
  const existing = store.get(String(id || ''));
  if (!existing) return null;

  const next = {
    ...existing,
    ...updates,
    creative: updates?.creative ? mergeNested(existing.creative, updates.creative) : existing.creative,
    scheduling: updates?.scheduling ? mergeNested(existing.scheduling, updates.scheduling) : existing.scheduling,
    targeting: updates?.targeting ? mergeNested(existing.targeting, updates.targeting) : existing.targeting,
    budget: updates?.budget ? mergeNested(existing.budget, updates.budget) : existing.budget,
    performance: updates?.performance ? mergeNested(existing.performance, updates.performance) : existing.performance,
    aiSuggestions: updates?.aiSuggestions ? mergeNested(existing.aiSuggestions, updates.aiSuggestions) : existing.aiSuggestions,
    updatedAt: new Date(),
  };

  if (next.scheduling) {
    next.scheduling.startDate = toDate(next.scheduling.startDate);
    next.scheduling.endDate = toDate(next.scheduling.endDate);
  }

  store.set(String(id || ''), next);
  return next;
}

function deleteCampaign(userId, id) {
  const store = ensureUserStore(userId);
  const existing = store.get(String(id || ''));
  if (!existing) return null;
  store.delete(String(id || ''));
  return existing;
}

module.exports = {
  createCampaign,
  listCampaigns,
  getCounts,
  findCampaign,
  updateCampaign,
  deleteCampaign,
};

