import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, UserCheck, UserX, TrendingUp, Search, X, LogOut,
  RefreshCw, Clock, Zap, BarChart2, Send, ChevronRight,
  AlertTriangle, Activity, Calendar, Shield, Tag, Plus, Trash2, ToggleLeft
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
  mobileNumber?: string;
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
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...options.headers },
  });
  if (res.status === 401) { localStorage.removeItem('adminToken'); window.location.hash = '#/admin/login'; throw new Error('Session expired'); }
  return res.json();
};

const getTrialInfo = (user: UserRow) => {
  if (user.trial?.migratedToProd) return { label: 'Converted', cls: 'text-blue-400 bg-blue-500/10 border border-blue-500/20' };
  if (user.trial?.isExpired) return { label: 'Expired', cls: 'text-red-400 bg-red-500/10 border border-red-500/20' };
  const exp = user.trial?.expiresAt ? new Date(user.trial.expiresAt) : null;
  if (exp) {
    const d = Math.ceil((exp.getTime() - Date.now()) / 86400000);
    if (d <= 0) return { label: 'Expired', cls: 'text-red-400 bg-red-500/10 border border-red-500/20' };
    if (d <= 3) return { label: `${d}d left`, cls: 'text-orange-400 bg-orange-500/10 border border-orange-500/20' };
    return { label: `${d}d left`, cls: 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20' };
  }
  return { label: 'Active', cls: 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20' };
};

const getInitials = (email: string) => email.slice(0, 2).toUpperCase();

const avatarColor = (email: string) => {
  const colors = ['bg-violet-500', 'bg-blue-500', 'bg-emerald-500', 'bg-orange-500', 'bg-pink-500', 'bg-cyan-500', 'bg-yellow-500'];
  return colors[email.charCodeAt(0) % colors.length];
};

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
  const [activeTab, setActiveTab] = useState<'users' | 'funnel' | 'content' | 'coupons'>('users');
  const [trialFunnel, setTrialFunnel] = useState<{ active: UserRow[]; expiringSoon: UserRow[]; expired: UserRow[]; migrated: UserRow[] } | null>(null);
  const [coupons, setCoupons] = useState<any[]>([]);
  const [couponForm, setCouponForm] = useState({ code: '', discountedAmount: '5000', maxUses: '1', note: '' });
  const [couponCreating, setCouponCreating] = useState(false);
  const [resettingTrial, setResettingTrial] = useState(false);
  const [addingCredits, setAddingCredits] = useState(false);
  const [creditsToAdd, setCreditsToAdd] = useState('100');
  const [trialDaysToAdd, setTrialDaysToAdd] = useState('7');
  const [adminActionMsg, setAdminActionMsg] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [ovRes, usersRes, contentRes, funnelRes, couponsRes] = await Promise.all([
        adminFetch('/overview'), adminFetch('/users'), adminFetch('/content-stats'), adminFetch('/trial-funnel'), adminFetch('/coupons'),
      ]);
      if (ovRes.success) setOverview(ovRes.data);
      if (usersRes.success) setUsers(usersRes.data);
      if (contentRes.success) setContentStats(contentRes.data);
      if (funnelRes.success) setTrialFunnel(funnelRes.data);
      if (couponsRes.success) setCoupons(couponsRes.data);
    } catch {}
    setLoading(false);
  }, []);

  const handleResetTrial = async (userId: string) => {
    setResettingTrial(true);
    setAdminActionMsg('');
    try {
      const res = await adminFetch(`/users/${userId}/reset-trial`, { method: 'POST' });
      if (res.success) {
        setAdminActionMsg('Trial re-enabled for 30 days');
        if (selected) setSelected(prev => prev ? { ...prev, user: { ...prev.user, trial: { ...prev.user.trial, isExpired: false } } } : prev);
      }
    } catch { setAdminActionMsg('Failed to reset trial'); }
    setResettingTrial(false);
  };

  const handleAddCredits = async (userId: string) => {
    const amount = Number(creditsToAdd);
    if (!amount || amount <= 0) return;
    setAddingCredits(true);
    setAdminActionMsg('');
    try {
      const res = await adminFetch(`/users/${userId}/add-credits`, { method: 'POST', body: JSON.stringify({ amount }) });
      if (res.success) {
        setAdminActionMsg(`Added ${amount} credits. New balance: ${res.newBalance}`);
        if (selected) setSelected(prev => prev ? { ...prev, user: { ...prev.user, credits: { ...prev.user.credits, balance: res.newBalance } } } : prev);
      }
    } catch { setAdminActionMsg('Failed to add credits'); }
    setAddingCredits(false);
  };

  const createCoupon = async () => {
    if (!couponForm.code.trim()) return;
    setCouponCreating(true);
    try {
      const res = await adminFetch('/coupons', {
        method: 'POST',
        body: JSON.stringify({ code: couponForm.code, discountedAmount: Number(couponForm.discountedAmount), maxUses: Number(couponForm.maxUses), note: couponForm.note })
      });
      if (res.success) {
        setCoupons(prev => [res.data, ...prev]);
        setCouponForm({ code: '', discountedAmount: '5000', maxUses: '1', note: '' });
      }
    } catch {}
    setCouponCreating(false);
  };

  const deactivateCoupon = async (code: string) => {
    try {
      const res = await adminFetch(`/coupons/${code}/deactivate`, { method: 'PATCH' });
      if (res.success) setCoupons(prev => prev.map(c => c.code === code ? { ...c, isActive: false } : c));
    } catch {}
  };

  const deleteCoupon = async (code: string) => {
    if (!confirm(`Delete coupon ${code}?`)) return;
    try {
      await adminFetch(`/coupons/${code}`, { method: 'DELETE' });
      setCoupons(prev => prev.filter(c => c.code !== code));
    } catch {}
  };

  useEffect(() => {
    if (!localStorage.getItem('adminToken')) { navigate('/admin/login'); return; }
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
        if (selected?.user._id === id) setSelected(prev => prev ? { ...prev, user: { ...prev.user, isActive: res.data.isActive } } : null);
      }
    } catch {}
    setToggling(null);
  };

  const filtered = users.filter(u =>
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    (u.companyName || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-[#060810] text-white flex flex-col">
      {/* Topbar */}
      <header className="flex items-center justify-between px-8 py-4 border-b border-white/5 bg-[#060810]/80 backdrop-blur sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#ffcc29] flex items-center justify-center shadow-lg shadow-[#ffcc29]/20">
            <span className="text-black font-black text-sm">N</span>
          </div>
          <div>
            <p className="text-white font-semibold text-sm leading-none">Nebulaa Admin</p>
            <p className="text-white/30 text-xs mt-0.5">demo.nebulaa.ai</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadData} className="p-2 rounded-lg text-white/40 hover:text-white hover:bg-white/5 transition-all">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => { localStorage.removeItem('adminToken'); navigate('/admin/login'); }}
            className="flex items-center gap-2 text-white/40 hover:text-white text-xs px-3 py-2 rounded-lg hover:bg-white/5 transition-all">
            <LogOut className="w-3.5 h-3.5" /> Logout
          </button>
        </div>
      </header>

      <main className="flex-1 px-8 py-6 max-w-screen-2xl mx-auto w-full">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-8 h-8 border-2 border-[#ffcc29]/30 border-t-[#ffcc29] rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* Metrics Row */}
            {overview && (
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
                {/* Primary metrics */}
                <div className="col-span-2 sm:col-span-4 lg:col-span-2 bg-gradient-to-br from-[#ffcc29]/10 to-transparent border border-[#ffcc29]/20 rounded-2xl p-5">
                  <p className="text-white/50 text-xs uppercase tracking-wider mb-1">Total Users</p>
                  <p className="text-5xl font-black text-white">{overview.totalUsers}</p>
                  <div className="flex gap-4 mt-3">
                    <span className="text-xs text-white/40">+{overview.newToday} today</span>
                    <span className="text-xs text-white/40">+{overview.newThisWeek} this week</span>
                  </div>
                </div>

                <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 hover:border-emerald-500/30 transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-white/40 text-xs uppercase tracking-wider">DAU</p>
                    <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                  </div>
                  <p className="text-2xl font-bold text-white">{overview.dau}</p>
                  <p className="text-white/30 text-xs mt-1">Active today</p>
                </div>

                <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 hover:border-blue-500/30 transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-white/40 text-xs uppercase tracking-wider">WAU</p>
                    <TrendingUp className="w-3.5 h-3.5 text-blue-400" />
                  </div>
                  <p className="text-2xl font-bold text-white">{overview.wau}</p>
                  <p className="text-white/30 text-xs mt-1">Last 7 days</p>
                </div>

                <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 hover:border-violet-500/30 transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-white/40 text-xs uppercase tracking-wider">MAU</p>
                    <Activity className="w-3.5 h-3.5 text-violet-400" />
                  </div>
                  <p className="text-2xl font-bold text-white">{overview.mau}</p>
                  <p className="text-white/30 text-xs mt-1">Last 30 days</p>
                </div>

                <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 hover:border-emerald-500/30 transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-white/40 text-xs uppercase tracking-wider">Active Trials</p>
                    <Shield className="w-3.5 h-3.5 text-emerald-400" />
                  </div>
                  <p className="text-2xl font-bold text-white">{overview.activeTrials}</p>
                </div>

                <div className="bg-orange-500/5 border border-orange-500/20 rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-orange-400/70 text-xs uppercase tracking-wider">Expiring</p>
                    <AlertTriangle className="w-3.5 h-3.5 text-orange-400" />
                  </div>
                  <p className="text-2xl font-bold text-orange-300">{overview.expiringSoon}</p>
                  <p className="text-orange-400/50 text-xs mt-1">≤3 days left</p>
                </div>

                <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-red-400/70 text-xs uppercase tracking-wider">Expired</p>
                    <UserX className="w-3.5 h-3.5 text-red-400" />
                  </div>
                  <p className="text-2xl font-bold text-red-300">{overview.expiredTrials}</p>
                </div>

                <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-white/40 text-xs uppercase tracking-wider">Credits Used</p>
                    <Zap className="w-3.5 h-3.5 text-[#ffcc29]" />
                  </div>
                  <p className="text-2xl font-bold text-white">{overview.totalCreditsUsed.toLocaleString()}</p>
                  <p className="text-white/30 text-xs mt-1">All users</p>
                </div>

                {contentStats && (
                  <>
                    <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-white/40 text-xs uppercase tracking-wider">Generated</p>
                        <BarChart2 className="w-3.5 h-3.5 text-blue-400" />
                      </div>
                      <p className="text-2xl font-bold text-white">{contentStats.generated}</p>
                      <p className="text-white/30 text-xs mt-1">Posts created</p>
                    </div>
                    <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-white/40 text-xs uppercase tracking-wider">Publish Rate</p>
                        <Send className="w-3.5 h-3.5 text-emerald-400" />
                      </div>
                      <p className="text-2xl font-bold text-white">{contentStats.publishRate}%</p>
                      <div className="w-full bg-white/10 rounded-full h-1 mt-2">
                        <div className="bg-emerald-400 h-1 rounded-full transition-all" style={{ width: `${contentStats.publishRate}%` }} />
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Tabs */}
            <div className="flex gap-1 mb-5 w-fit">
              {(['users', 'funnel', 'content', 'coupons'] as const).map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={`px-5 py-2 rounded-xl text-sm font-medium transition-all ${
                    activeTab === tab
                      ? 'bg-[#ffcc29] text-black shadow-lg shadow-[#ffcc29]/20'
                      : 'text-white/40 hover:text-white hover:bg-white/5'
                  }`}>
                  {tab === 'funnel' ? 'Trial Funnel' : tab === 'content' ? 'Content Stats' : tab === 'coupons' ? 'Coupons' : 'Users'}
                </button>
              ))}
            </div>

            <div className="flex gap-5">
              {/* Main panel */}
              <div className="flex-1 min-w-0">

                {/* USERS TAB */}
                {activeTab === 'users' && (
                  <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl overflow-hidden">
                    <div className="px-5 py-4 border-b border-white/[0.06]">
                      <div className="relative">
                        <Search className="w-4 h-4 text-white/20 absolute left-3.5 top-1/2 -translate-y-1/2" />
                        <input type="text" placeholder="Search by email or company..."
                          value={search} onChange={e => setSearch(e.target.value)}
                          className="w-full bg-white/[0.04] border border-white/[0.06] rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-[#ffcc29]/40 transition-colors"
                        />
                      </div>
                    </div>

                    <div className="overflow-auto max-h-[calc(100vh-440px)]">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-white/[0.04]">
                            {['User', 'Credits', 'Activity', 'Trial', 'Last Login', 'Status', ''].map(h => (
                              <th key={h} className="text-left text-white/30 text-xs font-medium px-5 py-3 uppercase tracking-wider">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.03]">
                          {filtered.map(u => {
                            const trial = getTrialInfo(u);
                            return (
                              <tr key={u._id}
                                onClick={() => openUser(u._id)}
                                className={`hover:bg-white/[0.03] cursor-pointer transition-colors group ${selected?.user._id === u._id ? 'bg-white/[0.04]' : ''}`}>
                                <td className="px-5 py-3.5">
                                  <div className="flex items-center gap-3">
                                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${avatarColor(u.email)}`}>
                                      {getInitials(u.email)}
                                    </div>
                                    <div>
                                      <p className="text-white text-sm font-medium">{u.email}</p>
                                      <p className="text-white/30 text-xs">{u.companyName || '—'}</p>
                                    </div>
                                  </div>
                                </td>
                                <td className="px-5 py-3.5">
                                  <p className="text-[#ffcc29] text-sm font-semibold">{u.credits?.balance ?? '—'}</p>
                                  <p className="text-white/25 text-xs">{u.credits?.totalUsed ?? 0} used</p>
                                </td>
                                <td className="px-5 py-3.5">
                                  <p className={`text-sm font-medium ${u.eventTotal > 0 ? 'text-white' : 'text-white/20'}`}>{u.eventTotal}</p>
                                  <p className="text-white/25 text-xs">events</p>
                                </td>
                                <td className="px-5 py-3.5">
                                  <span className={`px-2.5 py-1 rounded-lg text-xs font-medium ${trial.cls}`}>{trial.label}</span>
                                </td>
                                <td className="px-5 py-3.5 text-white/40 text-xs">
                                  {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'}
                                </td>
                                <td className="px-5 py-3.5">
                                  <span className={`px-2.5 py-1 rounded-lg text-xs font-medium ${u.isActive ? 'text-emerald-400 bg-emerald-500/10' : 'text-red-400 bg-red-500/10'}`}>
                                    {u.isActive ? 'Active' : 'Disabled'}
                                  </span>
                                </td>
                                <td className="px-5 py-3.5">
                                  <ChevronRight className="w-4 h-4 text-white/20 group-hover:text-white/50 transition-colors" />
                                </td>
                              </tr>
                            );
                          })}
                          {filtered.length === 0 && (
                            <tr><td colSpan={7} className="text-center text-white/20 py-12 text-sm">No users found</td></tr>
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
                      { key: 'active', label: 'Active Trials', icon: <Shield className="w-4 h-4" />, gradient: 'from-emerald-500/10', border: 'border-emerald-500/20', badge: 'bg-emerald-500/20 text-emerald-400' },
                      { key: 'expiringSoon', label: 'Expiring Soon', icon: <AlertTriangle className="w-4 h-4" />, gradient: 'from-orange-500/10', border: 'border-orange-500/20', badge: 'bg-orange-500/20 text-orange-400' },
                      { key: 'expired', label: 'Expired', icon: <Clock className="w-4 h-4" />, gradient: 'from-red-500/10', border: 'border-red-500/20', badge: 'bg-red-500/20 text-red-400' },
                      { key: 'migrated', label: 'Converted to Prod', icon: <UserCheck className="w-4 h-4" />, gradient: 'from-blue-500/10', border: 'border-blue-500/20', badge: 'bg-blue-500/20 text-blue-400' },
                    ].map(({ key, label, icon, gradient, border, badge }) => {
                      const list = trialFunnel[key as keyof typeof trialFunnel] as UserRow[];
                      return (
                        <div key={key} className={`bg-gradient-to-b ${gradient} to-transparent border ${border} rounded-2xl p-5`}>
                          <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                              <span className={`${badge} p-1.5 rounded-lg`}>{icon}</span>
                              <p className="text-white text-sm font-semibold">{label}</p>
                            </div>
                            <span className={`${badge} px-2.5 py-1 rounded-lg text-sm font-bold`}>{list.length}</span>
                          </div>
                          <div className="space-y-2 max-h-52 overflow-auto">
                            {list.length === 0 ? (
                              <p className="text-white/20 text-xs text-center py-4">None</p>
                            ) : list.map(u => (
                              <div key={u._id}
                                onClick={() => { setActiveTab('users'); openUser(u._id); }}
                                className="flex items-center justify-between bg-black/20 hover:bg-black/30 rounded-xl px-3 py-2.5 cursor-pointer transition-colors">
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${avatarColor(u.email)}`}>
                                    {getInitials(u.email)}
                                  </div>
                                  <div className="min-w-0">
                                    <p className="text-white text-xs font-medium truncate">{u.email}</p>
                                    <p className="text-white/30 text-xs truncate">{u.companyName || '—'}</p>
                                  </div>
                                </div>
                                <span className="text-white/40 text-xs flex-shrink-0 ml-2">{u.credits?.balance ?? '—'} cr</span>
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
                      {[
                        { label: 'Posts Generated', value: contentStats.generated, sub: 'Total across all users', color: 'text-blue-400', bg: 'from-blue-500/10' },
                        { label: 'Posts Published', value: contentStats.published, sub: 'Actually sent to socials', color: 'text-emerald-400', bg: 'from-emerald-500/10' },
                        { label: 'Publish Rate', value: `${contentStats.publishRate}%`, sub: 'Generated → Published', color: 'text-[#ffcc29]', bg: 'from-yellow-500/10' },
                      ].map(({ label, value, sub, color, bg }) => (
                        <div key={label} className={`bg-gradient-to-b ${bg} to-transparent border border-white/[0.06] rounded-2xl p-6`}>
                          <p className="text-white/40 text-xs uppercase tracking-wider mb-3">{label}</p>
                          <p className={`text-4xl font-black ${color}`}>{value}</p>
                          <p className="text-white/30 text-xs mt-2">{sub}</p>
                          {label === 'Publish Rate' && (
                            <div className="w-full bg-white/10 rounded-full h-1.5 mt-3">
                              <div className="bg-[#ffcc29] h-1.5 rounded-full" style={{ width: `${contentStats.publishRate}%` }} />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-5">
                      <p className="text-white/40 text-xs uppercase tracking-wider mb-4">Top Generators</p>
                      {contentStats.topGenerators.length === 0 ? (
                        <p className="text-white/20 text-sm text-center py-6">No data yet — will populate as users generate posts</p>
                      ) : (
                        <div className="space-y-2">
                          {contentStats.topGenerators.map((u, i) => (
                            <div key={i} className="flex items-center gap-4 bg-white/[0.03] rounded-xl px-4 py-3">
                              <span className="text-white/20 text-sm font-bold w-5">#{i + 1}</span>
                              <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold ${avatarColor(u.email)}`}>
                                {getInitials(u.email)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-white text-sm font-medium truncate">{u.email}</p>
                                <p className="text-white/30 text-xs">{u.companyName || '—'}</p>
                              </div>
                              <span className="text-[#ffcc29] font-bold text-sm">{u.count} posts</span>
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
                <div className="w-[300px] flex-shrink-0 bg-white/[0.02] border border-white/[0.06] rounded-2xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
                    <p className="text-white font-semibold text-sm">User Details</p>
                    <button onClick={() => setSelected(null)} className="text-white/30 hover:text-white transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {detailLoading ? (
                    <div className="flex items-center justify-center h-40">
                      <div className="w-6 h-6 border-2 border-[#ffcc29]/30 border-t-[#ffcc29] rounded-full animate-spin" />
                    </div>
                  ) : selected && (
                    <div className="overflow-auto max-h-[calc(100vh-200px)]">
                      {/* Header */}
                      <div className="px-5 py-4 border-b border-white/[0.04]">
                        <div className="flex items-center gap-3 mb-3">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold ${avatarColor(selected.user.email)}`}>
                            {getInitials(selected.user.email)}
                          </div>
                          <div className="min-w-0">
                            <p className="text-white text-sm font-medium truncate">{selected.user.email}</p>
                            <p className="text-white/40 text-xs">{selected.user.companyName || 'No company'}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-white/30">
                          <Calendar className="w-3 h-3" />
                          <span>Joined {new Date(selected.user.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                        </div>
                        {selected.user.lastLoginAt && (
                          <p className="text-white/20 text-xs mt-1">Last login: {new Date(selected.user.lastLoginAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                        )}
                      </div>

                      {/* Metrics */}
                      <div className="px-5 py-4 border-b border-white/[0.04]">
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            { label: 'Balance', value: selected.user.credits?.balance ?? '—', color: 'text-[#ffcc29]' },
                            { label: 'Credits Used', value: selected.user.credits?.totalUsed ?? 0, color: 'text-white' },
                            { label: 'Generated', value: selected.generated, color: 'text-blue-400' },
                            { label: 'Publish Rate', value: `${selected.publishRate}%`, color: 'text-emerald-400' },
                          ].map(({ label, value, color }) => (
                            <div key={label} className="bg-white/[0.03] rounded-xl p-3 text-center">
                              <p className={`text-xl font-bold ${color}`}>{value}</p>
                              <p className="text-white/30 text-xs mt-0.5">{label}</p>
                            </div>
                          ))}
                        </div>

                        {selected.user.trialDaysLeft !== null && selected.user.trialDaysLeft !== undefined && (
                          <div className="mt-3 bg-white/[0.03] rounded-xl p-3">
                            <div className="flex justify-between text-xs mb-1.5">
                              <span className="text-white/40">Trial remaining</span>
                              <span className={selected.user.trialDaysLeft <= 3 ? 'text-orange-400 font-semibold' : 'text-emerald-400 font-semibold'}>
                                {selected.user.trialDaysLeft}d
                              </span>
                            </div>
                            <div className="w-full bg-white/10 rounded-full h-1.5">
                              <div
                                className={`h-1.5 rounded-full transition-all ${selected.user.trialDaysLeft <= 3 ? 'bg-orange-400' : 'bg-emerald-400'}`}
                                style={{ width: `${Math.min(100, (selected.user.trialDaysLeft / 7) * 100)}%` }}
                              />
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Mobile Number */}
                      {selected.user.mobileNumber && (
                        <div className="px-5 py-3 border-b border-white/[0.04]">
                          <p className="text-white/30 text-xs uppercase tracking-wider mb-1">Mobile</p>
                          <p className="text-white text-sm font-medium">{selected.user.mobileNumber}</p>
                        </div>
                      )}

                      {/* Admin Actions */}
                      <div className="px-5 py-4 border-b border-white/[0.04] space-y-3">
                        <p className="text-white/30 text-xs uppercase tracking-wider">Admin Actions</p>
                        {adminActionMsg && (
                          <p className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">{adminActionMsg}</p>
                        )}
                        <button
                          onClick={() => { setAdminActionMsg(''); handleResetTrial(selected.user._id); }}
                          disabled={resettingTrial}
                          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border border-blue-500/20 transition-all disabled:opacity-50"
                        >
                          {resettingTrial ? 'Resetting...' : '↺ Re-enable Trial'}
                        </button>
                        <div className="flex gap-2">
                          <input
                            type="number"
                            value={creditsToAdd}
                            onChange={e => setCreditsToAdd(e.target.value)}
                            className="flex-1 bg-white/[0.05] border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-[#ffcc29]/50"
                            placeholder="Credits"
                            min="1"
                          />
                          <button
                            onClick={() => { setAdminActionMsg(''); handleAddCredits(selected.user._id); }}
                            disabled={addingCredits}
                            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold bg-[#ffcc29]/10 text-[#ffcc29] hover:bg-[#ffcc29]/20 border border-[#ffcc29]/20 transition-all disabled:opacity-50"
                          >
                            {addingCredits ? 'Adding...' : '+ Add Credits'}
                          </button>
                        </div>
                      </div>

                      {/* Toggle */}
                      <div className="px-5 py-3 border-b border-white/[0.04]">
                        <button onClick={() => toggleUser(selected.user._id)} disabled={toggling === selected.user._id}
                          className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50 ${
                            selected.user.isActive
                              ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20'
                              : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20'
                          }`}>
                          {selected.user.isActive ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                          {toggling === selected.user._id ? 'Updating...' : selected.user.isActive ? 'Disable Account' : 'Enable Account'}
                        </button>
                      </div>

                      {/* Feature Usage */}
                      <div className="px-5 py-4">
                        <p className="text-white/30 text-xs uppercase tracking-wider mb-3">Feature Usage</p>
                        {selected.usage.length === 0 ? (
                          <p className="text-white/20 text-sm text-center py-6">No activity yet</p>
                        ) : (
                          <div className="space-y-2">
                            {selected.usage.map(u => (
                              <div key={u.feature} className="bg-white/[0.03] rounded-xl px-3 py-2.5">
                                <div className="flex items-center justify-between">
                                  <p className="text-white text-xs font-medium">{u.label}</p>
                                  <span className="text-[#ffcc29] font-bold text-sm">{u.count}×</span>
                                </div>
                                <div className="flex items-center justify-between mt-1">
                                  <p className="text-white/25 text-xs">{new Date(u.lastUsed).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</p>
                                  {u.creditsUsed > 0 && <p className="text-white/25 text-xs">{u.creditsUsed} cr</p>}
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

            {/* COUPONS TAB */}
            {activeTab === 'coupons' && (
              <div className="max-w-2xl space-y-5">
                {/* Create form */}
                <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-5">
                  <p className="text-white/50 text-xs uppercase tracking-wider mb-4 flex items-center gap-2"><Tag className="w-3.5 h-3.5" /> Create Coupon</p>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="text-white/30 text-xs mb-1 block">Code</label>
                      <input type="text" placeholder="e.g. BOBBY50" value={couponForm.code}
                        onChange={e => setCouponForm(p => ({ ...p, code: e.target.value.toUpperCase() }))}
                        className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-white placeholder-white/20 outline-none focus:border-[#ffcc29]/40 transition-colors font-mono" />
                    </div>
                    <div>
                      <label className="text-white/30 text-xs mb-1 block">Discounted Price (₹)</label>
                      <input type="number" value={couponForm.discountedAmount}
                        onChange={e => setCouponForm(p => ({ ...p, discountedAmount: e.target.value }))}
                        className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-[#ffcc29]/40 transition-colors" />
                    </div>
                    <div>
                      <label className="text-white/30 text-xs mb-1 block">Max Uses</label>
                      <input type="number" value={couponForm.maxUses}
                        onChange={e => setCouponForm(p => ({ ...p, maxUses: e.target.value }))}
                        className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-[#ffcc29]/40 transition-colors" />
                    </div>
                    <div>
                      <label className="text-white/30 text-xs mb-1 block">Note (optional)</label>
                      <input type="text" placeholder="e.g. For Bobby" value={couponForm.note}
                        onChange={e => setCouponForm(p => ({ ...p, note: e.target.value }))}
                        className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-white placeholder-white/20 outline-none focus:border-[#ffcc29]/40 transition-colors" />
                    </div>
                  </div>
                  <button onClick={createCoupon} disabled={couponCreating || !couponForm.code.trim()}
                    className="flex items-center gap-2 px-4 py-2 bg-[#ffcc29] hover:bg-[#e6b825] text-black text-sm font-semibold rounded-xl disabled:opacity-40 transition-all">
                    <Plus className="w-4 h-4" /> {couponCreating ? 'Creating...' : 'Create Coupon'}
                  </button>
                </div>

                {/* Coupons list */}
                <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl overflow-hidden">
                  <div className="px-5 py-3 border-b border-white/[0.06]">
                    <p className="text-white/50 text-xs uppercase tracking-wider">All Coupons ({coupons.length})</p>
                  </div>
                  {coupons.length === 0 ? (
                    <p className="text-white/20 text-sm text-center py-10">No coupons yet</p>
                  ) : (
                    <div className="divide-y divide-white/[0.04]">
                      {coupons.map(c => (
                        <div key={c.code} className="px-5 py-3.5 flex items-center justify-between gap-4">
                          <div className="flex items-center gap-3">
                            <span className={`font-mono font-bold text-sm px-2.5 py-1 rounded-lg ${c.isActive ? 'text-[#ffcc29] bg-[#ffcc29]/10' : 'text-white/20 bg-white/5 line-through'}`}>{c.code}</span>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-white text-sm font-semibold">₹{c.discountedAmount.toLocaleString('en-IN')}</span>
                                <span className="text-white/30 text-xs line-through">₹{c.originalAmount.toLocaleString('en-IN')}</span>
                                <span className="text-emerald-400 text-xs">-₹{(c.originalAmount - c.discountedAmount).toLocaleString('en-IN')}</span>
                              </div>
                              <div className="flex items-center gap-3 mt-0.5">
                                <span className="text-white/30 text-xs">{c.usedCount}/{c.maxUses} uses</span>
                                {c.note && <span className="text-white/25 text-xs italic">{c.note}</span>}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {c.isActive && (
                              <button onClick={() => deactivateCoupon(c.code)} title="Deactivate"
                                className="p-1.5 rounded-lg text-white/30 hover:text-orange-400 hover:bg-orange-400/10 transition-all">
                                <ToggleLeft className="w-4 h-4" />
                              </button>
                            )}
                            <button onClick={() => deleteCoupon(c.code)} title="Delete"
                              className="p-1.5 rounded-lg text-white/30 hover:text-red-400 hover:bg-red-400/10 transition-all">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
};

export default AdminDashboard;
