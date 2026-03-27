import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, UserCheck, UserX, TrendingUp, Search, X, ChevronRight, LogOut, RefreshCw } from 'lucide-react';

const BASE_URL = import.meta.env.DEV ? 'http://localhost:5000/api' : '/api';

interface UserRow {
  _id: string;
  email: string;
  companyName?: string;
  isActive: boolean;
  createdAt: string;
  credits?: { balance: number; totalUsed: number };
}

interface FeatureUsage {
  feature: string;
  label: string;
  count: number;
  lastUsed: string;
}

interface UserDetail {
  user: UserRow;
  usage: FeatureUsage[];
}

interface Stats {
  total: number;
  today: number;
  thisWeek: number;
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

const AdminDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<UserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, usersRes] = await Promise.all([
        adminFetch('/stats'),
        adminFetch('/users'),
      ]);
      if (statsRes.success) setStats(statsRes.data);
      if (usersRes.success) setUsers(usersRes.data);
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

  const logout = () => {
    localStorage.removeItem('adminToken');
    navigate('/admin/login');
  };

  const filtered = users.filter(u =>
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    (u.companyName || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-[#070A12] text-white">
      {/* Header */}
      <div className="border-b border-[#1E2530] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-[#ffcc29] rounded-lg flex items-center justify-center">
            <span className="text-black font-bold text-sm">N</span>
          </div>
          <div>
            <span className="text-white font-semibold">Nebulaa Admin</span>
            <span className="text-gray-500 text-xs ml-2">demo.nebulaa.ai</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={loadData} className="text-gray-400 hover:text-white transition-colors p-2 rounded-lg hover:bg-[#1E2530]">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={logout} className="flex items-center gap-2 text-gray-400 hover:text-white text-sm transition-colors px-3 py-2 rounded-lg hover:bg-[#1E2530]">
            <LogOut className="w-4 h-4" /> Logout
          </button>
        </div>
      </div>

      <div className="p-6 max-w-7xl mx-auto">
        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-[#0D1117] border border-[#1E2530] rounded-xl p-5">
              <div className="flex items-center gap-3 mb-2">
                <Users className="w-5 h-5 text-[#ffcc29]" />
                <span className="text-gray-400 text-sm">Total Users</span>
              </div>
              <p className="text-3xl font-bold text-white">{stats.total}</p>
            </div>
            <div className="bg-[#0D1117] border border-[#1E2530] rounded-xl p-5">
              <div className="flex items-center gap-3 mb-2">
                <TrendingUp className="w-5 h-5 text-green-400" />
                <span className="text-gray-400 text-sm">New Today</span>
              </div>
              <p className="text-3xl font-bold text-white">{stats.today}</p>
            </div>
            <div className="bg-[#0D1117] border border-[#1E2530] rounded-xl p-5">
              <div className="flex items-center gap-3 mb-2">
                <TrendingUp className="w-5 h-5 text-blue-400" />
                <span className="text-gray-400 text-sm">New This Week</span>
              </div>
              <p className="text-3xl font-bold text-white">{stats.thisWeek}</p>
            </div>
          </div>
        )}

        <div className="flex gap-6">
          {/* User List */}
          <div className="flex-1 bg-[#0D1117] border border-[#1E2530] rounded-xl overflow-hidden">
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

            {loading ? (
              <div className="p-8 text-center text-gray-500 text-sm">Loading users...</div>
            ) : (
              <div className="overflow-auto max-h-[calc(100vh-280px)]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-[#0D1117] border-b border-[#1E2530]">
                    <tr>
                      <th className="text-left text-gray-400 font-medium px-4 py-3">Email</th>
                      <th className="text-left text-gray-400 font-medium px-4 py-3">Company</th>
                      <th className="text-left text-gray-400 font-medium px-4 py-3">Credits</th>
                      <th className="text-left text-gray-400 font-medium px-4 py-3">Joined</th>
                      <th className="text-left text-gray-400 font-medium px-4 py-3">Status</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(u => (
                      <tr
                        key={u._id}
                        className={`border-b border-[#1E2530]/50 hover:bg-[#131920] cursor-pointer transition-colors ${selected?.user._id === u._id ? 'bg-[#131920]' : ''}`}
                        onClick={() => openUser(u._id)}
                      >
                        <td className="px-4 py-3 text-white">{u.email}</td>
                        <td className="px-4 py-3 text-gray-300">{u.companyName || '—'}</td>
                        <td className="px-4 py-3 text-gray-300">{u.credits?.balance ?? '—'}</td>
                        <td className="px-4 py-3 text-gray-400">{new Date(u.createdAt).toLocaleDateString()}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${u.isActive ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
                            {u.isActive ? 'Active' : 'Disabled'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <ChevronRight className="w-4 h-4 text-gray-500" />
                        </td>
                      </tr>
                    ))}
                    {filtered.length === 0 && (
                      <tr><td colSpan={6} className="text-center text-gray-500 py-8">No users found</td></tr>
                    )}
                  </tbody>
                </table>
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
                <div className="p-4 overflow-auto max-h-[calc(100vh-200px)]">
                  {/* User Info */}
                  <div className="mb-4">
                    <p className="text-white text-sm font-medium break-all">{selected.user.email}</p>
                    <p className="text-gray-400 text-xs mt-1">{selected.user.companyName || 'No company'}</p>
                    <p className="text-gray-500 text-xs mt-1">Joined {new Date(selected.user.createdAt).toLocaleDateString()}</p>
                    {selected.user.credits && (
                      <div className="flex gap-4 mt-2">
                        <span className="text-xs text-gray-400">Balance: <span className="text-[#ffcc29]">{selected.user.credits.balance}</span></span>
                        <span className="text-xs text-gray-400">Used: <span className="text-white">{selected.user.credits.totalUsed}</span></span>
                      </div>
                    )}
                  </div>

                  {/* Toggle Button */}
                  <button
                    onClick={() => toggleUser(selected.user._id)}
                    disabled={toggling === selected.user._id}
                    className={`w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-sm font-medium transition-colors mb-5 ${
                      selected.user.isActive
                        ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25 border border-red-500/30'
                        : 'bg-green-500/15 text-green-400 hover:bg-green-500/25 border border-green-500/30'
                    } disabled:opacity-50`}
                  >
                    {selected.user.isActive ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                    {toggling === selected.user._id
                      ? 'Updating...'
                      : selected.user.isActive ? 'Disable Account' : 'Enable Account'}
                  </button>

                  {/* Feature Usage */}
                  <div>
                    <p className="text-gray-400 text-xs font-medium uppercase tracking-wider mb-3">Feature Usage</p>
                    {selected.usage.length === 0 ? (
                      <p className="text-gray-500 text-sm">No activity recorded yet</p>
                    ) : (
                      <div className="space-y-2">
                        {selected.usage.map(u => (
                          <div key={u.feature} className="flex items-center justify-between bg-[#131920] rounded-lg px-3 py-2">
                            <div>
                              <p className="text-white text-xs font-medium">{u.label}</p>
                              <p className="text-gray-500 text-xs">Last: {new Date(u.lastUsed).toLocaleDateString()}</p>
                            </div>
                            <span className="text-[#ffcc29] font-bold text-sm">{u.count}</span>
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
      </div>
    </div>
  );
};

export default AdminDashboard;
