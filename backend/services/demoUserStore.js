const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const usersByEmail = new Map();
const usersById = new Map();

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function createPublicUser(user) {
  return {
    _id: user._id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    companyName: user.companyName,
    avatar: user.avatar,
    onboardingCompleted: user.onboardingCompleted,
    businessProfile: user.businessProfile,
    connectedSocials: (user.connectedSocials || []).map((s) => ({
      platform: s.platform,
      accountName: s.accountName,
      connectedAt: s.connectedAt,
    })),
    subscription: user.subscription,
    createdAt: user.createdAt,
  };
}

function attachMethods(user) {
  return {
    ...user,
    id: user._id,
    userId: user._id,
    toPublicJSON() {
      return createPublicUser(user);
    },
    async comparePassword(candidatePassword) {
      return bcrypt.compare(String(candidatePassword || ''), user.passwordHash);
    },
  };
}

async function createUser({ email, password, firstName, lastName = '', companyName = '' }) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    const err = new Error('Email is required');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }

  if (usersByEmail.has(normalizedEmail)) {
    const err = new Error('An account with this email already exists. Please sign in.');
    err.code = 'DUPLICATE_EMAIL';
    throw err;
  }

  const passwordString = String(password || '');
  const salt = await bcrypt.genSalt(12);
  const passwordHash = await bcrypt.hash(passwordString, salt);

  const now = new Date();
  const userRecord = {
    _id: crypto.randomBytes(12).toString('hex'),
    email: normalizedEmail,
    passwordHash,
    firstName: String(firstName || '').trim(),
    lastName: String(lastName || '').trim(),
    companyName: String(companyName || '').trim(),
    avatar: '',
    onboardingCompleted: false,
    businessProfile: {
      name: '',
      website: '',
      industry: '',
      niche: '',
      businessType: '',
      targetAudience: '',
      brandVoice: 'Professional',
      marketingGoals: [],
      description: '',
      competitors: [],
    },
    connectedSocials: [],
    subscription: { plan: 'free', status: 'active' },
    lastLoginAt: now,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  usersByEmail.set(normalizedEmail, userRecord._id);
  usersById.set(userRecord._id, userRecord);
  return attachMethods(userRecord);
}

function findByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  const id = usersByEmail.get(normalizedEmail);
  if (!id) return null;
  const user = usersById.get(id);
  return user ? attachMethods(user) : null;
}

function findById(id) {
  const user = usersById.get(String(id || ''));
  return user ? attachMethods(user) : null;
}

function updateUser(id, updates) {
  const user = usersById.get(String(id || ''));
  if (!user) return null;

  const allowed = [
    'firstName',
    'lastName',
    'companyName',
    'avatar',
    'onboardingCompleted',
    'businessProfile',
    'connectedSocials',
  ];

  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      user[key] = updates[key];
    }
  }

  user.updatedAt = new Date();
  usersById.set(user._id, user);
  return attachMethods(user);
}

async function setPassword(id, newPassword) {
  const user = usersById.get(String(id || ''));
  if (!user) return null;

  const salt = await bcrypt.genSalt(12);
  user.passwordHash = await bcrypt.hash(String(newPassword || ''), salt);
  user.updatedAt = new Date();
  usersById.set(user._id, user);
  return attachMethods(user);
}

module.exports = {
  createUser,
  findByEmail,
  findById,
  updateUser,
  setPassword,
};
