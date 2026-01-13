import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiService } from '../services/api';
import { Loader2, Zap, Check, X as XIcon, ShieldCheck, Sun, Moon } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

interface AuthProps {
  onLoginSuccess: (user: any) => void;
}

const Auth: React.FC<AuthProps> = ({ onLoginSuccess }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();

  // Form State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [companyName, setCompanyName] = useState('');

  // Password Guardrails
  const [pwdCriteria, setPwdCriteria] = useState({
      length: false,
      number: false,
      special: false,
      letter: false
  });

  useEffect(() => {
      setPwdCriteria({
          length: password.length >= 8,
          number: /\d/.test(password),
          special: /[!@#$%^&*(),.?":{}|<>]/.test(password),
          letter: /[a-zA-Z]/.test(password)
      });
  }, [password]);

  const isPasswordValid = Object.values(pwdCriteria).every(Boolean);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validation Guardrails
    if (!isLogin && !isPasswordValid) {
        setError("Please ensure your password meets all security requirements.");
        return;
    }
    if (!email.includes('@') || !email.includes('.')) {
        setError("Please enter a valid email address.");
        return;
    }

    setLoading(true);

    try {
      let response;
      if (isLogin) {
        response = await apiService.login({ email, password });
      } else {
        response = await apiService.register({ 
            email, 
            password, 
            firstName, 
            companyName 
        });
      }

      if (response.token && response.user) {
        // Token is already saved by apiService
        // If registering, store company name for onboarding
        if (!isLogin && companyName) {
          sessionStorage.setItem('nebulaa_registration_company', companyName);
        }
        onLoginSuccess(response.user);
        navigate('/dashboard');
      } else {
        setError("Authentication failed. Please try again.");
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred during authentication.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`min-h-screen flex items-center justify-center p-4 ${theme === 'dark' ? 'bg-[#070A12]' : 'bg-gray-100'}`}>
      {/* Theme Toggle Button */}
      <button
        onClick={toggleTheme}
        className={`fixed top-4 right-4 p-3 rounded-full transition-all duration-300 z-50 ${
          theme === 'dark' 
            ? 'bg-[#1a1f2e] hover:bg-[#252b3d] text-yellow-400' 
            : 'bg-white hover:bg-gray-100 text-gray-700 shadow-md'
        }`}
        title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      >
        {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
      </button>

      <div className={`rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col animate-in zoom-in-95 duration-300 ${
        theme === 'dark' 
          ? 'bg-[#0d1117] border border-slate-700/50' 
          : 'bg-white border border-gray-200'
      }`}>
        
        {/* Header */}
        <div className="bg-gradient-to-r from-[#ffcc29] to-[#e6b825] p-8 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[#070A12]/20 mb-4 backdrop-blur-sm">
                <img src="/assets/logo.png" alt="Nebulaa Gravity" className="w-12 h-12" />
            </div>
            <h1 className="text-2xl font-bold text-[#070A12] tracking-tight">Nebulaa</h1>
            <h2 className="text-xl font-bold text-[#070A12] tracking-tight">Gravity</h2>
            <p className="text-[#070A12]/80 text-sm mt-2">Marketing Agent & Growth Engine</p>
        </div>

        {/* Form */}
        <div className="p-8">
            <h2 className={`text-xl font-bold mb-6 text-center ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                {isLogin ? 'Welcome Back' : 'Create Secure Account'}
            </h2>

            {error && (
                <div className="bg-red-500/20 text-red-400 p-3 rounded-lg text-sm mb-6 border border-red-500/30 flex items-start gap-2">
                    <XIcon className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
                {!isLogin && (
                    <>
                        <div>
                            <label className={`block text-xs font-bold uppercase mb-1 ${theme === 'dark' ? 'text-[#ededed]/70' : 'text-gray-600'}`}>First Name</label>
                            <input 
                                type="text"
                                required 
                                className={`w-full px-4 py-2 border rounded-lg focus:ring-2 outline-none transition-all ${
                                  theme === 'dark'
                                    ? 'bg-[#070A12] border-[#ffcc29]/30 focus:ring-[#ffcc29]/50 focus:border-[#ffcc29] text-[#ededed] placeholder-[#ededed]/40'
                                    : 'bg-gray-50 border-gray-300 focus:ring-[#ffcc29]/50 focus:border-[#ffcc29] text-gray-900 placeholder-gray-400'
                                }`}
                                value={firstName}
                                onChange={(e) => setFirstName(e.target.value)}
                                placeholder="Jane"
                            />
                        </div>
                        <div>
                            <label className={`block text-xs font-bold uppercase mb-1 ${theme === 'dark' ? 'text-[#ededed]/70' : 'text-gray-600'}`}>Company Name</label>
                            <input 
                                type="text"
                                required 
                                className={`w-full px-4 py-2 border rounded-lg focus:ring-2 outline-none transition-all ${
                                  theme === 'dark'
                                    ? 'bg-[#070A12] border-[#ffcc29]/30 focus:ring-[#ffcc29]/50 focus:border-[#ffcc29] text-[#ededed] placeholder-[#ededed]/40'
                                    : 'bg-gray-50 border-gray-300 focus:ring-[#ffcc29]/50 focus:border-[#ffcc29] text-gray-900 placeholder-gray-400'
                                }`}
                                value={companyName}
                                onChange={(e) => setCompanyName(e.target.value)}
                                placeholder="Acme Inc."
                            />
                        </div>
                    </>
                )}

                <div>
                    <label className={`block text-xs font-bold uppercase mb-1 ${theme === 'dark' ? 'text-[#ededed]/70' : 'text-gray-600'}`}>Email Address</label>
                    <input 
                        type="email"
                        required 
                        className={`w-full px-4 py-2 border rounded-lg focus:ring-2 outline-none transition-all ${
                          theme === 'dark'
                            ? 'bg-[#070A12] border-[#ffcc29]/30 focus:ring-[#ffcc29]/50 focus:border-[#ffcc29] text-[#ededed] placeholder-[#ededed]/40'
                            : 'bg-gray-50 border-gray-300 focus:ring-[#ffcc29]/50 focus:border-[#ffcc29] text-gray-900 placeholder-gray-400'
                        }`}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@company.com"
                    />
                </div>
                
                <div>
                    <label className={`block text-xs font-bold uppercase mb-1 ${theme === 'dark' ? 'text-[#ededed]/70' : 'text-gray-600'}`}>Password</label>
                    <input 
                        type="password"
                        required 
                        className={`w-full px-4 py-2 border rounded-lg focus:ring-2 outline-none transition-all ${
                            !isLogin && !isPasswordValid && password.length > 0 
                              ? 'border-red-400/50 focus:ring-red-400/30' 
                              : theme === 'dark'
                                ? 'border-[#ffcc29]/30 focus:ring-[#ffcc29]/50 focus:border-[#ffcc29]'
                                : 'border-gray-300 focus:ring-[#ffcc29]/50 focus:border-[#ffcc29]'
                        } ${theme === 'dark' ? 'bg-[#070A12] text-[#ededed] placeholder-[#ededed]/40' : 'bg-gray-50 text-gray-900 placeholder-gray-400'}`}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                    />
                </div>

                {/* Password Strength Meter (Only for Signup) */}
                {!isLogin && (
                    <div className={`p-3 rounded-lg text-xs animate-in fade-in ${
                      theme === 'dark' 
                        ? 'bg-[#070A12] border border-slate-700/50' 
                        : 'bg-gray-50 border border-gray-200'
                    }`}>
                        <p className="font-semibold text-[#ffcc29] mb-2 flex items-center gap-1">
                            <ShieldCheck className="w-3 h-3" /> Password Requirements:
                        </p>
                        <ul className="space-y-1">
                            <CriteriaItem met={pwdCriteria.length} label="At least 8 characters" theme={theme} />
                            <CriteriaItem met={pwdCriteria.letter} label="Contains a letter" theme={theme} />
                            <CriteriaItem met={pwdCriteria.number} label="Contains a number" theme={theme} />
                            <CriteriaItem met={pwdCriteria.special} label="Contains a symbol (!@#$)" theme={theme} />
                        </ul>
                    </div>
                )}

                <button 
                    type="submit" 
                    disabled={loading || (!isLogin && !isPasswordValid)}
                    className="w-full bg-[#ffcc29] hover:bg-[#e6b825] text-[#070A12] font-bold py-3 rounded-lg transition-colors mt-6 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                    {isLogin ? 'Sign In' : 'Create Account'}
                </button>
            </form>

            <div className="mt-6 text-center">
                <p className={`text-sm ${theme === 'dark' ? 'text-[#ededed]/70' : 'text-gray-600'}`}>
                    {isLogin ? "Don't have an account? " : "Already have an account? "}
                    <button 
                        onClick={() => { setIsLogin(!isLogin); setError(null); setPassword(''); }}
                        className="text-[#ffcc29] font-semibold hover:underline focus:outline-none"
                    >
                        {isLogin ? 'Sign Up' : 'Log In'}
                    </button>
                </p>
            </div>
        </div>
      </div>
    </div>
  );
};

const CriteriaItem: React.FC<{ met: boolean; label: string; theme?: string }> = ({ met, label, theme }) => (
    <li className={`flex items-center gap-2 ${met ? 'text-green-400' : theme === 'dark' ? 'text-[#ededed]/50' : 'text-gray-500'}`}>
        {met ? <Check className="w-3 h-3" /> : <div className={`w-3 h-3 rounded-full border ${theme === 'dark' ? 'border-[#ededed]/30' : 'border-gray-400'}`} />}
        <span>{label}</span>
    </li>
);

export default Auth;