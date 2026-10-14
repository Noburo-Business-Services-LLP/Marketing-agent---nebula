/**
 * Runs a real carousel and a real campaign through the local backend (port 5000, DEV database only) and lists
 * what came back. Costs real money (about US$0.165 per picture). A local token is signed for the chosen dev user.
 *   node scripts/series-test.js <out.json> [carousel|campaign]
 */
require('dotenv').config();
const fs = require('fs');
const mongoose = require('mongoose');
const BASE = 'http://localhost:5000/api';

async function stream(path, token, body) {
  const res = await fetch(BASE + path, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
  const events = [];
  const dec = new TextDecoder();
  let buf = ''; let cur = '';
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop() || '';
    for (const l of lines) {
      if (l.startsWith('event: ')) cur = l.slice(7).trim();
      else if (l.startsWith('data: ') && cur) { try { events.push({ event: cur, data: JSON.parse(l.slice(6)) }); } catch (_) {} }
    }
  }
  return events;
}

(async () => {
  const out = process.argv[2];
  const which = process.argv[3] || 'both';
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  if (mongoose.connection.name !== 'nebulaa_dev') throw new Error('Refusing: not the dev database');
  const { generateToken } = require('../middleware/auth');
  const result = {};
  if (which === 'both' || which === 'carousel') {
    const token = generateToken('6a3e40e8a65384fd914f9991'); // TRM Santhi Furniture (has a logo)
    const ev = await stream('/carousels/generate-stream', token, {
      title: 'Diwali sale', brief: 'Diwali furniture sale: up to 30% off sofa sets, beds and dining tables, free delivery in Cuddalore district.',
      slideCount: 3, platforms: ['instagram'], tone: 'warm', language: 'tamil', aspectRatio: '4:5', contentType: 'carousel'
    });
    result.carousel = ev.filter((e) => ['plan', 'slide', 'error', 'complete'].includes(e.event)).map((e) => ({ event: e.event, order: e.data.order, role: e.data.role, imageUrl: e.data.imageUrl, message: e.data.message, caption: e.data.caption }));
    console.log('carousel done', result.carousel.map((e) => e.event + (e.imageUrl ? ':ok' : '')).join(' '));
  }
  if (which === 'both' || which === 'campaign') {
    const token = generateToken(process.env.CAMPAIGN_USER || '69b91d809c76dde92fa2708d');
    const ev = await stream('/campaigns/generate-campaign-stream', token, {
      campaignName: 'Diwali biryani feast', campaignDescription: 'Diwali family feast combo: mutton biryani, chicken 65 and dessert for 4 at Rs 1499, free home delivery.', objective: 'leads',
      platforms: ['instagram'], tone: 'professional', language: 'tamil', aspectRatio: '4:5', duration: process.env.CAMPAIGN_DURATION || '1 week', postsPerWeek: Number(process.env.CAMPAIGN_POSTS_PER_WEEK || 2),
      startDate: new Date().toISOString().slice(0, 10), preferredDays: [], targetAge: '25-55', targetGender: 'all', targetLocation: 'Dindigul', targetInterests: ''
    });
    result.campaign = ev.filter((e) => ['post', 'error', 'complete'].includes(e.event)).map((e) => ({ event: e.event, imageUrl: e.data.imageUrl, caption: e.data.caption, message: e.data.message, model: e.data.model }));
    console.log('campaign done', result.campaign.map((e) => e.event + (e.imageUrl ? ':ok' : '')).join(' '));
  }
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
  process.exit(0);
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
