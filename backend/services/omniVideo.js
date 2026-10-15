/**
 * Gemini Omni (gemini-omni-1.1-flash) client: make a 10 second vertical clip with speech and music from a prompt
 * and optional reference photos, or change a clip we already made. Never throws; returns { ok, buffer } or { ok:false, message }.
 * Interactions API: https://ai.google.dev/gemini-api/docs/omni
 */
const MODEL = () => process.env.OMNI_MODEL || 'gemini-omni-1.1-flash';
const BASE = 'https://generativelanguage.googleapis.com';
const REQUEST_MS = 300000;

const key = () => String(process.env.GEMINI_API_KEY || '').trim();

function failure(res, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body || {});
  if (res && (res.status === 429 || /quota|exhaust|billing|RESOURCE_EXHAUSTED/i.test(text))) {
    try { require('./opsAlerts').recordCritical('google_video', `Gemini Omni refused: ${text.slice(0, 200)}`); } catch (_) { /* alert is best effort */ }
    return { ok: false, retryable: true, message: 'Video making is very busy right now. Please try again in a few minutes. Your Quarks were returned.' };
  }
  if (/safety|blocked|policy|prohibited|PROHIBITED_CONTENT|violat/i.test(text)) {
    return { ok: false, retryable: false, message: 'This idea could not be made into a video. Please change the wording and try again. Your Quarks were returned.' };
  }
  return { ok: false, retryable: true, message: 'The video could not be made this time. Your Quarks were returned. Please try again.' };
}

function videoFrom(json) {
  const parts = (json.steps || []).filter((s) => s.type === 'model_output').flatMap((s) => s.content || []);
  return parts.find((c) => c.type === 'video') || null;
}

async function download(uri) {
  const id = String(uri).split('/files/')[1];
  if (!id) return null;
  const fileId = id.split(':')[0];
  for (let i = 0; i < 30; i += 1) {
    const meta = await (await fetch(`${BASE}/v1beta/files/${fileId}`, { headers: { 'x-goog-api-key': key() } })).json().catch(() => ({}));
    if (!meta.state || meta.state === 'ACTIVE') break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  const d = await fetch(`${BASE}/v1beta/files/${fileId}:download?alt=media`, { headers: { 'x-goog-api-key': key() } });
  if (!d.ok) return null;
  return Buffer.from(await d.arrayBuffer());
}

async function interact(input, { aspectRatio = '9:16' } = {}, io = {}) {
  if (!key()) return { ok: false, retryable: false, message: 'Video making is not available right now.' };
  const doFetch = io.fetch || fetch;
  const body = { model: MODEL(), input, response_format: { type: 'video', aspect_ratio: aspectRatio === '16:9' ? '16:9' : '9:16', resolution: '720p' } };
  let res;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_MS);
    try {
      res = await doFetch(`${BASE}/v1beta/interactions`, { method: 'POST', headers: { 'x-goog-api-key': key(), 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
    } finally { clearTimeout(timer); }
  } catch (e) {
    return { ok: false, retryable: true, message: 'The video could not be made this time. Your Quarks were returned. Please try again.' };
  }
  let json = {};
  try { json = await res.json(); } catch (_) { json = {}; }
  if (!res.ok) return failure(res, json);
  const vid = videoFrom(json);
  if (!vid) return failure(res, json);
  if (vid.data) return { ok: true, buffer: Buffer.from(vid.data, 'base64') };
  const uri = vid.uri || vid.file_uri || vid.url;
  const buffer = uri ? await download(uri).catch(() => null) : null;
  return buffer ? { ok: true, buffer } : { ok: false, retryable: true, message: 'The video could not be made this time. Your Quarks were returned. Please try again.' };
}

/** references: [{ mimeType, data(base64) }] up to 3. */
function generate({ prompt, references = [], aspectRatio }, io) {
  const input = [
    ...references.slice(0, 3).map((r) => ({ type: 'image', data: r.data, mime_type: r.mimeType })),
    { type: 'text', text: String(prompt || '').slice(0, 6000) }
  ];
  return interact(input, { aspectRatio }, io);
}

/** Uploads a clip we made so the model can change it. Returns the file uri. */
async function uploadVideo(buffer, io = {}) {
  const doFetch = io.fetch || fetch;
  const boundary = `----nebula${Date.now()}`;
  const meta = JSON.stringify({ file: { mimeType: 'video/mp4', displayName: 'nebula-clip' } });
  const head = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: video/mp4\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--`);
  const res = await doFetch(`${BASE}/upload/v1beta/files?uploadType=multipart`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key(), 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: Buffer.concat([head, buffer, tail])
  });
  const json = await res.json().catch(() => ({}));
  const file = json.file || json;
  if (!res.ok || !file.uri) return null;
  // The file must be ACTIVE before it can be used.
  for (let i = 0; i < 20; i += 1) {
    const m = await (await doFetch(`${BASE}/v1beta/${file.name}`, { headers: { 'x-goog-api-key': key() } })).json().catch(() => ({}));
    if (!m.state || m.state === 'ACTIVE') break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return file.uri;
}

async function change({ videoBuffer, instruction, aspectRatio }, io) {
  const uri = await uploadVideo(videoBuffer, io).catch(() => null);
  if (!uri) return { ok: false, retryable: true, message: 'The change could not be made this time. Your Quarks were returned. Please try again.' };
  const input = [
    { type: 'video', uri },
    { type: 'text', text: `Edit this video: ${String(instruction || '').slice(0, 1000)}. Keep everything else the same: the people, the place, the voice and the music.` }
  ];
  return interact(input, { aspectRatio }, io);
}

module.exports = { generate, change, uploadVideo, interact, videoFrom };
