import React, { useState } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import { Shield, Building, User, Mail, Phone, ArrowRight, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { OtpInput } from '@/components/auth/OtpInput';
import { normalizePhoneNumber } from '@/lib/phoneNormalization';
import { normalizeEmailAddress } from '@/lib/emailNormalization';

export const RegisterPage: React.FC = () => {
  const { requestOtp, verifyOtp } = useAuth();
  const navigate = useNavigate();

  // Step 1: Account Details Form, Step 2: Verify Email OTP
  const [step, setStep] = useState<1 | 2>(1);

  // Form fields
  const [companyName, setCompanyName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [industry, setIndustry] = useState('Education Consultancy');
  const [companySize, setCompanySize] = useState('1-10');

  // OTP Verification state
  const [otp, setOtp] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [cooldown, setCooldown] = useState(60);
  const [expiresAt, setExpiresAt] = useState<string | undefined>(undefined);
  const [resendAvailableAt, setResendAvailableAt] = useState<string | undefined>(undefined);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1: Validate and Request OTP
  const handleContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!ownerName.trim()) {
      setError('Full Name is required.');
      return;
    }

    if (!companyName.trim()) {
      setError('Business / Organization Name is required.');
      return;
    }

    const normEmail = normalizeEmailAddress(email);
    if (!normEmail.isValid) {
      setError(normEmail.error || 'Please enter a valid work email address (e.g. name@company.com)');
      return;
    }

    let normPhone = null;
    if (phone.trim()) {
      normPhone = normalizePhoneNumber(phone);
      if (!normPhone.isValid) {
        setError(normPhone.error || 'Please enter a valid phone number (e.g. +91 98765 43210)');
        return;
      }
    }

    setIsLoading(true);
    const result = await requestOtp({
      email: normEmail.normalized,
      phone: normPhone?.normalized,
      purpose: 'REGISTER',
      fullName: ownerName.trim(),
      companyName: companyName.trim(),
      industry,
      companySize,
    });
    setIsLoading(false);

    if (result.success) {
      setMaskedEmail(result.maskedEmail || normEmail.masked);
      setCooldown(result.cooldownSeconds || 60);
      setExpiresAt(result.expiresAt);
      setResendAvailableAt(result.resendAvailableAt);
      setStep(2);
      setOtp('');
    } else {
      setError(result.error || 'Failed to send verification code.');
    }
  };

  // Step 2: Verify Email OTP & Create Owner Account
  const handleVerifyOtp = async (codeToVerify?: string) => {
    const code = codeToVerify || otp;
    if (!code || code.length !== 6) {
      setError('Enter the 6-digit verification code.');
      return;
    }

    setError(null);
    setIsLoading(true);

    const normEmail = normalizeEmailAddress(email);
    const normPhone = phone.trim() ? normalizePhoneNumber(phone) : null;

    const result = await verifyOtp({
      email: normEmail.normalized,
      phone: normPhone?.normalized,
      otp: code,
      purpose: 'REGISTER',
      registrationData: {
        companyName: companyName.trim(),
        ownerName: ownerName.trim(),
        email: normEmail.normalized,
        industry,
        companySize,
      },
    });
    setIsLoading(false);

    if (result.success) {
      navigate('/owner');
    } else {
      setError(result.error || 'Verification failed. Please check the code.');
    }
  };

  const handleResendOtp = async () => {
    setError(null);
    setIsLoading(true);
    const normEmail = normalizeEmailAddress(email);
    const normPhone = phone.trim() ? normalizePhoneNumber(phone) : null;

    const result = await requestOtp({
      email: normEmail.normalized,
      phone: normPhone?.normalized,
      purpose: 'REGISTER',
      fullName: ownerName.trim(),
      companyName: companyName.trim(),
      industry,
      companySize,
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
      <div className="sm:mx-auto sm:w-full sm:max-w-lg text-center">
        <Link to="/" className="inline-flex items-center gap-2.5 mb-2">
          <div className="flex h-11 w-11 items-center justify-center rounded-[10px] bg-[#0B1F3A] text-white shadow-subtle">
            <Shield className="h-6 w-6" />
          </div>
          <span className="text-2xl font-bold tracking-tight text-[#0B1F3A]">ENCRIX</span>
        </Link>
        <p className="text-xs text-[#64748B] font-medium">
          Create an enterprise workspace for your organization.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-lg">
        <div className="bg-white border border-[#DCE4EE] py-8 px-6 shadow-card rounded-[12px] sm:px-10 space-y-6">
          <div className="text-center">
            <h2 className="text-lg font-bold text-[#0B1F3A]">
              {step === 1 ? 'Create Your ENCRIX Account' : 'Verify Your Email'}
            </h2>
            <p className="text-xs text-[#64748B] mt-1">
              {step === 1
                ? 'Your organization workspace and owner account will be activated after email verification.'
                : `Enter the 6-digit verification code sent to ${maskedEmail}`}
            </p>
          </div>

          {error && (
            <div className="p-3 bg-[#FEECEB] border border-[#F8C8C6] rounded-[8px] text-xs text-[#C53030]">
              {error}
            </div>
          )}

          {step === 1 ? (
            <form onSubmit={handleContinue} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-[#172B4D] font-semibold block mb-1">Full Name</label>
                  <div className="relative">
                    <User className="w-4 h-4 text-[#64748B] absolute left-3 top-2.5" />
                    <input
                      type="text"
                      required
                      value={ownerName}
                      onChange={(e) => setOwnerName(e.target.value)}
                      placeholder="e.g. Sameer Kapoor"
                      className="w-full pl-9 pr-3 py-2 bg-white border border-[#DCE4EE] rounded-[10px] text-[#172B4D] placeholder-[#94A3B8] shadow-subtle focus:outline-none focus:border-[#0B1F3A]"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[#172B4D] font-semibold block mb-1">Business / Organization Name</label>
                  <div className="relative">
                    <Building className="w-4 h-4 text-[#64748B] absolute left-3 top-2.5" />
                    <input
                      type="text"
                      required
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      placeholder="e.g. Apex Edutech"
                      className="w-full pl-9 pr-3 py-2 bg-white border border-[#DCE4EE] rounded-[10px] text-[#172B4D] placeholder-[#94A3B8] shadow-subtle focus:outline-none focus:border-[#0B1F3A]"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-[#172B4D] font-semibold block mb-1">Work Email</label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-[#64748B] absolute left-3 top-2.5" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="owner@apexedutech.com"
                      className="w-full pl-9 pr-3 py-2 bg-white border border-[#DCE4EE] rounded-[10px] text-[#172B4D] placeholder-[#94A3B8] shadow-subtle focus:outline-none focus:border-[#0B1F3A]"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[#172B4D] font-semibold block mb-1">
                    Phone Number <span className="text-[#94A3B8] font-normal">(Optional)</span>
                  </label>
                  <div className="relative">
                    <Phone className="w-4 h-4 text-[#64748B] absolute left-3 top-2.5" />
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+91 98000 12345"
                      className="w-full pl-9 pr-3 py-2 bg-white border border-[#DCE4EE] rounded-[10px] text-[#172B4D] placeholder-[#94A3B8] shadow-subtle focus:outline-none focus:border-[#0B1F3A]"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-[#172B4D] font-semibold block mb-1">Industry</label>
                  <select
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-[#DCE4EE] rounded-[10px] text-[#172B4D] shadow-subtle focus:outline-none focus:border-[#0B1F3A]"
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
                  <label className="text-[#172B4D] font-semibold block mb-1">Team Size</label>
                  <select
                    value={companySize}
                    onChange={(e) => setCompanySize(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-[#DCE4EE] rounded-[10px] text-[#172B4D] shadow-subtle focus:outline-none focus:border-[#0B1F3A]"
                  >
                    <option value="1-10">1-10 Telecallers</option>
                    <option value="11-50">11-50 Telecallers</option>
                    <option value="51-200">51-200 Telecallers</option>
                    <option value="200+">200+ Telecallers</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#0B1F3A] hover:bg-[#071A33] text-white font-semibold text-xs rounded-[10px] shadow-subtle transition-all cursor-pointer disabled:opacity-50 mt-2"
              >
                <span>{isLoading ? 'Sending Verification Code...' : 'Continue'}</span>
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
                  <span>{isLoading ? 'Activating Account...' : 'Verify OTP'}</span>
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
                  <span>Edit Registration Details</span>
                </button>
              </div>
            </div>
          )}

          <div className="pt-4 border-t border-[#DCE4EE] text-center text-xs text-[#64748B]">
            Already have an account?{' '}
            <Link to="/login" className="font-semibold text-[#1E4D8F] hover:underline">
              Sign In
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
