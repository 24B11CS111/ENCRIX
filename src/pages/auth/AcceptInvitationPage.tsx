import React, { useState, useEffect } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Shield, Mail, ArrowRight, ArrowLeft, CheckCircle2, Headphones, AlertTriangle } from 'lucide-react';
import { OtpInput } from '@/components/auth/OtpInput';
import { normalizeEmailAddress } from '@/lib/emailNormalization';
import { db } from '@/services/supabase/db';

export const AcceptInvitationPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const tokenFromUrl = searchParams.get('token') || '';
  const { requestOtp, verifyOtp } = useAuth();
  const navigate = useNavigate();

  const [token, setToken] = useState(tokenFromUrl);
  const [invitationData, setInvitationData] = useState<any>(null);
  const [invitationError, setInvitationError] = useState<string | null>(null);

  // Step 1 = Email verification form, Step 2 = OTP input
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [cooldown, setCooldown] = useState(60);
  const [expiresAt, setExpiresAt] = useState<string | undefined>(undefined);
  const [resendAvailableAt, setResendAvailableAt] = useState<string | undefined>(undefined);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (token) {
      // Look up invitation
      const inv = db.getInvitationByToken(token);
      if (!inv) {
        setInvitationError('Invitation link is invalid or could not be found.');
      } else if (inv.status === 'EXPIRED') {
        setInvitationError('This invitation has expired. Please contact your organization owner for a new invitation.');
      } else if (inv.status === 'ACCEPTED') {
        setInvitationError('This invitation has already been accepted. Please sign in directly.');
      } else if (inv.status === 'REVOKED') {
        setInvitationError('This invitation has been revoked by the organization owner.');
      } else {
        setInvitationData(inv);
        if (inv.email) setEmail(inv.email);
        setInvitationError(null);
      }
    }
  }, [token]);

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!token.trim()) {
      setError('Invitation token is required.');
      return;
    }

    const norm = normalizeEmailAddress(email);
    if (!norm.isValid) {
      setError(norm.error || 'Please enter a valid work email address (e.g. name@company.com)');
      return;
    }

    setIsLoading(true);
    const result = await requestOtp({
      email: norm.normalized,
      purpose: 'INVITATION',
      inviteToken: token.trim(),
    });
    setIsLoading(false);

    if (result.success) {
      setMaskedEmail(result.maskedEmail || norm.masked);
      setCooldown(result.cooldownSeconds || 60);
      setExpiresAt(result.expiresAt);
      setResendAvailableAt(result.resendAvailableAt);
      setStep(2);
      setOtp('');
    } else {
      setError(result.error || 'Failed to send verification code.');
    }
  };

  const handleVerifyOtp = async (codeToVerify?: string) => {
    const code = codeToVerify || otp;
    if (!code || code.length !== 6) {
      setError('Enter the 6-digit verification code.');
      return;
    }

    setError(null);
    setIsLoading(true);

    const norm = normalizeEmailAddress(email);
    const result = await verifyOtp({
      email: norm.normalized,
      otp: code,
      purpose: 'INVITATION',
      inviteToken: token.trim(),
    });
    setIsLoading(false);

    if (result.success) {
      navigate('/telecaller');
    } else {
      setError(result.error || 'Verification failed. Please check the code.');
    }
  };

  const handleResendOtp = async () => {
    setError(null);
    setIsLoading(true);
    const norm = normalizeEmailAddress(email);
    const result = await requestOtp({
      email: norm.normalized,
      purpose: 'INVITATION',
      inviteToken: token.trim(),
    });
    setIsLoading(false);

    if (result.success) {
      setCooldown(result.cooldownSeconds || 60);
      setExpiresAt(result.expiresAt);
      setResendAvailableAt(result.resendAvailableAt);
      setOtp('');
    } else {
      setError(result.error || 'Failed to resend code.');
    }
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
          Verified Telecaller Onboarding
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white border border-[#DCE4EE] py-8 px-6 shadow-card rounded-[12px] sm:px-10 space-y-6">
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-[#EAF2FB] text-[#1E4D8F] mb-3">
              <Headphones className="w-5 h-5" />
            </div>
            <h2 className="text-lg font-bold text-[#0B1F3A]">
              {step === 1 ? 'Join Workspace' : 'Verify Your Email'}
            </h2>
            <p className="text-xs text-[#64748B] mt-1">
              {step === 1
                ? invitationData
                  ? `You have been invited to join ${invitationData.organization_name || 'an organization'} as a Telecaller.`
                  : 'Enter your invitation code to activate your assigned caller workspace.'
                : `Enter the 6-digit verification code sent to ${maskedEmail}`}
            </p>
          </div>

          {invitationError ? (
            <div className="space-y-4">
              <div className="p-3.5 bg-[#FEECEB] border border-[#F8C8C6] rounded-[10px] text-xs text-[#C53030] flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold">Invitation Issue</div>
                  <div className="mt-0.5">{invitationError}</div>
                </div>
              </div>

              <div className="text-center pt-2">
                <Link
                  to="/login"
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-[#0B1F3A] text-white rounded-[10px] text-xs font-semibold hover:bg-[#071A33] transition-colors"
                >
                  <span>Go to Login</span>
                </Link>
              </div>
            </div>
          ) : (
            <>
              {error && (
                <div className="p-3 bg-[#FEECEB] border border-[#F8C8C6] rounded-[8px] text-xs text-[#C53030]">
                  {error}
                </div>
              )}

              {step === 1 ? (
                <form onSubmit={handleSendOtp} className="space-y-4">
                  {!tokenFromUrl && (
                    <div>
                      <label className="text-xs font-semibold text-[#172B4D] block mb-1">Invitation Token / Link</label>
                      <input
                        type="text"
                        required
                        placeholder="inv_..."
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-[#DCE4EE] rounded-[10px] text-xs text-[#172B4D] font-mono shadow-subtle focus:outline-none focus:border-[#0B1F3A]"
                      />
                    </div>
                  )}

                  {invitationData && (
                    <div className="p-3 bg-[#F6F8FB] border border-[#DCE4EE] rounded-[10px] text-xs space-y-1">
                      <div className="text-[#64748B]">Invited Name: <span className="font-semibold text-[#172B4D]">{invitationData.full_name}</span></div>
                      <div className="text-[#64748B]">Role: <span className="font-semibold text-[#1E4D8F]">TELECALLER</span></div>
                    </div>
                  )}

                  <div>
                    <label className="text-xs font-semibold text-[#172B4D] block mb-1">Work Email Address</label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-[#64748B] absolute left-3 top-2.5" />
                      <input
                        type="email"
                        required
                        placeholder="name@company.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 bg-white border border-[#DCE4EE] rounded-[10px] text-xs text-[#172B4D] shadow-subtle focus:outline-none focus:border-[#0B1F3A]"
                      />
                    </div>
                    <p className="text-[11px] text-[#64748B] mt-1">
                      Must match the email address registered on your invitation.
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#0B1F3A] hover:bg-[#071A33] text-white font-semibold text-xs rounded-[10px] shadow-subtle transition-all cursor-pointer disabled:opacity-50"
                  >
                    <span>{isLoading ? 'Verifying Invitation...' : 'Send Verification Code'}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </form>
              ) : (
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
                      <span>{isLoading ? 'Activating Workspace...' : 'Verify OTP & Join Workspace'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setStep(1);
                        setError(null);
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
            </>
          )}

          <div className="pt-4 border-t border-[#DCE4EE] text-center text-xs text-[#64748B]">
            Already an active member?{' '}
            <Link to="/login" className="font-semibold text-[#1E4D8F] hover:underline">
              Sign In
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
