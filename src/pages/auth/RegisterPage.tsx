import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Building2, CheckCircle2, Mail, MapPin, Phone, Shield, UserRound, Globe2 } from 'lucide-react';
import { OtpInput } from '@/components/auth/OtpInput';
import { useAuth } from '@/features/auth/AuthContext';
import { normalizeEmailAddress } from '@/lib/emailNormalization';
import { normalizePhoneNumber } from '@/lib/phoneNormalization';

const inputClass = 'w-full rounded-xl border border-[#DCE4EE] bg-white px-3.5 py-3 text-sm text-[#172B4D] shadow-sm outline-none transition focus:border-[#1E4D8F] focus:ring-2 focus:ring-[#1E4D8F]/10';

export const RegisterPage: React.FC = () => {
  const { requestOtp, verifyOtp } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [accountType, setAccountType] = useState<'owner' | 'telecaller'>('owner');
  const [step, setStep] = useState<1 | 2>(1);
  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [industry, setIndustry] = useState('Education Consultancy');
  const [businessEmail, setBusinessEmail] = useState('');
  const [businessPhone, setBusinessPhone] = useState('');
  const [businessLocation, setBusinessLocation] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [otp, setOtp] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [cooldown, setCooldown] = useState(60);
  const [expiresAt, setExpiresAt] = useState<string>();
  const [resendAvailableAt, setResendAvailableAt] = useState<string>();
  const [registrationTicket, setRegistrationTicket] = useState<string>();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validatedData = () => {
    if (!ownerName.trim() || !companyName.trim() || !businessLocation.trim()) {
      setError('Complete your name, organization, and business location.');
      return null;
    }
    const ownerEmail = normalizeEmailAddress(email);
    const companyEmail = normalizeEmailAddress(businessEmail);
    const ownerPhone = normalizePhoneNumber(phone);
    const companyPhone = normalizePhoneNumber(businessPhone);
    if (!ownerEmail.isValid || !companyEmail.isValid) {
      setError('Enter valid owner and business email addresses.');
      return null;
    }
    if (!ownerPhone.isValid || !companyPhone.isValid) {
      setError('Enter valid owner and business phone numbers, including the country code.');
      return null;
    }
    if (websiteUrl.trim()) {
      try {
        const url = new URL(websiteUrl.trim());
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid');
      } catch {
        setError('Enter a valid website URL beginning with https://.');
        return null;
      }
    }
    return {
      email: ownerEmail.normalized,
      phone: ownerPhone.normalized,
      businessEmail: companyEmail.normalized,
      businessPhone: companyPhone.normalized,
    };
  };

  const requestRegistrationOtp = async () => {
    const data = validatedData();
    if (!data) return;
    setError(null);
    setIsLoading(true);
    const result = await requestOtp({
      ...data,
      purpose: 'REGISTER',
      fullName: ownerName.trim(),
      companyName: companyName.trim(),
      industry,
      businessLocation: businessLocation.trim(),
      websiteUrl: websiteUrl.trim() || undefined,
    });
    setIsLoading(false);
    if (!result.success) {
      setError(result.error || 'We could not send the verification code.');
      return;
    }
    setRegistrationTicket(result.registrationTicket || result.verificationTicket);
    setMaskedEmail(result.maskedEmail || data.email);
    setCooldown(result.cooldownSeconds || 60);
    setExpiresAt(result.expiresAt);
    setResendAvailableAt(result.resendAvailableAt);
    setOtp('');
    setStep(2);
  };

  const handleContinue = async (event: React.FormEvent) => {
    event.preventDefault();
    await requestRegistrationOtp();
  };

  const handleVerifyOtp = async (code = otp) => {
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit verification code.');
      return;
    }
    const data = validatedData();
    if (!data) return;
    setError(null);
    setIsLoading(true);
    const result = await verifyOtp({
      ...data,
      otp: code,
      purpose: 'REGISTER',
      registrationTicket,
      verificationTicket: registrationTicket,
      registrationData: {
        companyName: companyName.trim(),
        ownerName: ownerName.trim(),
        email: data.email,
        industry,
        businessEmail: data.businessEmail,
        businessPhone: data.businessPhone,
        businessLocation: businessLocation.trim(),
        websiteUrl: websiteUrl.trim() || undefined,
      },
    });
    setIsLoading(false);
    if (!result.success) {
      setError(result.error || 'Verification failed. Check the code and try again.');
      return;
    }
    const destination = searchParams.get('next');
    navigate(destination?.startsWith('/') && !destination.startsWith('//') ? destination : '/owner/pricing');
  };

  return (
    <main className="min-h-screen bg-[#F6F8FB] px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex items-center justify-between">
          <Link to="/" className="inline-flex items-center gap-3" aria-label="ENCRIX home">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#0B1F3A] text-white"><Shield className="h-5 w-5" /></span>
            <span><strong className="block text-xl tracking-tight text-[#0B1F3A]">ENCRIX</strong><span className="text-xs text-[#64748B]">Secure workspace onboarding</span></span>
          </Link>
          <Link to="/login" className="text-sm font-semibold text-[#1E4D8F] hover:underline">Sign in</Link>
        </header>

        <div className="grid overflow-hidden rounded-3xl border border-[#DCE4EE] bg-white shadow-xl lg:grid-cols-[0.82fr_1.18fr]">
          <aside className="hidden bg-[#0B1F3A] p-8 text-white lg:flex lg:flex-col lg:justify-between xl:p-10">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-200">Owner onboarding</p>
              <h1 className="mt-4 text-3xl font-bold leading-tight">Set up your organization workspace.</h1>
              <p className="mt-4 text-sm leading-6 text-slate-300">Verify your email, save your business details, then review the available annual plan.</p>
            </div>
            <div className="space-y-4 rounded-2xl border border-white/15 bg-white/5 p-5">
              <div className="flex items-center gap-3 text-sm"><CheckCircle2 className="h-5 w-5 text-emerald-300" /> Email verified with a one-time code</div>
              <div className="flex items-center gap-3 text-sm"><CheckCircle2 className="h-5 w-5 text-emerald-300" /> Organization details saved to your account</div>
              <div className="flex items-center gap-3 text-sm"><CheckCircle2 className="h-5 w-5 text-emerald-300" /> Review pricing before payment setup</div>
            </div>
          </aside>

          <section className="p-5 sm:p-8 xl:p-10">
            <div className="mb-7 lg:hidden">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1E4D8F]">Secure owner onboarding</p>
              <h1 className="mt-2 text-2xl font-bold text-[#0B1F3A]">Create your ENCRIX account</h1>
            </div>
            <div className="mb-6 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1E4D8F]">Step {step} of 2</p>
                <h2 className="mt-1 text-xl font-bold text-[#0B1F3A]">{step === 1 ? 'Account and business details' : 'Verify your email'}</h2>
              </div>
              <div className="flex gap-1.5" aria-hidden="true"><span className="h-1.5 w-10 rounded-full bg-[#1E4D8F]" /><span className={`h-1.5 w-10 rounded-full ${step === 2 ? 'bg-[#1E4D8F]' : 'bg-[#DCE4EE]'}`} /></div>
            </div>

            {error && <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

            {step === 1 ? (
              <>
                <div className="mb-6 grid grid-cols-2 gap-2 rounded-xl bg-[#F6F8FB] p-1">
                  <button type="button" onClick={() => setAccountType('owner')} className={`rounded-lg px-3 py-2.5 text-sm font-semibold ${accountType === 'owner' ? 'bg-white text-[#0B1F3A] shadow-sm' : 'text-[#64748B]'}`}>Owner</button>
                  <button type="button" onClick={() => setAccountType('telecaller')} className={`rounded-lg px-3 py-2.5 text-sm font-semibold ${accountType === 'telecaller' ? 'bg-white text-[#0B1F3A] shadow-sm' : 'text-[#64748B]'}`}>Telecaller</button>
                </div>
                {accountType === 'telecaller' ? (
                  <div className="rounded-2xl border border-[#DCE4EE] bg-[#F9FBFD] p-5">
                    <h3 className="font-semibold text-[#0B1F3A]">Telecaller accounts are invitation-only</h3>
                    <p className="mt-2 text-sm leading-6 text-[#64748B]">Ask your organization owner to send you an ENCRIX invitation. Open the invitation link to verify your email and join the workspace.</p>
                    <Link to="/accept-invitation" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[#1E4D8F]">I have an invitation <ArrowRight className="h-4 w-4" /></Link>
                  </div>
                ) : (
                  <form onSubmit={handleContinue} className="space-y-6">
                    <fieldset className="space-y-4">
                      <legend className="mb-1 text-sm font-semibold text-[#0B1F3A]">Personal details</legend>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <label className="space-y-1.5"><span className="text-xs font-semibold text-[#475569]">Full name</span><span className="relative block"><UserRound className="absolute left-3 top-3.5 h-4 w-4 text-[#94A3B8]" /><input className={`${inputClass} pl-10`} autoComplete="name" required value={ownerName} onChange={e => setOwnerName(e.target.value)} placeholder="Your name" /></span></label>
                        <label className="space-y-1.5"><span className="text-xs font-semibold text-[#475569]">Mobile number</span><span className="relative block"><Phone className="absolute left-3 top-3.5 h-4 w-4 text-[#94A3B8]" /><input className={`${inputClass} pl-10`} autoComplete="tel" type="tel" required value={phone} onChange={e => setPhone(e.target.value)} placeholder="+91 98765 43210" /></span></label>
                      </div>
                      <label className="block space-y-1.5"><span className="text-xs font-semibold text-[#475569]">Email address</span><span className="relative block"><Mail className="absolute left-3 top-3.5 h-4 w-4 text-[#94A3B8]" /><input className={`${inputClass} pl-10`} autoComplete="email" type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" /></span></label>
                      <p className="text-xs text-[#64748B]">We use email verification for account access. No password is stored or sent during registration.</p>
                    </fieldset>

                    <fieldset className="space-y-4 border-t border-[#E6ECF3] pt-5">
                      <legend className="mb-1 text-sm font-semibold text-[#0B1F3A]">Business details</legend>
                      <label className="block space-y-1.5"><span className="text-xs font-semibold text-[#475569]">Business / organization name</span><span className="relative block"><Building2 className="absolute left-3 top-3.5 h-4 w-4 text-[#94A3B8]" /><input className={`${inputClass} pl-10`} autoComplete="organization" required value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="Organization name" /></span></label>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <label className="space-y-1.5"><span className="text-xs font-semibold text-[#475569]">Business category</span><select className={inputClass} value={industry} onChange={e => setIndustry(e.target.value)}><option>Education Consultancy</option><option>Real Estate</option><option>Recruitment Agency</option><option>Insurance Agency</option><option>Marketing Agency</option><option>Financial Services</option><option>Other</option></select></label>
                        <label className="space-y-1.5"><span className="text-xs font-semibold text-[#475569]">Business phone</span><input className={inputClass} autoComplete="tel" type="tel" required value={businessPhone} onChange={e => setBusinessPhone(e.target.value)} placeholder="+91 98765 43210" /></label>
                      </div>
                      <label className="block space-y-1.5"><span className="text-xs font-semibold text-[#475569]">Business email</span><input className={inputClass} autoComplete="email" type="email" required value={businessEmail} onChange={e => setBusinessEmail(e.target.value)} placeholder="hello@company.com" /></label>
                      <label className="block space-y-1.5"><span className="text-xs font-semibold text-[#475569]">Business location</span><span className="relative block"><MapPin className="absolute left-3 top-3.5 h-4 w-4 text-[#94A3B8]" /><input className={`${inputClass} pl-10`} autoComplete="street-address" required value={businessLocation} onChange={e => setBusinessLocation(e.target.value)} placeholder="City, state, country" /></span></label>
                      <label className="block space-y-1.5"><span className="text-xs font-semibold text-[#475569]">Website <span className="font-normal text-[#94A3B8]">(optional)</span></span><span className="relative block"><Globe2 className="absolute left-3 top-3.5 h-4 w-4 text-[#94A3B8]" /><input className={`${inputClass} pl-10`} type="url" value={websiteUrl} onChange={e => setWebsiteUrl(e.target.value)} placeholder="https://company.com" /></span></label>
                    </fieldset>
                    <button type="submit" disabled={isLoading} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0B1F3A] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#17385F] disabled:cursor-wait disabled:opacity-60">{isLoading ? 'Sending verification code…' : 'Continue to email verification'} <ArrowRight className="h-4 w-4" /></button>
                  </form>
                )}
              </>
            ) : (
              <div className="space-y-5">
                <p className="text-sm text-[#64748B]">Enter the 6-digit code sent to <strong className="text-[#172B4D]">{maskedEmail}</strong>. Your organization details are attached to this verified registration.</p>
                <OtpInput value={otp} onChange={setOtp} onComplete={code => void handleVerifyOtp(code)} onResend={() => void requestRegistrationOtp()} cooldownSeconds={cooldown} expiresAt={expiresAt} resendAvailableAt={resendAvailableAt} isLoading={isLoading} error={error || undefined} />
                <button type="button" onClick={() => void handleVerifyOtp()} disabled={isLoading || otp.length !== 6} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0B1F3A] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"><CheckCircle2 className="h-4 w-4" />{isLoading ? 'Verifying…' : 'Verify and continue'}</button>
                <button type="button" onClick={() => { setStep(1); setError(null); }} disabled={isLoading} className="mx-auto flex items-center gap-2 text-sm font-medium text-[#64748B] hover:text-[#0B1F3A]"><ArrowLeft className="h-4 w-4" /> Edit registration details</button>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
};
