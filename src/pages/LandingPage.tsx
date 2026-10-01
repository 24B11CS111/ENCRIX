import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthContext';
import {
  Shield,
  Lock,
  Headphones,
  CheckCircle2,
  XCircle,
  Database,
  ArrowRight,
  TrendingUp,
  PhoneCall,
  Sparkles,
  Building,
  UserCheck,
  EyeOff,
  AlertTriangle,
  Play,
  FileSpreadsheet,
  ChevronDown,
} from 'lucide-react';

export const LandingPage: React.FC = () => {
  const { quickLogin } = useAuth();
  const navigate = useNavigate();

  const handleLaunchDemo = (role: 'owner' | 'telecaller' | 'admin') => {
    quickLogin(role);
    if (role === 'owner') navigate('/owner');
    else if (role === 'telecaller') navigate('/telecaller');
    else navigate('/admin');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-emerald-500/30 selection:text-emerald-200">
      {/* Top Navbar */}
      <nav className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/80 backdrop-blur-md px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <span className="text-lg font-bold tracking-tight text-white">LEADVAULT</span>
              <span className="hidden sm:inline-block ml-2 text-[10px] text-emerald-400 bg-emerald-950/80 border border-emerald-500/30 px-2 py-0.5 rounded-full font-medium">
                Enterprise Telecaller CRM
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => handleLaunchDemo('owner')}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 hover:border-emerald-500/50 text-xs font-semibold text-emerald-400 transition-all"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Instant Live Demo</span>
            </button>

            <Link
              to="/login"
              className="px-3.5 py-1.5 text-xs font-semibold text-slate-300 hover:text-white transition-colors"
            >
              Sign In
            </Link>

            <Link
              to="/register"
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg shadow-sm transition-all"
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* HERO SECTION (Section 47) */}
      <section className="relative pt-20 pb-20 px-6 overflow-hidden">
        {/* Ambient glow effects */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] bg-emerald-500/10 blur-[120px] rounded-full pointer-events-none" />

        <div className="max-w-4xl mx-auto text-center relative z-10 space-y-6">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-900 border border-slate-800 text-xs text-slate-300">
            <Shield className="w-3.5 h-3.5 text-emerald-400" />
            <span className="font-semibold text-white">Zero-Leakage Architecture</span>
            <span className="text-slate-500">•</span>
            <span className="text-emerald-400">PostgreSQL RLS Protected</span>
          </div>

          <h1 className="text-4xl sm:text-6xl font-extrabold text-white tracking-tight leading-[1.1]">
            STOP LOSING CONTROL OF YOUR <span className="text-emerald-400">LEAD DATA.</span>
          </h1>

          <p className="text-base sm:text-lg text-slate-400 max-w-2xl mx-auto leading-relaxed">
            A secure workspace for managing leads, telecallers, calls, follow-ups, and customer interactions — without handing your entire database to every caller.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3.5 pt-4">
            <Link
              to="/register"
              className="w-full sm:w-auto px-7 py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm rounded-xl shadow-lg shadow-emerald-950/60 transition-all hover:scale-105"
            >
              START PROTECTING YOUR LEADS
            </Link>

            <button
              onClick={() => handleLaunchDemo('owner')}
              className="w-full sm:w-auto px-7 py-3.5 bg-slate-900 hover:bg-slate-800 text-slate-200 hover:text-white font-semibold text-sm rounded-xl border border-slate-700 transition-all flex items-center justify-center gap-2"
            >
              <Play className="w-4 h-4 text-emerald-400 fill-current" />
              <span>VIEW LIVE DEMO</span>
            </button>
          </div>

          {/* Quick Demo Persona Badges */}
          <div className="pt-6 flex flex-wrap items-center justify-center gap-2 text-xs text-slate-400">
            <span>Explore with pre-seeded data:</span>
            <button
              onClick={() => handleLaunchDemo('owner')}
              className="px-2.5 py-1 rounded bg-slate-900 border border-slate-800 hover:border-emerald-500 text-slate-300 hover:text-white font-medium transition-colors"
            >
              👑 Owner Workspace
            </button>
            <button
              onClick={() => handleLaunchDemo('telecaller')}
              className="px-2.5 py-1 rounded bg-slate-900 border border-slate-800 hover:border-sky-500 text-slate-300 hover:text-white font-medium transition-colors"
            >
              🎧 Telecaller (Masked)
            </button>
            <button
              onClick={() => handleLaunchDemo('admin')}
              className="px-2.5 py-1 rounded bg-slate-900 border border-slate-800 hover:border-purple-500 text-slate-300 hover:text-white font-medium transition-colors"
            >
              🛡️ Super Admin
            </button>
          </div>
        </div>
      </section>

      {/* SECTION: PROBLEM VS SOLUTION (Section 48) */}
      <section className="py-20 px-6 border-t border-slate-900 bg-slate-950/40">
        <div className="max-w-6xl mx-auto space-y-12">
          <div className="text-center max-w-2xl mx-auto space-y-2">
            <h2 className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
              The Critical Security Void
            </h2>
            <h3 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
              Handing Raw Spreadsheets to Callers Destroys Business Value
            </h3>
            <p className="text-xs text-slate-400">
              When customer databases are shared via Excel sheets or WhatsApp, your most valuable asset is completely exposed.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* The Old Way */}
            <div className="p-8 rounded-2xl bg-rose-950/10 border border-rose-500/20 space-y-5">
              <div className="flex items-center gap-2 text-rose-400 font-bold text-sm">
                <XCircle className="w-5 h-5" />
                <span>The Traditional Uncontrolled Danger</span>
              </div>
              <ul className="space-y-3 text-xs text-slate-300">
                <li className="flex items-start gap-2.5">
                  <XCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                  <span>Callers download entire customer databases to personal mobile phones.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <XCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                  <span>Leads forwarded, resold to competitors, or shared through personal WhatsApp.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <XCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                  <span>Zero accountability: owners don't know who called, when, or what was discussed.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <XCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                  <span>Severe regulatory exposure under customer privacy and data protection statutes.</span>
                </li>
              </ul>
            </div>

            {/* The LeadVault Way */}
            <div className="p-8 rounded-2xl bg-emerald-950/15 border border-emerald-500/30 space-y-5 shadow-xl">
              <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                <CheckCircle2 className="w-5 h-5" />
                <span>The LeadVault Governed Architecture</span>
              </div>
              <ul className="space-y-3 text-xs text-slate-200">
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span><strong>Zero Raw Access:</strong> Telecallers see only their authorized assigned leads.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span><strong>Data Masking Shield:</strong> Surnames and phone numbers (+91 ******3210) are masked at the API layer.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span><strong>Authorized Telephony Bridge:</strong> Dialing occurs via secure gateway with compliance recording.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span><strong>Realtime Owner Visibility:</strong> Every call, duration, outcome, and follow-up streams to owner in real time.</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION: HOW IT WORKS (Section 48) */}
      <section className="py-20 px-6">
        <div className="max-w-6xl mx-auto space-y-12">
          <div className="text-center max-w-2xl mx-auto space-y-2">
            <h2 className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
              Controlled Lifecycle
            </h2>
            <h3 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
              How LeadVault Works Step-by-Step
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold flex items-center justify-center text-sm">
                1
              </div>
              <h4 className="text-sm font-bold text-white">Owner Ingests Leads</h4>
              <p className="text-xs text-slate-400">
                Upload CSV or Excel files. Automated column mapping checks phone syntax and filters duplicate records.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
              <div className="w-9 h-9 rounded-xl bg-sky-500/10 border border-sky-500/30 text-sky-400 font-bold flex items-center justify-center text-sm">
                2
              </div>
              <h4 className="text-sm font-bold text-white">Distribute Queue</h4>
              <p className="text-xs text-slate-400">
                Distribute leads evenly across active telecallers with automatic round-robin or targeted assignment.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
              <div className="w-9 h-9 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-400 font-bold flex items-center justify-center text-sm">
                3
              </div>
              <h4 className="text-sm font-bold text-white">Secure Calling</h4>
              <p className="text-xs text-slate-400">
                Telecallers open masked cards and place calls via authorized gateway. Numbers remain hidden from screen scraping.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
              <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 font-bold flex items-center justify-center text-sm">
                4
              </div>
              <h4 className="text-sm font-bold text-white">Instant Accountability</h4>
              <p className="text-xs text-slate-400">
                Call outcomes, follow-up dates, and recordings stream immediately to the owner dashboard in real time.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION: USE CASES (Section 48) */}
      <section className="py-20 px-6 border-t border-slate-900 bg-slate-950/40">
        <div className="max-w-6xl mx-auto space-y-12">
          <div className="text-center max-w-2xl mx-auto space-y-2">
            <h2 className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
              Tailored For High-Trust Industries
            </h2>
            <h3 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
              Engineered For Businesses That Cannot Afford Lead Theft
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                title: 'Education Consultancies',
                desc: 'Study abroad agencies handling student records, IELTS details, and visa documents.',
              },
              {
                title: 'Real Estate Companies',
                desc: 'Property brokers protecting high-net-worth investor contact lists from competitor poaching.',
              },
              {
                title: 'Recruitment & Staffing',
                desc: 'Headhunters ensuring candidate portfolios and hiring manager contacts stay inside the firm.',
              },
              {
                title: 'Insurance Agencies',
                desc: 'Brokers managing confidential client policy renewals, medical details and quotes.',
              },
              {
                title: 'Marketing Agencies',
                desc: 'Digital agencies running paid ad campaigns generating thousands of hot prospect inquiries.',
              },
              {
                title: 'Financial & Wealth Firms',
                desc: 'Advisors requiring complete audit trails, call recordings, and least-privilege access rules.',
              },
            ].map((uc, i) => (
              <div key={i} className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-2">
                <Building className="w-5 h-5 text-emerald-400 mb-2" />
                <h4 className="text-sm font-bold text-white">{uc.title}</h4>
                <p className="text-xs text-slate-400">{uc.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION: FAQ (Section 48) */}
      <section className="py-20 px-6">
        <div className="max-w-4xl mx-auto space-y-10">
          <div className="text-center space-y-2">
            <h2 className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
              Frequently Asked Questions
            </h2>
            <h3 className="text-2xl font-bold text-white tracking-tight">
              Everything You Need to Know About LeadVault Security
            </h3>
          </div>

          <div className="space-y-4 text-xs">
            <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
              <h4 className="text-sm font-bold text-white">Can telecallers download or export the lead list?</h4>
              <p className="text-slate-400 leading-relaxed">
                No. Export functionality is completely disabled and blocked at the PostgreSQL database policy layer for telecallers. Any attempt to query bulk unmasked data is blocked and immediately raises a high-severity security alert.
              </p>
            </div>

            <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
              <h4 className="text-sm font-bold text-white">How does data masking work?</h4>
              <p className="text-slate-400 leading-relaxed">
                Data masking is enforced at the data-access layer before reaching the UI. Surnames and phone numbers are converted to formats like "Rahul K." and "+91 ******3210". When an authorized call is placed, the secure telephony bridge resolves the actual destination server-side.
              </p>
            </div>

            <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
              <h4 className="text-sm font-bold text-white">How is multi-tenant organization isolation enforced?</h4>
              <p className="text-slate-400 leading-relaxed">
                LeadVault implements PostgreSQL Row Level Security (RLS). Every query automatically incorporates tenant validation. Organization A can never physically access Organization B records, regardless of frontend inputs.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* FINAL CTA SECTION (Section 48) */}
      <section className="py-20 px-6 border-t border-slate-900 bg-slate-950">
        <div className="max-w-4xl mx-auto text-center space-y-6">
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
            Take Control of Your Lead Operations Today
          </h2>
          <p className="text-sm text-slate-400 max-w-xl mx-auto">
            Stop lead theft. Eliminate spreadsheet leakages. Give your telecallers a focused, high-productivity workspace with complete owner accountability.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              to="/register"
              className="px-8 py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-emerald-950/50 transition-all hover:scale-105"
            >
              START PROTECTING YOUR LEADS
            </Link>
            <button
              onClick={() => handleLaunchDemo('owner')}
              className="px-8 py-3.5 bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-semibold rounded-xl border border-slate-700 transition-colors"
            >
              TRY WITH DEMO DATA
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-900 py-8 px-6 text-center text-xs text-slate-500">
        <p>© 2026 LEADVAULT Technologies. Master Production Specification. Built with Supabase PostgreSQL, RLS, and React.</p>
      </footer>
    </div>
  );
};
