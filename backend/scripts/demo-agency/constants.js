'use strict';
/**
 * Every fact about the ESTABLISHED demo agency in one place. Brightwave Media and its six clients are fictional: no real
 * person, business or account. Plan: docs/superpowers/ops/demo-agency-established.md.
 */

const AGENCY = Object.freeze({
  email: 'demo-agency-pro@example.test',
  slug: 'agency',
  name: 'Brightwave Media',
  owner: { firstName: 'Priya', lastName: 'Nair' },
  city: 'Chennai, Tamil Nadu',
  description: 'A Chennai social media studio that runs Instagram and Facebook for local and regional businesses: a plan every month, posts approved by the owner, results reported every week.',
  niche: 'Social media for local and regional businesses',
  heroProduct: 'Monthly social media management',
  targetAudience: 'Owners of cafes, clinics, shops, gyms and builders who have no time to post',
});

/** The agency's own marketing plan is built the same way as a client's, from these facts. */
const AGENCY_AS_CLIENT = Object.freeze({
  slug: 'brightwave-media', name: 'Brightwave Media', city: 'Chennai, Tamil Nadu', cityShort: 'Chennai', offer: 'a free social media audit for your business',
  palette: { bg: '#FFF4E3', ink: '#1F2A44', accent: '#F5A623', soft: '#FBD9A0' },
  items: [
    { n: 'Monthly social media management', d: 'A plan, posts and reports every month, approved by you.' }, { n: 'Reels and short videos', d: 'Two short videos a month for every client.' },
    { n: 'Festival campaigns', d: 'Diwali, Pongal and Onam posts planned weeks ahead.' }, { n: 'Weekly results report', d: 'Reach, followers and what worked, in plain words.' }
  ],
  profile: { description: AGENCY.description, niche: AGENCY.niche, heroProduct: AGENCY.heroProduct, targetAudience: AGENCY.targetAudience, targetCustomerProfile: 'Owners of local businesses who have no time to post' }
});

// Dates are counted back from today. `joinedAfter` is days after the first monthly charge; 5 monthly charges in all.
const TIMELINE = Object.freeze({ planCharges: 5, daysSinceLastCharge: 11, slotFromCharge: 3 });

/** Items are what the client sells; a post is about one of them. */
const CLIENTS = Object.freeze([
  {
    slug: 'brew-and-beans', name: 'Brew & Beans Cafe', industry: 'Restaurant, cafe or bar', city: 'Coimbatore, Tamil Nadu', cityShort: 'Coimbatore', motif: 'cafe',
    palette: { bg: '#F6EBDD', ink: '#3A2418', accent: '#C8742B', soft: '#E9D2B5' }, joinedAfter: 1, perMonth: 12, offer: 'Buy 1 get 1 on cold brews',
    tags: ['#coimbatorefoodie', '#specialtycoffee', '#cafevibes'], monogram: 'BB',
    items: [
      { n: 'Cold brew on tap', d: 'Steeped for 18 hours and served over ice.' }, { n: 'Filter coffee flight', d: 'Three South Indian filter coffees, side by side.' },
      { n: 'Walnut brownie', d: 'Baked every morning, gone by noon.' }, { n: 'Cheese garlic toast', d: 'Thick bread, real butter, a little chilli.' },
      { n: 'Weekend brunch plate', d: 'Eggs, sourdough, salad and a drink for one price.' }, { n: 'Beans by the kilo', d: 'Our house roast, ground the way you like it.' }
    ],
    profile: { description: 'A neighbourhood cafe in Coimbatore with its own roast, a baked-in-house counter and a quiet back room for work.', niche: 'Specialty coffee and baked snacks', heroProduct: 'Cold brew and house-roasted beans', targetAudience: 'Students, remote workers and families in RS Puram and Race Course', targetCustomerProfile: 'Young professionals who work from cafes and weekend families' }
  },
  {
    slug: 'lotus-dental', name: 'Lotus Dental Care', industry: 'Clinic, hospital or pharmacy', city: 'Chennai, Tamil Nadu', cityShort: 'Chennai', motif: 'dental',
    palette: { bg: '#E8F4F3', ink: '#0F3B3F', accent: '#1F9AA0', soft: '#C4E5E3' }, joinedAfter: 2, perMonth: 8, offer: 'free check-up this month',
    tags: ['#chennaidentist', '#smilecare', '#dentalhealth'], monogram: 'LD',
    items: [
      { n: 'Teeth cleaning', d: 'A gentle scale and polish in thirty minutes.' }, { n: 'Clear aligners', d: 'Straighter teeth without wires, planned on a screen first.' },
      { n: 'Root canal, painless', d: 'Modern anaesthesia, usually done in one visit.' }, { n: 'Kids dental check', d: 'A friendly first visit for children under ten.' },
      { n: 'Teeth whitening', d: 'Up to four shades brighter in one sitting.' }, { n: 'Dental implants', d: 'A fixed, natural-looking tooth that lasts.' }
    ],
    profile: { description: 'A family dental clinic in Chennai with three dentists, digital X-rays and evening appointments.', niche: 'Family dentistry and smile care', heroProduct: 'Check-ups, cleaning and aligners', targetAudience: 'Families and working professionals in Adyar and Velachery', targetCustomerProfile: 'Parents and young professionals who want a trusted, painless dentist' }
  },
  {
    slug: 'urban-thread', name: 'Urban Thread Boutique', industry: 'Fashion and clothing', city: 'Bengaluru, Karnataka', cityShort: 'Bengaluru', motif: 'boutique',
    palette: { bg: '#FBEAF1', ink: '#4A1030', accent: '#C2185B', soft: '#F4C6D9' }, joinedAfter: 3, perMonth: 14, offer: 'flat 20 percent off new arrivals',
    tags: ['#bengalurufashion', '#ootd', '#boutiquestyle'], monogram: 'UT',
    items: [
      { n: 'Linen co-ord set', d: 'Cool, light and made for a warm Bengaluru day.' }, { n: 'Block-print kurta', d: 'Hand block-printed in Jaipur, cut for everyday wear.' },
      { n: 'Festive anarkali', d: 'Soft georgette with a gold border.' }, { n: 'Cotton wrap dress', d: 'Ties at the waist and washes without fuss.' },
      { n: 'Statement earrings', d: 'Oxidised silver, light enough for all day.' }, { n: 'Handloom saree', d: 'Woven by a small cooperative in Karnataka.' }
    ],
    profile: { description: 'A women-led boutique in Bengaluru selling everyday and festive wear from small Indian makers.', niche: 'Women\'s fashion from small Indian makers', heroProduct: 'Linen sets and block-print kurtas', targetAudience: 'Women 22 to 40 in Bengaluru and across India', targetCustomerProfile: 'Working women who like handmade fabrics and shop on Instagram' }
  },
  {
    slug: 'ironforge-fitness', name: 'IronForge Fitness', industry: 'Gym and fitness', city: 'Hyderabad, Telangana', cityShort: 'Hyderabad', motif: 'gym',
    palette: { bg: '#1B1B1F', ink: '#F5F5F0', accent: '#E53935', soft: '#34343A' }, joinedAfter: 33, perMonth: 10, offer: 'first week free for new members',
    tags: ['#hyderabadfitness', '#gymlife', '#strongerdaily'], monogram: 'IF',
    items: [
      { n: 'Strength floor', d: 'Racks, plates and platforms, never crowded before 8 am.' }, { n: '6 am HIIT class', d: 'Forty minutes, done before work starts.' },
      { n: 'Personal training', d: 'A plan built around you, checked every two weeks.' }, { n: 'Women\'s only batch', d: 'A calm hour with a woman trainer on the floor.' },
      { n: 'Nutrition coaching', d: 'Simple meals from the food you already eat.' }, { n: '90 day challenge', d: 'Weigh in, train hard, compare at the end.' }
    ],
    profile: { description: 'A neighbourhood strength and fitness gym in Hyderabad with group classes and personal training.', niche: 'Strength training and group fitness', heroProduct: 'Memberships and personal training', targetAudience: 'Working adults 20 to 40 in Madhapur and Gachibowli', targetCustomerProfile: 'First-time gym goers and returning members who want a clear plan' }
  },
  {
    slug: 'skyline-homes', name: 'Skyline Homes Kochi', industry: 'Real estate', city: 'Kochi, Kerala', cityShort: 'Kochi', motif: 'home',
    palette: { bg: '#EAF0F7', ink: '#102A43', accent: '#C9A227', soft: '#C9D8E8' }, joinedAfter: 64, perMonth: 8, offer: 'site visits with free pick-up this weekend',
    tags: ['#kochirealestate', '#newhome', '#apartmentsforsale'], monogram: 'SH',
    items: [
      { n: 'Skyline Heights, 2 and 3 BHK', d: 'Ten minutes from the metro, ready in eight months.' }, { n: 'Skyline Gardens villas', d: 'Gated plots with a clubhouse and a walking track.' },
      { n: 'Home loan help', d: 'We sit with you and the bank until it is sorted.' }, { n: 'RERA approved', d: 'Every project registered and open to check.' },
      { n: 'Show flat open', d: 'Walk through a finished 3 BHK this weekend.' }, { n: 'Smart home package', d: 'Locks, lights and cameras, included.' }
    ],
    profile: { description: 'A Kochi builder of mid-range apartments and villas, RERA registered, with a show flat open every weekend.', niche: 'Apartments and villas in Kochi', heroProduct: 'Skyline Heights 2 and 3 BHK apartments', targetAudience: 'Families and NRIs buying a home in Kochi', targetCustomerProfile: 'Salaried families and NRIs who want a trusted builder and a clear price' }
  },
  {
    slug: 'pure-pantry', name: 'Pure Pantry Organics', industry: 'Food and drinks brand', city: 'Mumbai, Maharashtra', cityShort: 'Mumbai', motif: 'pantry',
    palette: { bg: '#EEF3E4', ink: '#27431F', accent: '#6B9B37', soft: '#D5E3BB' }, joinedAfter: 76, perMonth: 10, offer: 'free shipping above Rs 599',
    tags: ['#organicfood', '#cleaneating', '#mumbaifoodbrand'], monogram: 'PP',
    items: [
      { n: 'Cold-pressed groundnut oil', d: 'Pressed in small batches, nothing added.' }, { n: 'Millet breakfast mix', d: 'Ready in five minutes, high in fibre.' },
      { n: 'A2 desi ghee', d: 'Slow-churned from grass-fed cows.' }, { n: 'Jaggery powder', d: 'Unrefined, from one family farm in Maharashtra.' },
      { n: 'Raw forest honey', d: 'Collected twice a year and never heated.' }, { n: 'Masala chai blend', d: 'Whole spices, ground the week we pack.' }
    ],
    profile: { description: 'A Mumbai direct-to-consumer brand of organic staples sourced from small farms and sold online.', niche: 'Organic pantry staples', heroProduct: 'Cold-pressed oils and A2 ghee', targetAudience: 'Health-conscious families in metro India', targetCustomerProfile: 'Parents who read labels and order groceries online every month' }
  }
]);

const word = (s) => String(s).replace(/\.$/, '');
/** Seventeen post shapes. Each returns the words on the picture and the caption for one item of one client. */
const TEMPLATES = Object.freeze([
  (c, a) => ({ head: a.n, sub: word(a.d), cap: `${a.n}. ${a.d} Find it at ${c.name}, ${c.cityShort}.` }),
  (c, a) => ({ head: 'This week only', sub: `${a.n}: ${c.offer}`, cap: `This week only: ${c.offer}. Try the ${a.n.toLowerCase()} and tell us what you think.` }),
  (c, a) => ({ head: 'Behind the scenes', sub: `How we make ${a.n.toLowerCase()}`, cap: `A quick look behind the scenes at ${c.name}: ${a.d} The team cares about every detail.` }),
  (c, a) => ({ head: 'Loved it', sub: `A regular on our ${a.n.toLowerCase()}`, cap: `Messages like this make our week. Thank you for trusting us with your ${a.n.toLowerCase()}.` }),
  (c, a) => ({ head: 'Quick tip', sub: `Get more from ${a.n.toLowerCase()}`, cap: `Quick tip from the ${c.name} team: ${a.d} Save this for later.` }),
  (c, a, b) => ({ head: 'Weekend plans?', sub: `Start with ${a.n.toLowerCase()}`, cap: `Weekend plans sorted: start with ${a.n.toLowerCase()}, then ${b.n.toLowerCase()}. See you at ${c.name}.` }),
  (c) => ({ head: 'Meet the team', sub: `The people behind ${c.name}`, cap: `Behind every good day at ${c.name} is this team. Say hello when you visit us in ${c.cityShort}.` }),
  (c, a) => ({ head: `New at ${c.name}`, sub: a.n, cap: `New: ${a.n}. ${a.d} Now available.` }),
  (c, a) => ({ head: 'You asked', sub: `Everything about ${a.n.toLowerCase()}`, cap: `You asked, we answered: what is ${a.n.toLowerCase()}? ${a.d} Send us a message for more.` }),
  (c, a, b) => ({ head: 'Better together', sub: `${a.n} and ${b.n.toLowerCase()}`, cap: `Two favourites that belong together: ${a.n.toLowerCase()} and ${b.n.toLowerCase()}.` }),
  (c) => ({ head: 'Open today', sub: `Visit ${c.name}, ${c.cityShort}`, cap: `We are open today. Come by ${c.name} in ${c.cityShort} or send us a message to book.` }),
  (c) => ({ head: 'Thank you', sub: 'You keep us going', cap: `To everyone who shared, saved and visited this month: thank you. ${c.name} is here because of you.` }),
  (c, a) => ({ head: `Made in ${c.cityShort}`, sub: a.n, cap: `Proudly local: ${a.n.toLowerCase()} from ${c.cityShort}. ${a.d}` }),
  (c, a) => ({ head: 'Almost gone', sub: a.n, cap: `Running low on ${a.n.toLowerCase()}. If it is on your list, today is the day.` }),
  (c) => ({ head: 'Our story', sub: `Why we started ${c.name}`, cap: `Every business starts with a reason. Ours is simple: do one thing well for ${c.cityShort}. Read the story in our bio.` }),
  (c, a, b) => ({ head: 'Which one?', sub: `${a.n} or ${b.n.toLowerCase()}`, cap: `Tough choice: ${a.n.toLowerCase()} or ${b.n.toLowerCase()}? Tell us in the comments.` }),
  (c, a) => ({ head: 'Book now', sub: `${a.n}: ${c.offer}`, cap: `${c.offer.charAt(0).toUpperCase()}${c.offer.slice(1)}. Message us to book your ${a.n.toLowerCase()}.` })
]);

module.exports = { AGENCY, AGENCY_AS_CLIENT, TIMELINE, CLIENTS, TEMPLATES };
