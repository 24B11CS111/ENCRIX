import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthContext';
import {
  Shield,
  PhoneCall,
  UserCheck,
  EyeOff,
  Activity,
  BarChart3,
  Building,
  CheckCircle2,
  XCircle,
  Play,
  ArrowRight,
  Headphones,
  Upload,
} from 'lucide-react';

export const LandingPage: React.FC = () => {
  const { quickLogin, isDemoMode } = useAuth();
  const navigate = useNavigate();

  const handleLaunchDemo = (role: 'owner' | 'telecaller' | 'admin') => {
    if (!isDemoMode) {
      navigate('/login');
      return;
    }
    quickLogin(role);
    if (role === 'owner') navigate('/owner');
    else if (role === 'telecaller') navigate('/telecaller');
    else navigate('/admin');
  };

  return (
    <div className="min-h-screen bg-[#F6F8FB] text-[#172B4D] font-sans selection:bg-[#EAF2FB] selection:text-[#0B1F3A]">
      {/* Top Navbar */}
      <nav className="sticky top-0 z-40 border-b border-[#DCE4EE] bg-white/95 backdrop-blur-md px-6 py-4 shadow-subtle">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-[#0B1F3A] text-white shadow-subtle">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl font-bold tracking-tight text-[#0B1F3A]">ENCRIX</span>
                <span className="text-[10px] text-[#1E4D8F] bg-[#EAF2FB] border border-[#C7DCF3] px-2 py-0.5 rounded-[6px] font-semibold">
                  Enterprise CRM
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {isDemoMode && (
              <button
                onClick={() => handleLaunchDemo('owner')}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] bg-white border border-[#DCE4EE] hover:border-[#1E4D8F] text-xs font-semibold text-[#0B1F3A] transition-all shadow-subtle"
              >
                <Play className="w-3.5 h-3.5 fill-[#1E4D8F] text-[#1E4D8F]" />
                <span>Instant Live Demo</span>
              </button>
            )}

            <Link
              to="/login"
              className="px-4 py-2 text-xs font-semibold text-[#172B4D] hover:text-[#0B1F3A] transition-colors"
            >
              Sign In
            </Link>

            <Link
              to="/register"
              className="px-4 py-2 bg-[#0B1F3A] hover:bg-[#071A33] text-white text-xs font-semibold rounded-[10px] shadow-subtle transition-all"
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* HERO SECTION */}
      <section className="relative pt-20 pb-16 px-6 bg-white border-b border-[#DCE4EE]">
        <div className="max-w-4xl mx-auto text-center space-y-6">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#EAF2FB] border border-[#C7DCF3] text-xs text-[#1E4D8F] font-medium">
            <span className="w-2 h-2 rounded-full bg-[#16845B]" />
            <span className="font-semibold text-[#0B1F3A]">Enterprise Security Architecture</span>
            <span className="text-[#94A3B8]">•</span>
            <span>PostgreSQL RLS Protected</span>
          </div>

          <h1 className="text-4xl sm:text-6xl font-extrabold text-[#0B1F3A] tracking-tight leading-[1.1]">
            YOUR LEADS. <br />
            <span className="text-[#1E4D8F]">YOUR CONTROL.</span>
          </h1>

          <p className="text-lg sm:text-xl font-medium text-[#172B4D] max-w-2xl mx-auto">
            Secure lead operations for businesses that depend on telecalling.
          </p>

          <p className="text-sm sm:text-base text-[#64748B] max-w-2xl mx-auto leading-relaxed">
            ENCRIX helps businesses control lead access, secure calling workflows, track activity and reduce uncontrolled handling of customer data.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3.5 pt-2">
            <Link
              to="/register"
              className="w-full sm:w-auto px-7 py-3.5 bg-[#0B1F3A] hover:bg-[#071A33] text-white font-semibold text-sm rounded-[10px] shadow-subtle transition-all"
            >
              GET STARTED
            </Link>

            {isDemoMode ? (
              <button
                onClick={() => handleLaunchDemo('owner')}
                className="w-full sm:w-auto px-7 py-3.5 bg-white hover:bg-[#F6F8FB] text-[#0B1F3A] font-semibold text-sm rounded-[10px] border border-[#DCE4EE] shadow-subtle transition-all flex items-center justify-center gap-2"
              >
                <Play className="w-4 h-4 text-[#1E4D8F] fill-[#1E4D8F]" />
                <span>VIEW PLATFORM</span>
              </button>
            ) : (
              <Link
                to="/login"
                className="w-full sm:w-auto px-7 py-3.5 bg-white hover:bg-[#F6F8FB] text-[#0B1F3A] font-semibold text-sm rounded-[10px] border border-[#DCE4EE] shadow-subtle transition-all flex items-center justify-center gap-2"
              >
                <span>SIGN IN</span>
                <ArrowRight className="w-4 h-4 text-[#1E4D8F]" />
              </Link>
            )}
          </div>

          {/* Quick Demo Persona Badges */}
          {isDemoMode && (
            <div className="pt-4 flex flex-wrap items-center justify-center gap-2 text-xs text-[#64748B]">
              <span>Explore demo personas:</span>
              <button
                onClick={() => handleLaunchDemo('owner')}
                className="px-2.5 py-1 rounded-[8px] bg-[#F6F8FB] border border-[#DCE4EE] hover:border-[#1E4D8F] text-[#172B4D] hover:text-[#0B1F3A] font-medium transition-colors"
              >
                Owner Workspace
              </button>
              <button
                onClick={() => handleLaunchDemo('telecaller')}
                className="px-2.5 py-1 rounded-[8px] bg-[#F6F8FB] border border-[#DCE4EE] hover:border-[#1E4D8F] text-[#172B4D] hover:text-[#0B1F3A] font-medium transition-colors"
              >
                Telecaller (Masked)
              </button>
              <button
                onClick={() => handleLaunchDemo('admin')}
                className="px-2.5 py-1 rounded-[8px] bg-[#F6F8FB] border border-[#DCE4EE] hover:border-[#1E4D8F] text-[#172B4D] hover:text-[#0B1F3A] font-medium transition-colors"
              >
                Platform Admin
              </button>
            </div>
          )}

          {/* Hero Interface Mockup Card */}
          <div className="pt-8 max-w-5xl mx-auto">
            <div className="rounded-[12px] border border-[#DCE4EE] bg-white p-4 sm:p-6 shadow-card text-left space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#DCE4EE] pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-[8px] bg-[#EAF2FB] border border-[#C7DCF3] flex items-center justify-center text-[#1E4D8F]">
                    <Shield className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-[#0B1F3A]">Enterprise Control Console</h3>
                    <p className="text-xs text-[#64748B]">Live Telecaller Pipeline • Protected Row-Level Isolation</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#EAF7EE] border border-[#C3EBD0] text-[11px] font-medium text-[#16845B]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#16845B]" />
                    ● System Secure
                  </span>
                </div>
              </div>

              {/* Sample Metrics Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-[10px] bg-[#F6F8FB] border border-[#DCE4EE]">
                  <div className="text-[10px] font-semibold text-[#64748B] uppercase tracking-wider">Total Leads</div>
                  <div className="text-lg font-bold text-[#0B1F3A] mt-0.5">2,480</div>
                  <div className="text-[10px] text-[#16845B] mt-0.5">✓ 100% Governed</div>
                </div>
                <div className="p-3 rounded-[10px] bg-[#F6F8FB] border border-[#DCE4EE]">
                  <div className="text-[10px] font-semibold text-[#64748B] uppercase tracking-wider">Active Calls</div>
                  <div className="text-lg font-bold text-[#0B1F3A] mt-0.5">18</div>
                  <div className="text-[10px] text-[#1E4D8F] mt-0.5">Bridge Connected</div>
                </div>
                <div className="p-3 rounded-[10px] bg-[#F6F8FB] border border-[#DCE4EE]">
                  <div className="text-[10px] font-semibold text-[#64748B] uppercase tracking-wider">Follow-Ups</div>
                  <div className="text-lg font-bold text-[#0B1F3A] mt-0.5">126</div>
                  <div className="text-[10px] text-[#B7791F] mt-0.5">Due Today</div>
                </div>
                <div className="p-3 rounded-[10px] bg-[#F6F8FB] border border-[#DCE4EE]">
                  <div className="text-[10px] font-semibold text-[#64748B] uppercase tracking-wider">Data Protection</div>
                  <div className="text-lg font-bold text-[#16845B] mt-0.5">Active</div>
                  <div className="text-[10px] text-[#64748B] mt-0.5">Zero Leakage</div>
                </div>
              </div>

              {/* Sample Table Row */}
              <div className="rounded-[10px] border border-[#DCE4EE] bg-[#FFFFFF] overflow-hidden">
                <div className="px-4 py-2.5 bg-[#F6F8FB] border-b border-[#DCE4EE] flex items-center justify-between text-xs font-semibold text-[#64748B]">
                  <span>Lead Identity (Telecaller View)</span>
                  <span>Security Status</span>
                </div>
                <div className="px-4 py-3 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-[#EAF2FB] border border-[#C7DCF3] text-[#0B1F3A] flex items-center justify-center font-bold text-xs">
                      RK
                    </div>
                    <div>
                      <div className="font-semibold text-[#0B1F3A]">Rahul K.</div>
                      <div className="text-[#64748B] font-mono text-[11px]">+91 ******3210</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#EAF2FB] text-[#1E4D8F] border border-[#C7DCF3]">
                      ✓ Masked & Protected
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURE SECTION (Section 18) */}
      <section className="py-20 px-6">
        <div className="max-w-6xl mx-auto space-y-12">
          <div className="text-center max-w-2xl mx-auto space-y-2">
            <h2 className="text-xs font-bold text-[#1E4D8F] uppercase tracking-wider">
              Core Capabilities
            </h2>
            <h3 className="text-2xl sm:text-3xl font-bold text-[#0B1F3A] tracking-tight">
              Six Pillars of Enterprise Lead Protection
            </h3>
            <p className="text-sm text-[#64748B]">
              Purpose-built controls engineered to replace uncontrolled spreadsheets and vulnerable CRM workflows.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="p-6 rounded-[12px] bg-white border border-[#DCE4EE] shadow-card space-y-3">
              <div className="w-10 h-10 rounded-[10px] bg-[#EAF2FB] border border-[#C7DCF3] flex items-center justify-center text-[#1E4D8F]">
                <UserCheck className="w-5 h-5" />
              </div>
              <h4 className="text-base font-semibold text-[#0B1F3A]">SECURE LEAD ACCESS</h4>
              <p className="text-xs text-[#64748B] leading-relaxed">
                Give every telecaller access only to the leads they need. Database-enforced Row Level Security ensures callers cannot view or discover peers' leads.
              </p>
            </div>

            <div className="p-6 rounded-[12px] bg-white border border-[#DCE4EE] shadow-card space-y-3">
              <div className="w-10 h-10 rounded-[10px] bg-[#EAF2FB] border border-[#C7DCF3] flex items-center justify-center text-[#1E4D8F]">
                <EyeOff className="w-5 h-5" />
              </div>
              <h4 className="text-base font-semibold text-[#0B1F3A]">MASKED CUSTOMER DATA</h4>
              <p className="text-xs text-[#64748B] leading-relaxed">
                Protect sensitive customer information inside the workflow. Phone numbers and surnames remain masked to prevent screenshots and data theft.
              </p>
            </div>

            <div className="p-6 rounded-[12px] bg-white border border-[#DCE4EE] shadow-card space-y-3">
              <div className="w-10 h-10 rounded-[10px] bg-[#EAF2FB] border border-[#C7DCF3] flex items-center justify-center text-[#1E4D8F]">
                <PhoneCall className="w-5 h-5" />
              </div>
              <h4 className="text-base font-semibold text-[#0B1F3A]">SECURE CALLING</h4>
              <p className="text-xs text-[#64748B] leading-relaxed">
                Initiate calls without exposing the underlying phone number. Calls route via verified cloud telephony bridges with compliance recording.
              </p>
            </div>

            <div className="p-6 rounded-[12px] bg-white border border-[#DCE4EE] shadow-card space-y-3">
              <div className="w-10 h-10 rounded-[10px] bg-[#EAF2FB] border border-[#C7DCF3] flex items-center justify-center text-[#1E4D8F]">
                <Activity className="w-5 h-5" />
              </div>
              <h4 className="text-base font-semibold text-[#0B1F3A]">AUDIT TRAIL</h4>
              <p className="text-xs text-[#64748B] leading-relaxed">
                Know what happened, when it happened and who performed the action. Immutable event logs capture logins, calls, exports, and status changes.
              </p>
            </div>

            <div className="p-6 rounded-[12px] bg-white border border-[#DCE4EE] shadow-card space-y-3">
              <div className="w-10 h-10 rounded-[10px] bg-[#EAF2FB] border border-[#C7DCF3] flex items-center justify-center text-[#1E4D8F]">
                <Headphones className="w-5 h-5" />
              </div>
              <h4 className="text-base font-semibold text-[#0B1F3A]">TEAM CONTROL</h4>
              <p className="text-xs text-[#64748B] leading-relaxed">
                Manage assignments, performance and workflows from one workspace. Automate round-robin distribution and balance calling workloads.
              </p>
            </div>

            <div className="p-6 rounded-[12px] bg-white border border-[#DCE4EE] shadow-card space-y-3">
              <div className="w-10 h-10 rounded-[10px] bg-[#EAF2FB] border border-[#C7DCF3] flex items-center justify-center text-[#1E4D8F]">
                <BarChart3 className="w-5 h-5" />
              </div>
              <h4 className="text-base font-semibold text-[#0B1F3A]">ANALYTICS</h4>
              <p className="text-xs text-[#64748B] leading-relaxed">
                Understand calls, outcomes, follow-ups and conversions. Clean enterprise analytics without visual clutter or unnecessary noise.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION: PROBLEM VS SOLUTION */}
      <section className="py-20 px-6 border-t border-[#DCE4EE] bg-white">
        <div className="max-w-6xl mx-auto space-y-12">
          <div className="text-center max-w-2xl mx-auto space-y-2">
            <h2 className="text-xs font-bold text-[#1E4D8F] uppercase tracking-wider">
              Comparative Analysis
            </h2>
            <h3 className="text-2xl sm:text-3xl font-bold text-[#0B1F3A] tracking-tight">
              Why Traditional Workflows Fail Enterprise Businesses
            </h3>
            <p className="text-sm text-[#64748B]">
              Sharing spreadsheets with callers leaves your customer database completely exposed to lateral exfiltration.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* The Old Way */}
            <div className="p-8 rounded-[12px] bg-[#F6F8FB] border border-[#DCE4EE] space-y-5">
              <div className="flex items-center gap-2 text-[#C53030] font-bold text-sm">
                <XCircle className="w-5 h-5" />
                <span>The Traditional Uncontrolled Approach</span>
              </div>
              <ul className="space-y-3 text-xs text-[#172B4D]">
                <li className="flex items-start gap-2.5">
                  <XCircle className="w-4 h-4 text-[#C53030] shrink-0 mt-0.5" />
                  <span>Callers download complete customer databases to personal laptops and phones.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <XCircle className="w-4 h-4 text-[#C53030] shrink-0 mt-0.5" />
                  <span>Leads forwarded or resold to competitors with zero technical deterrents.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <XCircle className="w-4 h-4 text-[#C53030] shrink-0 mt-0.5" />
                  <span>No accountability: owners cannot verify when calls occurred or what was discussed.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <XCircle className="w-4 h-4 text-[#C53030] shrink-0 mt-0.5" />
                  <span>Substantial legal and compliance liability under data protection statutes.</span>
                </li>
              </ul>
            </div>

            {/* The ENCRIX Way */}
            <div className="p-8 rounded-[12px] bg-white border-2 border-[#1E4D8F] space-y-5 shadow-card">
              <div className="flex items-center gap-2 text-[#16845B] font-bold text-sm">
                <CheckCircle2 className="w-5 h-5" />
                <span>The ENCRIX Governed Architecture</span>
              </div>
              <ul className="space-y-3 text-xs text-[#172B4D]">
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-[#16845B] shrink-0 mt-0.5" />
                  <span><strong>Zero Raw Access:</strong> Telecallers see only their authorized assigned leads.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-[#16845B] shrink-0 mt-0.5" />
                  <span><strong>Data Masking Shield:</strong> Surnames and phone numbers (+91 ******3210) are masked at the API layer.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-[#16845B] shrink-0 mt-0.5" />
                  <span><strong>Authorized Telephony Bridge:</strong> Dialing occurs via secure gateway with compliance recording.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-[#16845B] shrink-0 mt-0.5" />
                  <span><strong>Realtime Owner Visibility:</strong> Every call, duration, outcome, and follow-up streams to owner in real time.</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION: STEP-BY-STEP WORKFLOW */}
      <section className="py-20 px-6 bg-[#F6F8FB]">
        <div className="max-w-6xl mx-auto space-y-12">
          <div className="text-center max-w-2xl mx-auto space-y-2">
            <h2 className="text-xs font-bold text-[#1E4D8F] uppercase tracking-wider">
              Controlled Lifecycle
            </h2>
            <h3 className="text-2xl sm:text-3xl font-bold text-[#0B1F3A] tracking-tight">
              How ENCRIX Operates Step-by-Step
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="p-6 rounded-[12px] bg-white border border-[#DCE4EE] shadow-card space-y-3">
              <div className="w-9 h-9 rounded-[8px] bg-[#EAF2FB] border border-[#C7DCF3] text-[#1E4D8F] font-bold flex items-center justify-center text-sm">
                1
              </div>
              <h4 className="text-sm font-semibold text-[#0B1F3A]">Owner Ingests Leads</h4>
              <p className="text-xs text-[#64748B] leading-relaxed">
                Upload CSV or Excel files. Automated column mapping checks phone syntax and filters duplicate records.
              </p>
            </div>

            <div className="p-6 rounded-[12px] bg-white border border-[#DCE4EE] shadow-card space-y-3">
              <div className="w-9 h-9 rounded-[8px] bg-[#EAF2FB] border border-[#C7DCF3] text-[#1E4D8F] font-bold flex items-center justify-center text-sm">
                2
              </div>
              <h4 className="text-sm font-semibold text-[#0B1F3A]">Distribute Queue</h4>
              <p className="text-xs text-[#64748B] leading-relaxed">
                Distribute leads evenly across active telecallers with automatic round-robin or targeted assignment.
              </p>
            </div>

            <div className="p-6 rounded-[12px] bg-white border border-[#DCE4EE] shadow-card space-y-3">
              <div className="w-9 h-9 rounded-[8px] bg-[#EAF2FB] border border-[#C7DCF3] text-[#1E4D8F] font-bold flex items-center justify-center text-sm">
                3
              </div>
              <h4 className="text-sm font-semibold text-[#0B1F3A]">Secure Calling</h4>
              <p className="text-xs text-[#64748B] leading-relaxed">
                Telecallers open masked cards and place calls via authorized gateway. Numbers remain hidden from screen scraping.
              </p>
            </div>

            <div className="p-6 rounded-[12px] bg-white border border-[#DCE4EE] shadow-card space-y-3">
              <div className="w-9 h-9 rounded-[8px] bg-[#EAF2FB] border border-[#C7DCF3] text-[#1E4D8F] font-bold flex items-center justify-center text-sm">
                4
              </div>
              <h4 className="text-sm font-semibold text-[#0B1F3A]">Instant Accountability</h4>
              <p className="text-xs text-[#64748B] leading-relaxed">
                Call outcomes, follow-up dates, and recordings stream immediately to the owner dashboard in real time.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION: USE CASES */}
      <section className="py-20 px-6 border-t border-[#DCE4EE] bg-white">
        <div className="max-w-6xl mx-auto space-y-12">
          <div className="text-center max-w-2xl mx-auto space-y-2">
            <h2 className="text-xs font-bold text-[#1E4D8F] uppercase tracking-wider">
              Industry Applications
            </h2>
            <h3 className="text-2xl sm:text-3xl font-bold text-[#0B1F3A] tracking-tight">
              Built For Organizations That Rely on Telecalling
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
              <div key={i} className="p-6 rounded-[12px] bg-[#F6F8FB] border border-[#DCE4EE] space-y-2">
                <Building className="w-5 h-5 text-[#1E4D8F] mb-2" />
                <h4 className="text-sm font-semibold text-[#0B1F3A]">{uc.title}</h4>
                <p className="text-xs text-[#64748B] leading-relaxed">{uc.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION: FAQ */}
      <section className="py-20 px-6 bg-[#F6F8FB] border-t border-[#DCE4EE]">
        <div className="max-w-4xl mx-auto space-y-10">
          <div className="text-center space-y-2">
            <h2 className="text-xs font-bold text-[#1E4D8F] uppercase tracking-wider">
              Frequently Asked Questions
            </h2>
            <h3 className="text-2xl font-bold text-[#0B1F3A] tracking-tight">
              Everything You Need to Know About ENCRIX Security
            </h3>
          </div>

          <div className="space-y-4 text-xs">
            <div className="p-5 rounded-[12px] bg-white border border-[#DCE4EE] shadow-card space-y-2">
              <h4 className="text-sm font-semibold text-[#0B1F3A]">Can telecallers download or export the lead list?</h4>
              <p className="text-[#64748B] leading-relaxed">
                No. Export functionality is completely disabled and blocked at the PostgreSQL database policy layer for telecallers. Any attempt to query bulk unmasked data is blocked and immediately raises a high-severity security alert.
              </p>
            </div>

            <div className="p-5 rounded-[12px] bg-white border border-[#DCE4EE] shadow-card space-y-2">
              <h4 className="text-sm font-semibold text-[#0B1F3A]">How does data masking work?</h4>
              <p className="text-[#64748B] leading-relaxed">
                Data masking is enforced at the data-access layer before reaching the UI. Surnames and phone numbers are converted to formats like "Rahul K." and "+91 ******3210". When an authorized call is placed, the secure telephony bridge resolves the actual destination server-side.
              </p>
            </div>

            <div className="p-5 rounded-[12px] bg-white border border-[#DCE4EE] shadow-card space-y-2">
              <h4 className="text-sm font-semibold text-[#0B1F3A]">How is multi-tenant organization isolation enforced?</h4>
              <p className="text-[#64748B] leading-relaxed">
                ENCRIX implements PostgreSQL Row Level Security (RLS). Every query automatically incorporates tenant validation. Organization A can never physically access Organization B records, regardless of frontend inputs.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* FINAL CTA SECTION */}
      <section className="py-20 px-6 bg-[#0B1F3A] text-white">
        <div className="max-w-4xl mx-auto text-center space-y-6">
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
            Take Control of Your Lead Operations Today
          </h2>
          <p className="text-sm text-slate-300 max-w-xl mx-auto leading-relaxed">
            Stop lead theft. Eliminate spreadsheet leakages. Give your telecallers a focused, high-productivity workspace with complete owner accountability.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <Link
              to="/register"
              className="px-8 py-3.5 bg-white hover:bg-slate-100 text-[#0B1F3A] font-bold text-xs rounded-[10px] shadow-card transition-all"
            >
              START PROTECTING YOUR LEADS
            </Link>
            {isDemoMode ? (
              <button
                onClick={() => handleLaunchDemo('owner')}
                className="px-8 py-3.5 bg-[#071A33] hover:bg-[#1E4D8F] text-white text-xs font-semibold rounded-[10px] border border-slate-700 transition-colors"
              >
                TRY WITH DEMO DATA
              </button>
            ) : (
              <Link
                to="/login"
                className="px-8 py-3.5 bg-[#071A33] hover:bg-[#1E4D8F] text-white text-xs font-semibold rounded-[10px] border border-slate-700 transition-colors"
              >
                SIGN IN TO WORKSPACE
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#DCE4EE] py-8 px-6 text-center text-xs text-[#64748B] bg-white">
        <p>© 2026 ENCRIX Technologies. All rights reserved. Enterprise Lead Security & Telephony.</p>
      </footer>
    </div>
  );
};
