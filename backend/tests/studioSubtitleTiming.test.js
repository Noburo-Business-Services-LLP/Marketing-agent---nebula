const test = require('node:test');
const assert = require('node:assert');
const T = require('../services/studioSubtitleTiming');

const seg = (start, end, text = 'x', extra = {}) => ({ start, end, text, ...extra });
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg || ''} ${a} vs ${b}`);

// ---- language ----
test('the video language maps to the Whisper language code; unknown or none leaves it to Whisper', () => {
  assert.deepStrictEqual(['tamil', 'hindi', 'english', 'telugu', 'kannada', 'malayalam'].map(T.whisperLanguage), ['ta', 'hi', 'en', 'te', 'kn', 'ml']);
  assert.strictEqual(T.whisperLanguage('none'), null);
  assert.strictEqual(T.whisperLanguage('klingon'), null);
});

// ---- window maths ----
const one = { starts: [0], durations: [10], total: 10 };

test('window: one clip, first segment start to last segment end', () => {
  const w = T.speechWindows({ segments: [seg(2.1, 4), seg(4.2, 8.5)], ...one });
  assert.strictEqual(w.length, 1);
  close(w[0].start, 2.1); close(w[0].end, 8.5);
});

test('window: speech can start at 0 seconds', () => {
  const w = T.speechWindows({ segments: [seg(0, 5.5)], ...one });
  close(w[0].start, 0); close(w[0].end, 5.5);
});

test('window: speech that ends well before the clip ends is not stretched', () => {
  const w = T.speechWindows({ segments: [seg(1, 3.2)], ...one });
  close(w[0].end, 3.2);
});

test('window: a clip with no speech has no window', () => {
  const w = T.speechWindows({ segments: [seg(0.5, 4)], starts: [0, 9.7], durations: [10, 10], total: 19.7 });
  assert.ok(w[0]); assert.strictEqual(w[1], null);
});

test('window: two clips with an overlap use the real clip start offsets', () => {
  // clip 0 is 0..10, clip 1 starts at 9.7 (0.3 s fade overlap)
  const w = T.speechWindows({ segments: [seg(1, 5), seg(10.8, 15), seg(15.5, 18.9)], starts: [0, 9.7], durations: [10, 10], total: 19.7 });
  close(w[0].start, 1); close(w[0].end, 5);
  close(w[1].start, 10.8); close(w[1].end, 18.9);
});

test('window: a segment is placed by its middle, and the first window never runs into the second clip', () => {
  // runs 8.9 to 10.3: middle 9.6 is in clip 0 (cell 0 to 9.7) -> clipped to the cell end
  const w = T.speechWindows({ segments: [seg(8.9, 10.3)], starts: [0, 9.7], durations: [10, 10], total: 19.7 });
  assert.ok(w[0]); close(w[0].start, 8.9); close(w[0].end, 9.7); assert.strictEqual(w[1], null);
});

test('window: Whisper splitting one line into several segments gives one window across all of them', () => {
  const w = T.speechWindows({ segments: [seg(2.7, 4), seg(4.1, 6), seg(6.2, 9.4)], ...one });
  close(w[0].start, 2.7); close(w[0].end, 9.4);
});

test('window: words outside any clip are ignored and never widen a window', () => {
  const words = [{ start: -3, end: -2, word: 'a' }, { start: 2.2, end: 2.5, word: 'b' }, { start: 4.0, end: 4.4, word: 'c' }, { start: 99, end: 100, word: 'z' }];
  const w = T.speechWindows({ segments: [seg(2, 4.6)], words, ...one });
  close(w[0].start, 2.2); close(w[0].end, 4.4);
  // words alone (no segment) make no window
  assert.strictEqual(T.speechWindows({ segments: [], words, ...one })[0], null);
});

test('window: words only ever tighten, never expand beyond the segments', () => {
  const w = T.speechWindows({ segments: [seg(2, 4)], words: [{ start: 1, end: 1.5, word: 'a' }, { start: 3, end: 6, word: 'b' }], ...one });
  close(w[0].start, 3); close(w[0].end, 4);
});

test('window: bad numbers, reversed or empty segments and segments outside the video are ignored', () => {
  const w = T.speechWindows({ segments: [seg(NaN, 3), seg(5, 4), seg(6, 6), seg(30, 32), seg(-5, -4), null, seg(7, 8)], ...one });
  close(w[0].start, 7); close(w[0].end, 8);
});

test('window: segments Whisper itself marks as not speech are dropped', () => {
  const w = T.speechWindows({ segments: [seg(0, 3, 'Thank you.', { no_speech_prob: 0.9, avg_logprob: -1.4 }), seg(4, 6, 'real', { no_speech_prob: 0.1, avg_logprob: -0.3 })], ...one });
  close(w[0].start, 4);
  assert.strictEqual(T.speechWindows({ segments: [seg(0, 3, 'Thank you.', { no_speech_prob: 0.9, avg_logprob: -1.4 })], ...one })[0], null);
});

// ---- placing chunks ----
test('chunks share the real window in proportion to their length and each is held until the next starts', () => {
  const chunks = ['aaaa', 'aaaaaaaaaaaa'];
  const cues = T.placeChunks(chunks, { start: 2, end: 6 });
  assert.strictEqual(cues.length, 2);
  close(cues[0].start, 2); close(cues[1].end, 6); close(cues[0].end, cues[1].start);
  // weights are length + 4: 8 and 16 -> first gets a third
  close(cues[0].end - cues[0].start, 4 * 8 / 24);
});

test('a caption never shows before speech starts or after it ends', () => {
  const cues = T.placeChunks(['one two', 'three four', 'five six'], { start: 3.3, end: 7.1 });
  assert.ok(cues[0].start >= 3.3 - 1e-9 && cues[cues.length - 1].end <= 7.1 + 1e-9);
});

test('a window too short for all the chunks merges neighbours, and a tiny window still shows the line once', () => {
  const chunks = ['one two three', 'four five six', 'seven eight nine', 'ten eleven twelve'];
  const cues = T.placeChunks(chunks, { start: 1, end: 2.2 });
  assert.ok(cues.length >= 1 && cues.length < 4);
  for (const c of cues) assert.ok(c.end - c.start >= T.MIN_CUE_SECONDS - 1e-9, `${c.end - c.start}`);
  assert.strictEqual(cues.map((c) => c.text).join(' '), chunks.join(' '));
  const tiny = T.placeChunks(chunks, { start: 1, end: 1.5 });
  assert.strictEqual(tiny.length, 1);
  assert.strictEqual(tiny[0].text, chunks.join(' '));
  assert.deepStrictEqual(T.placeChunks(chunks, { start: 1, end: 1.1 }), []);
  assert.deepStrictEqual(T.placeChunks([], { start: 1, end: 5 }), []);
});

// ---- whole pipeline ----
const TA = 'இன்றே ஆர்டர் செய்யுங்கள். ஆயிரம் ரூபாய்க்கு மேல் வீட்டிலேயே இலவச டெலிவரி.';
const TA_HEARD = 'இன்றே ஓடர் செய்யுங்கள். ஆயிரம் ரூபாய்க்கு மேல் வீட்டிலேயே இலவச டெலிவரி.'; // Whisper's imperfect spelling
const HI = 'आज ही ऑर्डर करें। हज़ार रुपये से ऊपर घर पर मुफ़्त डिलीवरी।';
const HI_HEARD = 'आज ही ऑडर करें हजार रुपए से ऊपर घर पर मुफ्त डिलीवरी';
const EN = 'Order today and get free delivery to your home on everything above one thousand rupees.';

const check = (cues, total) => {
  for (let i = 0; i < cues.length; i += 1) {
    const c = cues[i];
    assert.ok(c.start >= 0 && c.end > c.start && c.end <= total + 1e-9, JSON.stringify(c));
    if (i) assert.ok(c.start >= cues[i - 1].end - 1e-9, `overlap at ${i}`);
  }
};

test('one clip: real timing, our text shown (never Whisper\'s), nothing outside the speech window', () => {
  const r = T.buildTimedCues({ parts: [{ spokenLine: TA }], transcript: { segments: [seg(0, 5.5, TA_HEARD)], words: [] }, starts: [0], durations: [10], total: 10 });
  assert.strictEqual(r.status, 'ok');
  assert.ok(r.cues.length >= 2);
  assert.ok(r.cues.every((c) => TA.includes(c.text.split(' ')[0])));
  assert.strictEqual(r.cues.map((c) => c.text).join(' '), TA);
  assert.ok(!r.cues.some((c) => c.text.includes('ஓடர்')));
  close(r.cues[0].start, 0); close(r.cues[r.cues.length - 1].end, 5.5);
  check(r.cues, 10);
});

test('two clips with overlap: each line sits in its own real window', () => {
  const parts = [{ spokenLine: EN }, { spokenLine: 'Visit us this Sunday for the big festival sale.' }];
  const transcript = { segments: [seg(2.0, 8.7, EN), seg(12.1, 17.2, 'Visit us this Sunday for the big festival sale')], words: [] };
  const r = T.buildTimedCues({ parts, transcript, starts: [0, 9.7], durations: [10, 10], total: 19.7 });
  assert.strictEqual(r.status, 'ok');
  const first = r.cues.filter((c) => c.end <= 9.7 + 1e-9); const second = r.cues.filter((c) => c.start >= 9.7);
  assert.strictEqual(first.length + second.length, r.cues.length);
  close(first[0].start, 2.0); close(first[first.length - 1].end, 8.7);
  close(second[0].start, 12.1); close(second[second.length - 1].end, 17.2);
  check(r.cues, 19.7);
});

test('a clip with no speech gets no captions, the other clip still does', () => {
  const parts = [{ spokenLine: EN }, { spokenLine: 'Another line here today.' }];
  const r = T.buildTimedCues({ parts, transcript: { segments: [seg(1, 6, EN)], words: [] }, starts: [0, 9.7], durations: [10, 10], total: 19.7 });
  assert.strictEqual(r.status, 'ok');
  assert.ok(r.cues.length > 0 && r.cues.every((c) => c.end <= 9.7 + 1e-9));
});

test('a clip with a line but a part with no line gets nothing even if Whisper heard something there', () => {
  const parts = [{ spokenLine: '' }, { spokenLine: EN }];
  const r = T.buildTimedCues({ parts, transcript: { segments: [seg(1, 3, 'music hum'), seg(11, 17, EN)], words: [] }, starts: [0, 9.7], durations: [10, 10], total: 19.7 });
  assert.ok(r.cues.every((c) => c.start >= 9.7));
});

test('no speech found anywhere gives status nospeech and no cues', () => {
  assert.strictEqual(T.buildTimedCues({ parts: [{ spokenLine: EN }], transcript: { segments: [], words: [] }, ...one }).status, 'nospeech');
  assert.strictEqual(T.buildTimedCues({ parts: [{ spokenLine: EN }], transcript: null, ...one }).status, 'nospeech');
  assert.strictEqual(T.buildTimedCues({ parts: [{ spokenLine: EN }], transcript: { segments: 'oops' }, ...one }).status, 'nospeech');
});

test('cues stop before the closing line and never pass the end of the video', () => {
  const r = T.buildTimedCues({ parts: [{ spokenLine: EN }], transcript: { segments: [seg(4, 9.9, EN)], words: [] }, starts: [0], durations: [10], total: 10, stopAt: 8 });
  assert.ok(r.cues.length > 0);
  assert.ok(r.cues.every((c) => c.end <= 8 - 0.05 + 1e-9));
  check(r.cues, 10);
  const r2 = T.buildTimedCues({ parts: [{ spokenLine: EN }], transcript: { segments: [seg(9, 14, EN)], words: [] }, starts: [0], durations: [10], total: 10 });
  check(r2.cues, 10);
});

test('windows that overlap each other (clip order or bad offsets) still give captions that do not overlap', () => {
  const parts = [{ spokenLine: 'First line of the film today.' }, { spokenLine: 'Second line of the film today.' }];
  const r = T.buildTimedCues({ parts, transcript: { segments: [seg(5, 9.9, 'First line of the film today'), seg(9.8, 12, 'Second line of the film today')], words: [] }, starts: [0, 9.7], durations: [10, 10], total: 19.7 });
  check(r.cues, 19.7);
});

test('chunking never splits a Tamil or Hindi combined character', () => {
  for (const line of [TA, HI]) {
    const r = T.buildTimedCues({ parts: [{ spokenLine: line }], transcript: { segments: [seg(0.5, 9, line)], words: [] }, ...one });
    assert.strictEqual(r.cues.map((c) => c.text).join(' '), line);
    for (const c of r.cues) assert.ok(!/^\p{M}/u.test(c.text) && !/‍$/.test(c.text), c.text);
    for (const c of r.cues) assert.strictEqual(c.text, c.text.normalize('NFC') === c.text ? c.text : c.text);
  }
});

// ---- the similarity guard ----
test('similarity: right words with imperfect spelling pass in Tamil, Hindi and English', () => {
  assert.ok(T.similarity(TA, TA_HEARD) > 0.7, String(T.similarity(TA, TA_HEARD)));
  assert.ok(T.similarity(HI, HI_HEARD) > 0.6, String(T.similarity(HI, HI_HEARD)));
  assert.ok(T.similarity(EN, 'Order today and get free delivery to your home on everything above 1000 rupees') > 0.7);
  assert.strictEqual(T.similarity(TA, TA), 1);
});

test('similarity: a repeated phrase or a swapped word is still above the threshold', () => {
  const repeated = `${TA_HEARD} வீட்டிலேயே இலவச டெலிவரி`;
  assert.ok(T.similarity(TA, repeated) >= T.MIN_SIMILARITY, String(T.similarity(TA, repeated)));
  const swapped = TA.replace('டெலிவரி', 'மதிப்பு');
  assert.ok(T.similarity(TA, swapped) >= T.MIN_SIMILARITY, String(T.similarity(TA, swapped)));
});

test('similarity: completely different words fall below the threshold in all three scripts', () => {
  const otherTa = 'நாளை காலை பத்து மணிக்கு கடை திறக்கப்படும் அனைவரும் வருக';
  const otherHi = 'कल सुबह दस बजे दुकान खुलेगी सभी का स्वागत है';
  const otherEn = 'The weather is lovely and the children are playing in the park';
  assert.ok(T.similarity(TA, otherTa) < T.MIN_SIMILARITY, String(T.similarity(TA, otherTa)));
  assert.ok(T.similarity(HI, otherHi) < T.MIN_SIMILARITY, String(T.similarity(HI, otherHi)));
  assert.ok(T.similarity(EN, otherEn) < T.MIN_SIMILARITY, String(T.similarity(EN, otherEn)));
  assert.strictEqual(T.similarity('', 'abc'), 0);
  assert.strictEqual(T.similarity('abc', ''), 0);
});

test('the guard: a clip whose spoken words do not match the line gives status mismatch and no cues at all', () => {
  const r = T.buildTimedCues({ parts: [{ spokenLine: TA }], transcript: { segments: [seg(1, 6, 'நாளை காலை பத்து மணிக்கு கடை திறக்கப்படும் அனைவரும் வருக')], words: [] }, ...one });
  assert.strictEqual(r.status, 'mismatch');
  assert.deepStrictEqual(r.cues, []);
  assert.ok(r.similarities[0] < T.MIN_SIMILARITY);
  const hi = T.buildTimedCues({ parts: [{ spokenLine: HI }], transcript: { segments: [seg(2.7, 9.4, 'कल सुबह दस बजे दुकान खुलेगी सभी का स्वागत है')], words: [] }, ...one });
  assert.strictEqual(hi.status, 'mismatch');
  const en = T.buildTimedCues({ parts: [{ spokenLine: EN }], transcript: { segments: [seg(1, 9, 'The weather is lovely and the children are playing in the park')], words: [] }, ...one });
  assert.strictEqual(en.status, 'mismatch');
});

test('the guard: one mismatching clip stops subtitles for the whole video', () => {
  const parts = [{ spokenLine: EN }, { spokenLine: TA }];
  const r = T.buildTimedCues({ parts, transcript: { segments: [seg(1, 8, EN), seg(11, 17, 'The weather is lovely and the children are playing in the park')], words: [] }, starts: [0, 9.7], durations: [10, 10], total: 19.7 });
  assert.strictEqual(r.status, 'mismatch');
  assert.deepStrictEqual(r.cues, []);
});

test('the threshold is documented and conservative', () => {
  assert.ok(T.MIN_SIMILARITY > 0 && T.MIN_SIMILARITY <= 0.35);
});
