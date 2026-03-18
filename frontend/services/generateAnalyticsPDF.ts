/**
 * Nebulaa Gravity — Analytics PDF Report Generator
 * 
 * Generates a professional, multi-page PDF report with:
 *  - Dark header banner with brand identity
 *  - Platform followers bar chart
 *  - Cross-platform summary cards
 *  - Platform detail cards (2-column)
 *  - Engagement donut + bar charts
 *  - Top post performance horizontal chart + table
 *  - Boosted ads impressions chart + table
 *  - Branded footer on every page
 */

import jsPDF from 'jspdf';

// ─── Color Palette ────────────────────────────────────────────
const C = {
  dark:       '#070A12',
  accent:     '#FFCC29',
  text:       '#1a1a2e',
  textSec:    '#4a5568',
  textMuted:  '#94a3b8',
  border:     '#e2e8f0',
  lightBg:    '#f8fafc',
  white:      '#FFFFFF',
  platforms: {
    instagram: '#E1306C',
    facebook:  '#1877F2',
    twitter:   '#1DA1F2',
    linkedin:  '#0A66C2',
  } as Record<string, string>,
  // Engagement metric colors
  likes:    '#EF4444',
  comments: '#F59E0B',
  shares:   '#10B981',
  saves:    '#EC4899',
  views:    '#8B5CF6',
  engage:   '#F97316',
  clicks:   '#14B8A6',
};

// ─── Utility Helpers ──────────────────────────────────────────

function fmt(num: number): string {
  if (num == null || isNaN(num)) return '—';
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
  return num.toLocaleString();
}

function hex(h: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
}

// ─── Canvas Chart Renderers ───────────────────────────────────
// Each returns a PNG data-URL at 2× resolution for crisp PDF output.

function drawBarChart(
  data: { label: string; value: number; color: string }[],
  w: number, h: number, title?: string,
): string {
  const DPR = 2;
  const cvs = document.createElement('canvas');
  cvs.width = w * DPR; cvs.height = h * DPR;
  const ctx = cvs.getContext('2d')!;
  ctx.scale(DPR, DPR);
  ctx.fillStyle = C.white; ctx.fillRect(0, 0, w, h);

  const pad = { top: title ? 42 : 22, right: 20, bottom: 50, left: 60 };
  const cW = w - pad.left - pad.right;
  const cH = h - pad.top - pad.bottom;

  // Title
  if (title) {
    ctx.fillStyle = C.text;
    ctx.font = 'bold 15px Helvetica, Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(title, pad.left, 28);
  }

  const maxVal = Math.max(...data.map(d => d.value), 1);

  // Gridlines
  const gridN = 5;
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let i = 0; i <= gridN; i++) {
    const yy = pad.top + cH - (i / gridN) * cH;
    ctx.strokeStyle = '#edf2f7'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(pad.left, yy); ctx.lineTo(pad.left + cW, yy); ctx.stroke();
    ctx.fillStyle = C.textMuted; ctx.font = '10px Helvetica, Arial, sans-serif';
    ctx.fillText(fmt(Math.round((maxVal * i) / gridN)), pad.left - 8, yy);
  }

  // Bars
  const gap = 18;
  const barW = Math.min((cW - (data.length + 1) * gap) / data.length, 64);
  const totalW = data.length * barW + (data.length - 1) * gap;
  const offX = pad.left + (cW - totalW) / 2;

  data.forEach((d, i) => {
    const x = offX + i * (barW + gap);
    const barH = (d.value / maxVal) * cH;
    const y = pad.top + cH - barH;

    // Gradient bar
    const grad = ctx.createLinearGradient(x, y, x, pad.top + cH);
    grad.addColorStop(0, d.color);
    const [r, g, b] = hex(d.color);
    grad.addColorStop(1, `rgba(${r},${g},${b},0.5)`);

    const rad = Math.min(barW / 4, 7);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.lineTo(x + barW - rad, y);
    ctx.quadraticCurveTo(x + barW, y, x + barW, y + rad);
    ctx.lineTo(x + barW, pad.top + cH);
    ctx.lineTo(x, pad.top + cH);
    ctx.lineTo(x, y + rad);
    ctx.quadraticCurveTo(x, y, x + rad, y);
    ctx.fillStyle = grad; ctx.fill();

    // Value on top
    ctx.fillStyle = C.text; ctx.font = 'bold 12px Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(fmt(d.value), x + barW / 2, y - 4);

    // X label
    ctx.fillStyle = C.textSec; ctx.font = '11px Helvetica, Arial, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(d.label, x + barW / 2, pad.top + cH + 8);
  });

  // X axis line
  ctx.strokeStyle = C.border; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad.left, pad.top + cH); ctx.lineTo(pad.left + cW, pad.top + cH); ctx.stroke();

  return cvs.toDataURL('image/png');
}

function drawDonutChart(
  data: { label: string; value: number; color: string }[],
  w: number, h: number, title?: string,
): string {
  const DPR = 2;
  const cvs = document.createElement('canvas');
  cvs.width = w * DPR; cvs.height = h * DPR;
  const ctx = cvs.getContext('2d')!;
  ctx.scale(DPR, DPR);
  ctx.fillStyle = C.white; ctx.fillRect(0, 0, w, h);

  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return cvs.toDataURL('image/png');

  const titleH = title ? 34 : 0;
  const legendH = data.length * 22 + 10;
  const cx = w / 2;
  const radius = Math.min(w - 60, h - titleH - legendH - 20) / 2;
  const cy = titleH + radius + 10;
  const inner = radius * 0.55;

  if (title) {
    ctx.fillStyle = C.text; ctx.font = 'bold 15px Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(title, cx, 12);
  }

  // Arcs
  let angle = -Math.PI / 2;
  data.forEach(d => {
    const sweep = (d.value / total) * 2 * Math.PI;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, angle, angle + sweep);
    ctx.arc(cx, cy, inner, angle + sweep, angle, true);
    ctx.closePath();
    ctx.fillStyle = d.color; ctx.fill();
    angle += sweep;
  });

  // Center number
  ctx.fillStyle = C.text; ctx.font = 'bold 22px Helvetica, Arial, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(fmt(total), cx, cy - 6);
  ctx.fillStyle = C.textMuted; ctx.font = '10px Helvetica, Arial, sans-serif';
  ctx.fillText('Total Engagement', cx, cy + 12);

  // Legend
  let ly = cy + radius + 20;
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  data.forEach((d, i) => {
    const yy = ly + i * 22;
    ctx.beginPath(); ctx.arc(24, yy + 7, 5, 0, Math.PI * 2); ctx.fillStyle = d.color; ctx.fill();
    ctx.fillStyle = C.textSec; ctx.font = '12px Helvetica, Arial, sans-serif';
    ctx.fillText(d.label, 36, yy + 1);
    ctx.fillStyle = C.text; ctx.font = 'bold 12px Helvetica, Arial, sans-serif';
    ctx.fillText(`${fmt(d.value)}  (${((d.value / total) * 100).toFixed(1)}%)`, 130, yy + 1);
  });

  return cvs.toDataURL('image/png');
}

function drawHorizontalBarChart(
  data: { label: string; value: number; color: string }[],
  w: number, h: number, title?: string,
): string {
  const DPR = 2;
  const cvs = document.createElement('canvas');
  cvs.width = w * DPR; cvs.height = h * DPR;
  const ctx = cvs.getContext('2d')!;
  ctx.scale(DPR, DPR);
  ctx.fillStyle = C.white; ctx.fillRect(0, 0, w, h);

  const pad = { top: title ? 42 : 22, right: 70, bottom: 20, left: 170 };
  const cW = w - pad.left - pad.right;
  const cH = h - pad.top - pad.bottom;

  if (title) {
    ctx.fillStyle = C.text; ctx.font = 'bold 15px Helvetica, Arial, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(title, pad.left, 28);
  }

  const maxVal = Math.max(...data.map(d => d.value), 1);
  const barH = Math.min((cH - (data.length + 1) * 8) / data.length, 32);
  const totalH = data.length * barH + (data.length - 1) * 8;
  const offY = pad.top + (cH - totalH) / 2;

  data.forEach((d, i) => {
    const y = offY + i * (barH + 8);
    const barW = (d.value / maxVal) * cW;

    // Label
    ctx.fillStyle = C.textSec; ctx.font = '12px Helvetica, Arial, sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    const lbl = d.label.length > 26 ? d.label.substring(0, 24) + '…' : d.label;
    ctx.fillText(lbl, pad.left - 10, y + barH / 2);

    // Bar
    const grad = ctx.createLinearGradient(pad.left, y, pad.left + barW, y);
    grad.addColorStop(0, d.color);
    const [r, g, b] = hex(d.color);
    grad.addColorStop(1, `rgba(${r},${g},${b},0.6)`);
    const rad = Math.min(barH / 4, 5);
    ctx.beginPath();
    ctx.moveTo(pad.left, y + rad);
    ctx.lineTo(pad.left, y + barH - rad);
    ctx.quadraticCurveTo(pad.left, y + barH, pad.left + rad, y + barH);
    ctx.lineTo(pad.left + barW - rad, y + barH);
    ctx.quadraticCurveTo(pad.left + barW, y + barH, pad.left + barW, y + barH - rad);
    ctx.lineTo(pad.left + barW, y + rad);
    ctx.quadraticCurveTo(pad.left + barW, y, pad.left + barW - rad, y);
    ctx.lineTo(pad.left + rad, y);
    ctx.quadraticCurveTo(pad.left, y, pad.left, y + rad);
    ctx.fillStyle = grad; ctx.fill();

    // Value
    ctx.fillStyle = C.text; ctx.font = 'bold 11px Helvetica, Arial, sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(fmt(d.value), pad.left + barW + 6, y + barH / 2);
  });

  return cvs.toDataURL('image/png');
}

// ─── Multi-metric grouped bar chart (followers vs reach vs impressions) ──
function drawGroupedBarChart(
  groups: { platform: string; color: string; followers: number; reach: number; impressions: number }[],
  w: number, h: number,
): string {
  const DPR = 2;
  const cvs = document.createElement('canvas');
  cvs.width = w * DPR; cvs.height = h * DPR;
  const ctx = cvs.getContext('2d')!;
  ctx.scale(DPR, DPR);
  ctx.fillStyle = C.white; ctx.fillRect(0, 0, w, h);

  const pad = { top: 20, right: 20, bottom: 60, left: 60 };
  const cW = w - pad.left - pad.right;
  const cH = h - pad.top - pad.bottom;

  const seriesColors = ['#3B82F6', '#10B981', '#8B5CF6']; // Followers, Reach, Impressions
  const seriesLabels = ['Followers', 'Reach', 'Impressions'];
  const allVals = groups.flatMap(g => [g.followers, g.reach, g.impressions]);
  const maxVal = Math.max(...allVals, 1);

  // Gridlines
  const gridN = 5;
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let i = 0; i <= gridN; i++) {
    const yy = pad.top + cH - (i / gridN) * cH;
    ctx.strokeStyle = '#edf2f7'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(pad.left, yy); ctx.lineTo(pad.left + cW, yy); ctx.stroke();
    ctx.fillStyle = C.textMuted; ctx.font = '9px Helvetica, Arial, sans-serif';
    ctx.fillText(fmt(Math.round((maxVal * i) / gridN)), pad.left - 6, yy);
  }

  // Bars
  const groupGap = 24;
  const subBarW = 16;
  const subGap = 2;
  const groupW = 3 * subBarW + 2 * subGap;
  const totalW = groups.length * groupW + (groups.length - 1) * groupGap;
  const offX = pad.left + (cW - totalW) / 2;

  groups.forEach((g, gi) => {
    const gx = offX + gi * (groupW + groupGap);
    [g.followers, g.reach, g.impressions].forEach((val, si) => {
      const x = gx + si * (subBarW + subGap);
      const barH = (val / maxVal) * cH;
      const y = pad.top + cH - barH;
      ctx.fillStyle = seriesColors[si];
      const rad = 3;
      ctx.beginPath();
      ctx.moveTo(x + rad, y);
      ctx.lineTo(x + subBarW - rad, y);
      ctx.quadraticCurveTo(x + subBarW, y, x + subBarW, y + rad);
      ctx.lineTo(x + subBarW, pad.top + cH);
      ctx.lineTo(x, pad.top + cH);
      ctx.lineTo(x, y + rad);
      ctx.quadraticCurveTo(x, y, x + rad, y);
      ctx.fill();
    });

    // Platform label
    ctx.fillStyle = g.color; ctx.font = 'bold 11px Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(g.platform.charAt(0).toUpperCase() + g.platform.slice(1), gx + groupW / 2, pad.top + cH + 8);
  });

  // X axis
  ctx.strokeStyle = C.border; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad.left, pad.top + cH); ctx.lineTo(pad.left + cW, pad.top + cH); ctx.stroke();

  // Legend
  const legY = h - 18;
  const legStartX = w / 2 - (seriesLabels.length * 80) / 2;
  seriesLabels.forEach((lbl, i) => {
    const lx = legStartX + i * 80;
    ctx.fillStyle = seriesColors[i];
    ctx.fillRect(lx, legY - 4, 10, 10);
    ctx.fillStyle = C.textSec; ctx.font = '10px Helvetica, Arial, sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(lbl, lx + 14, legY + 1);
  });

  return cvs.toDataURL('image/png');
}

// ─── Data Extraction Helpers ──────────────────────────────────

function normalizePlatformData(accountAnalytics: any, platform: string) {
  const raw = accountAnalytics?.[platform];
  if (!raw) return null;
  const d = raw.analytics || raw;

  // Helper: extract a numeric value — handles nested objects like LinkedIn's { totalFollowerCount: N }
  const num = (val: any): number => {
    if (val === null || val === undefined) return 0;
    if (typeof val === 'number') return isFinite(val) ? val : 0;
    if (typeof val === 'object') {
      const n = val.totalFollowerCount ?? val.total ?? val.count;
      if (typeof n === 'number') return n;
      const first = Object.values(val).find((v: any) => typeof v === 'number');
      return typeof first === 'number' ? first : 0;
    }
    const parsed = Number(val);
    return isFinite(parsed) ? parsed : 0;
  };

  return {
    followers:      num(d.followersCount) || num(d.followers) || num(d.fanCount) || num(d.firstDegreeSize) || num(d.connectionsCount) || num(d.networkSize) || 0,
    following:      num(d.followingCount) || num(d.following) || 0,
    posts:          num(d.postsCount) || num(d.posts) || num(d.mediaCount) || 0,
    engagementRate: num(d.engagementRate) || num(d.engagement_rate) || undefined,
    reach:          num(d.reach) || 0,
    impressions:    num(d.impressions) || 0,
    name:           d.name ?? d.username ?? d.localizedFirstName ?? platform,
    likes:          num(d.fanCount) || num(d.likes) || 0,
  };
}

function calcEngagementScore(analytics: any): number {
  if (!analytics || typeof analytics !== 'object') return 0;
  let total = 0;
  Object.keys(analytics).forEach(k => {
    if (['status', 'error', 'code', 'id'].includes(k)) return;
    if (typeof analytics[k] !== 'object' || analytics[k] === null) return;
    const d = analytics[k]?.analytics || analytics[k];
    if (!d) return;
    total += (d.likeCount || 0) + (d.commentsCount || d.commentCount || 0)
      + (d.sharesCount || d.shareCount || 0) + (d.savedCount || 0)
      + (d.engagementCount || 0) + (d.clickCount || 0);
  });
  return total;
}

function aggregateEngagement(postAnalytics: Record<string, any>) {
  let likes = 0, comments = 0, shares = 0, saves = 0, views = 0, clicks = 0;
  Object.values(postAnalytics).forEach(analytic => {
    if (!analytic || typeof analytic !== 'object') return;
    Object.keys(analytic).forEach(k => {
      if (['status', 'error', 'code', 'id'].includes(k)) return;
      if (typeof analytic[k] !== 'object' || analytic[k] === null) return;
      const d = analytic[k]?.analytics || analytic[k];
      if (!d) return;
      likes    += d.likeCount || 0;
      comments += d.commentsCount || d.commentCount || 0;
      shares   += d.sharesCount || d.shareCount || 0;
      saves    += d.savedCount || 0;
      views    += d.viewsCount || d.totalVideoViews || d.videoViews || d.mediaView || 0;
      clicks   += d.clickCount || 0;
    });
  });
  return { likes, comments, shares, saves, views, clicks };
}

// ─── PDF Section Helper ───────────────────────────────────────

function sectionTitle(
  doc: jsPDF, text: string, y: number, margin: number,
): number {
  const [ar, ag, ab] = hex(C.accent);
  doc.setTextColor(...hex(C.text));
  doc.setFontSize(14); doc.setFont('helvetica', 'bold');
  doc.text(text, margin, y);
  y += 4;
  doc.setFillColor(ar, ag, ab);
  doc.rect(margin, y, 30, 1.2, 'F');
  return y + 8;
}

// ─── Main Export ──────────────────────────────────────────────

export interface AnalyticsPDFData {
  accountAnalytics: any;
  campaigns: any[];
  postAnalytics: Record<string, any>;
  boostedAds: any[];
  adHistory: any;
  brandName?: string;
}

export async function generateAnalyticsPDF(data: AnalyticsPDFData): Promise<void> {
  const { accountAnalytics, campaigns, postAnalytics, boostedAds, adHistory, brandName } = data;

  const doc = new jsPDF('p', 'mm', 'a4');
  const PW = 210, PH = 297, M = 15;
  const CW = PW - 2 * M;
  let y = 0;
  const [ar, ag, ab] = hex(C.accent);

  const needPage = (needed: number) => {
    if (y + needed > PH - 20) { doc.addPage(); y = M; }
  };

  // Extract platform list
  const platforms = accountAnalytics
    ? Object.keys(accountAnalytics).filter(k => k !== 'status' && typeof accountAnalytics[k] === 'object')
    : [];

  // ════════════════════════════════════════
  // PAGE 1 — HEADER & PLATFORM OVERVIEW
  // ════════════════════════════════════════

  // Dark header banner
  doc.setFillColor(...hex(C.dark));
  doc.rect(0, 0, PW, 52, 'F');

  // Accent stripe
  doc.setFillColor(ar, ag, ab);
  doc.rect(0, 52, PW, 2.5, 'F');

  // Brand name
  doc.setTextColor(ar, ag, ab);
  doc.setFontSize(24); doc.setFont('helvetica', 'bold');
  doc.text('NEBULAA GRAVITY', M, 20);

  // Subtitle
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13); doc.setFont('helvetica', 'normal');
  doc.text('Social Media Analytics Report', M, 31);

  // Date
  doc.setFontSize(9); doc.setTextColor(180, 180, 195);
  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  doc.text(`Generated: ${dateStr}`, M, 42);
  if (brandName) {
    doc.text(brandName, PW - M, 42, { align: 'right' });
  }

  y = 64;

  // ── Platform Comparison Chart ──
  if (platforms.length > 0) {
    y = sectionTitle(doc, 'Platform Overview', y, M);

    // Grouped bar chart (Followers, Reach, Impressions per platform)
    const groupData = platforms.map(p => {
      const nd = normalizePlatformData(accountAnalytics, p)!;
      return {
        platform: p,
        color: C.platforms[p] || C.accent,
        followers: nd.followers,
        reach: nd.reach,
        impressions: nd.impressions,
      };
    });

    const hasReachOrImpr = groupData.some(g => g.reach > 0 || g.impressions > 0);

    if (hasReachOrImpr) {
      const chartImg = drawGroupedBarChart(groupData, 720, 300);
      const imgH = CW * 300 / 720;
      doc.addImage(chartImg, 'PNG', M, y, CW, imgH);
      y += imgH + 6;
    } else {
      // Simple followers-only bar chart
      const barData = platforms.map(p => ({
        label: p.charAt(0).toUpperCase() + p.slice(1),
        value: normalizePlatformData(accountAnalytics, p)?.followers || 0,
        color: C.platforms[p] || C.accent,
      }));
      const chartImg = drawBarChart(barData, 720, 280, 'Followers by Platform');
      const imgH = CW * 280 / 720;
      doc.addImage(chartImg, 'PNG', M, y, CW, imgH);
      y += imgH + 6;
    }

    // ── Cross-Platform Summary Boxes ──
    needPage(42);
    y = sectionTitle(doc, 'Cross-Platform Summary', y, M);

    const summary = [
      { label: 'Total Followers', value: platforms.reduce((s, p) => s + (normalizePlatformData(accountAnalytics, p)?.followers || 0), 0), color: '#3B82F6' },
      { label: 'Total Reach',     value: platforms.reduce((s, p) => s + (normalizePlatformData(accountAnalytics, p)?.reach || 0), 0),     color: '#8B5CF6' },
      { label: 'Total Impressions', value: platforms.reduce((s, p) => s + (normalizePlatformData(accountAnalytics, p)?.impressions || 0), 0), color: '#10B981' },
      { label: 'Total Posts',     value: platforms.reduce((s, p) => s + (normalizePlatformData(accountAnalytics, p)?.posts || 0), 0),      color: '#F97316' },
    ];

    const boxW = (CW - 3 * 4) / 4;
    summary.forEach((m, i) => {
      const x = M + i * (boxW + 4);
      // Card background
      doc.setFillColor(...hex(C.lightBg));
      doc.roundedRect(x, y, boxW, 28, 2, 2, 'F');
      // Color accent top bar
      doc.setFillColor(...hex(m.color));
      doc.roundedRect(x, y, boxW, 2.5, 1.2, 1.2, 'F');
      // Value
      doc.setTextColor(...hex(C.text));
      doc.setFontSize(17); doc.setFont('helvetica', 'bold');
      doc.text(fmt(m.value), x + boxW / 2, y + 14, { align: 'center' });
      // Label
      doc.setTextColor(...hex(C.textSec));
      doc.setFontSize(7.5); doc.setFont('helvetica', 'normal');
      doc.text(m.label, x + boxW / 2, y + 22, { align: 'center' });
    });
    y += 36;

    // ── Platform Detail Cards (2-col) ──
    needPage(55);
    y = sectionTitle(doc, 'Platform Details', y, M);

    const colW = (CW - 6) / 2;
    let cardStartY = y;
    let maxCardH = 0;

    platforms.forEach((platform, i) => {
      const nd = normalizePlatformData(accountAnalytics, platform);
      if (!nd) return;

      const col = i % 2;
      if (col === 0 && i > 0) {
        cardStartY += maxCardH + 6;
        maxCardH = 0;
        needPage(55);
        if (y === M) cardStartY = y; // after page break
      }
      const x = M + col * (colW + 6);

      // Build metric list
      const metrics: { label: string; val: string }[] = [];
      if (nd.followers)         metrics.push({ label: 'Followers',   val: fmt(nd.followers) });
      if (nd.following)         metrics.push({ label: 'Following',   val: fmt(nd.following) });
      if (nd.posts)             metrics.push({ label: 'Posts',       val: fmt(nd.posts) });
      if (nd.reach)             metrics.push({ label: 'Reach',       val: fmt(nd.reach) });
      if (nd.impressions)       metrics.push({ label: 'Impressions', val: fmt(nd.impressions) });
      if (nd.engagementRate != null) metrics.push({ label: 'Engagement', val: `${nd.engagementRate}%` });

      const cardH = 12 + metrics.length * 6 + 4;
      maxCardH = Math.max(maxCardH, cardH);

      // Card bg
      doc.setFillColor(250, 250, 252);
      doc.roundedRect(x, cardStartY, colW, cardH, 2, 2, 'F');

      // Color header
      doc.setFillColor(...hex(C.platforms[platform] || C.accent));
      doc.roundedRect(x, cardStartY, colW, 9, 2, 2, 'F');
      doc.rect(x, cardStartY + 5, colW, 4, 'F'); // square off bottom corners

      // Platform name
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(10); doc.setFont('helvetica', 'bold');
      doc.text(nd.name || platform.charAt(0).toUpperCase() + platform.slice(1), x + 4, cardStartY + 6.5);

      // Metrics
      let my = cardStartY + 15;
      metrics.forEach(m => {
        doc.setTextColor(...hex(C.textSec));
        doc.setFontSize(8); doc.setFont('helvetica', 'normal');
        doc.text(m.label, x + 4, my);
        doc.setTextColor(...hex(C.text));
        doc.setFont('helvetica', 'bold');
        doc.text(m.val, x + colW - 4, my, { align: 'right' });
        my += 6;
      });
    });
    y = cardStartY + maxCardH + 8;
  } else {
    // No platforms connected
    y = sectionTitle(doc, 'Platform Overview', y, M);
    doc.setTextColor(...hex(C.textMuted));
    doc.setFontSize(10); doc.setFont('helvetica', 'normal');
    doc.text('No social accounts connected yet. Connect platforms to see analytics.', M, y);
    y += 12;
  }

  // ════════════════════════════════════════
  // PAGE 2 — ENGAGEMENT & TOP POSTS
  // ════════════════════════════════════════

  const publishedCampaigns = campaigns.filter((c: any) => c.socialPostId);

  if (publishedCampaigns.length > 0) {
    doc.addPage();
    y = M;

    // Engagement overview
    const eng = aggregateEngagement(postAnalytics);
    const engData = [
      { label: 'Likes',    value: eng.likes,    color: C.likes },
      { label: 'Comments', value: eng.comments, color: C.comments },
      { label: 'Shares',   value: eng.shares,   color: C.shares },
      { label: 'Saves',    value: eng.saves,    color: C.saves },
      { label: 'Views',    value: eng.views,     color: C.views },
      { label: 'Clicks',   value: eng.clicks,    color: C.clicks },
    ].filter(d => d.value > 0);

    if (engData.length > 0) {
      y = sectionTitle(doc, 'Engagement Overview', y, M);

      const halfW = (CW - 4) / 2;
      const chartRatio = 340 / 420;

      const donutImg = drawDonutChart(engData, 420, 340, 'Distribution');
      doc.addImage(donutImg, 'PNG', M, y, halfW, halfW * chartRatio);

      const barImg = drawBarChart(engData, 420, 340, 'By Type');
      doc.addImage(barImg, 'PNG', M + halfW + 4, y, halfW, halfW * chartRatio);
      y += halfW * chartRatio + 8;
    }

    // ── Top Post Performance ──
    needPage(80);
    y = sectionTitle(doc, 'Top Post Performance', y, M);

    const ranked = publishedCampaigns
      .map((c: any) => ({
        name:      c.name || 'Untitled',
        platforms: (c.platforms || []).join(', '),
        score:     calcEngagementScore(postAnalytics[c.socialPostId]),
        date:      c.publishedAt ? new Date(c.publishedAt).toLocaleDateString() : '—',
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    // Horizontal bar chart
    if (ranked.some(r => r.score > 0)) {
      const hData = ranked.slice(0, 8).map((r, i) => ({
        label: `#${i + 1}  ${r.name}`,
        value: r.score,
        color: i === 0 ? '#FFD700' : i === 1 ? '#A0AEC0' : i === 2 ? '#CD7F32' : C.accent,
      }));
      const hH = Math.max(180, hData.length * 40 + 60);
      const hImg = drawHorizontalBarChart(hData, 720, hH, 'Engagement Score Ranking');
      const imgH = CW * hH / 720;
      needPage(imgH + 8);
      doc.addImage(hImg, 'PNG', M, y, CW, imgH);
      y += imgH + 6;
    }

    // Table
    needPage(16 + ranked.length * 7);
    const headerCols = ['#', 'Campaign Name', 'Platforms', 'Score', 'Published'];
    const colPcts = [0.06, 0.38, 0.22, 0.14, 0.20];
    const colXs = colPcts.reduce((acc: number[], pct) => {
      acc.push((acc[acc.length - 1] || M) + pct * CW);
      return acc;
    }, [M]);

    // Table header
    doc.setFillColor(...hex(C.dark));
    doc.rect(M, y, CW, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(7.5); doc.setFont('helvetica', 'bold');
    headerCols.forEach((h, i) => doc.text(h, colXs[i] - (i > 0 ? colPcts[i] * CW : 0) + 3, y + 5.5));
    y += 8;

    ranked.forEach((r, i) => {
      needPage(8);
      doc.setFillColor(...hex(i % 2 === 0 ? C.white : C.lightBg));
      doc.rect(M, y, CW, 7, 'F');
      doc.setTextColor(...hex(C.text));
      doc.setFontSize(7.5); doc.setFont('helvetica', 'normal');
      const medal = i === 0 ? '1st' : i === 1 ? '2nd' : i === 2 ? '3rd' : `${i + 1}`;
      let cx = M + 3;
      doc.text(medal, cx, y + 5); cx += colPcts[0] * CW;
      doc.text(r.name.substring(0, 35), cx, y + 5); cx += colPcts[1] * CW;
      doc.text(r.platforms.substring(0, 22), cx, y + 5); cx += colPcts[2] * CW;
      doc.setFont('helvetica', 'bold');
      doc.text(fmt(r.score), cx, y + 5); cx += colPcts[3] * CW;
      doc.setFont('helvetica', 'normal');
      doc.text(r.date, cx, y + 5);
      y += 7;
    });
    y += 8;
  }

  // ════════════════════════════════════════
  // PAGE 3 — BOOSTED ADS (if any)
  // ════════════════════════════════════════

  if (boostedAds && boostedAds.length > 0) {
    doc.addPage();
    y = M;

    y = sectionTitle(doc, 'Boosted Ads Performance', y, M);

    // Impressions bar chart
    const adsChart = boostedAds.slice(0, 8).map((ad: any, i: number) => ({
      label: (ad.adTitle || ad.title || ad.campaignName || `Ad ${i + 1}`).substring(0, 14),
      value: ad.impressions || 0,
      color: '#6366F1',
    }));
    if (adsChart.some(d => d.value > 0)) {
      const adsImg = drawBarChart(adsChart, 720, 260, 'Ad Impressions');
      const imgH = CW * 260 / 720;
      doc.addImage(adsImg, 'PNG', M, y, CW, imgH);
      y += imgH + 8;
    }

    // Ads table
    needPage(16 + boostedAds.length * 7);
    const adHeaders = ['Ad Name', 'Status', 'Budget', 'Spent', 'Impressions', 'Reach', 'Clicks'];
    const adPcts = [0.26, 0.11, 0.12, 0.13, 0.14, 0.12, 0.12];

    doc.setFillColor(...hex(C.dark));
    doc.rect(M, y, CW, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(7); doc.setFont('helvetica', 'bold');
    let hx = M + 2;
    adHeaders.forEach((h, i) => { doc.text(h, hx, y + 5.5); hx += adPcts[i] * CW; });
    y += 8;

    boostedAds.forEach((ad: any, i: number) => {
      needPage(8);
      doc.setFillColor(...hex(i % 2 === 0 ? C.white : C.lightBg));
      doc.rect(M, y, CW, 7, 'F');
      doc.setTextColor(...hex(C.text));
      doc.setFontSize(7); doc.setFont('helvetica', 'normal');

      const title = (ad.adTitle || ad.title || ad.campaignName || `Ad ${i + 1}`).substring(0, 28);
      const status = ad.status || '—';
      const curr = ad.currency === 'INR' ? '₹' : ad.currency === 'EUR' ? '€' : ad.currency === 'GBP' ? '£' : '$';

      let cx = M + 2;
      doc.text(title, cx, y + 5); cx += adPcts[0] * CW;
      // Status color
      if (status === 'ACTIVE') doc.setTextColor(16, 185, 129); else doc.setTextColor(...hex(C.text));
      doc.text(status, cx, y + 5); cx += adPcts[1] * CW;
      doc.setTextColor(...hex(C.text));
      doc.text(ad.dailyBudget != null ? `${curr}${ad.dailyBudget}` : '—', cx, y + 5); cx += adPcts[2] * CW;
      doc.text(ad.spend != null ? `${curr}${Number(ad.spend).toFixed(2)}` : '—', cx, y + 5); cx += adPcts[3] * CW;
      doc.text(fmt(ad.impressions || 0), cx, y + 5); cx += adPcts[4] * CW;
      doc.text(fmt(ad.reach || 0), cx, y + 5); cx += adPcts[5] * CW;
      doc.text(fmt(ad.clicks || 0), cx, y + 5);
      y += 7;
    });
    y += 8;

    // Ads total summary row
    const totalBudget = boostedAds.reduce((s: number, a: any) => s + (Number(a.dailyBudget) || 0), 0);
    const totalSpent  = boostedAds.reduce((s: number, a: any) => s + (Number(a.spend) || 0), 0);
    const totalImpr   = boostedAds.reduce((s: number, a: any) => s + (Number(a.impressions) || 0), 0);
    const totalReach  = boostedAds.reduce((s: number, a: any) => s + (Number(a.reach) || 0), 0);
    const totalClicks = boostedAds.reduce((s: number, a: any) => s + (Number(a.clicks) || 0), 0);
    const anyCurr = boostedAds[0]?.currency;
    const cr = anyCurr === 'INR' ? '₹' : anyCurr === 'EUR' ? '€' : anyCurr === 'GBP' ? '£' : '$';

    doc.setFillColor(...hex(C.accent));
    doc.rect(M, y, CW, 8, 'F');
    doc.setTextColor(...hex(C.dark));
    doc.setFontSize(7); doc.setFont('helvetica', 'bold');
    let tx = M + 2;
    doc.text('TOTAL', tx, y + 5.5); tx += adPcts[0] * CW;
    doc.text(`${boostedAds.length} ads`, tx, y + 5.5); tx += adPcts[1] * CW;
    doc.text(`${cr}${totalBudget}`, tx, y + 5.5); tx += adPcts[2] * CW;
    doc.text(`${cr}${totalSpent.toFixed(2)}`, tx, y + 5.5); tx += adPcts[3] * CW;
    doc.text(fmt(totalImpr), tx, y + 5.5); tx += adPcts[4] * CW;
    doc.text(fmt(totalReach), tx, y + 5.5); tx += adPcts[5] * CW;
    doc.text(fmt(totalClicks), tx, y + 5.5);
    y += 14;
  }

  // ════════════════════════════════════════
  // AD HISTORY SUMMARY (if data exists)
  // ════════════════════════════════════════

  if (adHistory) {
    const entries = Array.isArray(adHistory) ? adHistory : adHistory.data || adHistory.history || [];
    if (entries.length > 0) {
      needPage(50);
      y = sectionTitle(doc, 'Ad Spend History', y, M);

      const totalSpend = entries.reduce((s: number, e: any) => s + (e.spend || e.amount || 0), 0);
      const avgDaily = entries.length > 0 ? totalSpend / entries.length : 0;

      // Summary strip
      const stripW = CW / 3;
      [
        { label: 'Total Ad Spend', value: `$${totalSpend.toFixed(2)}`, color: '#10B981' },
        { label: 'Days with Spend', value: `${entries.length}`, color: '#3B82F6' },
        { label: 'Avg. Daily Spend', value: `$${avgDaily.toFixed(2)}`, color: '#8B5CF6' },
      ].forEach((m, i) => {
        const x = M + i * stripW;
        doc.setFillColor(...hex(C.lightBg));
        doc.roundedRect(x + 1, y, stripW - 2, 20, 2, 2, 'F');
        doc.setFillColor(...hex(m.color));
        doc.roundedRect(x + 1, y, stripW - 2, 2, 1, 1, 'F');
        doc.setTextColor(...hex(C.text));
        doc.setFontSize(14); doc.setFont('helvetica', 'bold');
        doc.text(m.value, x + stripW / 2, y + 10, { align: 'center' });
        doc.setTextColor(...hex(C.textSec));
        doc.setFontSize(7); doc.setFont('helvetica', 'normal');
        doc.text(m.label, x + stripW / 2, y + 16, { align: 'center' });
      });
      y += 28;
    }
  }

  // ════════════════════════════════════════
  // FOOTER ON EVERY PAGE
  // ════════════════════════════════════════

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    // Dark footer bar
    doc.setFillColor(...hex(C.dark));
    doc.rect(0, PH - 12, PW, 12, 'F');
    // Brand
    doc.setTextColor(ar, ag, ab);
    doc.setFontSize(7); doc.setFont('helvetica', 'bold');
    doc.text('NEBULAA GRAVITY', M, PH - 4.5);
    // Tagline
    doc.setTextColor(140, 140, 155); doc.setFont('helvetica', 'normal');
    doc.text('Powered by AI', M + 35, PH - 4.5);
    // Page number
    doc.setTextColor(180, 180, 195);
    doc.text(`Page ${i} of ${pages}`, PW - M, PH - 4.5, { align: 'right' });
  }

  // ── Save ──
  const fileName = `Nebulaa-Analytics-${new Date().toISOString().split('T')[0]}.pdf`;
  doc.save(fileName);
}
