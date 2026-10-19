/**
 * The Help page (pages/Help.tsx): its quick answers and where each tile leads. Pure, tested in tests/help.test.mjs.
 * Every answer states only what the product does now (checked against the code on 2026-10-19): approval rules from
 * backend/services/draftStatus.js and the Library, add-ons from backend/config/entitlements.js, video plans being free
 * from backend/routes/studioVideos.js. No claim about replies sent from the Inbox.
 */

export interface HelpAnswer { id: string; question: string; answer: string; link?: { to: string; label: string } }

export const HELP_ANSWERS: HelpAnswer[] = [
  {
    id: 'post',
    question: 'How do I make a post?',
    answer: 'Open Create, then Create content. Describe what you want, choose the platforms and the look, and Nebulaa makes the picture and the caption. You see the price before anything is made, and the post is saved in your Library.',
    link: { to: '/campaigns', label: 'Create content' },
  },
  {
    id: 'approval',
    question: 'Which posts need my approval?',
    answer: 'Only posts Nebulaa prepares for you, such as the posts from your plan, wait in Library under Needs approval. Posts you make yourself can be scheduled or posted at once. Approving never posts by itself: a post with a planned date is scheduled for that date, the others wait as Approved.',
    link: { to: '/library?view=approve', label: 'Open Needs approval' },
  },
  {
    id: 'schedule',
    question: 'How do I schedule or post?',
    answer: 'Open the post in your Library and choose Schedule or Post now. This needs your accounts connected and the Publish and schedule add-on, which the Agency plan includes. You can always download a post and share it yourself.',
    link: { to: '/library', label: 'Open the Library' },
  },
  {
    id: 'quarks',
    question: 'What are Quarks?',
    answer: 'Quarks are what you spend to make posts, carousels, videos and photos. Your plan adds Quarks each month and you can buy more at any time. Every price is shown before you make something, and your balance is at the top of the page.',
    link: { to: '/settings?tab=billing', label: 'See what things cost' },
  },
  {
    id: 'accounts',
    question: 'How do I connect my accounts?',
    answer: 'Open Setup, then Connected accounts, and connect each account you want to post to. Connecting and posting are part of the Publish and schedule add-on.',
    link: { to: '/connect-socials', label: 'Connected accounts' },
  },
  {
    id: 'videos',
    question: 'How do videos work?',
    answer: 'Open Create, then Create video. Describe your idea and choose a style, a language and a length. Nebulaa writes a plan for the video that you can read and change for free, then makes the video. Parts of a video that cannot be made are not charged.',
    link: { to: '/reels', label: 'Create video' },
  },
  {
    id: 'photoshoot',
    question: 'What is Photoshoot?',
    answer: 'Photoshoot turns a photo of your product into a set of styled product photos. Choose a product and a pack, and you see the price before it starts. The photos are saved in your Library. Photoshoot is part of the paid plans.',
    link: { to: '/photoshoot', label: 'Open Photoshoot' },
  },
  {
    id: 'inbox',
    question: 'What is the Inbox?',
    answer: 'The Inbox brings the messages, comments and reviews from your connected accounts into one place. It is part of the Inbox add-on, which is used together with Publish and schedule.',
    link: { to: '/inbox', label: 'Open the Inbox' },
  },
];

/** Where the "How Quarks work" tile leads: the price list in Settings > Billing. */
export const QUARKS_HELP_LINK = '/settings?tab=billing';
