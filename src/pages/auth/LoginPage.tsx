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
    <div className="min-h-screen bg-[#F6F8FB] flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <Link to="/" className="inline-flex items-center gap-2.5 mb-2">
          <div className="flex h-11 w-11 items-center justify-center rounded-[10px] bg-[#0B1F3A] text-white shadow-subtle">
            <Shield className="h-6 w-6" />
          </div>
          <span className="text-2xl font-bold tracking-tight text-[#0B1F3A]">ENCRIX</span>
        </Link>
        <p className="text-xs text-[#64748B] font-medium">
          Your Leads. Your Data. Under Your Control.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white border border-[#DCE4EE] py-8 px-6 shadow-card rounded-[12px] sm:px-10 space-y-6">
          <div className="text-center">
            <h2 className="text-lg font-bold text-[#0B1F3A]">Sign in to your CRM workspace</h2>
            <p className="text-xs text-[#64748B] mt-1">
              Protected by PostgreSQL Row Level Security
            </p>
          </div>

          {error && (
            <div className="p-3 bg-[#FEECEB] border border-[#F8C8C6] rounded-[8px] text-xs text-[#C53030]">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-[#172B4D] block mb-1">Work Email</label>
              <div className="relative">
                <Mail className="w-4 h-4 text-[#64748B] absolute left-3 top-2.5" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-white border border-[#DCE4EE] rounded-[10px] text-xs text-[#172B4D] placeholder-[#94A3B8] shadow-subtle focus:outline-none focus:border-[#1E4D8F]"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-[#172B4D]">Password</label>
                <Link to="/forgot-password" className="text-[11px] text-[#1E4D8F] font-semibold hover:underline">
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 text-[#64748B] absolute left-3 top-2.5" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-white border border-[#DCE4EE] rounded-[10px] text-xs text-[#172B4D] placeholder-[#94A3B8] shadow-subtle focus:outline-none focus:border-[#1E4D8F]"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#0B1F3A] hover:bg-[#071A33] text-white font-semibold text-xs rounded-[10px] shadow-subtle transition-all"
            >
              <span>{isLoading ? 'Verifying...' : 'Sign In'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </form>

          {/* Quick Demo Logins for instant evaluation */}
          <div className="pt-4 border-t border-[#DCE4EE]">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[#64748B] uppercase tracking-wider mb-2.5">
              <Sparkles className="w-3.5 h-3.5 text-[#1E4D8F]" />
              <span>1-Click Evaluator Login</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleQuickLogin('owner')}
                className="p-2.5 rounded-[8px] bg-[#F6F8FB] hover:bg-[#EAF2FB] border border-[#DCE4EE] hover:border-[#1E4D8F] text-left transition-colors"
              >
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#0B1F3A]">
                  <Building className="w-3.5 h-3.5 text-[#1E4D8F]" />
                  <span>Owner</span>
                </div>
                <div className="text-[10px] text-[#64748B] truncate">Vertex Consultancy</div>
              </button>

              <button
                type="button"
                onClick={() => handleQuickLogin('telecaller')}
                className="p-2.5 rounded-[8px] bg-[#F6F8FB] hover:bg-[#EAF2FB] border border-[#DCE4EE] hover:border-[#1E4D8F] text-left transition-colors"
              >
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#0B1F3A]">
                  <Headphones className="w-3.5 h-3.5 text-[#1E4D8F]" />
                  <span>Telecaller</span>
                </div>
                <div className="text-[10px] text-[#64748B] truncate">Arjun Kumar</div>
              </button>

              <button
                type="button"
                onClick={() => handleQuickLogin('admin')}
                className="p-2.5 rounded-[8px] bg-[#F6F8FB] hover:bg-[#EAF2FB] border border-[#DCE4EE] hover:border-[#1E4D8F] text-left transition-colors"
              >
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#0B1F3A]">
                  <Server className="w-3.5 h-3.5 text-[#1E4D8F]" />
                  <span>Super Admin</span>
                </div>
                <div className="text-[10px] text-[#64748B] truncate">Platform Overview</div>
              </button>

              <button
                type="button"
                onClick={() => handleQuickLogin('prime_owner')}
                className="p-2.5 rounded-[8px] bg-[#F6F8FB] hover:bg-[#EAF2FB] border border-[#DCE4EE] hover:border-[#B7791F] text-left transition-colors"
              >
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#B7791F]">
                  <Building className="w-3.5 h-3.5 text-[#B7791F]" />
                  <span>Tenant B Owner</span>
                </div>
                <div className="text-[10px] text-[#64748B] truncate">Prime Careers</div>
              </button>
            </div>
          </div>

          <div className="text-center pt-2">
            <span className="text-xs text-[#64748B]">Need a new organization workspace? </span>
            <Link to="/register" className="text-xs text-[#1E4D8F] font-semibold hover:underline">
              Create an organization
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
