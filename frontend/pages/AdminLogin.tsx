import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const BASE_URL = import.meta.env.DEV ? 'http://localhost:5000/api' : '/api';

const AdminLogin: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
      localStorage.setItem('adminToken', data.token);
      navigate('/admin');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#070A12] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="bg-[#0D1117] border border-[#1E2530] rounded-2xl p-8">
          <div className="text-center mb-8">
            <div className="w-12 h-12 bg-[#ffcc29] rounded-xl flex items-center justify-center mx-auto mb-4">
              <span className="text-black font-bold text-xl">N</span>
            </div>
            <h1 className="text-white text-2xl font-bold">Nebulaa Admin</h1>
            <p className="text-gray-400 text-sm mt-1">Founder Dashboard</p>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3 mb-6">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-gray-400 text-sm block mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="w-full bg-[#131920] border border-[#1E2530] rounded-lg px-4 py-3 text-white text-sm outline-none focus:border-[#ffcc29] transition-colors"
                placeholder="admin@nebulaa.ai"
              />
            </div>
            <div>
              <label className="text-gray-400 text-sm block mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="w-full bg-[#131920] border border-[#1E2530] rounded-lg px-4 py-3 text-white text-sm outline-none focus:border-[#ffcc29] transition-colors"
                placeholder="••••••••"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#ffcc29] text-black font-semibold rounded-lg py-3 mt-2 hover:bg-[#f5c200] transition-colors disabled:opacity-50"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default AdminLogin;
