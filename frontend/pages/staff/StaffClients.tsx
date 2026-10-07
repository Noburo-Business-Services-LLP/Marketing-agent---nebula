import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Search, Check, Minus, AlertTriangle, Download } from 'lucide-react';
import { apiService } from '../../services/api';
import { customerMessage } from '../../utils/errors';
import PlatformIcon from '../../components/PlatformIcon';
import { FILTER_LABEL, TIER_LABEL, ACCESS_LABEL, whenLabel, attentionText } from './staffLabels';

type Row = {
  id: string; name: string; email: string; tier: string; addons: string[]; paying: boolean; trial: boolean;
  status: 'active' | 'inactive' | 'disabled'; quarks: number; platforms: string[]; access: Record<string, boolean>;
  csm: { id: string; name: string } | null; lastActiveAt: string | null; attention: string[];
};

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-800',
  inactive: 'bg-amber-100 text-amber-800',
  disabled: 'bg-slate-200 text-slate-600'
};
const STATUS_TEXT: Record<string, string> = { active: 'Active', inactive: 'Inactive', disabled: 'Switched off' };

const SORTABLE: Array<{ key: string; label: string }> = [
  { key: 'name', label: 'Client' }, { key: 'plan', label: 'Plan' }, { key: 'quarks', label: 'Quarks' },
  { key: 'lastActive', label: 'Last active' }, { key: 'status', label: 'Status' }
];

function toCsv(rows: Row[]): string {
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['Name', 'Email', 'Plan', 'Paying', 'Quarks', 'Connected accounts', 'CSM', 'Last active', 'Status'];
  const lines = rows.map((r) => [r.name, r.email, TIER_LABEL[r.tier] || r.tier, r.paying ? 'Yes' : 'No', r.quarks, r.platforms.join(' '), r.csm?.name || '', r.lastActiveAt || '', STATUS_TEXT[r.status]].map(esc).join(','));
  return [head.map(esc).join(','), ...lines].join('\n');
}

/** The client list: filters with counts, search, sorting, paging, and what each client can use. */
const StaffClients: React.FC<{ can: Record<string, boolean> }> = ({ can }) => {
  const navigate = useNavigate();
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('lastActive');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [csms, setCsms] = useState<Array<{ id: string; name: string }>>([]);
  const [bulkCsm, setBulkCsm] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => { const t = setTimeout(() => { setSearch(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    apiService.getStaffClients({ filter, q: search, sort, dir, page, pageSize: 25 })
      .then((res) => setData(res))
      .catch((e) => setError(customerMessage(e)))
      .finally(() => setLoading(false));
  }, [filter, search, sort, dir, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (can.assign_csm) apiService.getStaffCsms().then((r) => setCsms(r.csms || [])).catch(() => undefined); }, [can.assign_csm]);

  const sortBy = (key: string) => {
    if (sort === key) setDir(dir === 'asc' ? 'desc' : 'asc'); else { setSort(key); setDir(key === 'name' ? 'asc' : 'desc'); }
    setPage(1);
  };

  const rows: Row[] = data?.rows || [];
  const allPicked = rows.length > 0 && rows.every((r) => picked.includes(r.id));

  const bulkAssign = async () => {
    setNote('');
    try {
      const res = await apiService.staffBulkAssign(picked, bulkCsm || null);
      setNote(res.success ? `${res.updated} ${res.updated === 1 ? 'client' : 'clients'} updated.` : (res.message || 'Could not assign.'));
      if (res.success) { setPicked([]); load(); }
    } catch (e) { setNote(customerMessage(e)); }
  };

  const exportCsv = async () => {
    setNote('');
    try {
      let all: Row[] = [];
      for (let p = 1; p <= 20; p++) {
        const res = await apiService.getStaffClients({ filter, q: search, sort, dir, page: p, pageSize: 100 });
        all = all.concat(res.rows || []);
        if (p >= (res.pages || 1)) break;
      }
      const url = URL.createObjectURL(new Blob([toCsv(all)], { type: 'text/csv' }));
      const a = document.createElement('a'); a.href = url; a.download = 'clients.csv'; a.click(); URL.revokeObjectURL(url);
    } catch (e) { setNote(customerMessage(e)); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {FILTER_LABEL.map((f) => (
          <button key={f.key} onClick={() => { setFilter(f.key); setPage(1); setPicked([]); }}
            className={`px-3 py-1.5 rounded-full text-sm font-semibold border ${filter === f.key ? 'bg-[#F5A623] border-[#F5A623] text-black' : 'bg-white border-slate-300 text-slate-700'}`}>
            {f.label} <span className="opacity-70">{data?.counts?.[f.key] ?? ''}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, email, company or phone" className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm bg-white" />
        </div>
        {can.export_csv && (
          <button onClick={exportCsv} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700"><Download className="w-4 h-4" /> Export CSV</button>
        )}
        {can.assign_csm && picked.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-600">{picked.length} selected</span>
            <select value={bulkCsm} onChange={(e) => setBulkCsm(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm">
              <option value="">No CSM</option>
              {csms.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button onClick={bulkAssign} className="px-3 py-2 rounded-lg bg-[#F5A623] text-black text-sm font-bold">Assign</button>
          </div>
        )}
      </div>
      {note && <p className="text-sm text-slate-700">{note}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {can.assign_csm && <th className="w-10 px-3 py-2"><input type="checkbox" checked={allPicked} onChange={() => setPicked(allPicked ? [] : rows.map((r) => r.id))} aria-label="Select all on this page" /></th>}
              {SORTABLE.slice(0, 3).map((c) => (
                <th key={c.key} className="px-3 py-2"><button onClick={() => sortBy(c.key)} className="font-semibold uppercase">{c.label}{sort === c.key ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}</button></th>
              ))}
              <th className="px-3 py-2">Accounts</th>
              <th className="px-3 py-2">Can use</th>
              <th className="px-3 py-2">CSM</th>
              {SORTABLE.slice(3).map((c) => (
                <th key={c.key} className="px-3 py-2"><button onClick={() => sortBy(c.key)} className="font-semibold uppercase">{c.label}{sort === c.key ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}</button></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={9} className="px-3 py-10 text-center"><Loader2 className="w-5 h-5 animate-spin inline text-[#F5A623]" /></td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={9} className="px-3 py-10 text-center text-slate-500">No clients match this view.</td></tr>}
            {!loading && rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => navigate(`/staff/clients/${r.id}`)}>
                {can.assign_csm && (
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={picked.includes(r.id)} onChange={() => setPicked((p) => (p.includes(r.id) ? p.filter((x) => x !== r.id) : [...p, r.id]))} aria-label={`Select ${r.name}`} />
                  </td>
                )}
                <td className="px-3 py-2">
                  <div className="font-semibold text-slate-900 flex items-center gap-2">
                    {r.name}
                    {r.attention.length > 0 && <span title={attentionText(r.attention)} className="inline-flex items-center gap-1 text-amber-700"><AlertTriangle className="w-3.5 h-3.5" />{r.attention.length}</span>}
                  </div>
                  <div className="text-xs text-slate-500">{r.email}</div>
                </td>
                <td className="px-3 py-2">
                  <div className="font-medium text-slate-800">{TIER_LABEL[r.tier] || r.tier}{r.paying ? ' · paying' : r.trial ? ' · trial' : ''}</div>
                  {r.addons.length > 0 && <div className="flex gap-1 mt-1 flex-wrap">{r.addons.map((a) => <span key={a} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{a}</span>)}</div>}
                </td>
                <td className={`px-3 py-2 tabular-nums font-semibold ${r.quarks < 100 ? 'text-amber-700' : 'text-slate-800'}`}>{r.quarks.toLocaleString()}</td>
                <td className="px-3 py-2">
                  <div className="flex gap-1.5 text-slate-600">{r.platforms.length === 0 ? <span className="text-xs text-slate-400">None</span> : r.platforms.map((p) => <span key={p} title={p}><PlatformIcon platform={p} className="w-4 h-4" /></span>)}</div>
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-2 text-[11px] whitespace-nowrap">
                    {ACCESS_LABEL.map((a) => (
                      <span key={a.key} title={`${a.label}: ${r.access[a.key] ? 'included in the plan' : 'not in the plan'}`} className={`inline-flex items-center gap-0.5 whitespace-nowrap ${r.access[a.key] ? 'text-emerald-700' : 'text-slate-400'}`}>
                        {r.access[a.key] ? <Check className="w-3 h-3" /> : <Minus className="w-3 h-3" />}{a.label}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2 text-slate-700">{r.csm ? (r.csm.name || 'Assigned') : <span className="text-slate-400">None</span>}</td>
                <td className="px-3 py-2 text-slate-600">{whenLabel(r.lastActiveAt)}</td>
                <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[r.status]}`}>{STATUS_TEXT[r.status]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data && data.pages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>{data.total} clients · page {data.page} of {data.pages}</span>
          <div className="flex gap-2">
            <button disabled={data.page <= 1} onClick={() => setPage(data.page - 1)} className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white disabled:opacity-40">Previous</button>
            <button disabled={data.page >= data.pages} onClick={() => setPage(data.page + 1)} className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white disabled:opacity-40">Next</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default StaffClients;
