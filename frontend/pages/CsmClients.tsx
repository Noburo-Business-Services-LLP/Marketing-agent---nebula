import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Search, ArrowRight, Users } from 'lucide-react';
import { apiService } from '../services/api';
import { useTheme, getThemeClasses } from '../context/ThemeContext';
import { customerMessage } from '../utils/errors';

type Client = Awaited<ReturnType<typeof apiService.getCsmClients>>['clients'][number];

function lastSeen(value: string | null): string {
  if (!value) return 'Never signed in';
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
  if (days <= 0) return 'Signed in today';
  if (days === 1) return 'Signed in yesterday';
  return `Signed in ${days} days ago`;
}

/** The clients assigned to this customer success manager, with a one-click way into each account. */
const CsmClients: React.FC = () => {
  const { isDarkMode } = useTheme();
  const theme = getThemeClasses(isDarkMode);
  const [clients, setClients] = useState<Client[] | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    apiService.getCsmClients()
      .then((res) => setClients(res.clients || []))
      .catch((e) => { setError(customerMessage(e)); setClients([]); });
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = clients || [];
    return q ? list.filter((c) => `${c.name} ${c.email} ${c.industry}`.toLowerCase().includes(q)) : list;
  }, [clients, query]);

  const open = async (client: Client) => {
    setOpening(client.id);
    setError('');
    try {
      await apiService.openCsmClient(client.id);
      window.location.hash = '#/dashboard';
      window.location.reload();
    } catch (e) {
      setError(customerMessage(e));
      setOpening(null);
    }
  };

  if (clients === null) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-[#F5A623]" /></div>;

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div>
        <h1 className={`text-2xl font-semibold ${theme.text}`}>My clients</h1>
        <p className={`text-sm mt-1 ${theme.textSecondary}`}>Open a client to work in their account. You can return to this list at any time from the banner at the top.</p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {clients.length === 0 ? (
        <div className={`rounded-2xl border p-8 text-center ${theme.bgCard} border-slate-200`}>
          <Users className="w-10 h-10 mx-auto text-[#F5A623]" />
          <p className={`mt-3 ${theme.text}`}>No clients are assigned to you yet.</p>
          <p className={`text-sm mt-1 ${theme.textSecondary}`}>An administrator assigns clients to you from the admin area.</p>
        </div>
      ) : (
        <>
          <div className="relative max-w-sm">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search clients" className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {shown.map((c) => (
              <div key={c.id} className={`rounded-xl border p-4 flex flex-col gap-3 ${theme.bgCard} border-slate-200`}>
                <div>
                  <p className={`font-semibold ${theme.text}`}>{c.name}</p>
                  <p className={`text-xs ${theme.textSecondary}`}>{c.email}{c.industry ? ` · ${c.industry}` : ''}</p>
                </div>
                <ul className={`text-sm space-y-1 ${theme.textSecondary}`}>
                  <li>{c.draftsWaiting > 0 ? `${c.draftsWaiting} ${c.draftsWaiting === 1 ? 'draft is' : 'drafts are'} waiting for review` : 'No drafts waiting'}</li>
                  <li>{c.connectedAccounts > 0 ? `${c.connectedAccounts} social ${c.connectedAccounts === 1 ? 'account' : 'accounts'} connected` : 'No social accounts connected'}</li>
                  <li className={c.quarks < 100 ? 'text-amber-700' : ''}>{c.quarks} Quarks left</li>
                  {!c.onboardingCompleted && <li className="text-amber-700">Onboarding not finished</li>}
                  <li>{lastSeen(c.lastLoginAt)}</li>
                </ul>
                <button onClick={() => open(c)} disabled={opening !== null || !c.isActive} className="self-start px-4 py-2 rounded-lg bg-[#F5A623] text-[#070A12] text-sm font-bold inline-flex items-center gap-2 disabled:opacity-50">
                  {opening === c.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                  {c.isActive ? 'Open account' : 'Account switched off'}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default CsmClients;
