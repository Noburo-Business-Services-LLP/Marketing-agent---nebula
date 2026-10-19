'use strict';
// Extra words and phrases for the Home drafts decency filter (services/homeDrafts/decency.js). They come ON TOP of the
// comment-scoring abuse list (config/listening.js ABUSE_WORDS), which is applied first with the same obfuscation rules.
// Deliberately conservative: a harmless draft that is refused costs one more try or a plain "we could not write a draft"
// message and a refund; an unkind public comment costs the customer far more. Every draft ALSO goes through the second
// (model) check, which carries the words no list can cover (other spellings, other languages, tone).
// Add a word here, never in the code. Lists are lower case.
module.exports = Object.freeze({
  // Single words (Latin letters), matched as whole words with the abuse list's obfuscation rules (f*ck, sp a ced, l33t,
  // and repeated letters, so a word here also matches its stretched form: never add a word whose stretched form is an
  // everyday word, as "god" would match "good").
  WORDS: Object.freeze([
    // banter that turns into mockery, and insults about a business
    'mock', 'mocking', 'mocked', 'roast', 'roasted', 'roasting', 'destroy', 'destroyed', 'destroys', 'crush', 'crushed', 'savage',
    'shame', 'shameful', 'shameless', 'expose', 'exposed', 'troll', 'trolling', 'clown', 'clowns', 'jokers', 'pathetic',
    'loser', 'losers', 'fake', 'fakes', 'copycat', 'copycats', 'copied', 'overpriced', 'ripoff', 'rip-off', 'scam', 'rubbish',
    'disgusting', 'horrible', 'terrible', 'awful', 'worst', 'worse', 'inferior', 'lousy', 'mediocre', 'amateur', 'amateurs',
    'incompetent', 'clueless', 'fool', 'fools', 'foolish', 'idiots', 'stupidity', 'shit', 'crappy', 'sucker', 'dumbest',
    'competitor', 'competitors', 'rival', 'rivals',
    // groups, beliefs and bodies: never a subject for a joke
    'caste', 'castes', 'religion', 'religions', 'religious', 'hindu', 'hindus', 'muslim', 'muslims', 'christian', 'christians',
    'sikh', 'sikhs', 'dalit', 'dalits', 'brahmin', 'brahmins', 'allah', 'jesus', 'temple', 'mosque', 'church',
    'ugly', 'fatty', 'fatso', 'obese', 'skinny', 'bald', 'dwarf', 'cripple', 'crippled', 'handicapped', 'lame', 'psycho', 'insane',
    'madrasi', 'chinki', 'gora', 'kalu', 'kaalu', 'blackie', 'accent',
    // politics
    'politics', 'political', 'politician', 'politicians', 'election', 'elections', 'vote', 'votes', 'voting', 'minister', 'government',
    'bjp', 'congress', 'dmk', 'aiadmk', 'admk', 'aap', 'tvk', 'modi', 'rss',
    // threats and harm
    'attack', 'threat', 'threaten', 'punch', 'slap', 'beaten', 'murder', 'dead', 'death', 'bomb', 'hate', 'hated', 'hating',
    // Hindi in Latin letters
    'bekaar', 'bekar', 'bakwas', 'bakwaas', 'ghatiya', 'faltu', 'phaltu', 'bewakoof', 'bevkoof', 'bewkoof', 'pagal', 'paagal', 'ullu',
    'gadha', 'gadhe', 'nalayak', 'chor', 'chorr', 'dhokebaaz', 'dhokebaz', 'dhokha', 'jhoota', 'jhootha', 'besharam', 'kachra', 'nakli',
    'bhikari', 'bhikhari', 'kanjoos', 'chamcha', 'chapri', 'tharki',
    // Tamil in Latin letters
    'mokka', 'mokkai', 'loosu', 'lusu', 'kevalam', 'kevalamana', 'naatham', 'naaththam', 'thirudan', 'thirudi', 'emathu', 'ematthu',
    'fraudu', 'muttal', 'mutthal', 'madaiyan', 'madayan', 'paithiyam', 'kuppai', 'poda', 'naai', 'erumai',
    // Telugu, Kannada and Malayalam in Latin letters
    'vedava', 'vedhava', 'donga', 'pichodu', 'pichi', 'huccha', 'huchcha', 'mandan', 'kothi', 'kazhutha'
  ]),
  // Words in other scripts, matched anywhere in the text after normalisation.
  NATIVE: Object.freeze([
    // Hindi
    'बेकार', 'बकवास', 'घटिया', 'फालतू', 'बेवकूफ', 'बेवक़ूफ़', 'पागल', 'उल्लू', 'गधा', 'नालायक', 'चोर', 'धोखेबाज', 'धोखेबाज़', 'धोखा', 'झूठा',
    'झूठ', 'बेशर्म', 'कचरा', 'नकली', 'भिखारी', 'कंजूस', 'मूर्ख', 'बदतमीज', 'घिनौना', 'जाति', 'धर्म', 'मजहब', 'चुनाव', 'राजनीति',
    'मोदी', 'नफरत', 'मार डालो',
    // Tamil
    'மொக்கை', 'லூசு', 'கேவலம்', 'கேவலமான', 'திருடன்', 'திருடி', 'ஏமாற்று', 'ஏமாத்து', 'நாத்தம்', 'முட்டாள்', 'மடையன்', 'பைத்தியம்',
    'குப்பை', 'நாய்', 'எருமை', 'பன்னி', 'ஜாதி', 'தேர்தல்', 'அரசியல்', 'வெறுப்பு', 'போடா',
    // Telugu, Kannada, Malayalam
    'వెధవ', 'దొంగ', 'పిచ్చి', 'ಹುಚ್ಚ', 'ಕಳ್ಳ', 'ಕೋತಿ', 'കഴുത', 'മണ്ടൻ', 'കള്ളൻ'
  ]),
  // Phrases (regular expression sources, matched on lower-case text with spaces collapsed). They catch comparisons that
  // put another business down and self-promotion on someone else's page.
  PHRASES: Object.freeze([
    'worse than', 'better than (?:you|them|yours|theirs|others|other|the rest|any|anyone|every)', 'cheaper than', 'faster than (?:you|them)',
    'unlike (?:you|them|others|other|some|the rest|certain)', 'than (?:you guys|them|those guys)',
    'they (?:fail|failed|failing|can\'?t|cannot|never|don\'?t know|lie|lied|cheat|cheated|copy|copied|steal|stole)',
    'you (?:fail|failed|failing|can\'?t|cannot|never|don\'?t know|lie|lied|cheat|cheated|copy|copied|steal|stole)',
    'your (?:\\w+ )?(?:is|are|was|were) (?:bad|poor|weak|slow|boring|average|nothing|overpriced|stale|cold|late)',
    'their (?:\\w+ )?(?:is|are|was|were) (?:bad|poor|weak|slow|boring|average|nothing|overpriced|stale|cold|late)',
    'try (?:us|ours|our)', 'come to us', 'switch to us', 'switch to our', 'visit us', 'visit our', 'check out our', 'check our',
    'follow us', 'follow our', 'dm us', 'message us', 'call us', 'order from us', 'buy from us', 'shop with us', 'link in (?:our )?bio',
    'other (?:shops|stores|brands|bakeries|businesses|sellers|companies) (?:are|can\'?t|don\'?t|never)',
    'number one', 'no\\. ?1', '#1', 'best in (?:town|the city|city|india|the world|chennai|mumbai|delhi|bangalore|bengaluru|hyderabad)',
    'cheapest', 'lowest price', 'guaranteed', '100 ?%', 'money back',
    'what a joke', 'step up your', 'learn from us', 'take notes', 'nice try', 'stay in your lane', 'cry more', 'cope',
    'shut up', 'get lost', 'go home', 'grow up'
  ])
});
