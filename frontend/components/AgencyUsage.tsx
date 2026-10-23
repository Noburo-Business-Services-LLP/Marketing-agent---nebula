import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, BarChart3, ChevronLeft, ChevronRight, Download, Image as ImageIcon, Loader2, Users, Video as VideoIcon, Wallet } from 'lucide-react';
import { apiService } from '../services/api';
import type { AgencyUsageResponse } from '../services/api';
import { agencyErrorMessage, lastActiveText } from '../utils/agency';
import {
  canGoNext, canGoPrev, csvLinkLabel, isMonthKey, monthChoices, monthKeyOf, monthLabel, pagerState,
  poolText, removedClientNote, shiftMonth, usageLoadMessage, usageRowsOf,
} from '../utils/agencyPlan';

const BTN = 'inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-panel)] px-3 min-h-[40px] text-[13px] font-semibold text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-2)] disabled:opacity-50 disabled:cursor-not-allowed';
const ICON_BTN = 'inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-panel)] text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-2)] disabled:opacity-40 disabled:cursor-not-allowed';

// The same tint families as the Home number tiles (home.css [data-mark]): amber posts, lavender videos, teal clients, green pool.
const TINT = {
  posts: { tint: '#FFF0C7', ink: '#8A5200', bar: '#F5A623' },
  videos: { tint: '#ECE6FB', ink: '#5B3FA8', bar: '#8B6CE0' },
  clients: { tint: '#D6F1EF', ink: '#136F6C', bar: '#2BB3AD' },
  pool: { tint: '#DDF2E6', ink: '#2B6B43', bar: '#3FA56A' },
} as const;
const AVATARS = [
  { tint: '#FFF0C7', ink: '#8A5200' }, { tint: '#ECE6FB', ink: '#5B3FA8' }, { tint: '#D6F1EF', ink: '#136F6C' },
  { tint: '#FBDCE5', ink: '#A8335A' }, { tint: '#DDF2E6', ink: '#2B6B43' }, { tint: '#FFE9CC', ink: '#8A4A0B' },
];
const initialsOf = (name: string) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join('');

/** Per-client posts and videos for a month, the shared pool in posts and videos, and the CSV report. Shown to an agency account only. */
const AgencyUsage: React.FC = () => {
  const [month, setMonth] = useState('');
  const [currentKey, setCurrentKey] = useState(() => monthKeyOf(new Date()));
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AgencyUsageResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvError, setCsvError] = useState('');
  const latest = useRef(0);

  const load = useCallback(async (m: string, p: number) => {
    const mine = ++latest.current;
    setLoading(true); setError('');
    try {
      const r = await apiService.getAgencyUsage(m || undefined, p);
      if (mine !== latest.current) return;
      setData(r);
      if (!m && isMonthKey(r?.month)) setCurrentKey(r.month);
    } catch (e) {
      if (mine !== latest.current) return;
      setError(usageLoadMessage(e));
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, []);

  useEffect(() => { load(month, page); }, [load, month, page]);

  const shown = isMonthKey(data?.month) ? (data!.month) : (month || currentKey);
  const rows = usageRowsOf(data);
  const pool = data ? poolText(data.poolPosts, data.poolVideos) : '';
  const pager = pagerState(data);
  const hasRemoved = rows.some((r) => r.removed);

  const go = (m: string) => { setMonth(m); setPage(1); setCsvError(''); };

  const download = async () => {
    setCsvBusy(true); setCsvError('');
    const r = await apiService.downloadAgencyUsage(shown);
    setCsvBusy(false);
    if (!r.success) setCsvError(agencyErrorMessage(r, 'We could not prepare the usage report. Please try again.'));
  };

  const totalPosts = rows.reduce((n, r) => n + r.posts, 0);
  const totalVideos = rows.reduce((n, r) => n + r.videos, 0);
  const activeClients = rows.filter((r) => !r.removed).length;
  const maxPosts = Math.max(1, ...rows.map((r) => r.posts));
  const maxVideos = Math.max(1, ...rows.map((r) => r.videos));
  const tiles = [
    { key: 'posts', label: `Posts in ${monthLabel(shown)}`, value: totalPosts.toLocaleString('en-IN'), Icon: ImageIcon, t: TINT.posts },
    { key: 'videos', label: 'Videos', value: totalVideos.toLocaleString('en-IN'), Icon: VideoIcon, t: TINT.videos },
    { key: 'clients', label: 'Clients active', value: activeClients.toLocaleString('en-IN'), Icon: Users, t: TINT.clients },
    ...(data && typeof data.poolPosts === 'number' ? [{ key: 'pool', label: 'Left in the shared pool', value: `${data.poolPosts.toLocaleString('en-IN')} posts`, Icon: Wallet, t: TINT.pool, note: typeof data.poolVideos === 'number' ? `or ${data.poolVideos.toLocaleString('en-IN')} videos` : '' }] : []),
  ];

  return (
    <section aria-labelledby="agency-usage-title" className="mb-10 rounded-2xl border border-[var(--gv-border-subtle)] p-4 sm:p-6" style={{ background: 'linear-gradient(135deg, #FFF3D6 0%, #FFFBF2 42%, #FFFFFF 100%)', boxShadow: '0 1px 2px rgb(43 29 14 / 0.04)' }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: TINT.posts.tint, color: TINT.posts.ink }}><BarChart3 className="h-5 w-5" aria-hidden="true" /></span>
          <div className="min-w-0">
            <h2 id="agency-usage-title" className="text-[18px] font-semibold text-[var(--gv-text-primary)]">Client usage</h2>
            {pool && <p className="mt-0.5 text-[14px] leading-relaxed text-[var(--gv-text-secondary)]">{pool}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2" role="group" aria-label="Choose a month">
          <button type="button" className={ICON_BTN} onClick={() => go(shiftMonth(shown, -1))} disabled={loading || !canGoPrev(shown, currentKey)} aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></button>
          <select
            aria-label="Month"
            value={shown}
            onChange={(e) => go(e.target.value)}
            disabled={loading}
            className="min-h-[40px] rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-panel)] px-2 text-[13px] font-semibold text-[var(--gv-text-primary)]"
          >
            {(monthChoices(currentKey).includes(shown) ? monthChoices(currentKey) : [shown, ...monthChoices(currentKey)]).map((k) => <option key={k} value={k}>{monthLabel(k)}</option>)}
          </select>
          <button type="button" className={ICON_BTN} onClick={() => go(shiftMonth(shown, 1))} disabled={loading || !canGoNext(shown, currentKey)} aria-label="Next month"><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>

      {loading && !data && (
        <div className="flex items-center justify-center gap-2 py-12 text-[14px] text-[var(--gv-text-secondary)]" role="status"><Loader2 className="h-5 w-5 animate-spin" /> Loading usage</div>
      )}

      {error && (
        <div role="alert" className="mt-4 rounded-xl border border-[var(--gv-border-default)] bg-[var(--gv-panel)] p-4">
          <p className="flex items-start gap-2 text-[14px] font-semibold text-[var(--gv-text-primary)]"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />{error}</p>
          <button type="button" className={`${BTN} mt-3`} onClick={() => load(month, page)}>Try again</button>
        </div>
      )}

      {data && !error && rows.length === 0 && (
        <div className="mt-4 rounded-xl border border-dashed border-[var(--gv-border-default)] p-6 text-center">
          <p className="text-[14px] font-semibold text-[var(--gv-text-primary)]">No clients to report on yet</p>
          <p className="mx-auto mt-1 max-w-md text-[13.5px] text-[var(--gv-text-secondary)]">Add a client and open it to start making posts and videos. Each client's use for the month will show here.</p>
          <Link to="/agency/clients" className={`${BTN} mt-3`}>Go to clients</Link>
        </div>
      )}

      {data && !error && rows.length > 0 && (
        <div className={loading ? 'opacity-60' : ''} aria-busy={loading}>
          <ul className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label={`Totals for ${monthLabel(shown)}`}>
            {tiles.map(({ key, label, value, Icon, t, note }: any) => (
              <li key={key} className="rounded-2xl border border-[var(--gv-border-subtle)] p-3.5" style={{ background: '#FFFFFF', borderTop: `3px solid ${t.bar}`, boxShadow: '0 1px 2px rgb(43 29 14 / 0.04)' }}>
                <div className="flex items-center gap-2">
                  <span className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: t.tint, color: t.ink }}><Icon className="h-4 w-4" aria-hidden="true" /></span>
                  <span className="text-[12.5px] font-semibold leading-tight text-[var(--gv-text-secondary)]">{label}</span>
                </div>
                <p className="mt-2 text-[24px] font-semibold leading-none tabular-nums text-[var(--gv-text-primary)]">{value}</p>
                {note && <p className="mt-1 text-[12px] text-[var(--gv-text-tertiary)]">{note}</p>}
              </li>
            ))}
          </ul>

          <table className="mt-4 w-full border-separate border-spacing-y-2 text-left text-[13.5px]">
            <caption className="sr-only">Posts and videos made for each client in {monthLabel(shown)}</caption>
            <thead className="sr-only"><tr><th scope="col">Client</th><th scope="col">Posts</th><th scope="col">Videos</th></tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const av = AVATARS[i % AVATARS.length];
                return (
                  <tr key={r.id || r.name} className="[&>*]:bg-white [&>*]:border-y [&>*]:border-[var(--gv-border-subtle)]">
                    <th scope="row" className="rounded-l-xl border-l px-3 py-3 font-normal">
                      <div className="flex items-center gap-3">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[13px] font-semibold" style={{ background: av.tint, color: av.ink }} aria-hidden="true">{initialsOf(r.name)}</span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="break-words font-semibold text-[var(--gv-text-primary)]">{r.name}</span>
                            {r.frozen && <span className="rounded-full bg-[var(--gv-surface-3)] px-2 py-0.5 text-[11.5px] font-semibold text-[var(--gv-text-secondary)]">Paused</span>}
                          </div>
                          {!r.removed && <div className="mt-0.5 text-[12px] text-[var(--gv-text-secondary)]">{lastActiveText(r.lastActive)}</div>}
                        </div>
                      </div>
                    </th>
                    <td className="w-[28%] px-3 py-3">
                      <div className="flex items-center justify-between gap-2"><span className="rounded-full px-2 py-0.5 text-[11.5px] font-semibold" style={{ background: TINT.posts.tint, color: TINT.posts.ink }}>Posts</span><span className="font-semibold tabular-nums text-[var(--gv-text-primary)]">{r.posts.toLocaleString('en-IN')}</span></div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full" style={{ background: TINT.posts.tint }} aria-hidden="true"><div className="h-full rounded-full" style={{ width: `${Math.max(r.posts ? 6 : 0, Math.round((r.posts / maxPosts) * 100))}%`, background: TINT.posts.bar }} /></div>
                    </td>
                    <td className="w-[24%] rounded-r-xl border-r px-3 py-3">
                      <div className="flex items-center justify-between gap-2"><span className="rounded-full px-2 py-0.5 text-[11.5px] font-semibold" style={{ background: TINT.videos.tint, color: TINT.videos.ink }}>Videos</span><span className="font-semibold tabular-nums text-[var(--gv-text-primary)]">{r.videos.toLocaleString('en-IN')}</span></div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full" style={{ background: TINT.videos.tint }} aria-hidden="true"><div className="h-full rounded-full" style={{ width: `${Math.max(r.videos ? 6 : 0, Math.round((r.videos / maxVideos) * 100))}%`, background: TINT.videos.bar }} /></div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {hasRemoved && <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--gv-text-secondary)]">{removedClientNote()}</p>}
        </div>
      )}

      {data && !error && (pager.text || rows.length > 0) && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {pager.text && <p className="text-[12.5px] text-[var(--gv-text-secondary)]">{pager.text}</p>}
            {pager.text && (
              <>
                <button type="button" className={BTN} onClick={() => setPage(pager.page - 1)} disabled={loading || !pager.canPrev}>Previous page</button>
                <button type="button" className={BTN} onClick={() => setPage(pager.page + 1)} disabled={loading || !pager.canNext}>Next page</button>
              </>
            )}
          </div>
          {rows.length > 0 && (
            <button type="button" className={BTN} onClick={download} disabled={csvBusy}>{csvBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} {csvLinkLabel(shown)}</button>
          )}
        </div>
      )}
      {csvError && <p role="alert" className="mt-2 flex items-start gap-1.5 text-[13px] text-red-700"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{csvError}</p>}
    </section>
  );
};

export default AgencyUsage;
