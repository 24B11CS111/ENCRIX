import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, LockKeyhole, Shield } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthContext';

export const PricingPage: React.FC = () => {
  const { profile, isAuthenticated, isLoading } = useAuth();
  const continueToPlan = isAuthenticated && profile?.role === 'OWNER'
    ? '/owner/pricing/checkout'
    : `/register?next=${encodeURIComponent('/owner/pricing/checkout')}`;

  return (
    <main className="min-h-screen bg-[#F6F8FB] px-4 py-8 text-[#172B4D] sm:px-6 sm:py-12">
      <div className="mx-auto max-w-6xl">
        <nav className="mb-12 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0B1F3A] text-white"><Shield className="h-5 w-5" /></span><span className="text-xl font-bold text-[#0B1F3A]">ENCRIX</span></Link>
          <Link to={isAuthenticated ? '/owner' : '/login'} className="text-sm font-semibold text-[#1E4D8F]">{isAuthenticated ? 'Dashboard' : 'Sign in'}</Link>
        </nav>
        <header className="mx-auto mb-10 max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#1E4D8F]">Plans and billing</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-[#0B1F3A] sm:text-4xl">Choose your ENCRIX plan</h1>
          <p className="mt-3 text-sm leading-6 text-[#64748B]">The current plan is shown below. Checkout will become available after the Razorpay test configuration and billing database setup pass verification.</p>
        </header>
        <section className="mx-auto max-w-3xl overflow-hidden rounded-3xl border border-[#DCE4EE] bg-white shadow-xl">
          <div className="bg-[#0B1F3A] p-6 text-white sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-200">Available plan</p><h2 className="mt-2 text-2xl font-bold">ENCRIX Business</h2></div>
              <span className="rounded-full border border-amber-200/30 bg-amber-100/10 px-3 py-1 text-xs font-medium text-amber-100">Checkout setup in progress</span>
            </div>
            <p className="mt-6"><strong className="text-4xl">₹9,999</strong><span className="ml-2 text-sm text-blue-100">/ year · INR</span></p>
            <p className="mt-2 text-sm text-blue-100">Annual billing · 1 year per billing period</p>
          </div>
          <div className="p-6 sm:p-8">
            <div className="rounded-2xl border border-[#E6ECF3] bg-[#F9FBFD] p-4">
              <div className="flex items-start gap-3"><LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-[#1E4D8F]" /><p className="text-sm leading-6 text-[#475569]">₹9,999 INR is the full annual ENCRIX subscription price. There is no onboarding or registration fee. Twilio account, phone-number, and usage charges are paid separately by your organization to Twilio. Paid access begins only after server verification.</p></div>
            </div>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              {isLoading ? <span role="status" className="text-sm text-[#64748B]">Checking your account…</span> : profile?.role === 'TELECALLER' ? <span className="text-sm text-[#64748B]">Plan purchase is available to organization owners.</span> : <Link to={continueToPlan} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#0B1F3A] px-5 py-3 text-sm font-semibold text-white hover:bg-[#17385F]">{isAuthenticated ? 'Continue to checkout' : 'Get started'} <ArrowRight className="h-4 w-4" /></Link>}
              <Link to="/" className="text-center text-sm font-medium text-[#64748B] hover:text-[#0B1F3A]">Back to ENCRIX</Link>
            </div>
            <div className="mt-6 flex items-center gap-2 border-t border-[#E6ECF3] pt-5 text-xs text-[#64748B]"><Check className="h-4 w-4 text-[#16845B]" /> Your selected plan and organization details carry into the shared checkout path.</div>
          </div>
        </section>
      </div>
    </main>
  );
};
