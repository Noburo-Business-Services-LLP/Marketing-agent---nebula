// The local decency filter of the Home drafts: a table of unkind, offensive or self-promoting drafts that must be
// blocked (English, Hindi and Tamil, in Latin letters and in their own scripts), and decent drafts that must pass.
const test = require('node:test');
const assert = require('node:assert');
const { textProblems, checkDraft, copiesFrom, nameForms } = require('../services/homeDrafts/decency');
const helpers = require('../services/listening/helpers');

const BANNED = ['Sweet Truth', 'sweettruth_chennai', 'Cake Zone'];

const OFFENSIVE = [
  // English: comparisons, put-downs, mockery, abuse, groups, politics, self-promotion, contact details, claims
  'Your cakes are worse than ours, honestly.',
  'Unlike them, we actually bake fresh every morning.',
  'They fail at delivery every single time.',
  'What a joke of a menu.',
  'These idiots cannot even frost a cupcake.',
  'Try us instead, our coffee is way better than yours.',
  'Lol, pathetic attempt at a reel.',
  'This bakery is a total scam.',
  'Such an overpriced shop, nobody should go.',
  'Copycats, you copied our idea.',
  'Fake reviews everywhere on this page.',
  'This looks like trash.',
  'F*ck this, ours is better.',
  'What the hell is this frosting.',
  'Ugly packaging, nobody will buy it.',
  'Typical of their religion to do this.',
  'Vote for the right party, not these losers.',
  'Visit us at our shop for real cakes.',
  'DM us for better deals.',
  'Your service is slow, come to us.',
  'Check out @ourbakery for a real cake.',
  'Go to www.ourcakes.com instead.',
  'Call nine eight seven six five four three two for cheaper cakes.',
  'We are number one in the city, sorry not sorry.',
  'Roast of the year: this reel.',
  'Stay in your lane, amateurs.',
  's t u p i d post, really.',
  'Bloody brilliant, said no one.',
  'Sweet Truth should close the shop.',
  'sweettruth_chennai is such a let down.',
  'Is this from Cake Zone again?',
  'DESTROYS THE COMPETITION, SORRY GUYS.',
  // Hindi in Latin letters and in Devanagari
  'Bakwas cake hai yeh.',
  'Kitna ghatiya reel hai.',
  'Yeh log chor hain.',
  'Pagal ho kya, itna mehenga?',
  'Bilkul bekaar service.',
  'Saala kya hai yeh.',
  'Chutiya post hai.',
  'यह केक बकवास है',
  'कितना घटिया पोस्ट है',
  'ये लोग चोर हैं',
  'बेवकूफ लोग ही यहाँ से खरीदते हैं',
  'धोखेबाज़ दुकान है यह',
  // Tamil in Latin letters and in Tamil script
  'Mokka reel da.',
  'Romba kevalamana cake.',
  'Ivanga thirudan maadhiri.',
  'Loosu mathiri post.',
  'Otha, enna post idhu.',
  'இது மொக்கை போஸ்ட்',
  'ரொம்ப கேவலமான கேக்',
  'இவங்க திருடன் மாதிரி',
  'முட்டாள் தனமான விளம்பரம்',
  'குப்பை மாதிரி இருக்கு',
  'லூசு மாதிரி பேசாதே'
];

const DECENT = [
  'This looks delicious. As fellow bakers, we know how much love goes into a tray like this.',
  'Beautiful colours on these cupcakes. Monday mornings need exactly this.',
  'That frosting swirl deserves its own fan club.',
  'Lovely reel, the slow-motion pour made us hungry.',
  'Rainy evenings and hot tea, the best pair. Lovely post.',
  'Such a cheerful set of colours, it brightened our day ☀️',
  'Fresh bread on a Sunday is a small joy. Well shot.',
  'Great idea for the festive season, lovely work.',
  'The plating here is so neat. Lovely to see good food celebrated.',
  'Coffee art like this makes every cup feel special.',
  'Wishing everyone a lovely weekend full of good food.',
  'बहुत सुंदर रील, देखकर ही भूख लग गई।',
  'Kya baat hai, bahut pyaara post.',
  'ऐसी मिठाई देखकर त्योहार की याद आ गई।',
  'Chai aur samosa, isse achha combination kya hoga.',
  'ரொம்ப அழகான ரீல், பார்த்தாலே பசிக்குது.',
  'Super ah irukku, semma colours.',
  'மழை நேரத்துல சூடான காபி, அருமையான பதிவு.',
  'இந்த கேக் பார்க்கவே ரொம்ப அழகா இருக்கு.',
  'చాలా అందమైన పోస్ట్, చూడగానే ఆకలేసింది.',
  'ತುಂಬಾ ಚೆನ್ನಾಗಿದೆ, ಸುಂದರ ಬಣ್ಣಗಳು.',
  'വളരെ മനോഹരമായ പോസ്റ്റ്, കണ്ടപ്പോൾ തന്നെ വിശന്നു.'
];

test('the tables are big enough: at least 40 unkind drafts and 20 decent ones', () => {
  assert.ok(OFFENSIVE.length >= 40, `${OFFENSIVE.length}`);
  assert.ok(DECENT.length >= 20, `${DECENT.length}`);
});

for (const text of OFFENSIVE) {
  test(`blocked: ${text}`, () => {
    const r = textProblems(text, { field: 'comment', banned: BANNED });
    assert.ok(r.length > 0, `should be blocked: ${text}`);
  });
}

for (const text of DECENT) {
  test(`passes: ${text}`, () => {
    assert.deepStrictEqual(textProblems(text, { field: 'comment', banned: BANNED }), []);
  });
}

test('tricks do not get through: look-alike letters, invisible characters, l33t and spaced letters', () => {
  for (const t of ['What a pаthetic reel.', 'Total sc​am, this page.', 'Such a 1d10t move.', 'This is t r a s h honestly.', 'Lol p@thetic.']) {
    assert.ok(textProblems(t, { field: 'comment' }).length > 0, t);
  }
});

test('each rule gives its own code, and no code ever carries the text', () => {
  const codes = (t, o = {}) => textProblems(t, { field: 'comment', ...o });
  assert.ok(codes('Ugly cupcakes everywhere today.').includes('word'));
  assert.ok(codes('Ours are better than yours, friend.').includes('phrase'));
  assert.ok(codes('Lovely work from Sweet Truth today.', { banned: BANNED }).includes('name'));
  assert.ok(codes('Lovely work, sweet truth fans.', { banned: BANNED }).includes('name'));
  assert.ok(codes('Lovely work, sweettruth fans.', { banned: BANNED }).includes('name'));
  assert.ok(codes('Lovely post, email hello@cakes.in today.').includes('contact'));
  assert.ok(codes('Lovely post, we sold two hundred and 50 today.').includes('number'));
  assert.ok(codes('Lovely post #cake').includes('hashtags'));
  assert.ok(codes('Lovely post 😀😀😀').includes('emoji'));
  assert.ok(codes('LOVELY POST REALLY GOOD').includes('shouting'));
  assert.ok(codes('Lovely post!!! Really!').includes('shouting'));
  assert.ok(codes('Lovely <b>post</b> today.').includes('markup'));
  assert.ok(codes('Nice.').includes('length'));
  assert.ok(codes('a'.repeat(221)).includes('length'));
  assert.deepStrictEqual(codes(''), ['empty']);
  for (const r of codes('Ugly cupcakes everywhere today.')) assert.match(r, /^[a-z]+$/);
});

test('a whole word is needed for a name, so a competitor called Bake does not block "baker"', () => {
  assert.deepStrictEqual(textProblems('As fellow bakers we love this tray.', { field: 'comment', banned: ['Bake'] }), []);
  assert.ok(textProblems('Bake did it again today.', { field: 'comment', banned: ['Bake'] }).includes('name'));
  assert.deepStrictEqual(nameForms('@cake_zone.chennai'), ['cake_zone.chennai', 'cake zone chennai', 'cakezonechennai']);
  assert.deepStrictEqual(nameForms('ab'), []);
});

test('the copy backstop: four words in a row from the competitor caption are refused', () => {
  const caption = 'Our new hazelnut brownie is finally here for the weekend';
  assert.ok(copiesFrom('Wow, hazelnut brownie is finally here, lovely.', caption));
  assert.ok(!copiesFrom('Hazelnut and brownies, a lovely pair.', caption));
  assert.ok(textProblems('Wow, the new hazelnut brownie is finally here.', { field: 'comment', source: caption }).includes('copy'));
});

test('lengths follow the caps: comment up to 220, caption 40 to 600 with up to 3 hashtags, picture idea up to 200', () => {
  const caption = `${'Warm bread from our oven every morning, baked slowly with care. '.repeat(3)}#bread #bakery #fresh`;
  assert.deepStrictEqual(checkDraft('response_post', { caption, imageIdea: 'A close photo of a warm loaf on a wooden board by the window.' }), { ok: true, reasons: [] });
  assert.ok(checkDraft('response_post', { caption: `${caption} #extra`, imageIdea: 'A warm loaf on a board.' }).reasons.includes('hashtags'));
  assert.ok(checkDraft('response_post', { caption: 'x'.repeat(601), imageIdea: 'A warm loaf on a board.' }).reasons.includes('length'));
  assert.ok(checkDraft('response_post', { caption, imageIdea: 'y'.repeat(201) }).reasons.includes('length'));
  assert.ok(checkDraft('response_post', { caption }).reasons.includes('empty'));
  assert.ok(checkDraft('witty_comment', {}).reasons.includes('empty'));
  // Tamil letters are counted as people see them, so a long Tamil comment is not cut short by code units.
  const tamil = 'இந்த கேக் பார்க்கவே ரொம்ப அழகா இருக்கு. '.repeat(6).trim();
  assert.ok(Array.from(tamil).length > 220, 'more than 220 code points');
  assert.ok(!textProblems(tamil, { field: 'comment' }).includes('length'), 'but fewer than 220 letters as people count them');
});

test('the shared abuse check is exported from the comment-scoring helpers and keeps the quote filter as it was', () => {
  assert.strictEqual(typeof helpers.isDecentText, 'function');
  assert.strictEqual(helpers.isDecentText('A lovely warm loaf of bread.'), true);
  assert.strictEqual(helpers.isDecentText('What a f u c k i n g mess.'), false);
  assert.strictEqual(helpers.isDecentText(42), false);
  // The quote filter still has its own length and contact rules.
  assert.strictEqual(helpers.safeQuoteText('Short'), null);
  assert.strictEqual(helpers.safeQuoteText('The bread was lovely and warm, thank you so much.'), 'The bread was lovely and warm, thank you so much.');
});
