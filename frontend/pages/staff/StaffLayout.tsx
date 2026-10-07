import React, { useEffect, useState } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { Loader2, Home, Users, UserCog, Wallet, BarChart3 } from 'lucide-react';
import { apiService } from '../../services/api';
import { customerMessage } from '../../utils/errors';
import StaffHome from './StaffHome';
import StaffClients from './StaffClients';
import StaffClientPage from './StaffClientPage';
import StaffTeam from './StaffTeam';
import StaffMoney from './StaffMoney';

const SECTIONS = [
  { id: 'home', label: 'Home', icon: Home, needs: 'view_home' },
  { id: 'clients', label: 'Clients', icon: Users, needs: 'view_clients' },
  { id: 'team', label: 'Team', icon: UserCog, needs: 'add_csm' },
  { id: 'money', label: 'Money', icon: Wallet, needs: 'view_money' },
  { id: 'usage', label: 'Usage', icon: BarChart3, needs: 'view_usage_summary' }
] as const;

const NEXT_STEP: Record<string, string> = {
  usage: 'Feature use and the sign-up funnel arrive in a later release.'
};

/** The Nebulaa staff area: its own menu, shown only to the Owner, Admins and CSMs. */
const StaffLayout: React.FC = () => {
  const { section = 'home', id } = useParams();
  const [me, setMe] = useState<Awaited<ReturnType<typeof apiService.getStaffMe>> | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiService.getStaffMe().then(setMe).catch((e) => setError(customerMessage(e)));
  }, []);

  if (error) return <div className="max-w-xl mx-auto mt-16 text-center text-[var(--gv-text-primary)]">{error}</div>;
  if (!me) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-[#F5A623]" /></div>;

  const visible = SECTIONS.filter((s) => me.can[s.needs]);
  const current = visible.find((s) => s.id === section) || visible[0];

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[#B7791F]">Staff area</p>
          <h1 className="text-2xl font-semibold text-[var(--gv-text-primary)]">{current?.label}</h1>
        </div>
        <p className="text-sm text-[var(--gv-text-muted)]">{me.staff.name} · {me.staff.role === 'owner' ? 'Owner' : me.staff.role === 'admin' ? 'Admin' : 'CSM'}</p>
      </div>
      <nav className="mb-6 flex flex-wrap gap-2 border-b border-[var(--gv-border-subtle)]">
        {visible.map((s) => {
          const Icon = s.icon;
          return (
            <NavLink key={s.id} to={`/staff/${s.id}`} className={() => `flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px ${current?.id === s.id ? 'border-[#F5A623] text-[#B7791F]' : 'border-transparent text-[var(--gv-text-muted)]'}`}>
              <Icon className="w-4 h-4" /> {s.label}
            </NavLink>
          );
        })}
      </nav>
      {current?.id === 'home' ? <StaffHome role={me.staff.role} can={me.can} /> : current?.id === 'clients' ? (id ? <StaffClientPage id={id} /> : <StaffClients can={me.can} />) : current?.id === 'team' ? <StaffTeam /> : current?.id === 'money' ? <StaffMoney /> : <p className="py-16 text-center text-[var(--gv-text-muted)]">{NEXT_STEP[current?.id || ''] || ''}</p>}
    </div>
  );
};

export default StaffLayout;
