import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { AlertCircle, ArrowRight, Check, Download, Loader2, Pencil, Plus, Trash2, Users, X } from 'lucide-react';
import { apiService } from '../services/api';
import type { AgencyClient } from '../services/api';
import type { User } from '../types';
import {
  addClientCheck, agencyErrorMessage, canConfirmRemoval, clientStatus, includedText, isAgencyUser, isInsideClient,
  lastActiveText, limitLabel, mergeUsage, removalExplainer, slotOffer, usageText,
} from '../utils/agency';
import type { UsageRow } from '../utils/agency';
import Dialog from '../components/AgencyDialog';
import ExtraClientDialog from '../components/ExtraClientDialog';

const FIELD = 'w-full rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-surface-1)] px-3 py-2.5 text-[14px] text-[var(--gv-text-primary)] outline-none focus:border-[var(--gv-accent)]';
const CARD = 'rounded-xl border border-[var(--gv-border-default)] bg-[var(--gv-panel)] p-4 sm:p-5';
const BTN = 'inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-panel)] px-3.5 min-h-[40px] text-[13px] font-semibold text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-2)] disabled:opacity-50';
const BTN_MAIN = 'inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--gv-accent)] px-4 min-h-[40px] text-[13px] font-semibold text-[var(--gv-accent-ink)] hover:bg-[var(--gv-accent-hover)] disabled:opacity-50';
const BTN_DANGER = 'inline-flex items-center justify-center gap-2 rounded-lg bg-red-700 px-4 min-h-[40px] text-[13px] font-semibold text-white hover:bg-red-800 disabled:opacity-50';
const LOAD_ERROR = 'We could not load your clients. Please try again.';

type Loaded = { clients: AgencyClient[]; limit: number; used: number; slotInr: number };
type Info = { includedClients: number; maxClients: number; slotInr: number; slot?: { inr?: number; gstPaise?: number; chargePaise?: number } };

const AgencyClients: React.FC<{ user: User | null }> = ({ user }) => {
  const [data, setData] = useState<Loaded | null>(null);
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [month, setMonth] = useState('');
  const [info, setInfo] = useState<Info | null>(null);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [pageError, setPageError] = useState('');
  const [opening, setOpening] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | { kind: 'add' } | { kind: 'remove'; client: UsageRow }>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState('');
  const [slotOpen, setSlotOpen] = useState(false);
  const [csvBusy, setCsvBusy] = useState(false);

  const agency = isAgencyUser(user);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const r = await apiService.getAgencyClients();
      setData({ clients: r.clients || [], limit: r.limit || 0, used: r.used ?? (r.clients || []).length, slotInr: r.slotInr || 0 });
      let usage = null;
      try { usage = await apiService.getAgencyUsage(); setMonth(usage?.month || ''); } catch { /* the list is useful without the monthly figures */ }
      setRows(mergeUsage(r.clients || [], usage));
    } catch (e) {
      setLoadError(LOAD_ERROR);
      setData(null);
    }
  }, []);

  useEffect(() => {
    if (!agency) return;
    load();
    apiService.getPlans()
      .then((p) => { if (p?.agency) setInfo({ includedClients: p.agency.includedClients, maxClients: p.agency.maxClients, slotInr: p.slot ? Math.round(p.slot.inr ?? p.agency.slotInr) : p.agency.slotInr, slot: p.slot }); })
      .catch(() => undefined);
  }, [agency, load]);

  if (!user) return null;
  if (isInsideClient(user)) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className={CARD}>
          <h1 className="text-[20px] font-semibold text-[var(--gv-text-primary)]">Clients are managed from your agency account</h1>
          <p className="mt-1 text-[14px] text-[var(--gv-text-secondary)]">To add, rename or remove clients, go back to your clients first.</p>
          <button type="button" className={`${BTN_MAIN} mt-3`} onClick={() => { if (apiService.returnToCsmAccount()) { window.location.hash = '#/agency/clients'; window.location.reload(); } }}>Back to my clients</button>
        </div>
      </div>
    );
  }
  if (!agency) return <Navigate to="/dashboard" replace />;

  const maxClients = info?.maxClients ?? 25;
  const slotInr = data?.slotInr || info?.slotInr || 0;
  const room = { used: data?.used ?? 0, limit: data?.limit ?? 0, maxClients };
  const offer = data ? slotOffer({ ...room, slotInr }) : null;

  const open = async (c: UsageRow) => {
    setOpening(c.id); setPageError('');
    const r = await apiService.openAgencyClient(c.id);
    if (r.success) { window.location.hash = '#/dashboard'; window.location.reload(); }
    else { setPageError(agencyErrorMessage(r, 'We could not open this client. Please try again.')); setOpening(null); }
  };

  const saveRename = async () => {
    if (!renaming) return;
    const check = addClientCheck(renaming.name, { used: 0, limit: 1, maxClients });
    if (!check.ok) { setRenameError(check.problem); return; }
    setRenameBusy(true); setRenameError('');
    const r = await apiService.renameAgencyClient(renaming.id, renaming.name.trim());
    setRenameBusy(false);
    if (r.success) { setRenaming(null); setNotice('The client was renamed.'); await load(); }
    else setRenameError(agencyErrorMessage(r, 'We could not rename this client. Please try again.'));
  };

  const downloadCsv = async () => {
    setCsvBusy(true); setPageError('');
    const r = await apiService.downloadAgencyUsage(month);
    setCsvBusy(false);
    if (!r.success) setPageError(agencyErrorMessage(r, 'We could not prepare the usage report. Please try again.'));
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[24px] font-semibold tracking-[-0.01em] text-[var(--gv-text-primary)]">Clients</h1>
          <p className="mt-1 text-[14px] leading-relaxed text-[var(--gv-text-secondary)]">
            Each client has its own brand details, calendar, library and connected accounts. {info ? includedText(info.includedClients, slotInr) : ''}
          </p>
        </div>
        {data && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[var(--gv-accent-fill)] px-3 py-1.5 text-[13px] font-semibold text-[var(--gv-accent-text)]" aria-label={`Clients in use: ${limitLabel(data.used, data.limit)}`}>{limitLabel(data.used, data.limit)}</span>
            <button type="button" className={BTN_MAIN} onClick={() => { setNotice(''); setDialog({ kind: 'add' }); }}><Plus className="h-4 w-4" /> Add a client</button>
          </div>
        )}
      </div>

      {notice && <p role="status" className="flex items-center gap-1.5 rounded-lg bg-[var(--gv-mint)] px-3 py-2 text-[13px] text-[var(--gv-text-primary)]"><Check className="h-4 w-4 shrink-0" />{notice}</p>}
      {pageError && <p role="alert" className="flex items-start gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-800"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{pageError}</p>}

      {!data && !loadError && (
        <div className="flex items-center justify-center gap-2 py-20 text-[14px] text-[var(--gv-text-secondary)]" role="status"><Loader2 className="h-5 w-5 animate-spin" /> Loading your clients</div>
      )}
      {loadError && (
        <div className={CARD} role="alert">
          <p className="flex items-center gap-2 text-[14px] font-semibold text-[var(--gv-text-primary)]"><AlertCircle className="h-4 w-4 text-red-700" /> {loadError}</p>
          <button type="button" className={`${BTN} mt-3`} onClick={() => { setData(null); load(); }}>Try again</button>
        </div>
      )}

      {data && offer && (
        <div className={`${CARD} flex flex-col gap-3 bg-[var(--gv-accent-fill)] sm:flex-row sm:items-center sm:justify-between`}>
          <p className="min-w-0 text-[14px] text-[var(--gv-text-primary)] sm:flex-1">{offer.text}</p>
          {offer.kind === 'buy' && (
            <button type="button" className={BTN_MAIN} onClick={() => { setNotice(''); setSlotOpen(true); }}><Plus className="h-4 w-4" /> Add an extra client</button>
          )}
        </div>
      )}

      {data && rows.length === 0 && (
        <div className={`${CARD} text-center`}>
          <Users className="mx-auto h-9 w-9 text-[var(--gv-accent-text)]" aria-hidden="true" />
          <h2 className="mt-3 text-[17px] font-semibold text-[var(--gv-text-primary)]">You have no clients yet</h2>
          <p className="mx-auto mt-1 max-w-md text-[14px] text-[var(--gv-text-secondary)]">Add your first client to give it its own brand details, calendar and library. Then open it to start making posts and videos.</p>
          <button type="button" className={`${BTN_MAIN} mt-4`} onClick={() => setDialog({ kind: 'add' })}><Plus className="h-4 w-4" /> Add a client</button>
        </div>
      )}

      {data && rows.length > 0 && (
        <ul className="space-y-3">
          {rows.map((c) => {
            const st = clientStatus(c, data.limit);
            const editing = renaming?.id === c.id;
            return (
              <li key={c.id} className={`${CARD} flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`}>
                <div className="min-w-0 flex-1">
                  {editing ? (
                    <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); saveRename(); }}>
                      <input autoFocus value={renaming!.name} onChange={(e) => setRenaming({ id: c.id, name: e.target.value })} aria-label="Client business name" className={`${FIELD} max-w-xs`} />
                      <button type="submit" className={BTN_MAIN} disabled={renameBusy}>{renameBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save name</button>
                      <button type="button" className={BTN} onClick={() => { setRenaming(null); setRenameError(''); }}>Cancel</button>
                    </form>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="break-words text-[16px] font-semibold text-[var(--gv-text-primary)]">{c.name}</h2>
                      <span className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${st.paused ? 'bg-[var(--gv-surface-3)] text-[var(--gv-text-secondary)]' : 'bg-[var(--gv-mint)] text-[var(--gv-text-primary)]'}`}>{st.label}</span>
                    </div>
                  )}
                  {editing && renameError && <p role="alert" className="mt-1 text-[13px] text-red-700">{renameError}</p>}
                  {st.paused ? (
                    <p className="mt-1 text-[13px] leading-relaxed text-[var(--gv-text-secondary)]">{st.reason}</p>
                  ) : (
                    <p className="mt-1 text-[13px] text-[var(--gv-text-secondary)]">{usageText(c.posts, c.videos)}. {lastActiveText(c.lastActive)}.</p>
                  )}
                </div>
                {!editing && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className={BTN_MAIN} disabled={!st.canOpen || opening !== null} onClick={() => open(c)} aria-label={st.canOpen ? `Open ${c.name}` : `${c.name} is paused`}>
                      {opening === c.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />} {st.canOpen ? 'Open client' : 'Paused'}
                    </button>
                    <button type="button" className={BTN} onClick={() => { setRenaming({ id: c.id, name: c.name }); setRenameError(''); }} aria-label={`Rename ${c.name}`}><Pencil className="h-4 w-4" /> Rename</button>
                    <button type="button" className={BTN} onClick={() => setDialog({ kind: 'remove', client: c })} aria-label={`Remove ${c.name}`}><Trash2 className="h-4 w-4" /> Remove</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {data && rows.length > 0 && month && (
        <div className="flex justify-end">
          <button type="button" className={BTN} onClick={downloadCsv} disabled={csvBusy}>{csvBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download this month's usage</button>
        </div>
      )}

      {dialog?.kind === 'add' && data && (
        <AddDialog
          room={room}
          offer={offer}
          included={info ? includedText(info.includedClients, slotInr) : ''}
          onBuy={() => { setDialog(null); setNotice(''); setSlotOpen(true); }}
          onClose={() => setDialog(null)}
          onAdded={async (name) => { setDialog(null); setNotice(`${name} was added. Open it to set up its brand details.`); await load(); }}
        />
      )}
      {slotOpen && (
        <ExtraClientDialog
          slot={info?.slot}
          agency={info ? { includedClients: info.includedClients, maxClients: info.maxClients, slotInr: slotInr } : undefined}
          limit={data?.limit ?? 0}
          onClose={() => setSlotOpen(false)}
          onAdded={() => { setNotice(''); load(); }}
        />
      )}
      {dialog?.kind === 'remove' && (
        <RemoveDialog
          client={dialog.client}
          onClose={() => setDialog(null)}
          onRemoved={async (name) => { setDialog(null); setNotice(`${name} was removed.`); await load(); }}
        />
      )}
    </div>
  );
};

const AddDialog: React.FC<{
  room: { used: number; limit: number; maxClients: number };
  offer: ReturnType<typeof slotOffer>;
  included: string;
  onBuy: () => void;
  onClose: () => void;
  onAdded: (name: string) => Promise<void>;
}> = ({ room, offer, included, onBuy, onClose, onAdded }) => {
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const check = addClientCheck(name, room);
    if (!check.ok) { setError(check.problem); return; }
    setBusy(true); setError('');
    const r = await apiService.createAgencyClient({ name: name.trim(), industry: industry.trim() || undefined });
    if (r.success) { await onAdded(name.trim()); return; }
    setBusy(false);
    setError(agencyErrorMessage(r, 'We could not add this client. Please try again.'));
  };

  if (offer) {
    return (
      <Dialog title="Add a client" onClose={onClose}>
        <p className="text-[14px] leading-relaxed text-[var(--gv-text-secondary)]">{offer.text}</p>
        {offer.kind === 'buy' && <p className="mt-2 text-[13px] text-[var(--gv-text-secondary)]">You will see the full price, with GST, before you pay.</p>}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" className={BTN} onClick={onClose}>Close</button>
          {offer.kind === 'buy' && <button type="button" className={BTN_MAIN} onClick={onBuy}><Plus className="h-4 w-4" /> Add an extra client</button>}
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title="Add a client" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <p className="text-[13px] leading-relaxed text-[var(--gv-text-secondary)]">{included} You are using {room.used} of {room.limit}.</p>
        <label className="block text-[13px] font-semibold text-[var(--gv-text-primary)]">Client business name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="off" className={`${FIELD} mt-1 font-normal`} />
        </label>
        <label className="block text-[13px] font-semibold text-[var(--gv-text-primary)]">Industry (optional)
          <input value={industry} onChange={(e) => setIndustry(e.target.value)} maxLength={80} autoComplete="off" className={`${FIELD} mt-1 font-normal`} />
        </label>
        {error && <p role="alert" className="flex items-start gap-1.5 text-[13px] text-red-700"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>}
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button type="button" className={BTN} onClick={onClose}>Cancel</button>
          <button type="submit" className={BTN_MAIN} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add client</button>
        </div>
      </form>
    </Dialog>
  );
};

const RemoveDialog: React.FC<{ client: UsageRow; onClose: () => void; onRemoved: (name: string) => Promise<void> }> = ({ client, onClose, onRemoved }) => {
  const [pw, setPw] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const text = removalExplainer(client.name);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canConfirmRemoval(pw, typed)) return;
    setBusy(true); setError('');
    const r = await apiService.removeAgencyClient(client.id, pw);
    if (r.success) { await onRemoved(client.name); return; }
    setBusy(false);
    setError(agencyErrorMessage(r, 'We could not remove this client. Nothing was changed.'));
  };

  return (
    <Dialog title={`Remove ${client.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <p className="text-[13.5px] leading-relaxed text-[var(--gv-text-primary)]">{text.erased}</p>
        <p className="text-[13.5px] leading-relaxed text-[var(--gv-text-secondary)]">{text.kept}</p>
        <p className="text-[13.5px] font-semibold leading-relaxed text-[var(--gv-text-primary)]">{text.undo}</p>
        <input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Your agency password" aria-label="Your agency password" className={FIELD} />
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type REMOVE" aria-label="Type REMOVE to confirm" autoComplete="off" className={FIELD} />
        {error && <p role="alert" className="flex items-start gap-1.5 text-[13px] text-red-700"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>}
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button type="button" className={BTN} onClick={onClose}>Keep this client</button>
          <button type="submit" className={BTN_DANGER} disabled={busy || !canConfirmRemoval(pw, typed)}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Remove client</button>
        </div>
      </form>
    </Dialog>
  );
};

export default AgencyClients;
