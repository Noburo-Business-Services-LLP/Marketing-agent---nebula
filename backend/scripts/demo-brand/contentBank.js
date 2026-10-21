'use strict';
/**
 * The words of the demo brand's posts: per-product lines and hand-written seasonal, founder and education posts.
 * Plain data, no logic. English with light Tamil touches; no medical claims, no named competitors, no before-and-after.
 * Keys are the product slugs of constants.js.
 */

// Per product: when, how, myth, fact, batch, offer, quote (a customer's words), person (who said it)
const PRODUCT_LINES = {
  'kumkumadi-glow-serum': {
    short: 'Kumkumadi Serum', when: 'Every night', how: 'Warm three drops between your palms, press into clean skin and leave it on overnight.',
    myth: 'Facial oils make skin greasy.', fact: 'A light oil serum sinks in within minutes. Three drops are enough for the whole face.',
    batch: 'Batch 14 of the serum: saffron steeped in oil for six weeks, then filtered by hand.',
    offer: 'Buy the serum with the toner and get free shipping across India this week.',
    quote: 'My skin looks rested in the morning. The serum is the one step I never skip now.', person: 'Meera, Coimbatore'
  },
  'saffron-sandal-face-mask': {
    short: 'Saffron Sandal Mask', when: 'Sunday', how: 'Mix a spoon with rose water, apply, rest for ten minutes and rinse with cool water.',
    myth: 'A face mask has to tingle to work.', fact: 'A good clay mask should feel calm. If it stings, wash it off. Ours is made to feel soft.',
    batch: 'Grinding sandalwood for the mask: one slow stone, one steady hand, a very good smell.',
    offer: 'Sunday ritual pack: the mask and the rose toner together for Rs 1,149 this weekend.',
    quote: 'Sunday evenings are now my face-mask evenings. Ten minutes and I feel ready for the week.', person: 'Divya, Bengaluru'
  },
  'rose-petal-toner': {
    short: 'Rose Toner', when: 'Morning and midday', how: 'Close your eyes, mist from an arm\'s length and pat gently.',
    myth: 'Toner is an extra step you can skip.', fact: 'A toner gets skin ready for serum, so the next step sinks in better. Ours has no alcohol.',
    batch: 'Rose water from Kannauj arriving at the studio. We smell every drum before it goes in a bottle.',
    offer: 'Free toner mini with any order above Rs 1,499 until the weekend.',
    quote: 'I keep it on my desk and mist it in the afternoon. My colleagues keep borrowing it.', person: 'Shruti, Pune'
  },
  'neem-turmeric-cleanser': {
    short: 'Neem Cleanser', when: 'Morning and after a long day', how: 'Wet your face, take one pump, massage for a minute and rinse.',
    myth: 'A cleanser must foam a lot to clean well.', fact: 'Foam is only soap. Our gel cleans with gentle cleansers and leaves skin soft, never tight.',
    batch: 'Neem leaves drying in the sun on the terrace, ready for the next cleanser batch.',
    offer: 'First order? Use ZAYA10 for 10 percent off the cleanser and everything else in the cart.',
    quote: 'Chennai heat and a two-hour commute. This is the first cleanser that does not leave my face tight.', person: 'Nandhini, Chennai'
  },
  'bakuchi-night-repair-cream': {
    short: 'Bakuchi Night Cream', when: 'Night', how: 'A pea-sized amount after your serum, twice a week to start and then every night.',
    myth: 'You need retinol to have smooth-looking skin.', fact: 'Bakuchi is a plant that many people find kinder than retinol. Start slow and always wear sunscreen by day.',
    batch: 'Shea butter melting with bakuchi in the double boiler. Stirred, never rushed.',
    offer: 'Night duo: the cream and the serum together for Rs 2,199, a small saving for your ritual.',
    quote: 'I found retinol too harsh. This cream is rich but not sticky and I wake up with soft skin.', person: 'Pooja, Hyderabad'
  },
  'tinted-mineral-spf-40': {
    short: 'Tinted Mineral SPF', when: 'Every morning', how: 'Two finger lengths, thirty minutes before you step out, and again if you are outdoors for hours.',
    myth: 'Dark skin does not need sunscreen.', fact: 'Every skin tone needs it. Ours has a sheer tint made for Indian skin tones, so there is no white cast.',
    batch: 'Colour matching the SPF tint against fifty Indian skin tones, one swatch at a time.',
    offer: 'Back to the commute: sunscreen and cleanser for Rs 1,049 this week only.',
    quote: 'No white cast at all and it does not melt in the Mumbai humidity. Finally a sunscreen I wear daily.', person: 'Ananya, Mumbai'
  },
  'coconut-hibiscus-hair-oil': {
    short: 'Hibiscus Hair Oil', when: 'Sunday', how: 'Warm it slightly, massage your scalp, leave it on for an hour and wash as usual.',
    myth: 'Hair oiling is only for grandmothers.', fact: 'Plenty of people in their twenties and thirties still do a Sunday oil bath. It is a ritual, not a rule.',
    batch: 'Curry leaves and hibiscus steeping slowly in cold-pressed coconut oil. The whole studio smells of home.',
    offer: 'Oil bath bundle: two bottles of hair oil for Rs 1,099, a perfect gift for the family.',
    quote: 'It reminds me of my paati\'s oil. My hair feels soft and my brother steals the bottle too.', person: 'Kavya, Madurai'
  },
  'lip-balm-trio': {
    short: 'Lip Balm Trio', when: 'Always', how: 'Keep one in your bag, one by the bed and one in the car.',
    myth: 'Tinted lip balms are only for makeup lovers.', fact: 'A tint with kokum butter is care first, colour second. Bare, Rose and Beet cover most moods.',
    batch: 'Pouring lip balm tubes by hand: three shades, one steady pour.',
    offer: 'Free lip balm trio with any order above Rs 1,499 as our festive thank-you.',
    quote: 'I bought it as a gift and kept one for myself. Now all three live in different bags.', person: 'Ritika, Delhi'
  }
};

// One short plain line per ingredient used by the ingredient carousels (first word of the ingredient, lower case)
const INGREDIENT_LINES = {
  saffron: 'Saffron: real threads, steeped in oil for weeks.',
  manjistha: 'Manjistha: a root used in ayurveda for centuries.',
  sandalwood: 'Sandalwood: slow-ground for a soft, calm smell.',
  vetiver: 'Vetiver: the cooling root, known as khus in Tamil.',
  multani: 'Multani mitti: gentle clay that soaks up the day.',
  rose: 'Rose: steam-distilled, never perfumed.',
  aloe: 'Aloe vera: light water for a fresh feel.',
  glycerin: 'Glycerin: holds a little moisture in the skin.',
  neem: 'Neem: the tree outside every Tamil home.',
  turmeric: 'Turmeric: the golden spice from our kitchens.',
  tulsi: 'Tulsi: holy basil, grown for freshness.',
  coconut: 'Coconut: cold-pressed, never refined.',
  bakuchi: 'Bakuchi: the plant many people choose over retinol.',
  shea: 'Shea butter: a rich cushion for night.',
  ashwagandha: 'Ashwagandha: an old root, new to skincare.',
  zinc: 'Zinc oxide: a mineral shield that sits on skin.',
  iron: 'Iron oxides: the sheer tint, matched to Indian skin.',
  carrot: 'Carrot seed oil: softness, with a gentle glow.',
  hibiscus: 'Hibiscus: the red flower every grandmother knew.',
  curry: 'Curry leaf: the kitchen leaf for the hair oil.',
  fenugreek: 'Fenugreek: methi seeds, soaked in oil.',
  beeswax: 'Beeswax: a soft seal for dry lips.',
  kokum: 'Kokum butter: a gentle butter from the Western Ghats.',
  beetroot: 'Beetroot: a natural pink tint.',
  steam: 'Steam-distilled rose water from Kannauj.',
  'steam-distilled': 'Steam-distilled rose water from Kannauj.',
  'cold-pressed': 'Cold-pressed coconut oil, never refined.'
};

// Hand-written posts. Each: key, pillar, fmt (image|carousel|reel), product (slug or ''), head (on the picture), title, caption,
// tags, cta ('shop_now'|'learn_more'|''), theme, plus `md` (month-day) for seasonal posts that went out in the past.
const FOUNDER = [
  { key: 'founder-brass-pot', pillar: 'Founder story', fmt: 'image', product: 'kumkumadi-glow-serum', head: 'Paati\'s brass pot', title: 'Where kumkumadi began for us',
    caption: 'Vanakkam. Aanya here. Every Zaya recipe begins in my paati\'s kitchen, with a brass pot and a lot of patience.\nWe have kept the recipe and made the formula light enough for your everyday night routine.\nThe serum is still poured and labelled by hand in Chennai.', tags: ['#ZayaNaturals', '#KumkumadiSerum', '#FounderStory', '#MadeInChennai'], cta: 'learn_more', theme: 'Founder story' },
  { key: 'founder-chemist', pillar: 'Founder story', fmt: 'carousel', product: '', head: 'Meet our chemist', title: 'The chemist who checks every batch',
    caption: 'Swipe to meet Karthik, the chemist friend who checks every Zaya batch before it is bottled.\nHe tests the pH, the texture and the smell. If a batch is not right, it does not leave the studio.\nClean, not clinical, and tested the way dermatologists want.', tags: ['#ZayaNaturals', '#CleanBeauty', '#BehindTheBrand', '#IndianSkincare'], cta: '', theme: 'Founder story' },
  { key: 'founder-first-orders', pillar: 'Founder story', fmt: 'reel', product: 'rose-petal-toner', head: 'Our first 100 orders', title: 'Packing our first 100 orders at the dining table',
    caption: 'In 2022 we packed the first hundred orders at a dining table in Chennai. Amma wrote the thank-you cards. Appa taped the boxes.\nToday the studio is bigger, but the cards are still handwritten.\nRomba nandri for being here from the start.', tags: ['#ZayaNaturals', '#SmallBusinessIndia', '#FounderStory', '#MadeInIndia'], cta: '', theme: 'Founder story' },
  { key: 'founder-why-chennai', pillar: 'Founder story', fmt: 'image', product: 'neem-turmeric-cleanser', head: 'Why we stay in Chennai', title: 'Why Zaya is made in Chennai',
    caption: 'Our neem, curry leaves and coconut oil all come from within a few hours of the studio. Short journeys mean fresher ingredients.\nAnd the city\'s humidity is our best test: if a formula works in Chennai, it works anywhere.', tags: ['#ZayaNaturals', '#ChennaiBrand', '#LocalIngredients', '#AyurvedaSkincare'], cta: '', theme: 'Founder story' },
  { key: 'founder-label', pillar: 'Founder story', fmt: 'image', product: 'bakuchi-night-repair-cream', head: 'Every label, every source', title: 'Why our labels name the source',
    caption: 'Look at the back of any Zaya jar: every ingredient is named, with where it comes from.\nWe do this because we read labels too. If you can\'t pronounce it, we will explain it.', tags: ['#ZayaNaturals', '#ReadTheLabel', '#CleanBeauty', '#IngredientTransparency'], cta: 'learn_more', theme: 'Founder story' }
];

const EDUCATION = [
  { key: 'edu-order', pillar: 'Skin education', fmt: 'carousel', product: 'rose-petal-toner', head: 'The right order', title: 'The right order for your routine',
    caption: 'Cleanser, toner, serum, cream, sunscreen by day. That is the whole routine.\nSwipe for what each step does and when to skip one. Skincare does not need to be ten steps.', tags: ['#SkincareRoutine', '#ZayaNaturals', '#SkinEducation', '#IndianSkin'], cta: 'learn_more', theme: 'Skin education' },
  { key: 'edu-labels', pillar: 'Skin education', fmt: 'carousel', product: 'bakuchi-night-repair-cream', head: 'Three label words', title: 'Three words to look for on a label',
    caption: 'Three words to look for: the ingredient\'s plain name, where it is from, and how much is in there.\nIf a label hides all three, ask why. We are always happy to answer your questions.', tags: ['#ReadTheLabel', '#ZayaNaturals', '#CleanBeauty', '#SkinEducation'], cta: '', theme: 'Skin education' },
  { key: 'edu-spf-humid', pillar: 'Skin education', fmt: 'image', product: 'tinted-mineral-spf-40', head: 'Sunscreen in humidity', title: 'Sunscreen in Chennai humidity',
    caption: 'Sweat does not mean the sunscreen has gone. But it does mean you should reapply every two to three hours outdoors.\nA mineral SPF with a sheer tint sits well on humid days.', tags: ['#SunscreenIndia', '#ZayaNaturals', '#SkinEducation', '#MineralSPF'], cta: 'shop_now', theme: 'Skin education' },
  { key: 'edu-patch', pillar: 'Skin education', fmt: 'image', product: 'neem-turmeric-cleanser', head: 'Patch test first', title: 'Always patch test a new product',
    caption: 'New product, new habit: try it on your inner arm for a day before it meets your face.\nThis goes for every brand, including ours. Your skin is yours.', tags: ['#PatchTest', '#SkincareTips', '#ZayaNaturals', '#CleanSkincare'], cta: '', theme: 'Skin education' },
  { key: 'edu-oil-types', pillar: 'Skin education', fmt: 'carousel', product: 'coconut-hibiscus-hair-oil', head: 'Hair oil, explained', title: 'Which hair oil for which hair',
    caption: 'Cold-pressed coconut, hibiscus and curry leaf: what each does for your hair and how long to leave it in.\nSwipe, save and do your Sunday oil bath the easy way.', tags: ['#HairOiling', '#ZayaNaturals', '#HairCareIndia', '#SundayRitual'], cta: 'learn_more', theme: 'Skin education' },
  { key: 'edu-glow-water', pillar: 'Skin education', fmt: 'reel', product: 'kumkumadi-glow-serum', head: 'Skin loves routine', title: 'Skin loves a calm routine',
    caption: 'A glow is not one product. It is sleep, water, sunscreen and a ritual you can keep.\nHere is the calm night routine we follow at the studio.', tags: ['#NightRoutine', '#ZayaNaturals', '#GlowRitual', '#SkinEducation'], cta: '', theme: 'Skin education' },
  { key: 'edu-lips', pillar: 'Skin education', fmt: 'image', product: 'lip-balm-trio', head: 'Lips need care too', title: 'Lip care you can carry',
    caption: 'Dry lips in the AC, in the monsoon, on the train: a balm in your bag solves most of it.\nKokum butter and beeswax in three shades. Azhagu in your pocket.', tags: ['#LipCare', '#ZayaNaturals', '#KokumButter', '#PocketBeauty'], cta: 'shop_now', theme: 'Skin education' },
  { key: 'edu-clay', pillar: 'Skin education', fmt: 'image', product: 'saffron-sandal-face-mask', head: 'How often to mask', title: 'How often should you use a clay mask',
    caption: 'Once or twice a week is plenty. More does not mean clearer skin.\nRinse with cool water, pat dry and follow with toner and serum.', tags: ['#FaceMask', '#ZayaNaturals', '#SkincareTips', '#SundayRitual'], cta: '', theme: 'Skin education' }
];

// Seasonal posts that already went out. `md` is the month-day they were made for.
const PAST_SEASONAL = [
  { key: 'sea-summer', md: '06-14', pillar: 'Skin education', fmt: 'image', product: 'tinted-mineral-spf-40', head: 'Summer routine in three steps', title: 'A summer routine in three steps',
    caption: 'Cleanse, protect, refresh. That is the whole summer routine.\nNeem cleanser in the morning, tinted SPF before you step out, rose toner mist at midday.', tags: ['#SummerSkincare', '#ZayaNaturals', '#SPFIndia', '#SkincareRoutine'], cta: 'shop_now', theme: 'Summer' },
  { key: 'sea-monsoon', md: '07-20', pillar: 'Ritual and ingredients', fmt: 'image', product: 'coconut-hibiscus-hair-oil', head: 'Monsoon Sunday oil bath', title: 'The monsoon Sunday oil bath',
    caption: 'Rain outside, warm oil on the scalp. The monsoon is made for a Sunday oil bath.\nHibiscus and curry leaf in cold-pressed coconut oil, just as it was done at home.', tags: ['#MonsoonHairCare', '#ZayaNaturals', '#HairOiling', '#SundayRitual'], cta: 'shop_now', theme: 'Monsoon' },
  { key: 'sea-independence', md: '08-15', pillar: 'Offers and festivals', fmt: 'image', product: 'lip-balm-trio', head: 'Independence Day: free lip balm trio', title: 'Independence Day free lip balm trio',
    caption: 'Proudly made in India. This Independence Day, get a free lip balm trio on every order above Rs 1,499.\nOffer valid today and tomorrow.', tags: ['#IndependenceDay', '#MadeInIndia', '#ZayaNaturals', '#Offer'], cta: 'shop_now', theme: 'Independence Day' },
  { key: 'sea-onam', md: '08-26', pillar: 'Ritual and ingredients', fmt: 'image', product: 'coconut-hibiscus-hair-oil', head: 'Onam blessings', title: 'Onam wishes from our studio',
    caption: 'Happy Onam to everyone celebrating. Flowers on the floor, oil on the hair, family around the table.\nSending warm wishes from our Chennai studio.', tags: ['#Onam', '#ZayaNaturals', '#FestiveSeason', '#HappyOnam'], cta: '', theme: 'Onam' },
  { key: 'sea-rakhi', md: '08-28', pillar: 'Offers and festivals', fmt: 'carousel', product: 'lip-balm-trio', head: 'Raksha Bandhan gifts', title: 'Raksha Bandhan gift ideas',
    caption: 'Gift ideas for the sibling who has everything: a lip balm trio for her, a hair oil for him.\nSwipe for three gifts under Rs 999 that arrive in time.', tags: ['#RakshaBandhan', '#GiftIdeas', '#ZayaNaturals', '#GiftsUnder999'], cta: 'shop_now', theme: 'Raksha Bandhan' },
  { key: 'sea-ganesh', md: '09-14', pillar: 'Ritual and ingredients', fmt: 'image', product: 'saffron-sandal-face-mask', head: 'Ganesh Chaturthi glow', title: 'Ganesh Chaturthi, sandal and saffron',
    caption: 'Sandalwood is the smell of festival mornings. Our saffron and sandal mask is for the quiet moment between the pooja and the guests.\nGanpati Bappa Morya.', tags: ['#GaneshChaturthi', '#ZayaNaturals', '#SandalwoodRitual', '#FestiveGlow'], cta: 'shop_now', theme: 'Ganesh Chaturthi' },
  { key: 'sea-navratri-start', md: '10-12', pillar: 'Ritual and ingredients', fmt: 'reel', product: 'kumkumadi-glow-serum', head: 'Nine nights, nine rituals', title: 'Nine nights, nine rituals',
    caption: 'Navratri is nine nights of dressing up. Here is a simple routine to keep skin calm after long evenings of garba and pooja.\nCleanse, mist, serum, sleep. Semma glow by the morning.', tags: ['#Navratri', '#ZayaNaturals', '#NavratriGlow', '#NightRoutine'], cta: '', theme: 'Navratri' },
  { key: 'sea-navratri-end', md: '10-17', pillar: 'Customer glow stories', fmt: 'image', product: 'rose-petal-toner', head: 'Your Navratri looks', title: 'Your Navratri glow, in your words',
    caption: 'You shared your Navratri looks and your rituals, and we loved every one.\nThank you for tagging us. A rose toner mist between garba rounds is now officially a tradition.', tags: ['#Navratri', '#ZayaNaturals', '#CustomerLove', '#NavratriGlow'], cta: '', theme: 'Navratri' }
];

// Posts for the next weeks (scheduled and waiting for approval). The first group is scheduled, the second waits for approval.
const SOON = [
  { key: 'soon-karwa', group: 'scheduled', pillar: 'Ritual and ingredients', fmt: 'image', product: 'saffron-sandal-face-mask', head: 'Karwa Chauth glow', title: 'A Karwa Chauth glow ritual',
    caption: 'A calm evening before the fast: mask on for ten minutes, rose water on a cotton pad, a little serum.\nFor everyone celebrating, wishing you a beautiful Karwa Chauth.', tags: ['#KarwaChauth', '#ZayaNaturals', '#FestiveGlow', '#SkincareRitual'], cta: 'shop_now', theme: 'Karwa Chauth' },
  { key: 'soon-dhanteras', group: 'scheduled', pillar: 'Offers and festivals', fmt: 'image', product: 'kumkumadi-glow-serum', head: 'Dhanteras: invest in glow', title: 'Dhanteras gifting',
    caption: 'Gold is for the locker. The glow is for every day.\nOur Kumkumadi serum is in the Diwali Glow Gift Box, ready to gift.', tags: ['#Dhanteras', '#Diwali2026', '#ZayaNaturals', '#GiftIdeas'], cta: 'shop_now', theme: 'Diwali' },
  { key: 'soon-box-live', group: 'scheduled', pillar: 'Offers and festivals', fmt: 'carousel', product: 'kumkumadi-glow-serum', head: 'The Diwali Glow Gift Box is live', title: 'The Diwali Glow Gift Box is live',
    caption: 'The box is here: Kumkumadi serum, saffron mask, rose toner and a lip balm, wrapped by hand in cotton and sage.\nRs 1,999, free shipping across India. Swipe to see what is inside.', tags: ['#DiwaliGifting', '#ZayaNaturals', '#GiftBox', '#Diwali2026'], cta: 'shop_now', theme: 'Diwali' },
  { key: 'soon-early-bird', group: 'scheduled', pillar: 'Offers and festivals', fmt: 'image', product: 'lip-balm-trio', head: 'Early bird: free lip balm trio', title: 'Early bird Diwali offer',
    caption: 'Order your Diwali gifts early and get a free lip balm trio on orders above Rs 1,499.\nAzhagu for you, and a small something for the person who packs the sweets.', tags: ['#DiwaliOffer', '#ZayaNaturals', '#EarlyBird', '#FestiveSale'], cta: 'shop_now', theme: 'Diwali' },
  { key: 'soon-packing', group: 'scheduled', pillar: 'Founder story', fmt: 'reel', product: 'kumkumadi-glow-serum', head: 'Packing the Diwali boxes', title: 'Packing the Diwali boxes by hand',
    caption: 'Behind the scenes at the studio: every Diwali box is packed by hand, with a card in Aanya\'s handwriting.\nSix hands, one very long table.', tags: ['#BehindTheScenes', '#ZayaNaturals', '#DiwaliGifting', '#HandPacked'], cta: '', theme: 'Diwali' },
  { key: 'soon-bhaidooj', group: 'scheduled', pillar: 'Offers and festivals', fmt: 'image', product: 'coconut-hibiscus-hair-oil', head: 'Bhai Dooj gifting', title: 'Bhai Dooj gift: the oil bath bundle',
    caption: 'For the brother who steals your hair oil: a bundle of two bottles, wrapped and ready for Bhai Dooj.\nRs 1,099 for the pair.', tags: ['#BhaiDooj', '#ZayaNaturals', '#GiftsForBrother', '#HairOil'], cta: 'shop_now', theme: 'Diwali' },
  { key: 'soon-last-date', group: 'scheduled', pillar: 'Offers and festivals', fmt: 'image', product: 'rose-petal-toner', head: 'Order by Sunday for Diwali delivery', title: 'Last date to order for Diwali delivery',
    caption: 'Last call for Diwali delivery: order by Sunday and your parcel reaches you before the festival.\nMetros in three days, the rest in five.', tags: ['#Diwali', '#ZayaNaturals', '#OrderNow', '#FestiveDelivery'], cta: 'shop_now', theme: 'Diwali' },
  { key: 'soon-oilbath', group: 'scheduled', pillar: 'Ritual and ingredients', fmt: 'image', product: 'coconut-hibiscus-hair-oil', head: 'The Diwali morning oil bath', title: 'The Diwali morning oil bath',
    caption: 'Diwali begins with an oil bath before sunrise. Warm the hibiscus oil, massage slowly and wash with warm water.\nHappy Diwali in advance from all of us.', tags: ['#Diwali', '#OilBath', '#ZayaNaturals', '#FestiveRitual'], cta: '', theme: 'Diwali' },
  { key: 'soon-prep', group: 'approval', pillar: 'Skin education', fmt: 'carousel', product: 'kumkumadi-glow-serum', head: 'Diwali skin prep: 7 days', title: 'Seven days to a Diwali glow',
    caption: 'A week before Diwali, keep it simple: hydrate, mask twice, serum every night and sleep early.\nSwipe for the seven-day plan.', tags: ['#DiwaliPrep', '#ZayaNaturals', '#GlowRitual', '#SkincareRoutine'], cta: 'learn_more', theme: 'Diwali' },
  { key: 'soon-guide', group: 'approval', pillar: 'Offers and festivals', fmt: 'carousel', product: 'lip-balm-trio', head: 'Gifts under Rs 999', title: 'Diwali gifts under Rs 999',
    caption: 'Thoughtful and under Rs 999: the lip balm trio, the rose toner, the neem cleanser and the hair oil.\nSwipe for the gift guide.', tags: ['#GiftGuide', '#DiwaliGifts', '#ZayaNaturals', '#GiftsUnder999'], cta: 'shop_now', theme: 'Diwali' },
  { key: 'soon-night', group: 'approval', pillar: 'Ritual and ingredients', fmt: 'image', product: 'neem-turmeric-cleanser', head: 'Wash off the festive day', title: 'The after-pooja cleanse',
    caption: 'After the pooja, the guests and the fireworks, wash the day off. Neem cleanser, rose mist, a little serum and you are done.\nNalla thookkam awaits.', tags: ['#DiwaliNight', '#ZayaNaturals', '#NightRoutine', '#NeemCleanser'], cta: '', theme: 'Diwali' },
  { key: 'soon-winter', group: 'approval', pillar: 'Skin education', fmt: 'image', product: 'bakuchi-night-repair-cream', head: 'Winter is coming for your skin', title: 'Winter skin: time for a richer cream',
    caption: 'Cooler evenings mean drier skin. Time to switch to a richer night cream.\nBakuchi, shea and ashwagandha, a pea-sized amount after your serum.', tags: ['#WinterSkincare', '#ZayaNaturals', '#NightCream', '#SkinEducation'], cta: 'shop_now', theme: 'Winter' },
  { key: 'soon-stories', group: 'approval', pillar: 'Customer glow stories', fmt: 'carousel', product: 'kumkumadi-glow-serum', head: 'Your Diwali glow stories', title: 'Your glow stories this season',
    caption: 'You told us how you use Zaya at your festivals. Swipe through some of our favourites.\nThank you, thank you, romba nandri. Keep tagging us.', tags: ['#CustomerLove', '#ZayaNaturals', '#GlowStories', '#Diwali2026'], cta: '', theme: 'Diwali' }
];

module.exports = { PRODUCT_LINES, INGREDIENT_LINES, FOUNDER, EDUCATION, PAST_SEASONAL, SOON };
