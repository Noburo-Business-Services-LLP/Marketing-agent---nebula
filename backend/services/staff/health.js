/** Turns the failure counts and the Ayrshare breaker into green, amber or red cards. Pure. */

const CARDS = [
  { key: 'images', label: 'Images', categories: ['image'], what: 'Image creation' },
  { key: 'publishing', label: 'Publishing', categories: ['publish'], what: 'Posting to social networks' },
  { key: 'social', label: 'Social accounts', categories: ['social_connect'], what: 'Connecting social accounts', breaker: true },
  { key: 'payments', label: 'Payments', categories: ['payment'], what: 'Payments and subscriptions' },
  { key: 'video', label: 'Video', categories: ['video', 'hero_video'], what: 'Video creation' },
  { key: 'writing', label: 'AI writing', categories: ['ai_text'], what: 'Writing captions and scripts' }
];

function statusFor(count) {
  if (count >= 3) return 'red';
  if (count >= 1) return 'amber';
  return 'green';
}

function buildHealth({ snapshot, breaker }) {
  const cats = (snapshot && snapshot.categories) || {};
  return CARDS.map((card) => {
    const lastHour = card.categories.reduce((n, c) => n + ((cats[c] && cats[c].lastHour) || 0), 0);
    const lastDay = card.categories.reduce((n, c) => n + ((cats[c] && cats[c].lastDay) || 0), 0);
    const latest = card.categories.flatMap((c) => (cats[c] && cats[c].latest) || []).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 3);
    let status = statusFor(lastHour);
    let note = lastHour === 0 ? `${card.what} is working.` : `${card.what} failed ${lastHour} ${lastHour === 1 ? 'time' : 'times'} in the last hour.`;
    if (card.breaker && breaker && breaker.tripped) {
      status = 'red';
      note = 'The posting provider is refusing requests, so new connections and posts are paused. This clears itself, or after a restart.';
    }
    return { key: card.key, label: card.label, status, note, lastHour, lastDay, latest };
  });
}

module.exports = { buildHealth, statusFor, CARDS };
