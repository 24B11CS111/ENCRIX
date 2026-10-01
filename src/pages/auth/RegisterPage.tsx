import React, { useState } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import { Shield, Building, User, Mail, Phone, Lock, ArrowRight } from 'lucide-react';

export const RegisterPage: React.FC = () => {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [companyName, setCompanyName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [industry, setIndustry] = useState('Education Consultancy');
  const [companySize, setCompanySize] = useState('1-10');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const result = await register({
      companyName,
      ownerName,
      email,
      phone,
      industry,
      companySize,
    });

    setIsLoading(false);
    if (result.success) {
      navigate('/owner');
    } else {
      setError(result.error || 'Registration failed');
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans">
      <div className="sm:mx-auto sm:w-full sm:max-w-lg text-center">
        <Link to="/" className="inline-flex items-center gap-2.5 mb-2">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
            <Shield className="h-6 w-6" />
          </div>
          <span className="text-2xl font-bold tracking-tight text-white">LEADVAULT</span>
        </Link>
        <p className="text-xs text-slate-400">
          Create an enterprise workspace for your organization.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-lg">
        <div className="bg-slate-900 border border-slate-800 py-8 px-6 shadow-2xl rounded-2xl sm:px-10 space-y-6">
          <div className="text-center">
            <h2 className="text-lg font-bold text-white">Organization Onboarding</h2>
            <p className="text-xs text-slate-400 mt-1">
              Your leads will be isolated in a dedicated tenant database schema.
            </p>
          </div>

          {error && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-xs text-rose-400">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-slate-300 block mb-1">Company / Business Name</label>
                <div className="relative">
                  <Building className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    required
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="e.g. Apex Edutech"
                    className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-slate-300 block mb-1">Owner / Director Name</label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    required
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    placeholder="e.g. Sameer Kapoor"
                    className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-slate-300 block mb-1">Work Email</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="owner@apexedutech.com"
                    className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-slate-300 block mb-1">Direct Phone</label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91 98000 12345"
                    className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-slate-300 block mb-1">Industry</label>
                <select
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-emerald-500"
                >
                  <option value="Education Consultancy">Education Consultancy</option>
                  <option value="Real Estate">Real Estate</option>
                  <option value="Recruitment Agency">Recruitment Agency</option>
                  <option value="Insurance Agency">Insurance Agency</option>
                  <option value="Marketing Agency">Marketing Agency</option>
                  <option value="Financial Services">Financial Services</option>
                </select>
              </div>

              <div>
                <label className="text-slate-300 block mb-1">Team Size</label>
                <select
                  value={companySize}
                  onChange={(e) => setCompanySize(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-emerald-500"
                >
                  <option value="1-10">1-10 Telecallers</option>
                  <option value="11-50">11-50 Telecallers</option>
                  <option value="51-200">51-200 Telecallers</option>
                  <option value="200+">200+ Telecallers</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-slate-300 block mb-1">Account Master Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs rounded-lg shadow-sm transition-all mt-2"
            >
              <span>{isLoading ? 'Creating Tenant Workspace...' : 'Complete Onboarding & Launch Dashboard'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </form>

          <div className="text-center pt-2">
            <span className="text-xs text-slate-400">Already registered? </span>
            <Link to="/login" className="text-xs text-emerald-400 font-semibold hover:underline">
              Log in here
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
