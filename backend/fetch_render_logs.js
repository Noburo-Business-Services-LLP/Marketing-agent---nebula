// Fetch recent logs from Render for the demo service, filter for [MEM] lines,
// and print a compact summary. Usage: node fetch_render_logs.js [hours=6] [filter=[MEM]]
require('dotenv').config();

const API_KEY = process.env.RENDER_API_KEY;
const SERVICE_ID = process.env.RENDER_SERVICE_ID;
if (!API_KEY || !SERVICE_ID) {
  console.error('Set RENDER_API_KEY and RENDER_SERVICE_ID in .env');
  process.exit(1);
}

const HOURS = Number(process.argv[2] || 6);
const FILTER = String(process.argv[3] || '[MEM]');
const now = new Date();
const startTime = new Date(now.getTime() - HOURS * 60 * 60 * 1000);

(async () => {
  const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
  // Fetch ownerId once
  const svcRes = await fetch(`https://api.render.com/v1/services/${SERVICE_ID}`, {
    headers: { Authorization: `Bearer ${API_KEY}`, Accept: 'application/json' }
  });
  const svc = await svcRes.json();
  const ownerId = svc.ownerId;
  if (!ownerId) { console.error('Could not fetch ownerId'); process.exit(1); }

  const url = new URL('https://api.render.com/v1/logs');
  url.searchParams.set('ownerId', ownerId);
  url.searchParams.append('resource', SERVICE_ID);
  url.searchParams.set('startTime', startTime.toISOString());
  url.searchParams.set('endTime', now.toISOString());
  url.searchParams.set('limit', '500');
  if (FILTER) url.searchParams.set('text', FILTER);

  console.log(`Fetching logs from ${startTime.toISOString()} → ${now.toISOString()} filter="${FILTER}"...`);
  const res = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Accept': 'application/json'
    }
  });
  if (!res.ok) {
    console.error('Render API error', res.status, await res.text());
    process.exit(1);
  }
  const body = await res.json();
  const logs = body?.logs || body?.data || [];
  console.log(`Got ${logs.length} log entries.\n`);
  logs.forEach((log) => {
    const ts = log.timestamp || log.time || '';
    const msg = log.message || log.text || JSON.stringify(log);
    console.log(`${ts} ${msg}`);
  });
})().catch((e) => { console.error(e); process.exit(1); });
