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
  { id: 'how', label: 'How it works' },
  { id: 'make', label: 'What you can make' },
  { id: 'blueprint', label: 'Free Blueprint' },
  { id: 'plans', label: 'Plans' },
  { id: 'faq', label: 'Questions' },
];

export const NAV_COPY = { signIn: 'Sign in', menuOpen: 'Open the menu', menuClose: 'Close the menu', home: 'Nebulaa home' };

// Positioning v2 (2026-10-21, docs/superpowers/impact-maps/landing.md): the whole marketing, run from one place, and
// you approve. The two other headline options for the owner are recorded there.
export const HERO = {
  eyebrow: 'Marketing for Indian small businesses',
  title: 'Marketing on autopilot.',
  emphasis: 'You just say yes.',
  line: 'Your whole marketing, planned, made and posted for you. Nebulaa gets to know your business, your customers and your market. It plans your month, makes the content and learns from every result for the next round. You check everything before it goes out.',
  secondary: 'See how it works',
  promise: 'Nothing goes out until you approve it.',
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
  chips: ['On your calendar', 'Made in your style'],
};

/**
 * "How Nebulaa runs your marketing": the eight stages of one loop, in order. Each stage has a title, two short
 * sentences and a drawn piece (the art key, mapped in components/landing/LoopSection.tsx). Learn feeds the next round.
 */
export type StageArt = 'blueprint' | 'people' | 'competitors' | 'calendar' | 'campaign' | 'review' | 'inbox' | 'memory';
export interface LoopStage { title: string; text: string; art: StageArt; tone: string; addon?: string; inbox?: boolean; soonText?: string }
export const LOOP = {
  eyebrow: 'How it works',
  title: 'How Nebulaa runs',
  emphasis: 'your marketing.',
  line: 'Eight stages that work as one loop. What Nebulaa learns from your results goes into your next plan and your next content.',
  stageLabel: (n: number) => `Stage ${n}: `,
  soon: 'Coming soon',
  back: 'Then the loop starts again, with what Nebulaa learned.',
  stages: [
    { title: 'Understand your business', text: 'Add your website and social pages, and answer a few questions. Your free Brand Growth Blueprint shows what Nebulaa confirmed.', art: 'blueprint', tone: 'gold' },
    { title: 'Know your market and customers', text: 'See your ideal customers, how to position your brand and where to show up. It all sits in My plan.', art: 'people', tone: 'teal' },
    { title: 'Watch your competitors', text: 'Follow the competitor pages you confirm. See what they post and which of their posts worked.', art: 'competitors', tone: 'coral', addon: 'Add-on' },
    { title: 'Plan', text: 'Get a roadmap for the next 90 days and a monthly content calendar. You see what is planned for each day.', art: 'calendar', tone: 'green' },
    // The Photoshoot studio is built but switched off until the owner's real proof (ENABLE_PHOTOSHOOT): it stays "coming soon".
    { title: 'Create', text: 'Posts, carousels, campaigns, LinkedIn posts and short videos in your brand style. Product photoshoots are coming soon.', art: 'campaign', tone: 'gold' },
    { title: 'Review, schedule and publish', text: 'Nothing goes out until you approve it. With the Publish add-on, approved content goes out on the day you pick.', art: 'review', tone: 'green', addon: 'Publish add-on' },
    // CONFIRM AFTER INBOX TEST
    { title: 'Engage', text: 'Comments and messages arrive in one inbox. Each reply is drafted for you to read, change and approve.', art: 'inbox', tone: 'blue', addon: 'Inbox add-on', inbox: true, soonText: 'Comments and messages in one inbox, with replies drafted for you to approve.' },
    { title: 'Learn and improve', text: 'See results for each platform and your top posts. Nebulaa learns from your plan, products, results and competitors, and uses it next time.', art: 'memory', tone: 'lilac' },
  ] as LoopStage[],
};

/** A short, honest block on community: what the system helps with, never a promise of followers. */
export const COMMUNITY = {
  eyebrow: 'Building a community',
  title: 'People come back to brands',
  emphasis: 'that keep showing up.',
  line: 'A community grows from steady presence and real conversations. Nebulaa helps with the regular work behind that. The relationships stay yours.',
  points: [
    { title: 'Show up regularly', text: 'Your plan and monthly calendar keep your brand on a steady rhythm, so people keep seeing you.' },
    // CONFIRM AFTER INBOX TEST
    { title: 'Answer people', text: 'With the Inbox add-on, comments and messages wait in one place with replies drafted for you to approve.', inbox: true },
    { title: 'Learn what your audience likes', text: 'Your results and What Nebulaa learned show which topics and formats your audience responds to.' },
  ],
};

export const EXAMPLES = {
  eyebrow: 'Examples',
  title: 'Content for every kind of',
  emphasis: 'business.',
  line: 'Example designs in the styles Nebulaa makes, for hotels, shops, food brands, real estate and more.',
  chip: 'Example',
  alt: (kind: string) => `Example post for ${kind.toLowerCase()}`,
};

export type MakeKey = 'single' | 'carousel' | 'campaign' | 'video' | 'photoshoot' | 'linkedin';
export const MAKE = {
  eyebrow: 'What you can make',
  title: 'Every kind of content your brand needs,',
  emphasis: 'in one place.',
  line: 'Everything is made from your plan, in your brand style, and waits for your approval.',
  note: 'Every price is shown in Quarks before you make anything.',
  tiles: [
    { key: 'single' as MakeKey, title: 'Posts', line: 'A picture and a caption, ready to approve' },
    { key: 'carousel' as MakeKey, title: 'Carousels', line: 'Swipeable slides that explain or sell' },
    { key: 'campaign' as MakeKey, title: 'Campaigns', line: 'A set of pieces for one offer or festival' },
    { key: 'video' as MakeKey, title: 'Videos', line: 'Short videos with voice and music' },
    // The Photoshoot studio is built but switched off until the owner's real proof (ENABLE_PHOTOSHOOT).
    { key: 'photoshoot' as MakeKey, title: 'Photoshoot', line: 'Product photos from the photos you upload', chip: 'Coming soon' },
    { key: 'linkedin' as MakeKey, title: 'LinkedIn', line: 'Professional posts for your company page' },
  ],
};

export const APPROVAL = {
  eyebrow: 'You stay in charge',
  title: 'Nothing goes out until',
  emphasis: 'you approve it.',
  points: [
    { title: 'You see everything first', text: 'Content waits in Review and approve. Change the words, make it again or delete it.' },
    { title: 'You choose when it goes out', text: 'Approve a piece and it is scheduled for its planned day, or post it now. Publishing needs the Publish and schedule add-on.' },
    // CONFIRM AFTER INBOX TEST
    { title: 'Replies wait for you too', text: 'With the Inbox add-on, replies to comments and messages are drafted for you to read, change and approve.', inbox: true },
  ],
};

export type AudienceArt = 'single' | 'product' | 'map' | 'brands';
export const BUILT_FOR = {
  eyebrow: 'Built for',
  title: 'Made for people who',
  emphasis: 'run a business.',
  cards: [
    { title: 'Small business owners', text: 'Shops, cafes, salons and studios that want steady marketing without hiring an agency or a designer.', art: 'single' as AudienceArt, tone: 'gold' },
    { title: 'D2C brands', text: 'Launches, offers and festival campaigns that look and sound like your brand every time.', art: 'product' as AudienceArt, tone: 'coral' },
    { title: 'Local services', text: 'Clinics, coaching centres, hotels and real estate teams that want nearby customers to know them.', art: 'map' as AudienceArt, tone: 'teal' },
    { title: 'Agencies', text: 'Marketing for several client brands from one account, with a usage report for each client.', art: 'brands' as AudienceArt, tone: 'lilac' },
  ],
};

/** The landing's own framing for the free Blueprint; the rest of that section comes from BLUEPRINT_COPY.landing. */
export const BLUEPRINT_INTRO = {
  eyebrow: 'Stage one is free',
  line: 'Start where Nebulaa starts: with your business. Tell it about your brand and receive a printable Brand Growth Blueprint for the months ahead.',
};

export const PLANS_COPY = {
  eyebrow: 'Plans',
  title: 'Three plans.',
  emphasis: (f: LandingFacts) => `Start from ${rupees(planOf(f, 'starter').inr)}.`,
  line: 'Prices are per month plus GST. Starter and Growth include the same marketing tools, and Growth makes over three times as much content. Agency is for running several client brands. Publishing, competitor insights and the inbox are add-ons on Starter and Growth, and are included in Agency.',
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
      q: 'Is this only for social media posts?',
      a: 'No. Nebulaa covers your marketing from start to finish: it gets to know your business and customers, makes your plan and monthly calendar, creates posts, carousels, campaigns and short videos, and learns from your results. Publishing, competitor insights and the inbox are add-ons on Starter and Growth, and are included in Agency.',
      // CONFIRM AFTER INBOX TEST
      inboxNote: 'With the Inbox add-on, replies to comments and messages are drafted for you to approve.',
    },
    {
      q: 'Do I stay in control?',
      a: 'Yes. Nebulaa does the work and you make the decisions. Nothing is published or scheduled until you approve it, you can change or delete anything before then, and you can update your business details at any time.',
    },
    {
      q: 'What needs my approval?',
      a: 'Everything that goes out. Captions, pictures and videos wait in Review and approve, and nothing is published or scheduled before you approve it.',
      // CONFIRM AFTER INBOX TEST
      inboxNote: 'With the Inbox add-on, replies are drafted for you to approve too.',
    },
    {
      q: 'How does pricing work?',
      a: `Each plan adds Quarks every month: ${q('starter')} on Starter, ${q('professional')} on Growth and ${q('agency')} on Agency. Quarks are what you spend to make posts, carousels, videos and photos, and every price is shown before you make something. Plan Quarks are for the month you paid for; top-ups stay valid for 60 days. Prices are shown without GST; 18% GST is added at checkout.`,
    },
    {
      q: 'What does Nebulaa learn about my business?',
      a: 'It learns from six sources: your plan, your Blueprint, your customers, your products, your results and, with the add-on, your competitors. You can see what it holds under What Nebulaa learned, and it uses this for your next plan and content.',
    },
    {
      q: 'Can it track my competitors?',
      a: 'Yes, with the Competitor insights add-on (included in Agency). You confirm which competitor pages to follow, and Nebulaa reads only their public posts to show what they post, which posts did well and the trends coming up.',
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
      a: 'No. Nebulaa writes the words and makes the pictures and videos. If you have a website, add it and Nebulaa fills in most of your details. If not, answer a few simple questions.',
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
  title: 'Hand Nebulaa',
  emphasis: 'your marketing.',
  line: 'Sign up, answer a few questions and choose a plan. Nebulaa starts with your business, then makes your first plan and content for you to review.',
  haveAccount: 'Already have an account?',
};

export const FOOTER = {
  wordmark: 'Nebulaa',
  contact: 'Contact',
  rights: (year: number) => `© ${year} Nebulaa. All rights reserved.`,
};

/** The page title and description while the landing is shown (search engines that run scripts read them). */
export const LANDING_META = {
  title: 'Nebulaa: your marketing, run from one place, with you in charge',
  description: 'Nebulaa gets to know your business and customers, plans your month, makes the content and learns from the results. You approve everything before it goes out.',
};
