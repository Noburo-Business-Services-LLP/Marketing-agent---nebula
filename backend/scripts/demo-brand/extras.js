'use strict';
/**
 * Small rows the walkthrough (Stage 4) found empty: saved content ideas, today's notifications and the business context the
 * Competitors page asks for. Pure: no database, no network. Every row belongs to the demo user only, so `remove` (which
 * erases every row of the account through the data registry) deletes them with the rest.
 */
const mongoose = require('mongoose');
const { BRAND, PRODUCTS } = require('./constants');

const HOUR = 3600000;
const DAY = 24 * HOUR;

/** Seven saved ideas for "Content ideas" (Plan): typed ones and a short pasted list; none is already turned into a post. */
function ideaRows({ userId, now }) {
  const ideas = [
    ['A short reel of the Sunday oil bath, with the whole family in the frame.', 'manual', 2],
    ['Customer glow story: ask Kavya for a before-and-after of her routine, with her permission.', 'manual', 4],
    ['What is really inside the Kumkumadi serum? One carousel, one ingredient per slide.', 'manual', 6],
    ['Diwali gift box unboxing: the Lip Balm Trio with a handwritten card.', 'manual', 9],
    ['Behind the batch: the day we pour the Rose Petal Toner.', 'bulk_paste', 12],
    ['Skin myths: "oil makes my skin worse". Fact check with the Neem cleanser.', 'bulk_paste', 12],
    ['Winter skin: a richer night routine with the Bakuchi cream.', 'bulk_paste', 12]
  ];
  return ideas.map(([text, source, daysAgo], i) => {
    const createdAt = new Date(now.getTime() - daysAgo * DAY - i * 17 * 60000);
    return { _id: new mongoose.Types.ObjectId(), userId, text, imageUrl: '', sourceUrl: '', targetDate: null, source, status: 'new', draftId: null, createdAt, updatedAt: createdAt };
  });
}

/**
 * Notifications for the bell. The app only lists the last 24 hours, so these are dated hours ago: run `create` shortly before a
 * recording. `campaigns`: the demo's own campaigns (posted ones newest first for "live", scheduled ones for reminders).
 */
function notificationRows({ userId, campaigns, now }) {
  const posted = campaigns.filter((c) => c.status === 'posted').sort((a, b) => b.publishedAt - a.publishedAt).slice(0, 2);
  const upcoming = campaigns.filter((c) => c.status === 'scheduled').sort((a, b) => a.scheduledFor - b.scheduledFor).slice(0, 2);
  const row = (c, type, title, message, hoursAgo, read) => {
    const at = new Date(now.getTime() - hoursAgo * HOUR);
    return {
      _id: new mongoose.Types.ObjectId(), userId, campaignId: c._id, type, title, message, scheduledFor: at, sentAt: at, readAt: read ? new Date(at.getTime() + 20 * 60000) : null,
      emailSent: false, emailError: null, status: read ? 'read' : 'sent',
      metadata: { campaignName: c.name, platforms: c.platforms, scheduledTime: '', scheduledTimeISO: new Date(c.scheduledFor || c.publishedAt).toISOString() },
      createdAt: at, updatedAt: at
    };
  };
  const out = [];
  posted.forEach((c, i) => out.push(row(c, 'campaign_live', 'Your post is live', `"${c.name}" was posted.`, 2 + i * 7, i > 0)));
  upcoming.forEach((c, i) => out.push(row(c, 'campaign_reminder_30', 'A post goes out soon', `"${c.name}" is scheduled to go out.`, 4 + i * 9, i > 0)));
  return out;
}

/** The business context some pages ask for (company, geography, customer, goal). */
function onboardingContextRow({ userId }) {
  return {
    userId,
    company: { name: BRAND.name, website: BRAND.website, industry: 'Beauty & Wellness', description: `${BRAND.name} makes ayurveda-inspired skincare and haircare in Chennai: ${PRODUCTS.length} products sold on its own website and marketplaces.` },
    targetCustomer: { description: 'Women 22 to 38 in metro India who care about ingredients and want the rituals they grew up with.', roles: [], companySize: 'any', industries: [] },
    geography: { regions: ['Tamil Nadu', 'Karnataka', 'Maharashtra', 'Delhi NCR'], countries: ['India'], businessLocation: 'Chennai, Tamil Nadu', isGlobal: false },
    primaryGoal: 'sales', secondaryGoals: ['awareness'], brandTone: ['friendly', 'caring'],
    valueProposition: { main: BRAND.tagline, keyBenefits: [], differentiators: [] },
    competitors: [], completionStatus: { isComplete: true, completedAt: new Date(), missingFields: [] }
  };
}

module.exports = { ideaRows, notificationRows, onboardingContextRow };
