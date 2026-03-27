import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, UserCheck, UserX, TrendingUp, Search, X, LogOut,
  RefreshCw, Clock, Zap, BarChart2, Send, Eye, ChevronRight, AlertTriangle
} from 'lucide-react';

const BASE_URL = import.meta.env.DEV ? 'http://localhost:5000/api' : '/api';

interface UserRow {
  _id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  isActive: boolean;
  createdAt: string;
  lastLoginAt?: string;
  lastActivity?: string;
  eventTotal: number;
  socialCount: number;
  onboardingCompleted: boolean;
  credits?: { balance: number; totalUsed: number };
  trial?: { expiresAt?: string; isExpired?: boolean; migratedToProd?: boolean };
}

interface FeatureUsage {
  feature: string;
  label: string;
  count: number;
  lastUsed: string;
  creditsUsed: number;
}

interface UserDetail {
  user: UserRow & { trialDaysLeft?: number | null };
  usage: FeatureUsage[];
  publishRate: number;
  generated: number;
  published: number;
  totalCreditsBurned: number;
}

interface Overview {
  totalUsers: number;
  newToday: number;
  newThisWeek: number;
  newThisMonth: number;
  dau: number;
  wau: number;
  mau: number;
  activeTrials: number;
  expiringSoon: number;
  expiredTrials: number;
  totalCreditsUsed: number;
}

interface ContentStats {
  generated: number;
  published: number;
  publishRate: number;
  topGenerators: { email: string; companyName?: string; count: number }[];
}

const adminFetch = async (path: string, options: RequestInit = {}) => {
  const token = localStorage.getItem('adminToken');
  const res = await fetch(`${BASE_URL}/admin${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  if (res.status === 401) {
    localStorage.removeItem('adminToken');
    window.location.hash = '#/admin/login';
    throw new Error('Session expired');
  }
  return res.json();
};

const trialStatus = (user: UserRow) => {
  if (user.trial?.migratedToProd) return { label: 'Converted', color: 'text-blue-400 bg-blue-500/15 border-blue-500/30' };
  if (user.trial?.isExpired) return { label: 'Expired', color: 'text-red-400 bg-red-500/15 border-red-500/30' };
  const exp = user.trial?.expiresAt ? new Date(user.trial.expiresAt) : null;
  if (exp) {
    const daysLeft = Math.ceil((exp.getTime() - Date.now()) / 86400000);
    if (daysLeft <= 0) return { label: 'Expired', color: 'text-red-400 bg-red-500/15 border-red-500/30' };
    if (daysLeft <= 3) return { label: `${daysLeft}d left`, color: 'text-orange-400 bg-orange-500/15 border-orange-500/30' };
    return { label: `${daysLeft}d left`, color: 'text-green-400 bg-green-500/15 border-green-500/30' };
  }
  return { label: 'On trial', color: 'text-green-400 bg-green-500/15 border-green-500/30' };
};

const StatCard: React.FC<{ label: string; value: number | string; sub?: string; icon: React.ReactNode; accent?: string }> = ({ label, value, sub, icon, accent = 'text-[#ffcc29]' }) => (
  <div className="bg-[#0D1117] border border-[#1E2530] rounded-xl p-4">
    <div className="flex items-center justify-between mb-3">
      <span className="text-gray-400 text-xs font-medium uppercase tracking-wider">{label}</span>
      <span className={accent}>{icon}</span>
    </div>
    <p className={`text-2xl font-bold text-white`}>{value}</p>
    {sub && <p className="text-gray-500 text-xs mt-1">{sub}</p>}
  </div>
);

const AdminDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [contentStats, setContentStats] = useState<ContentStats | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<UserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'users' | 'funnel' | 'content'>('users');
  const [trialFunnel, setTrialFunnel] = useState<{ active: UserRow[]; expiringSoon: UserRow[]; expired: UserRow[]; migrated: UserRow[] } | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [ovRes, usersRes, contentRes, funnelRes] = await Promise.all([
        adminFetch('/overview'),
        adminFetch('/users'),
        adminFetch('/content-stats'),
        adminFetch('/trial-funnel'),
      ]);
      if (ovRes.success) setOverview(ovRes.data);
      if (usersRes.success) setUsers(usersRes.data);
      if (contentRes.success) setContentStats(contentRes.data);
      if (funnelRes.success) setTrialFunnel(funnelRes.data);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('adminToken');
    if (!token) { navigate('/admin/login'); return; }
    loadData();
  }, [loadData, navigate]);

  const openUser = async (id: string) => {
    setDetailLoading(true);
    setSelected(null);
    try {
      const res = await adminFetch(`/users/${id}/usage`);
      if (res.success) setSelected(res.data);
    } catch {}
    setDetailLoading(false);
  };

  const toggleUser = async (id: string) => {
    setToggling(id);
    try {
      const res = await adminFetch(`/users/${id}/toggle`, { method: 'PUT' });
      if (res.success) {
        setUsers(prev => prev.map(u => u._id === id ? { ...u, isActive: res.data.isActive } : u));
        if (selected?.user._id === id) {
          setSelected(prev => prev ? { ...prev, user: { ...prev.user, isActive: res.data.isActive } } : null);
        }
      }
    } catch {}
    setToggling(null);
  };

  const logout = () => { localStorage.removeItem('adminToken'); navigate('/admin/login'); };

  const filtered = users.filter(u =>
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    (u.companyName || '').toLowerCase().includes(search.toLowerCase())
  );

  const topFeatures = (() => {
    const map: Record<string, number> = {};
    // We don't have global feature data here, but content stats covers key ones
    return map;
  })();

  return (
    <div className="min-h-screen bg-[#070A12] text-white">
      {/* Header */}
      <div className="border-b border-[#1E2530] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-[#ffcc29] rounded-lg flex items-center justify-center flex-shrink-0">
            <span className="text-black font-bold text-sm">N</span>
          </div>
          <div>
            <span className="text-white font-semibold">Nebulaa Admin</span>
            <span className="text-gray-500 text-xs ml-2">demo.nebulaa.ai</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadData} className="text-gray-400 hover:text-white p-2 rounded-lg hover:bg-[#1E2530] transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={logout} className="flex items-center gap-2 text-gray-400 hover:text-white text-sm px-3 py-2 rounded-lg hover:bg-[#1E2530] transition-colors">
            <LogOut className="w-4 h-4" /> Logout
          </button>
        </div>
      </div>

      <div className="p-6 max-w-screen-xl mx-auto">
        {loading ? (
          <div className="text-center text-gray-500 py-20">Loading...</div>
        ) : (
          <>
            {/* Stats Grid */}
            {overview && (
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
                <StatCard label="Total Users" value={overview.totalUsers} icon={<Users className="w-4 h-4" />} />
                <StatCard label="DAU" value={overview.dau} sub="Active today" icon={<TrendingUp className="w-4 h-4" />} accent="text-green-400" />
                <StatCard label="WAU" value={overview.wau} sub="Last 7 days" icon={<TrendingUp className="w-4 h-4" />} accent="text-blue-400" />
                <StatCard label="MAU" value={overview.mau} sub="Last 30 days" icon={<TrendingUp className="w-4 h-4" />} accent="text-purple-400" />
                <StatCard label="New Today" value={overview.newToday} icon={<UserCheck className="w-4 h-4" />} accent="text-[#ffcc29]" />
                <StatCard label="New This Week" value={overview.newThisWeek} icon={<UserCheck className="w-4 h-4" />} accent="text-[#ffcc29]" />
                <StatCard label="Active Trials" value={overview.activeTrials} icon={<Clock className="w-4 h-4" />} accent="text-green-400" />
                <StatCard label="Expiring Soon" value={overview.expiringSoon} sub="≤3 days left" icon={<AlertTriangle className="w-4 h-4" />} accent="text-orange-400" />
                <StatCard label="Expired" value={overview.expiredTrials} icon={<UserX className="w-4 h-4" />} accent="text-red-400" />
                <StatCard label="Credits Used" value={overview.totalCreditsUsed.toLocaleString()} sub="All users total" icon={<Zap className="w-4 h-4" />} accent="text-[#ffcc29]" />
                {contentStats && (
                  <>
                    <StatCard label="Posts Generated" value={contentStats.generated} icon={<BarChart2 className="w-4 h-4" />} accent="text-blue-400" />
                    <StatCard label="Publish Rate" value={`${contentStats.publishRate}%`} sub={`${contentStats.published} published`} icon={<Send className="w-4 h-4" />} accent="text-green-400" />
                  </>
                )}
              </div>
            )}

            {/* Tabs */}
            <div className="flex gap-1 mb-4 bg-[#0D1117] border border-[#1E2530] rounded-xl p-1 w-fit">
              {(['users', 'funnel', 'content'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
                    activeTab === tab ? 'bg-[#ffcc29] text-black' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  {tab === 'funnel' ? 'Trial Funnel' : tab === 'content' ? 'Content Stats' : 'Users'}
                </button>
              ))}
            </div>

            <div className="flex gap-6">
              {/* Main Panel */}
              <div className="flex-1 min-w-0">

                {/* USERS TAB */}
                {activeTab === 'users' && (
                  <div className="bg-[#0D1117] border border-[#1E2530] rounded-xl overflow-hidden">
                    <div className="p-4 border-b border-[#1E2530]">
                      <div className="relative">
                        <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          placeholder="Search by email or company..."
                          value={search}
                          onChange={e => setSearch(e.target.value)}
                          className="w-full bg-[#131920] border border-[#1E2530] rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-[#ffcc29] transition-colors"
                        />
                      </div>
                    </div>
                    <div className="overflow-auto max-h-[calc(100vh-380px)]">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-[#0D1117] border-b border-[#1E2530]">
                          <tr>
                            <th className="text-left text-gray-400 font-medium px-4 py-3">Email</th>
                            <th className="text-left text-gray-400 font-medium px-4 py-3">Company</th>
                            <th className="text-left text-gray-400 font-medium px-4 py-3">Credits</th>
                            <th className="text-left text-gray-400 font-medium px-4 py-3">Activity</th>
                            <th className="text-left text-gray-400 font-medium px-4 py-3">Trial</th>
                            <th className="text-left text-gray-400 font-medium px-4 py-3">Last Login</th>
                            <th className="text-left text-gray-400 font-medium px-4 py-3">Status</th>
                            <th className="px-4 py-3"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map(u => {
                            const trial = trialStatus(u);
                            return (
                              <tr
                                key={u._id}
                                className={`border-b border-[#1E2530]/50 hover:bg-[#131920] cursor-pointer transition-colors ${selected?.user._id === u._id ? 'bg-[#131920]' : ''}`}
                                onClick={() => openUser(u._id)}
                              >
                                <td className="px-4 py-3 text-white text-xs">{u.email}</td>
                                <td className="px-4 py-3 text-gray-300 text-xs">{u.companyName || '—'}</td>
                                <td className="px-4 py-3 text-xs">
                                  <span className="text-[#ffcc29]">{u.credits?.balance ?? '—'}</span>
                                  <span className="text-gray-500 ml-1">/ {u.credits?.totalUsed ?? 0} used</span>
                                </td>
                                <td className="px-4 py-3 text-xs">
                                  <span className={`font-medium ${u.eventTotal > 0 ? 'text-white' : 'text-gray-500'}`}>{u.eventTotal} events</span>
                                </td>
                                <td className="px-4 py-3">
                                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${trial.color}`}>{trial.label}</span>
                                </td>
                                <td className="px-4 py-3 text-gray-400 text-xs">
                                  {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : '—'}
                                </td>
                                <td className="px-4 py-3">
                                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${u.isActive ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
                                    {u.isActive ? 'Active' : 'Disabled'}
                                  </span>
                                </td>
                                <td className="px-4 py-3">
                                  <ChevronRight className="w-4 h-4 text-gray-500" />
                                </td>
                              </tr>
                            );
                          })}
                          {filtered.length === 0 && (
                            <tr><td colSpan={8} className="text-center text-gray-500 py-8 text-sm">No users found</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* TRIAL FUNNEL TAB */}
                {activeTab === 'funnel' && trialFunnel && (
                  <div className="grid grid-cols-2 gap-4">
                    {[
                      { key: 'active', label: 'Active Trials', color: 'border-green-500/30 bg-green-500/5', badge: 'text-green-400 bg-green-500/15' },
                      { key: 'expiringSoon', label: 'Expiring Soon (≤3 days)', color: 'border-orange-500/30 bg-orange-500/5', badge: 'text-orange-400 bg-orange-500/15' },
                      { key: 'expired', label: 'Expired', color: 'border-red-500/30 bg-red-500/5', badge: 'text-red-400 bg-red-500/15' },
                      { key: 'migrated', label: 'Converted to Prod', color: 'border-blue-500/30 bg-blue-500/5', badge: 'text-blue-400 bg-blue-500/15' },
                    ].map(({ key, label, color, badge }) => {
                      const list = trialFunnel[key as keyof typeof trialFunnel] as UserRow[];
                      return (
                        <div key={key} className={`border rounded-xl p-4 ${color}`}>
                          <div className="flex items-center justify-between mb-3">
                            <span className="text-white text-sm font-medium">{label}</span>
                            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${badge}`}>{list.length}</span>
                          </div>
                          <div className="space-y-2 max-h-48 overflow-auto">
                            {list.length === 0 ? (
                              <p className="text-gray-500 text-xs">None</p>
                            ) : list.map(u => (
                              <div key={u._id} className="flex items-center justify-between bg-black/20 rounded-lg px-3 py-2 cursor-pointer hover:bg-black/30" onClick={() => { setActiveTab('users'); openUser(u._id); }}>
                                <div>
                                  <p className="text-white text-xs">{u.email}</p>
                                  <p className="text-gray-500 text-xs">{u.companyName || '—'}</p>
                                </div>
                                <span className="text-gray-400 text-xs">{u.credits?.balance ?? '—'} cr</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* CONTENT STATS TAB */}
                {activeTab === 'content' && contentStats && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-4">
                      <div className="bg-[#0D1117] border border-[#1E2530] rounded-xl p-5">
                        <p className="text-gray-400 text-xs uppercase tracking-wider mb-2">Posts Generated</p>
                        <p className="text-3xl font-bold text-white">{contentStats.generated}</p>
                      </div>
                      <div className="bg-[#0D1117] border border-[#1E2530] rounded-xl p-5">
                        <p className="text-gray-400 text-xs uppercase tracking-wider mb-2">Posts Published</p>
                        <p className="text-3xl font-bold text-white">{contentStats.published}</p>
                      </div>
                      <div className="bg-[#0D1117] border border-[#1E2530] rounded-xl p-5">
                        <p className="text-gray-400 text-xs uppercase tracking-wider mb-2">Publish Rate</p>
                        <p className="text-3xl font-bold text-white">{contentStats.publishRate}%</p>
                        <div className="w-full bg-[#1E2530] rounded-full h-1.5 mt-2">
                          <div className="bg-[#ffcc29] h-1.5 rounded-full" style={{ width: `${contentStats.publishRate}%` }} />
                        </div>
                      </div>
                    </div>

                    <div className="bg-[#0D1117] border border-[#1E2530] rounded-xl p-4">
                      <p className="text-gray-400 text-xs uppercase tracking-wider mb-3">Top Generators</p>
                      {contentStats.topGenerators.length === 0 ? (
                        <p className="text-gray-500 text-sm">No data yet</p>
                      ) : (
                        <div className="space-y-2">
                          {contentStats.topGenerators.map((u, i) => (
                            <div key={i} className="flex items-center justify-between bg-[#131920] rounded-lg px-3 py-2">
                              <div>
                                <p className="text-white text-sm">{u.email}</p>
                                <p className="text-gray-500 text-xs">{u.companyName || '—'}</p>
                              </div>
                              <span className="text-[#ffcc29] font-bold">{u.count} posts</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* User Detail Panel */}
              {(selected || detailLoading) && (
                <div className="w-80 bg-[#0D1117] border border-[#1E2530] rounded-xl overflow-hidden flex-shrink-0">
                  <div className="p-4 border-b border-[#1E2530] flex items-center justify-between">
                    <span className="text-white font-medium text-sm">User Details</span>
                    <button onClick={() => setSelected(null)} className="text-gray-500 hover:text-white transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {detailLoading ? (
                    <div className="p-6 text-center text-gray-500 text-sm">Loading...</div>
                  ) : selected && (
                    <div className="p-4 overflow-auto max-h-[calc(100vh-160px)]">
                      {/* User Info */}
                      <div className="mb-4 pb-4 border-b border-[#1E2530]">
                        <p className="text-white text-sm font-medium break-all">{selected.user.email}</p>
                        <p className="text-gray-400 text-xs mt-1">{selected.user.companyName || 'No company'}</p>
                        <p className="text-gray-500 text-xs mt-1">Joined {new Date(selected.user.createdAt).toLocaleDateString()}</p>
                        {selected.user.lastLoginAt && (
                          <p className="text-gray-500 text-xs">Last login: {new Date(selected.user.lastLoginAt).toLocaleString()}</p>
                        )}

                        <div className="grid grid-cols-2 gap-2 mt-3">
                          <div className="bg-[#131920] rounded-lg px-3 py-2 text-center">
                            <p className="text-[#ffcc29] font-bold">{selected.user.credits?.balance ?? '—'}</p>
                            <p className="text-gray-500 text-xs">Balance</p>
                          </div>
                          <div className="bg-[#131920] rounded-lg px-3 py-2 text-center">
                            <p className="text-white font-bold">{selected.user.credits?.totalUsed ?? 0}</p>
                            <p className="text-gray-500 text-xs">Credits Used</p>
                          </div>
                          <div className="bg-[#131920] rounded-lg px-3 py-2 text-center">
                            <p className="text-white font-bold">{selected.generated}</p>
                            <p className="text-gray-500 text-xs">Generated</p>
                          </div>
                          <div className="bg-[#131920] rounded-lg px-3 py-2 text-center">
                            <p className="text-green-400 font-bold">{selected.publishRate}%</p>
                            <p className="text-gray-500 text-xs">Publish Rate</p>
                          </div>
                        </div>

                        {selected.user.trialDaysLeft !== null && selected.user.trialDaysLeft !== undefined && (
                          <div className="mt-3 bg-[#131920] rounded-lg px-3 py-2">
                            <div className="flex justify-between text-xs mb-1">
                              <span className="text-gray-400">Trial remaining</span>
                              <span className={selected.user.trialDaysLeft <= 3 ? 'text-orange-400' : 'text-green-400'}>{selected.user.trialDaysLeft}d</span>
                            </div>
                            <div className="w-full bg-[#1E2530] rounded-full h-1">
                              <div
                                className={`h-1 rounded-full ${selected.user.trialDaysLeft <= 3 ? 'bg-orange-400' : 'bg-green-400'}`}
                                style={{ width: `${Math.min(100, (selected.user.trialDaysLeft / 7) * 100)}%` }}
                              />
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Toggle Button */}
                      <button
                        onClick={() => toggleUser(selected.user._id)}
                        disabled={toggling === selected.user._id}
                        className={`w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-sm font-medium transition-colors mb-4 border ${
                          selected.user.isActive
                            ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25 border-red-500/30'
                            : 'bg-green-500/15 text-green-400 hover:bg-green-500/25 border-green-500/30'
                        } disabled:opacity-50`}
                      >
                        {selected.user.isActive ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                        {toggling === selected.user._id ? 'Updating...' : selected.user.isActive ? 'Disable Account' : 'Enable Account'}
                      </button>

                      {/* Feature Usage */}
                      <div>
                        <p className="text-gray-400 text-xs font-medium uppercase tracking-wider mb-3">Feature Usage</p>
                        {selected.usage.length === 0 ? (
                          <p className="text-gray-500 text-sm">No activity recorded yet</p>
                        ) : (
                          <div className="space-y-2">
                            {selected.usage.map(u => (
                              <div key={u.feature} className="bg-[#131920] rounded-lg px-3 py-2">
                                <div className="flex items-center justify-between">
                                  <p className="text-white text-xs font-medium">{u.label}</p>
                                  <span className="text-[#ffcc29] font-bold text-sm">{u.count}x</span>
                                </div>
                                <div className="flex items-center justify-between mt-1">
                                  <p className="text-gray-500 text-xs">Last: {new Date(u.lastUsed).toLocaleDateString()}</p>
                                  {u.creditsUsed > 0 && <p className="text-gray-500 text-xs">{u.creditsUsed} cr</p>}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default AdminDashboard;
