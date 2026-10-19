'use strict';
// "Do this next": the short, ordered list of things worth doing on Home. Pure: no database, no clock. The same function
// is fed the data the Home summary already collected, so the rows and the numbers can never disagree.
//
// Rules, in the order they are checked and shown (the first five that apply are returned):
//    1 finish_profile      the business profile is incomplete (the plan is built from it)
//    2 choose_plan         a free account: pick a plan (free accounts skip the plan, week and top-up rules)
//    3 fix_plan            the plan could not be built; offer another go
//    4 plan_building       the plan is being built (information only, no button)
//    5 read_plan           a plan is ready and the customer never opened it (not for a staff, CSM or agency pass)
//    6 approve_week        this week's posts are proposed and waiting for a yes
//    7 top_up              the week cannot be paid for (never inside an agency client workspace)
//    8 review_drafts       posts are waiting for approval
//    9 reply_messages      unread messages, only when the account holds the inbox
//   10 connect_account     nothing is connected (posts can still be made)
//   11 confirm_competitor  a competitor needs a handle confirmed (only with the competitors add-on)
//   12 add_product_photo   some products have no photo
//
// Who sees what:
//   free account             only finish_profile, choose_plan and connect_account (setup and plan actions)
//   agency client workspace  never choose_plan or top_up (billing and plan choice are managed in the agency account),
//                            and never read_plan (a pass cannot tick the customer's own setup step)
//   staff on their own page  nothing
// Ties cannot happen: every rule has its own place in RULE_ORDER and the output keeps that order.
const MAX_ACTIONS = 5;
const RULE_ORDER = Object.freeze([
  'finish_profile', 'choose_plan', 'fix_plan', 'plan_building', 'read_plan', 'approve_week', 'top_up',
  'review_drafts', 'reply_messages', 'connect_account', 'confirm_competitor', 'add_product_photo'
]);
const FREE_ALLOWED = new Set(['finish_profile', 'choose_plan', 'connect_account']);

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const whole = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const noun = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function nextActions(input, options) {
  const s = obj(input);
  const acct = obj(s.account);
  const plan = obj(s.plan);
  const week = obj(s.week);
  const unreplied = obj(s.unreplied);
  const connected = obj(s.connected);
  const competitors = obj(s.competitors);
  const products = obj(s.products);
  const limit = options && Number.isFinite(options.limit) ? Math.max(0, Math.floor(options.limit)) : MAX_ACTIONS;

  if (acct.staff) return [];

  const drafts = whole(s.draftsWaiting);
  const messages = unreplied.entitled === true ? whole(unreplied.value) : 0;
  const planned = whole(week.plannedPosts);
  const needHandle = competitors.held === true ? whole(competitors.needHandle) : 0;
  const noPhoto = Math.max(0, whole(products.count) - whole(products.withPhotos));
  const planState = plan.state;

  const rules = {
    finish_profile: () => (s.profileComplete === false ? {
      kind: 'setup', title: 'Finish your business details', detail: 'Your plan and your posts are built from them.', to: '/settings?tab=business'
    } : null),
    choose_plan: () => (acct.free === true && !acct.clientWorkspace ? {
      kind: 'billing', title: 'Choose a plan', detail: 'Pick the plan that fits to get your plan and weekly posts.', to: '/trial-expired'
    } : null),
    fix_plan: () => (planState === 'failed' ? {
      kind: 'plan', title: 'Try building your plan again', detail: 'The last attempt did not finish. Nothing was charged.', to: '/plan'
    } : null),
    plan_building: () => (planState === 'building' ? {
      kind: 'plan', title: 'Your plan is being built', detail: 'It usually takes a few minutes. You do not need to wait.', to: null, info: true
    } : null),
    read_plan: () => ((planState === 'ready' || planState === 'stale') && plan.opened !== true && !acct.pass && !acct.clientWorkspace ? {
      kind: 'plan', title: 'Read your plan', detail: 'See what we will do for your business and why.', to: '/plan'
    } : null),
    approve_week: () => (week.state === 'proposed' && planned > 0 ? {
      kind: 'week', title: `Make this week's ${noun(planned, 'post', 'posts')}`, detail: 'Nothing goes out until you approve it.', to: '/dashboard#this-week', count: planned
    } : null),
    top_up: () => (week.topUp === true && !acct.clientWorkspace ? {
      kind: 'billing', title: "Top up to make this week's posts", detail: 'Your balance is too low for the posts planned this week.', to: '/trial-expired'
    } : null),
    review_drafts: () => (drafts > 0 ? {
      kind: 'drafts', title: `Review ${noun(drafts, 'post', 'posts')}`, detail: `${noun(drafts, 'post is', 'posts are')} waiting for your approval.`, to: '/drafts', count: drafts
    } : null),
    reply_messages: () => (messages > 0 ? {
      kind: 'inbox', title: `Reply to ${noun(messages, 'message', 'messages')}`, detail: `${noun(messages, 'message is', 'messages are')} unread.`, to: '/inbox', count: messages
    } : null),
    connect_account: () => (connected.count === 0 ? {
      kind: 'setup', title: 'Connect your accounts', detail: 'You can still make posts without it. Connecting lets them go out for you.', to: '/connect-socials'
    } : null),
    confirm_competitor: () => (needHandle > 0 ? {
      kind: 'competitors', title: needHandle === 1 ? "Confirm a competitor's handle" : "Confirm your competitors' handles", detail: 'We only look at a page once you have confirmed it.', to: '/competitors', count: needHandle
    } : null),
    add_product_photo: () => (noPhoto > 0 ? {
      kind: 'products', title: noPhoto === 1 ? 'Add a photo to a product' : 'Add photos to your products', detail: `${noun(noPhoto, 'product has', 'products have')} no photo yet.`, to: '/brand-assets?tab=products', count: noPhoto
    } : null)
  };

  const out = [];
  for (const id of RULE_ORDER) {
    if (out.length >= limit) break;
    if (acct.free === true && !FREE_ALLOWED.has(id)) continue;
    const made = rules[id]();
    if (made) out.push({ id, ...made });
  }
  return out;
}

module.exports = { nextActions, RULE_ORDER, MAX_ACTIONS };
