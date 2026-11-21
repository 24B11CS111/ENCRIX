import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Building2, CreditCard, LockKeyhole, RefreshCw, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthContext';
import { authService } from '@/services/auth/authService';

interface BillingSnapshot {
  subscription: { status?: string; checkout_creation_status?: string; current_period_end?: string | null } | null;
  payments: Array<{ id: string; amount_paise: number; amount_refunded_paise?: number; currency: string; status: string; paid_at?: string | null; failed_at?: string | null; created_at: string }>;
  checkoutAvailable: boolean;
  error?: string;
}

interface RazorpayCheckoutResult {
  razorpay_payment_id: string;
  razorpay_subscription_id: string;
  razorpay_signature: string;
}

interface RazorpayCheckoutOptions {
  key: string;
  subscription_id: string;
  name: string;
  description: string;
  prefill?: { name?: string; email?: string; contact?: string };
  handler: (result: RazorpayCheckoutResult) => void;
  modal: { ondismiss: () => void };
  theme: { color: string };
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => {
      open: () => void;
      on: (event: 'payment.failed', handler: () => void) => void;
    };
  }
}

const stateLabel: Record<string, string> = {
  pending_payment: 'Payment pending', active: 'Subscription active', past_due: 'Payment needs attention',
  cancelled: 'Payment cancelled', expired: 'Subscription expired',
  reconciliation_required: 'Payment reconciliation required',
};

export const OwnerCheckoutPage: React.FC = () => {
  const { profile, organization } = useAuth();
  const [snapshot, setSnapshot] = useState<BillingSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [startingPayment, setStartingPayment] = useState(false);
  const [savingBusinessDetails, setSavingBusinessDetails] = useState(false);
  const [businessDetailsError, setBusinessDetailsError] = useState<string | null>(null);
  const [businessDetailsReady, setBusinessDetailsReady] = useState(Boolean(
    organization?.business_email && organization?.business_phone && organization?.business_location,
  ));
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const token = authService.getSessionToken();
      if (!token) {
        if (mounted) { setSnapshot({ subscription: null, payments: [], checkoutAvailable: false, error: 'Your secure session has expired. Sign in to continue.' }); setLoading(false); }
        return;
      }
      try {
        const [plansResponse, billingResponse] = await Promise.all([
          fetch('/api/billing/plans', { cache: 'no-store' }),
          fetch('/api/billing/subscription', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }),
        ]);
        const [plans, billing] = await Promise.all([plansResponse.json(), billingResponse.json()]);
        const business = Array.isArray(plans.plans) ? plans.plans.find((plan: any) => plan.code === 'business') : null;
        if (mounted) setSnapshot({
          subscription: billing.subscription || null,
          payments: Array.isArray(billing.payments) ? billing.payments : [],
          checkoutAvailable: Boolean(business?.checkoutAvailable),
          error: !billingResponse.ok ? billing.error || 'Billing status is unavailable.' : undefined,
        });
      } catch {
        if (mounted) setSnapshot({ subscription: null, payments: [], checkoutAvailable: false, error: 'Billing status is unavailable. Please try again.' });
      } finally { if (mounted) setLoading(false); }
    };
    void load();
    return () => { mounted = false; };
  }, []);

  const status = snapshot?.subscription?.checkout_creation_status === 'reconciliation_required' || snapshot?.subscription?.checkout_creation_status === 'creating'
    ? 'reconciliation_required'
    : snapshot?.subscription?.status;
  const formatDate = (date?: string | null) => date ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(date)) : 'Not available';
  const saveBusinessDetails = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusinessDetailsError(null);
    setSavingBusinessDetails(true);
    try {
      const token = authService.getSessionToken();
      if (!token) throw new Error('Your secure session has expired. Sign in again.');
      const form = new FormData(event.currentTarget);
      const response = await fetch('/api/billing/business-details', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          businessEmail: form.get('businessEmail'),
          businessPhone: form.get('businessPhone'),
          businessLocation: form.get('businessLocation'),
          websiteUrl: form.get('websiteUrl'),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error === 'INVALID_BUSINESS_DETAILS' ? 'Enter a valid business email, phone, and location.' : 'Business details could not be saved. Try again.');
      setBusinessDetailsReady(true);
    } catch (error) {
      setBusinessDetailsError(error instanceof Error ? error.message : 'Business details could not be saved.');
    } finally { setSavingBusinessDetails(false); }
  };
  const startPayment = async () => {
    setPaymentError(null);
    setStartingPayment(true);
    try {
      const token = authService.getSessionToken();
      if (!token) throw new Error('Your secure session has expired. Sign in again.');
      const requestKey = `encrix_business_checkout_${profile?.organization_id || 'owner'}`;
      let idempotencyKey = localStorage.getItem(requestKey);
      if (!idempotencyKey || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
        idempotencyKey = crypto.randomUUID();
        localStorage.setItem(requestKey, idempotencyKey);
      }
      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ planCode: 'business', idempotencyKey }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error === 'BILLING_PLAN_NOT_CONFIGURED'
        ? 'The Business checkout plan is not configured on the server.'
        : 'Checkout could not be started. Your payment has not been confirmed.');
      if (!window.Razorpay) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://checkout.razorpay.com/v1/checkout.js';
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Razorpay Checkout could not be loaded.'));
          document.body.appendChild(script);
        });
      }
      if (!window.Razorpay) throw new Error('Razorpay Checkout is unavailable.');
      const checkout = new window.Razorpay({
        key: payload.keyId,
        subscription_id: payload.subscriptionId,
        name: 'ENCRIX',
        description: 'ENCRIX Business · ₹9,999/year',
        prefill: { name: profile?.full_name, email: profile?.email, contact: profile?.phone },
        theme: { color: '#0B1F3A' },
        modal: { ondismiss: () => { setStartingPayment(false); setPaymentError('Checkout was closed. Return here to check the payment status or retry.'); } },
        handler: async (result) => {
          setPaymentError(null);
          try {
            const verifyResponse = await fetch('/api/billing/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify(result),
            });
            const verified = await verifyResponse.json();
            if (!verifyResponse.ok || verified.verified !== true) {
              throw new Error('Payment was received but could not yet be verified. Return to Pricing & Billing to check again.');
            }
            localStorage.removeItem(requestKey);
            window.location.assign('/owner');
          } catch (error) {
            setPaymentError(error instanceof Error ? error.message : 'Payment verification is pending.');
            setStartingPayment(false);
          }
        },
      });
      checkout.on('payment.failed', () => {
        setStartingPayment(false);
        setPaymentError('Payment was not completed. No paid subscription has been activated. You can retry checkout.');
      });
      checkout.open();
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : 'Checkout could not be started.');
    } finally {
      setStartingPayment(false);
    }
  };
  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-8">
      <Link to="/owner/pricing" className="inline-flex items-center gap-2 text-sm font-medium text-[#1E4D8F]"><ArrowLeft className="h-4 w-4" /> Pricing &amp; Billing</Link>
      <header><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#1E4D8F]">Secure checkout</p><h1 className="mt-1 text-2xl font-bold text-[#0B1F3A]">Complete Your ENCRIX Subscription</h1><p className="mt-1 text-sm text-[#64748B]">Confirm the organization and annual amount before payment setup.</p></header>
      {!businessDetailsReady && <form onSubmit={saveBusinessDetails} className="rounded-2xl border border-[#DCE4EE] bg-white p-5 shadow-subtle sm:p-6"><h2 className="text-sm font-semibold text-[#0B1F3A]">Complete your business details</h2><p className="mt-1 text-xs text-[#64748B]">Add the billing contact details for {organization?.name || 'your organization'} to continue.</p><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="space-y-1.5 text-xs font-medium text-[#475569]">Business email<input name="businessEmail" type="email" required defaultValue={organization?.business_email || ''} className="mt-1 block w-full rounded-xl border border-[#DCE4EE] px-3 py-2.5 text-sm" /></label><label className="space-y-1.5 text-xs font-medium text-[#475569]">Business phone<input name="businessPhone" type="tel" required defaultValue={organization?.business_phone || ''} placeholder="+91 98765 43210" className="mt-1 block w-full rounded-xl border border-[#DCE4EE] px-3 py-2.5 text-sm" /></label><label className="space-y-1.5 text-xs font-medium text-[#475569]">Business location<input name="businessLocation" required defaultValue={organization?.business_location || ''} placeholder="City, state, country" className="mt-1 block w-full rounded-xl border border-[#DCE4EE] px-3 py-2.5 text-sm" /></label><label className="space-y-1.5 text-xs font-medium text-[#475569]">Website (optional)<input name="websiteUrl" type="url" defaultValue={organization?.website_url || ''} placeholder="https://company.com" className="mt-1 block w-full rounded-xl border border-[#DCE4EE] px-3 py-2.5 text-sm" /></label></div>{businessDetailsError && <p role="alert" className="mt-3 text-xs text-red-700">{businessDetailsError}</p>}<button type="submit" disabled={savingBusinessDetails} className="mt-4 rounded-xl bg-[#0B1F3A] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{savingBusinessDetails ? 'Saving…' : 'Save business details'}</button></form>}
      <div className="grid gap-6 lg:grid-cols-[1fr_0.75fr]">
        <section className="rounded-2xl border border-[#DCE4EE] bg-white p-5 shadow-subtle sm:p-7">
          <div className="flex items-center gap-3 border-b border-[#E6ECF3] pb-5"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#EAF2FB] text-[#1E4D8F]"><Building2 className="h-5 w-5" /></span><div><h2 className="font-semibold text-[#0B1F3A]">{organization?.name || 'Organization'}</h2><p className="mt-0.5 text-xs text-[#64748B]">Owner: {profile?.full_name || 'Not available'}</p></div></div>
          <dl className="mt-5 space-y-4 text-sm"><div className="flex justify-between gap-4"><dt className="text-[#64748B]">Selected plan</dt><dd className="font-semibold text-[#172B4D]">ENCRIX Business</dd></div><div className="flex justify-between gap-4"><dt className="text-[#64748B]">Billing frequency</dt><dd className="font-medium text-[#172B4D]">Yearly · every 1 year</dd></div><div className="flex justify-between gap-4"><dt className="text-[#64748B]">Payment status</dt><dd className="font-medium text-[#172B4D]">{loading ? 'Checking…' : snapshot?.error ? 'Status unavailable' : stateLabel[status || ''] || 'No payment started'}</dd></div>{snapshot?.subscription?.current_period_end && <div className="flex justify-between gap-4"><dt className="text-[#64748B]">Next renewal</dt><dd className="font-medium text-[#172B4D]">{formatDate(snapshot.subscription.current_period_end)}</dd></div>}</dl>
          {!snapshot?.checkoutAvailable && <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4"><div className="flex gap-3"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" /><div><p className="text-sm font-semibold text-amber-900">Test checkout is unavailable</p><p className="mt-1 text-xs leading-5 text-amber-800">A verified Razorpay Test Mode plan, test credentials, and billing database are required. No payment will be initiated until all checks pass.</p></div></div></div>}
          {snapshot?.error && <p role="status" className="mt-3 text-xs text-[#7C4A03]">{snapshot.error}</p>}
          <button type="button" disabled={!businessDetailsReady || !snapshot?.checkoutAvailable || startingPayment || status === 'reconciliation_required'} onClick={() => void startPayment()} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-[#0B1F3A] px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600"><CreditCard className="h-4 w-4" />{startingPayment ? 'Opening secure checkout…' : status === 'reconciliation_required' ? 'Payment review required' : 'PAY ₹9,999 & ACTIVATE ENCRIX'}</button>
          {paymentError && <p role="alert" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">{paymentError}</p>}
          <p className="mt-2 text-center text-xs text-[#64748B]">{snapshot?.checkoutAvailable ? 'Razorpay Test Mode checkout is available.' : 'Checkout unavailable until the staging verification gate is complete.'}</p>
        </section>
        <aside className="space-y-6">
          <section className="rounded-2xl border border-[#DCE4EE] bg-white p-5 shadow-subtle sm:p-6"><h2 className="text-sm font-semibold text-[#0B1F3A]">Payment summary</h2><div className="mt-4 flex items-start justify-between gap-4"><div><p className="text-sm font-medium text-[#172B4D]">ENCRIX Business</p><p className="mt-1 text-xs text-[#64748B]">Annual subscription · INR</p></div><p className="text-lg font-bold text-[#0B1F3A]">₹9,999</p></div><div className="mt-4 flex justify-between border-t border-[#E6ECF3] pt-4 text-sm"><span className="font-semibold text-[#172B4D]">Final payable amount</span><strong className="text-[#0B1F3A]">₹9,999</strong></div><p className="mt-3 text-xs leading-5 text-[#64748B]">The one-time onboarding fee is deferred and is not included. Twilio account, phone-number, and usage charges are paid separately by your organization to Twilio.</p></section>
          <section className="rounded-2xl border border-[#DCE4EE] bg-white p-5 shadow-subtle sm:p-6"><div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[#16845B]" /><h2 className="text-sm font-semibold text-[#0B1F3A]">Payment protection</h2></div><p className="mt-3 text-xs leading-5 text-[#64748B]">The server verifies the Razorpay signature and payment details before recording a successful payment or activating a subscription.</p><p className="mt-3 flex items-center gap-2 text-xs text-[#64748B]"><LockKeyhole className="h-4 w-4" /> Payment secrets stay on the server.</p></section>
          <section className="rounded-2xl border border-[#DCE4EE] bg-white p-5 shadow-subtle sm:p-6"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold text-[#0B1F3A]">Payment history</h2>{loading && <RefreshCw className="h-4 w-4 animate-spin text-[#64748B]" />}</div>{!loading && !snapshot?.payments.length ? <p className="mt-3 text-xs text-[#64748B]">No payment records are available.</p> : <ul className="mt-3 divide-y divide-[#E6ECF3]">{snapshot?.payments.map(payment => <li key={payment.id} className="flex justify-between gap-3 py-3 text-xs"><span><span className="block font-medium text-[#172B4D]">{payment.status === 'captured' ? 'Paid' : payment.status === 'failed' ? 'Failed' : payment.status}</span><span className="mt-1 block text-[#64748B]">{formatDate(payment.paid_at || payment.failed_at || payment.created_at)}</span>{Boolean(payment.amount_refunded_paise) && <span className="mt-1 block text-[#64748B]">Refunded ₹{((payment.amount_refunded_paise || 0) / 100).toLocaleString('en-IN')}</span>}</span><span className="font-semibold text-[#172B4D]">₹{(payment.amount_paise / 100).toLocaleString('en-IN')}</span></li>)}</ul>}</section>
        </aside>
      </div>
    </div>
  );
};

export default OwnerCheckoutPage;
