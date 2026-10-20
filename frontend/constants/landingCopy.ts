// Every customer-facing word of the public landing page, in page order. The separate marketing website copy
// (docs/superpowers/ops/website-copy-workflow.md) is regenerated from this file, so keep it the single source.
// Rules (tests/landing.test.mjs): only what is built and true; no customer logos, testimonials or results; no vendor
// names; no "credit", "trial", "7 days", "worth"; no exclamation marks or em dashes; prices only from the plans answer
// (utils/landingPlans.ts), passed in as `facts`. Quarks are written as a plain amount, the way the app writes them.
//
// The Inbox has never been tested with real accounts. Every line that depends on it carries `inbox: true` and the
// comment CONFIRM AFTER INBOX TEST, and INBOX_LINES_VISIBLE hides all of them in one edit.
import type { LandingFacts } from '../utils/landingPlans';
import { amount, planOf, rupees } from '../utils/landingPlans.ts';

/** Turn off to hide every sentence that depends on the Inbox until its live test has passed. */
export const INBOX_LINES_VISIBLE = true;

/** Where the page sends people. Auth owns the invitation code and the bot check. */
export const LANDING_ROUTES = { signUp: '/login?mode=signup', signIn: '/login' } as const;

export const startLabel = (f: LandingFacts): string => `Start for ${rupees(planOf(f, 'starter').inr)}`;

export const NAV_LINKS: Array<{ id: string; label: string }> = [
  { id: 'make', label: 'What you can make' },
  { id: 'how', label: 'How it works' },
  { id: 'blueprint', label: 'Free Blueprint' },
  { id: 'plans', label: 'Plans' },
  { id: 'faq', label: 'Questions' },
];

export const NAV_COPY = { signIn: 'Sign in', menuOpen: 'Open the menu', menuClose: 'Close the menu', home: 'Nebulaa home' };

export const HERO = {
  eyebrow: 'Social media for Indian small businesses',
  title: 'A month of posts,',
  emphasis: 'made for your business.',
  line: 'Tell Nebulaa about your business once. It writes the captions, makes the pictures and short videos, and lays every post out on your calendar. You check each one and approve it.',
  secondary: 'See what it makes',
  promise: 'Nothing is posted until you approve it.',
  // Kept from the earlier page: the spec (2026-10-18, section 2b) records it as owner-confirmed.
  experience: 'Built on real experience with 2,000+ MSMEs and startups.',
};

/** The phone mock in the hero: an illustrative approval screen, no real business or customer. */
export const PHONE = {
  label: 'Example of the Review and approve screen',
  title: 'Review and approve',
  example: 'Example',
  business: 'Your business',
  platform: 'Instagram',
  caption: 'Festive gift boxes are here. Order by Friday for delivery before Diwali.',
  tags: '#festive #giftbox #shoplocal',
  edit: 'Edit',
  approve: 'Approve',
  waiting: '2 more waiting',
  chips: ['Caption written', 'Picture made'],
};

export const EXAMPLES = {
  eyebrow: 'Examples',
  title: 'Posts for every kind of',
  emphasis: 'business.',
  line: 'Example posts in the styles Nebulaa makes, for hotels, shops, food brands, real estate and more.',
  chip: 'Example',
  alt: (kind: string) => `Example post for ${kind.toLowerCase()}`,
};

export type MakeKey = 'single' | 'carousel' | 'campaign' | 'video' | 'photoshoot' | 'linkedin';
export const MAKE = {
  eyebrow: 'What you can make',
  title: 'Everything your page needs,',
  emphasis: 'in one place.',
  note: 'Every price is shown in Quarks before you make anything.',
  tiles: [
    { key: 'single' as MakeKey, title: 'Posts', line: 'A picture and a caption, ready to approve' },
    { key: 'carousel' as MakeKey, title: 'Carousels', line: 'Swipeable slides that explain or sell' },
    { key: 'campaign' as MakeKey, title: 'Campaigns', line: 'A set of posts for one offer or festival' },
    { key: 'video' as MakeKey, title: 'Videos', line: 'Short videos with voice and music' },
    // The Photoshoot studio is built but switched off until the owner's real proof (ENABLE_PHOTOSHOOT).
    { key: 'photoshoot' as MakeKey, title: 'Photoshoot', line: 'Product photos from the photos you upload', chip: 'Coming soon' },
    { key: 'linkedin' as MakeKey, title: 'LinkedIn', line: 'Professional posts for your company page' },
  ],
};

export const APPROVAL = {
  eyebrow: 'How approval works',
  title: 'Nothing goes out until',
  emphasis: 'you approve it.',
  points: [
    { title: 'You see every post first', text: 'Captions, pictures and videos wait in Review and approve. Change the words, make it again or delete it.' },
    { title: 'You choose when it goes out', text: 'Approve a post and it is scheduled for its planned day, or post it now. Publishing needs the Publish and schedule add-on.' },
    // CONFIRM AFTER INBOX TEST
    { title: 'Replies wait for you too', text: 'With the Inbox add-on, replies to comments and messages are drafted for you to read, change and approve.', inbox: true },
  ],
};

export const HOW = {
  eyebrow: 'How it works',
  title: 'Plan, create, approve,',
  emphasis: 'publish, learn.',
  addon: 'Add-on',
  steps: [
    { title: 'Tell us about your business', text: 'Answer a few simple questions and add your website and social pages. Nebulaa reads them and fills in most of it. You also get a free Brand Growth Blueprint.' },
    { title: 'Get your plan', text: 'See your ideal customer and a simple strategy to reach them, in My plan.' },
    { title: 'Posts and videos every week', text: 'Captions, pictures and short videos for the week are made for you and laid out on your calendar.' },
    { title: 'Review and approve', text: 'Check each post on your phone, change what you like, and approve it.' },
    { title: 'Publish and schedule', text: 'Connect your accounts and send approved posts out now, or on the day you pick.', addon: true },
    // CONFIRM AFTER INBOX TEST
    { title: 'Reply from one inbox', text: 'Comments and messages from your connected pages arrive in one list, each with a reply drafted for you to approve.', addon: true, inbox: true },
    { title: 'Learn what works', text: 'See reach, engagement and new followers for your posts. Nebulaa keeps notes on what works for your business. Competitor insights is an add-on.' },
  ],
  cta: { title: 'Start with step one', text: 'It takes a few questions. You can change every answer later.' },
};

export type AudienceArt = 'single' | 'product' | 'calendar' | 'campaign';
export const BUILT_FOR = {
  eyebrow: 'Built for',
  title: 'Made for people who',
  emphasis: 'run a business.',
  cards: [
    { title: 'Small business owners', text: 'Shops, cafes, salons and studios that need to post often without hiring a designer.', art: 'single' as AudienceArt, tone: 'gold' },
    { title: 'D2C brands', text: 'Launches, offers and festival posts that look like your brand every time.', art: 'product' as AudienceArt, tone: 'coral' },
    { title: 'Local services', text: 'Clinics, coaching centres, hotels and real estate teams that want to stay visible nearby.', art: 'calendar' as AudienceArt, tone: 'teal' },
    { title: 'Agencies', text: 'Several client brands from one account, with a usage report for each client.', art: 'campaign' as AudienceArt, tone: 'lilac' },
  ],
};

export const PLANS_COPY = {
  eyebrow: 'Plans',
  title: 'Three plans.',
  emphasis: (f: LandingFacts) => `Start from ${rupees(planOf(f, 'starter').inr)}.`,
  line: 'Prices are per month plus GST. Starter and Growth do the same things, and Growth makes over three times as much. Agency is for running several client brands. Publishing, competitor insights and the inbox are add-ons on Starter and Growth, and are included in Agency.',
  perMonth: '/month + GST',
  bestValue: 'Best value',
  choose: (name: string) => `Choose ${name}`,
  extraClient: (f: LandingFacts) => `Extra client brand ${rupees(f.agency.slotInr)} a month plus GST`,
  addons: (f: LandingFacts) =>
    `Add-ons, per month plus GST: Publish and schedule ${rupees(f.addons.publish)}, Competitor insights ${rupees(f.addons.competitors)}, Inbox ${rupees(f.addons.inbox)}, or all three for ${rupees(f.addons.bundle)}.`,
  topup: 'Need more? Top up any time from inside the app. Top-ups stay valid for 60 days.',
};

export interface FaqItem { q: string; a: string; inboxNote?: string; link?: { label: string; page: 'privacy' | 'refund' } }
export const FAQ_COPY = { eyebrow: 'Questions', title: 'Questions people', emphasis: 'ask.' };
export function faqItems(f: LandingFacts): FaqItem[] {
  const q = (id: 'starter' | 'professional' | 'agency') => amount(planOf(f, id).quarks);
  return [
    {
      q: 'How does pricing work?',
      a: `Each plan adds Quarks every month: ${q('starter')} on Starter, ${q('professional')} on Growth and ${q('agency')} on Agency. Quarks are what you spend to make posts, carousels, videos and photos, and every price is shown before you make something. Plan Quarks are for the month you paid for; top-ups stay valid for 60 days. Prices are shown without GST; 18% GST is added at checkout.`,
    },
    {
      q: 'What needs my approval?',
      a: 'Every post. Captions, pictures and videos wait in Review and approve, and nothing is published or scheduled before you approve it.',
      // CONFIRM AFTER INBOX TEST
      inboxNote: 'With the Inbox add-on, replies are drafted for you to approve too.',
    },
    {
      q: 'Where can my posts go?',
      a: 'With the Publish and schedule add-on you connect your accounts and send approved posts to Instagram, Facebook, LinkedIn, X and Google Business, and videos to YouTube. You can also download any post and share it yourself.',
    },
    {
      q: 'Which languages does it write in?',
      a: 'English and Tamil today, on their own or mixed in one post. We add more languages only after our team can check them.',
    },
    {
      q: 'Do I need a designer or a website?',
      a: 'No. Nebulaa writes the captions and makes the pictures and videos. If you have a website, add it and Nebulaa fills in most of your details. If not, answer a few simple questions.',
    },
    {
      q: 'What happens to my data?',
      a: 'Your details, photos and posts are used to make your content, and we do not sell your personal data. You can download your data and delete your account yourself in Settings, under Security.',
      link: { label: 'Read the Privacy Policy', page: 'privacy' },
    },
    {
      q: 'Can I cancel any time?',
      a: 'Yes. Go to Settings, then Billing, and choose Cancel plan. Your plan stays available until the end of the month you paid for, and you are not charged again.',
      link: { label: 'Read the Refund Policy', page: 'refund' },
    },
    {
      q: 'Does it work for agencies?',
      a: `Yes, on the Agency plan: ${f.agency.includedClients} client brands included, one shared pool of posts and videos for all clients, and a usage report for each client. Extra client brands are ${rupees(f.agency.slotInr)} a month plus GST.`,
    },
  ];
}

export const CLOSING = {
  title: 'Start your first',
  emphasis: 'month of posts.',
  line: 'Sign up, answer a few questions and choose a plan. Your first posts are made for you to review.',
  haveAccount: 'Already have an account?',
};

export const FOOTER = {
  wordmark: 'Nebulaa',
  contact: 'Contact',
  rights: (year: number) => `© ${year} Nebulaa. All rights reserved.`,
};

/** The page title and description while the landing is shown (search engines that run scripts read them). */
export const LANDING_META = {
  title: 'Nebulaa: a month of posts, made for your business',
  description: 'Nebulaa writes the captions, makes the pictures and short videos, and plans every post for your business. You approve each one.',
};
