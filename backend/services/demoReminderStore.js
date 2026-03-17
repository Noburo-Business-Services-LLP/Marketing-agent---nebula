const crypto = require('crypto');

const remindersByUserId = new Map();

function normalizeUserId(userId) {
  return String(userId || '');
}

function ensureUserStore(userId) {
  const normalized = normalizeUserId(userId);
  if (!remindersByUserId.has(normalized)) {
    remindersByUserId.set(normalized, new Map());
  }
  return remindersByUserId.get(normalized);
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

function createReminder(userId, data) {
  const now = new Date();
  const id = generateId();

  const reminder = {
    _id: id,
    userId: normalizeUserId(userId),
    type: data?.type || 'custom',
    campaignId: data?.campaignId,
    title: String(data?.title || '').trim(),
    description: data?.description || '',
    scheduledFor: toDate(data?.scheduledFor),
    reminderTime: toDate(data?.reminderTime),
    reminderOffset: Number.isFinite(Number(data?.reminderOffset)) ? Number(data.reminderOffset) : 30,
    status: data?.status || 'pending',
    snoozedUntil: toDate(data?.snoozedUntil),
    notificationChannels: Array.isArray(data?.notificationChannels) ? data.notificationChannels : ['in-app'],
    notificationSentAt: toDate(data?.notificationSentAt),
    isRecurring: Boolean(data?.isRecurring),
    recurringPattern: data?.recurringPattern || 'none',
    platform: data?.platform,
    color: data?.color || '#6366f1',
    createdAt: now,
    updatedAt: now,
  };

  const store = ensureUserStore(userId);
  store.set(id, reminder);
  return reminder;
}

function listReminders(userId, { status, startDate, endDate } = {}) {
  const store = ensureUserStore(userId);
  let reminders = Array.from(store.values());

  if (status) reminders = reminders.filter((r) => r.status === status);

  if (startDate || endDate) {
    const start = toDate(startDate);
    const end = toDate(endDate);
    reminders = reminders.filter((r) => {
      const d = toDate(r.scheduledFor);
      if (!d) return false;
      if (start && d < start) return false;
      if (end && d > end) return false;
      return true;
    });
  }

  reminders.sort((a, b) => {
    const aTime = toDate(a.scheduledFor)?.getTime() || 0;
    const bTime = toDate(b.scheduledFor)?.getTime() || 0;
    return aTime - bTime;
  });

  return reminders;
}

function findReminder(userId, id) {
  const store = ensureUserStore(userId);
  return store.get(String(id || '')) || null;
}

function updateReminder(userId, id, updates) {
  const store = ensureUserStore(userId);
  const existing = store.get(String(id || ''));
  if (!existing) return null;

  const next = {
    ...existing,
    ...updates,
    updatedAt: new Date(),
  };

  next.scheduledFor = toDate(next.scheduledFor);
  next.reminderTime = toDate(next.reminderTime);
  next.snoozedUntil = toDate(next.snoozedUntil);
  next.notificationSentAt = toDate(next.notificationSentAt);
  next.notificationChannels = Array.isArray(next.notificationChannels)
    ? next.notificationChannels
    : existing.notificationChannels;

  store.set(String(id || ''), next);
  return next;
}

function deleteReminder(userId, id) {
  const store = ensureUserStore(userId);
  const existing = store.get(String(id || ''));
  if (!existing) return null;
  store.delete(String(id || ''));
  return existing;
}

function getPendingReminders(userId) {
  const now = new Date();
  const reminders = listReminders(userId);
  return reminders.filter((r) => r.status === 'pending' && toDate(r.reminderTime) && toDate(r.reminderTime) <= now);
}

function getUpcomingReminders(userId, startDate, endDate) {
  const start = toDate(startDate);
  const end = toDate(endDate);
  const reminders = listReminders(userId);
  return reminders
    .filter((r) => {
      if (!['pending', 'snoozed'].includes(r.status)) return false;
      const d = toDate(r.scheduledFor);
      if (!d) return false;
      if (start && d < start) return false;
      if (end && d > end) return false;
      return true;
    })
    .sort((a, b) => {
      const aTime = toDate(a.scheduledFor)?.getTime() || 0;
      const bTime = toDate(b.scheduledFor)?.getTime() || 0;
      return aTime - bTime;
    });
}

module.exports = {
  createReminder,
  listReminders,
  findReminder,
  updateReminder,
  deleteReminder,
  getPendingReminders,
  getUpcomingReminders,
};

