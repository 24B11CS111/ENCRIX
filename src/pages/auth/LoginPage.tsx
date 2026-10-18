import React, { useState } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import { Shield, Mail, ArrowRight, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { OtpInput } from '@/components/auth/OtpInput';
import { normalizeEmailAddress } from '@/lib/emailNormalization';

export const LoginPage: React.FC = () => {
  const { requestOtp, verifyOtp } = useAuth();
  const navigate = useNavigate();

  // Screen Step: 1 = Enter Email, 2 = Verify OTP
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [cooldown, setCooldown] = useState(60);
  const [expiresAt, setExpiresAt] = useState<string | undefined>(undefined);
  const [resendAvailableAt, setResendAvailableAt] = useState<string | undefined>(undefined);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1: Send OTP
  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

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

  // Step 2: Verify OTP
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
      purpose: 'LOGIN',
    });
    setIsLoading(false);

    if (result.success) {
      if (result.role === 'ADMIN') navigate('/admin');
      else if (result.role === 'OWNER') navigate('/owner');
      else navigate('/telecaller');
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
      purpose: 'LOGIN',
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
          Your Leads. Your Data. Under Your Control.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white border border-[#DCE4EE] py-8 px-6 shadow-card rounded-[12px] sm:px-10 space-y-6">
          <div className="text-center">
            <h2 className="text-lg font-bold text-[#0B1F3A]">
              {step === 1 ? 'Welcome Back' : 'Verify Your Email'}
            </h2>
            <p className="text-xs text-[#64748B] mt-1">
              {step === 1
                ? 'Sign in to your ENCRIX workspace using secure email OTP'
                : `Enter the 6-digit verification code sent to ${maskedEmail}`}
            </p>
          </div>

          {error && (
            <div className="p-3 bg-[#FEECEB] border border-[#F8C8C6] rounded-[8px] text-xs text-[#C53030]">
              {error}
            </div>
          )}

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
                  We'll send a one-time verification code to your email.
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

          <div className="pt-4 border-t border-[#DCE4EE] text-center text-xs text-[#64748B]">
            New to ENCRIX?{' '}
            <Link to="/register" className="font-semibold text-[#1E4D8F] hover:underline">
              Create an account
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
