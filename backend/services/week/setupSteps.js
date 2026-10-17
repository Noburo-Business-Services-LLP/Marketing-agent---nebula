// The customer's setup path: a short, ordered, suggested list. Pure.
const { profileComplete } = require('../plan/profileInput');

function setupSteps({ user, state = {} } = {}) {
  const { connectedCount = 0, hasPlan = false, planOpened = false, firstWeekApproved = false, isPaid = false } = state;
  const profile = profileComplete(user || {});
  const steps = [
    {
      id: 'profile',
      title: 'Complete your business profile',
      done: !!profile.complete,
      reason: 'Your plan is built from it.',
      minutes: 5,
    },
    {
      id: 'socials',
      title: 'Connect your social accounts',
      done: connectedCount > 0,
      reason: 'So posts can go out for you. You can make posts without it.',
      minutes: 2,
    },
  ];
  if (isPaid) {
    steps.push(
      { id: 'plan', title: 'Read your plan', done: !!planOpened, reason: 'See what we will do for your business and why.', minutes: 3 },
      { id: 'week', title: 'Approve your first week', done: !!firstWeekApproved, reason: 'Nothing goes out until you say so.', minutes: 1 }
    );
  } else {
    steps.push({ id: 'choose', title: 'Choose a plan', done: false, reason: 'Pick the plan that fits to get your plan and weekly posts.', minutes: 1 });
  }
  // First undone step; the plan (and the week after it) is not offered until a plan exists.
  const firstUndone = steps.find((s) => !s.done);
  const next = firstUndone && !(firstUndone.id === 'plan' && !hasPlan) ? firstUndone.id : null;
  return {
    steps,
    next,
    allDone: steps.every((s) => s.done),
  };
}

module.exports = { setupSteps };
