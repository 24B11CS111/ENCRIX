import React, { useState, useEffect } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Shield, Mail, ArrowRight, ArrowLeft, CheckCircle2, Headphones, AlertCircle } from 'lucide-react';
import { OtpInput } from '@/components/auth/OtpInput';
import { normalizeEmailAddress } from '@/lib/emailNormalization';

export type LoginPortal = 'ADMIN' | 'TELECALLER';

export const LoginPage: React.FC = () => {
  const { requestOtp, verifyOtp } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Role Portal selection (preference only; server profile strictly enforces authorization)
  const initialRoleParam = searchParams.get('role')?.toUpperCase() || searchParams.get('portal')?.toUpperCase();
  const [portalSelection, setPortalSelection] = useState<LoginPortal | null>(() => {
    if (initialRoleParam === 'ADMIN' || initialRoleParam === 'OWNER') return 'ADMIN';
    if (initialRoleParam === 'TELECALLER') return 'TELECALLER';
    return null;
  });

  // Screen Step: 1 = Enter Email, 2 = Verify OTP
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [verificationTicket, setVerificationTicket] = useState<string | undefined>(undefined);
  const [cooldown, setCooldown] = useState(60);
  const [expiresAt, setExpiresAt] = useState<string | undefined>(undefined);
  const [resendAvailableAt, setResendAvailableAt] = useState<string | undefined>(undefined);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  // Sync with URL query parameter changes if user navigates back/forward
  useEffect(() => {
    const roleParam = searchParams.get('role')?.toUpperCase() || searchParams.get('portal')?.toUpperCase();
    if (roleParam === 'ADMIN' || roleParam === 'OWNER') {
      setPortalSelection('ADMIN');
    } else if (roleParam === 'TELECALLER') {
      setPortalSelection('TELECALLER');
    }
  }, [searchParams]);

  // Step 1: Send OTP
  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);

    const norm = normalizeEmailAddress(email);
    if (!norm.isValid) {
      setError(norm.error || 'Please enter a valid work email address (e.g. name@company.com)');
      return;
    }

    setIsLoading(true);
    const result = await requestOtp({
      email: norm.normalized,
      purpose: 'LOGIN',
    });
    setIsLoading(false);

    if (result.success) {
      setVerificationTicket(result.verificationTicket);
      setMaskedEmail(result.maskedEmail || norm.masked);
      setCooldown(result.cooldownSeconds || 60);
      setExpiresAt(result.expiresAt);
      setResendAvailableAt(result.resendAvailableAt);
      setStep(2);
      setOtp('');
    } else {
      setError(result.error || 'Failed to send verification code. Please try again shortly.');
    }
  };

  // Step 2: Verify OTP and Route Strictly by Server-Verified Profile
  const handleVerifyOtp = async (codeToVerify?: string) => {
    const code = codeToVerify || otp;
    if (!code || code.length !== 6) {
      setError('Enter the 6-digit verification code.');
      return;
    }

    setError(null);
    setInfoMessage(null);
    setIsLoading(true);

    const norm = normalizeEmailAddress(email);
    const result = await verifyOtp({
      email: norm.normalized,
      otp: code,
      purpose: 'LOGIN',
      verificationTicket,
    });
    setIsLoading(false);

    if (result.success) {
      const verifiedProfile = result.profile;
      const verifiedRole = result.role || verifiedProfile?.role;
      const verifiedStatus = verifiedProfile?.status;

      // 1. Account Status Enforcement
      if (verifiedStatus === 'DISABLED' || verifiedStatus === 'SUSPENDED') {
        setError('Your account has been suspended. Please contact your organization owner.');
        return;
      }

      if (verifiedStatus === 'PENDING_VERIFICATION') {
        setError('Your account is pending verification and cannot be accessed.');
        return;
      }

      // 2. Verified Role-Based Routing
      // CRITICAL SECURITY ENFORCEMENT:
      // The user's role is determined strictly from the verified server profile,
      // never from the portal selection or client request.
      if (verifiedRole === 'ADMIN') {
        // Platform Superadmin console
        navigate('/admin');
      } else if (verifiedRole === 'OWNER') {
        // Authorized Organization Owner workspace
        if (portalSelection === 'TELECALLER') {
          setInfoMessage('Authenticated as Organization Owner. Redirecting to your owner workspace...');
          setTimeout(() => navigate('/owner'), 600);
        } else {
          navigate('/owner');
        }
      } else if (verifiedRole === 'TELECALLER') {
        // Authorized Telecaller workspace
        if (portalSelection === 'ADMIN') {
          setInfoMessage('Authenticated as Telecaller. Redirecting to your assigned telecaller workspace...');
          setTimeout(() => navigate('/telecaller'), 600);
        } else {
          navigate('/telecaller');
        }
      } else {
        // Default safe fallback to telecaller restricted dashboard
        navigate('/telecaller');
      }
    } else {
      const errMsg = result.error || 'Verification failed. Please check the code.';
      if (errMsg.toLowerCase().includes('expired')) {
        setError('Verification code has expired. Please request a new code.');
      } else if (errMsg.toLowerCase().includes('too many')) {
        setError('Too many incorrect attempts. Please request a new code.');
      } else {
        setError(errMsg);
      }
    }
  };

  const handleResendOtp = async () => {
    setError(null);
    setInfoMessage(null);
    setIsLoading(true);
    const norm = normalizeEmailAddress(email);
    const result = await requestOtp({
      email: norm.normalized,
      purpose: 'LOGIN',
    });
    setIsLoading(false);

    if (result.success) {
      setVerificationTicket(result.verificationTicket);
      setCooldown(result.cooldownSeconds || 60);
      setExpiresAt(result.expiresAt);
      setResendAvailableAt(result.resendAvailableAt);
      setOtp('');
      setInfoMessage('New verification code sent to your email.');
    } else {
      setError(result.error || 'Failed to resend code.');
    }
  };

  return (
    <div className="min-h-screen bg-[#F6F8FB] flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 font-sans">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <Link to="/" className="inline-flex items-center gap-2.5 mb-2 focus:outline-none focus:ring-2 focus:ring-[#1E4D8F] rounded-[8px]">
          <div className="flex h-11 w-11 items-center justify-center rounded-[10px] bg-[#0B1F3A] text-white shadow-subtle">
            <Shield className="h-6 w-6" />
          </div>
          <span className="text-2xl font-bold tracking-tight text-[#0B1F3A]">ENCRIX</span>
        </Link>
        <p className="text-xs text-[#64748B] font-medium">
          Controlled Lead Access & Secure Telecalling Operations
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-xl">
        {/* VIEW 1: Dual Entry Points (Shown when no role portal has been chosen yet) */}
        {!portalSelection && step === 1 ? (
          <div className="bg-white border border-[#DCE4EE] py-8 px-6 shadow-card rounded-[12px] sm:px-10 space-y-6">
            <div className="text-center space-y-1.5">
              <h2 className="text-xl font-bold text-[#0B1F3A]">
                Sign in to Your Workspace
              </h2>
              <p className="text-xs text-[#64748B] max-w-sm mx-auto">
                Select your designated role entry point to proceed with secure email verification.
              </p>
            </div>

            {error && (
              <div className="p-3 bg-[#FEECEB] border border-[#F8C8C6] rounded-[8px] text-xs text-[#C53030] flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              {/* Option A: Admin / Organization Owner */}
              <div className="rounded-[10px] border border-[#DCE4EE] bg-[#F8FAFC] hover:bg-white hover:border-[#1E4D8F] p-5 flex flex-col justify-between transition-all group shadow-subtle">
                <div className="space-y-2.5">
                  <div className="w-10 h-10 rounded-[8px] bg-[#EAF2FB] border border-[#C7DCF3] flex items-center justify-center text-[#1E4D8F] group-hover:bg-[#0B1F3A] group-hover:text-white transition-colors">
                    <Shield className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-[#0B1F3A]">Admin / Owner Login</h3>
                    <p className="text-xs text-[#64748B] mt-1 leading-relaxed">
                      Manage your organization, team members, lead assignments, permissions, and reporting.
                    </p>
                  </div>
                </div>
                <div className="pt-5">
                  <button
                    type="button"
                    onClick={() => {
                      setPortalSelection('ADMIN');
                      setError(null);
                    }}
                    className="w-full py-2.5 px-3 bg-[#0B1F3A] hover:bg-[#071A33] text-white font-semibold text-xs rounded-[8px] shadow-subtle transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <span>Continue as Admin</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Option B: Telecaller */}
              <div className="rounded-[10px] border border-[#DCE4EE] bg-[#F8FAFC] hover:bg-white hover:border-[#1E4D8F] p-5 flex flex-col justify-between transition-all group shadow-subtle">
                <div className="space-y-2.5">
                  <div className="w-10 h-10 rounded-[8px] bg-[#EAF2FB] border border-[#C7DCF3] flex items-center justify-center text-[#1E4D8F] group-hover:bg-[#0B1F3A] group-hover:text-white transition-colors">
                    <Headphones className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-[#0B1F3A]">Telecaller Login</h3>
                    <p className="text-xs text-[#64748B] mt-1 leading-relaxed">
                      Access assigned leads, manage follow-ups, and use authorized calling tools.
                    </p>
                  </div>
                </div>
                <div className="pt-5">
                  <button
                    type="button"
                    onClick={() => {
                      setPortalSelection('TELECALLER');
                      setError(null);
                    }}
                    className="w-full py-2.5 px-3 bg-white hover:bg-[#F6F8FB] text-[#0B1F3A] border border-[#DCE4EE] hover:border-[#0B1F3A] font-semibold text-xs rounded-[8px] shadow-subtle transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <span>Continue as Telecaller</span>
                    <ArrowRight className="w-3.5 h-3.5 text-[#1E4D8F]" />
                  </button>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-[#DCE4EE] text-center text-xs text-[#64748B]">
              New organization?{' '}
              <Link to="/register" className="font-semibold text-[#1E4D8F] hover:underline">
                Create an organization account
              </Link>
            </div>
          </div>
        ) : (
          /* VIEW 2: Active Portal Email / OTP Form */
          <div className="bg-white border border-[#DCE4EE] py-8 px-6 shadow-card rounded-[12px] sm:px-10 space-y-6">
            {/* Top Portal Switcher Tabs */}
            <div className="flex items-center justify-between pb-1 border-b border-[#F1F5F9]">
              <div className="flex rounded-[10px] bg-[#F1F5F9] p-1 border border-[#DCE4EE] w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => {
                    setPortalSelection('ADMIN');
                    setError(null);
                  }}
                  className={`flex-1 sm:flex-initial py-1.5 px-3.5 rounded-[8px] text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
                    portalSelection === 'ADMIN'
                      ? 'bg-white text-[#0B1F3A] shadow-subtle border border-[#DCE4EE]'
                      : 'text-[#64748B] hover:text-[#0B1F3A]'
                  }`}
                >
                  <Shield className="w-3.5 h-3.5" />
                  <span>Admin / Owner</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPortalSelection('TELECALLER');
                    setError(null);
                  }}
                  className={`flex-1 sm:flex-initial py-1.5 px-3.5 rounded-[8px] text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
                    portalSelection === 'TELECALLER'
                      ? 'bg-white text-[#0B1F3A] shadow-subtle border border-[#DCE4EE]'
                      : 'text-[#64748B] hover:text-[#0B1F3A]'
                  }`}
                >
                  <Headphones className="w-3.5 h-3.5" />
                  <span>Telecaller</span>
                </button>
              </div>

              {step === 1 && (
                <button
                  type="button"
                  onClick={() => {
                    setPortalSelection(null);
                    setError(null);
                  }}
                  className="hidden sm:inline-flex text-[11px] font-semibold text-[#64748B] hover:text-[#0B1F3A] transition-colors"
                >
                  All Entry Points
                </button>
              )}
            </div>

            {/* Header & Role Details */}
            <div className="text-center space-y-1">
              <h2 className="text-lg font-bold text-[#0B1F3A]">
                {step === 1
                  ? portalSelection === 'ADMIN'
                    ? 'Admin / Owner Login'
                    : 'Telecaller Login'
                  : 'Verify Your Email'}
              </h2>
              <p className="text-xs text-[#64748B]">
                {step === 1
                  ? portalSelection === 'ADMIN'
                    ? 'Manage your organization, team members, lead assignments, permissions, and reporting.'
                    : 'Access assigned leads, manage follow-ups, and use authorized calling tools.'
                  : `Enter the 6-digit verification code sent to ${maskedEmail}`}
              </p>
            </div>

            {/* Error & Info Feedback */}
            {error && (
              <div className="p-3 bg-[#FEECEB] border border-[#F8C8C6] rounded-[8px] text-xs text-[#C53030] flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {infoMessage && (
              <div className="p-3 bg-[#EAF7EE] border border-[#C3EBD0] rounded-[8px] text-xs text-[#16845B] flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{infoMessage}</span>
              </div>
            )}

            {/* Step 1: Email Input Form */}
            {step === 1 ? (
              <form onSubmit={handleSendOtp} className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-[#172B4D] block mb-1">Work Email</label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-[#64748B] absolute left-3 top-2.5" />
                    <input
                      type="email"
                      required
                      autoFocus
                      placeholder="name@company.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 bg-white border border-[#DCE4EE] rounded-[10px] text-xs text-[#172B4D] placeholder-[#94A3B8] shadow-subtle focus:outline-none focus:border-[#0B1F3A]"
                    />
                  </div>
                  <p className="text-[11px] text-[#64748B] mt-1">
                    We'll send a 6-digit one-time verification code to this address.
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#0B1F3A] hover:bg-[#071A33] text-white font-semibold text-xs rounded-[10px] shadow-subtle transition-all cursor-pointer disabled:opacity-50"
                >
                  <span>{isLoading ? 'Sending Code...' : 'Send OTP'}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </form>
            ) : (
              /* Step 2: OTP Verification Form */
              <div className="space-y-5">
                <OtpInput
                  value={otp}
                  onChange={setOtp}
                  onComplete={(code) => handleVerifyOtp(code)}
                  onResend={handleResendOtp}
                  cooldownSeconds={cooldown}
                  expiresAt={expiresAt}
                  resendAvailableAt={resendAvailableAt}
                  isLoading={isLoading}
                  error={error}
                />

                <div className="space-y-2 pt-2">
                  <button
                    type="button"
                    onClick={() => handleVerifyOtp()}
                    disabled={isLoading || otp.length !== 6}
                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#0B1F3A] hover:bg-[#071A33] text-white font-semibold text-xs rounded-[10px] shadow-subtle transition-all cursor-pointer disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{isLoading ? 'Verifying...' : 'Verify OTP'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setStep(1);
                      setError(null);
                      setInfoMessage(null);
                      setVerificationTicket(undefined);
                    }}
                    disabled={isLoading}
                    className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-semibold text-[#64748B] hover:text-[#0B1F3A] transition-colors"
                  >
                    <ArrowLeft className="w-3 h-3" />
                    <span>Change Email Address</span>
                  </button>
                </div>
              </div>
            )}

            <div className="pt-4 border-t border-[#DCE4EE] flex flex-col sm:flex-row items-center justify-between text-xs text-[#64748B] gap-2">
              <button
                type="button"
                onClick={() => {
                  setPortalSelection(null);
                  setStep(1);
                  setError(null);
                  setInfoMessage(null);
                }}
                className="font-medium text-[#64748B] hover:text-[#0B1F3A] transition-colors"
              >
                ← Switch Role Entry Point
              </button>

              <div>
                New organization?{' '}
                <Link to="/register" className="font-semibold text-[#1E4D8F] hover:underline">
                  Create account
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
