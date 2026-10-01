import React, { useState } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import {
  Shield,
  Lock,
  Mail,
  ArrowRight,
  Headphones,
  Building,
  Server,
  Sparkles,
} from 'lucide-react';

export const LoginPage: React.FC = () => {
  const { login, quickLogin } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('owner@vertex.com');
  const [password, setPassword] = useState('Password123!');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const result = await login(email, password);
    setIsLoading(false);

    if (result.success) {
      if (result.role === 'ADMIN') navigate('/admin');
      else if (result.role === 'OWNER') navigate('/owner');
      else navigate('/telecaller');
    } else {
      setError(result.error || 'Login failed');
    }
  };

  const handleQuickLogin = (type: 'owner' | 'telecaller' | 'admin' | 'prime_owner') => {
    quickLogin(type);
    if (type === 'admin') navigate('/admin');
    else if (type === 'owner' || type === 'prime_owner') navigate('/owner');
    else navigate('/telecaller');
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <Link to="/" className="inline-flex items-center gap-2.5 mb-2">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
            <Shield className="h-6 w-6" />
          </div>
          <span className="text-2xl font-bold tracking-tight text-white">LEADVAULT</span>
        </Link>
        <p className="text-xs text-slate-400">
          Your Leads. Your Data. Under Your Control.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-slate-900 border border-slate-800 py-8 px-6 shadow-2xl rounded-2xl sm:px-10 space-y-6">
          <div className="text-center">
            <h2 className="text-lg font-bold text-white">Sign in to your CRM workspace</h2>
            <p className="text-xs text-slate-400 mt-1">
              Protected by PostgreSQL Row Level Security
            </p>
          </div>

          {error && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-xs text-rose-400">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs text-slate-300 block mb-1">Work Email</label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-slate-300">Password</label>
                <Link to="/forgot-password" className="text-[11px] text-emerald-400 hover:underline">
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs rounded-lg shadow-sm transition-all"
            >
              <span>{isLoading ? 'Verifying...' : 'Sign In'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </form>

          {/* Quick Demo Logins for instant evaluation */}
          <div className="pt-4 border-t border-slate-800">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5">
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              <span>1-Click Evaluator Login</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleQuickLogin('owner')}
                className="p-2.5 rounded-lg bg-slate-950 hover:bg-slate-800/80 border border-slate-800 text-left transition-colors"
              >
                <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                  <Building className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Owner</span>
                </div>
                <div className="text-[10px] text-slate-400 truncate">Vertex Consultancy</div>
              </button>

              <button
                type="button"
                onClick={() => handleQuickLogin('telecaller')}
                className="p-2.5 rounded-lg bg-slate-950 hover:bg-slate-800/80 border border-slate-800 text-left transition-colors"
              >
                <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                  <Headphones className="w-3.5 h-3.5 text-sky-400" />
                  <span>Telecaller</span>
                </div>
                <div className="text-[10px] text-slate-400 truncate">Arjun Kumar</div>
              </button>

              <button
                type="button"
                onClick={() => handleQuickLogin('admin')}
                className="p-2.5 rounded-lg bg-slate-950 hover:bg-slate-800/80 border border-slate-800 text-left transition-colors"
              >
                <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                  <Server className="w-3.5 h-3.5 text-purple-400" />
                  <span>Super Admin</span>
                </div>
                <div className="text-[10px] text-slate-400 truncate">Platform Overview</div>
              </button>

              <button
                type="button"
                onClick={() => handleQuickLogin('prime_owner')}
                className="p-2.5 rounded-lg bg-slate-950 hover:bg-slate-800/80 border border-slate-800 text-left transition-colors"
              >
                <div className="flex items-center gap-1.5 text-xs font-bold text-amber-300">
                  <Building className="w-3.5 h-3.5 text-amber-400" />
                  <span>Tenant B Owner</span>
                </div>
                <div className="text-[10px] text-slate-400 truncate">Prime Careers</div>
              </button>
            </div>
          </div>

          <div className="text-center pt-2">
            <span className="text-xs text-slate-400">Need a new organization workspace? </span>
            <Link to="/register" className="text-xs text-emerald-400 font-semibold hover:underline">
              Create an organization
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
