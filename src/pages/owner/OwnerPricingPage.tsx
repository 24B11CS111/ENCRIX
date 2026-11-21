import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  CreditCard,
  LockKeyhole,
  RefreshCw,
} from 'lucide-react';
import { useAuth } from '@/features/auth/AuthContext';
import { authService } from '@/services/auth/authService';

interface BillingPlanSummary {
  code: string;
  displayName: string;
  billingInterval: string;
  billingIntervalCount: number;
  currency: string;
  priceInr: number | null;
  checkoutAvailable: boolean;
}

interface SubscriptionSummary {
  plan_code?: string;
  status?: string;
  checkout_creation_status?: string;
  current_period_start?: string | null;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean;
  cancellation_request_status?: string;
  cancellation_requested_at?: string | null;
  cancellation_effective_at?: string | null;
}

interface SubscriptionHistoryItem extends SubscriptionSummary {
  id: string;
  is_current?: boolean;
  entitlement_source?: string;
  cancelled_at?: string | null;
  ended_at?: string | null;
  last_payment_at?: string | null;
  created_at?: string;
}

interface PricingPageState {
  plan: BillingPlanSummary | null;
  planError: string | null;
  subscription: SubscriptionSummary | null;
  subscriptions: SubscriptionHistoryItem[];
  hasSubscriptionRecord: boolean;
  refundRequests: Array<{ id: string; payment_id: string; requested_amount_paise: number; approved_amount_paise?: number | null; status: string; created_at: string }>;
  cancellationMessage: string | null;
  subscriptionError: string | null;
  payments: Array<{ id: string; amount_paise: number; amount_refunded_paise?: number; currency: string; status: string; paid_at?: string | null; failed_at?: string | null; created_at: string }>;
  loading: boolean;
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await response.json();
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function subscriptionErrorMessage(status: number, code: unknown): string {
  if (status === 403) return 'Subscription details are only available to an authorized organization owner.';
  if (code === 'BILLING_DATABASE_CONFIGURATION_MISSING' || code === 'BILLING_DATABASE_UNAVAILABLE') {
    return 'Billing records are unavailable. The billing database setup must be completed before account billing can be shown.';
  }
  return 'We could not load subscription details right now. Please try again later.';
}

function formatDate(value?: string | null): string {
  if (!value) return 'Not available';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Not available'
    : new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(date);
}

function statusLabel(status?: string): string {
  switch (status) {
    case 'reconciliation_required': return 'Payment reconciliation required';
    case 'active': return 'Active';
    case 'pending_payment': return 'Pending payment';
    case 'past_due': return 'Past due';
    case 'cancelled': return 'Cancelled';
    case 'expired': return 'Expired';
    default: return 'No active subscription';
  }
}

export const OwnerPricingPage: React.FC = () => {
  const { organization } = useAuth();
  const [pageState, setPageState] = useState<PricingPageState>({
    plan: null,
    planError: null,
    subscription: null,
    subscriptions: [],
    hasSubscriptionRecord: false,
    refundRequests: [],
    cancellationMessage: null,
    subscriptionError: null,
    payments: [],
    loading: true,
  });

  useEffect(() => {
    let isMounted = true;

    const loadBilling = async () => {
      const token = authService.getSessionToken();
      const [plansResult, subscriptionResult] = await Promise.allSettled([
        fetch('/api/billing/plans', { headers: { Accept: 'application/json' }, cache: 'no-store' }),
        token
          ? fetch('/api/billing/subscription', {
              headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
              cache: 'no-store',
            })
          : Promise.resolve(null),
      ]);

      if (!isMounted) return;

      let plan: BillingPlanSummary | null = null;
      let planError: string | null = null;
      if (plansResult.status === 'fulfilled' && plansResult.value.ok) {
        const payload = await readJson(plansResult.value);
        const plans = Array.isArray(payload?.plans) ? payload.plans : [];
        const business = plans.find((item): item is BillingPlanSummary =>
          Boolean(item && typeof item === 'object' && (item as BillingPlanSummary).code === 'business'),
        );
        if (business) plan = business;
        else planError = 'The Business plan is not present in the server billing catalog.';
      } else {
        planError = 'Plan configuration is unavailable. Checkout remains disabled.';
      }

      let subscription: SubscriptionSummary | null = null;
      let subscriptions: SubscriptionHistoryItem[] = [];
      let payments: PricingPageState['payments'] = [];
      let hasSubscriptionRecord = false;
      let refundRequests: PricingPageState['refundRequests'] = [];
      let subscriptionError: string | null = null;
      if (!token) {
        subscriptionError = 'Your secure session is unavailable. Sign in again to view subscription details.';
      } else if (subscriptionResult.status === 'rejected') {
        subscriptionError = 'We could not load subscription details right now. Please try again later.';
      } else if (subscriptionResult.value === null) {
        subscriptionError = 'Your secure session is unavailable. Sign in again to view subscription details.';
      } else {
        const payload = await readJson(subscriptionResult.value);
        if (subscriptionResult.value.ok && payload && Object.prototype.hasOwnProperty.call(payload, 'subscription')) {
          hasSubscriptionRecord = true;
          const record = payload.subscription;
          if (record && typeof record === 'object' && !Array.isArray(record)) {
            subscription = record as SubscriptionSummary;
          }
          if (Array.isArray(payload.subscriptions)) subscriptions = payload.subscriptions as SubscriptionHistoryItem[];
          if (Array.isArray(payload.payments)) payments = payload.payments as PricingPageState['payments'];
          if (Array.isArray(payload.refundRequests)) refundRequests = payload.refundRequests as PricingPageState['refundRequests'];
        } else {
          subscriptionError = subscriptionErrorMessage(subscriptionResult.value.status, payload?.error);
        }
      }

      setPageState({ plan, planError, subscription, subscriptions, hasSubscriptionRecord, refundRequests, cancellationMessage: null, subscriptionError, payments, loading: false });
    };

    void loadBilling().catch(() => {
      if (!isMounted) return;
      setPageState({
        plan: null,
        planError: 'Plan configuration is unavailable. Test checkout remains unavailable.',
        subscription: null,
        subscriptions: [],
        hasSubscriptionRecord: false,
        refundRequests: [],
        cancellationMessage: null,
        subscriptionError: 'We could not load subscription details right now. Please try again later.',
        payments: [],
        loading: false,
      });
    });

    return () => { isMounted = false; };
  }, []);

  const serverAnnualPriceIsConfigured = Boolean(
    pageState.plan?.currency === 'INR' &&
    pageState.plan.priceInr === 9999 &&
    pageState.plan.billingInterval === 'yearly' &&
    pageState.plan.billingIntervalCount === 1,
  );
  const testCheckoutAvailable = pageState.plan?.checkoutAvailable === true;
  const currentStatus = pageState.subscription?.checkout_creation_status === 'reconciliation_required' || pageState.subscription?.checkout_creation_status === 'creating'
    ? 'reconciliation_required'
    : pageState.subscription?.status;
  const [refundDrafts, setRefundDrafts] = useState<Record<string, { amount: string; reason: string; message: string | null; busy: boolean }>>({});
  const [cancellationBusy, setCancellationBusy] = useState(false);

  const requestPeriodEndCancellation = async () => {
    const token = authService.getSessionToken();
    if (!token) { setPageState((state) => ({ ...state, cancellationMessage: 'Sign in again before requesting cancellation.' })); return; }
    setCancellationBusy(true);
    try {
      const response = await fetch('/api/billing/cancel-subscription', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
      });
      const payload = await readJson(response);
      if (!response.ok || payload?.status !== 'scheduled') {
        setPageState((state) => ({ ...state, cancellationMessage: payload?.status === 'pending_reconciliation'
          ? 'The provider result is not confirmed. Your request is being reconciled; do not submit another cancellation.'
          : 'Cancellation could not be confirmed. Your subscription remains unchanged; contact support if this persists.' }));
        return;
      }
      setPageState((state) => ({ ...state, subscription: state.subscription ? {
        ...state.subscription, cancel_at_period_end: true, cancellation_request_status: 'scheduled',
        cancellation_effective_at: String(payload.effectiveAt || ''),
      } : null, cancellationMessage: 'Cancellation is scheduled with the provider. Paid access continues through the current period end.' }));
    } catch {
      setPageState((state) => ({ ...state, cancellationMessage: 'The provider result could not be confirmed. The request requires reconciliation.' }));
    } finally { setCancellationBusy(false); }
  };

  const submitRefundRequest = async (paymentId: string) => {
    const draft = refundDrafts[paymentId];
    const amount = Number(draft?.amount);
    if (!draft || !Number.isFinite(amount) || amount <= 0 || !draft.reason.trim()) return;
    const token = authService.getSessionToken();
    if (!token) { setRefundDrafts((all) => ({ ...all, [paymentId]: { ...draft, message: 'Sign in again to request a refund review.', busy: false } })); return; }
    setRefundDrafts((all) => ({ ...all, [paymentId]: { ...draft, busy: true, message: null } }));
    try {
      const response = await fetch('/api/billing/refund-request', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ paymentId, amountPaise: Math.round(amount * 100), reason: draft.reason, idempotencyKey: crypto.randomUUID() }),
      });
      const payload = await readJson(response);
      if (!response.ok) throw new Error('Refund request could not be submitted. Check the amount and remaining refundable balance.');
      setRefundDrafts((all) => ({ ...all, [paymentId]: { ...draft, busy: false, message: 'Request submitted for manual administrator review. No refund has been issued.' } }));
      const request = payload?.refundRequest as any;
      if (request?.id) setPageState((state) => ({ ...state, refundRequests: [{
        id: request.id, payment_id: paymentId, requested_amount_paise: Math.round(amount * 100), status: request.status || 'requested', created_at: new Date().toISOString(),
      }, ...state.refundRequests] }));
    } catch (error) {
      setRefundDrafts((all) => ({ ...all, [paymentId]: { ...draft, busy: false, message: error instanceof Error ? error.message : 'Refund request failed.' } }));
    }
  };

  return (
    <div className="max-w-5xl space-y-6 pb-6">
      <header className="flex flex-col gap-3 border-b border-[#DCE4EE] pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#1E4D8F]">Organization billing</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-[#0B1F3A]">Pricing &amp; Billing</h1>
          <p className="mt-1 max-w-2xl text-sm text-[#64748B]">
            Review the ENCRIX Business annual subscription and your organization&apos;s billing status. The one-time onboarding fee is deferred and is not charged.
          </p>
        </div>
        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-[#DCE4EE] bg-white px-3 py-1.5 text-xs font-medium text-[#64748B]">
          <Building2 className="h-4 w-4 text-[#1E4D8F]" aria-hidden="true" />
          <span>{organization?.name || 'Organization account'}</span>
        </div>
      </header>

      <section aria-labelledby="business-plan-heading" className="overflow-hidden rounded-2xl border border-[#DCE4EE] bg-white shadow-subtle">
        <div className="bg-[#0B1F3A] px-5 py-5 text-white sm:px-7 sm:py-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-200">Business annual plan · access starts after verified payment</p>
              <h2 id="business-plan-heading" className="mt-1 text-xl font-bold">ENCRIX Business</h2>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium text-blue-50">
              <span className={`h-1.5 w-1.5 rounded-full ${testCheckoutAvailable ? 'bg-emerald-300' : 'bg-amber-300'}`} aria-hidden="true" />
              {testCheckoutAvailable ? 'Test Mode ready' : 'Test Mode configuration required'}
            </span>
          </div>
          <div className="mt-5 flex flex-wrap items-end gap-x-2 gap-y-1">
            <span className="text-3xl font-bold tracking-tight">₹9,999</span>
            <span className="pb-1 text-sm text-blue-100">/ year</span>
          </div>
              <p className="mt-1 text-sm text-blue-100">
                Annual recurring subscription · {serverAnnualPriceIsConfigured ? '₹9,999 INR' : 'catalog unavailable'}
              </p>
        </div>

        <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="rounded-xl border border-[#E6ECF3] bg-[#F9FBFD] p-5">
            <h3 className="text-sm font-semibold text-[#0B1F3A]">Business plan details</h3>
            <p className="mt-2 text-xs leading-relaxed text-[#64748B]">Annual billing, INR currency, and the ₹9,999 amount are configured. Paid feature entitlements and limits have not been approved, so none are listed here.</p>
            <dl className="mt-5 divide-y divide-[#E6ECF3] text-xs">
              <div className="flex justify-between py-3"><dt className="text-[#64748B]">Billing interval</dt><dd className="font-medium text-[#172B4D]">1 year</dd></div>
              <div className="flex justify-between py-3"><dt className="text-[#64748B]">Currency</dt><dd className="font-medium text-[#172B4D]">INR</dd></div>
              <div className="flex justify-between py-3"><dt className="text-[#64748B]">Approved entitlements</dt><dd className="font-medium text-[#172B4D]">None published</dd></div>
            </dl>
          </div>

          <aside className="flex flex-col rounded-xl border border-[#DCE4EE] bg-[#F6F8FB] p-4 sm:p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#0B1F3A]">
              <CreditCard className="h-4 w-4 text-[#1E4D8F]" aria-hidden="true" />
              Subscribe to Business
            </div>
            <p className="mt-2 text-xs leading-relaxed text-[#64748B]">
              {testCheckoutAvailable
                ? 'Razorpay Test Mode is configured. The server verifies the plan and payment before activating access.'
                : 'Test checkout requires valid Razorpay Test Mode credentials, the matching ₹9,999/year plan, and the billing database.'}
            </p>
            {testCheckoutAvailable
              ? <Link to="/owner/pricing/checkout" className="mt-5 flex w-full items-center justify-center rounded-[10px] bg-[#0B1F3A] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#17385F]">Continue to Test Checkout · ₹9,999/year</Link>
              : <button type="button" disabled aria-describedby="checkout-disabled-reason" className="mt-5 w-full cursor-not-allowed rounded-[10px] bg-[#CBD5E1] px-4 py-2.5 text-sm font-semibold text-[#475569]">Test checkout unavailable</button>}
            <p id="checkout-disabled-reason" className="mt-2 text-center text-[11px] text-[#64748B]">
              {pageState.loading
                ? 'Checking server billing configuration…'
                : testCheckoutAvailable
                  ? 'Test Mode only. Live Razorpay keys are rejected by the server.'
                  : 'Checkout stays unavailable until server-side Test Mode plan and credential checks pass.'}
            </p>
            <div className="mt-auto border-t border-[#DCE4EE] pt-4">
              <div className="flex items-start gap-2 text-[11px] leading-relaxed text-[#64748B]">
                <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-[#16845B]" aria-hidden="true" />
                <span>Payment verification is handled by the server. The browser cannot set the billed amount or grant paid access.</span>
              </div>
            </div>
          </aside>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section aria-labelledby="subscription-status-heading" className="rounded-2xl border border-[#DCE4EE] bg-white p-5 shadow-subtle sm:p-6">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-[#1E4D8F]" aria-hidden="true" />
            <h2 id="subscription-status-heading" className="text-sm font-semibold text-[#0B1F3A]">Subscription status</h2>
          </div>
          {pageState.loading ? (
            <div role="status" className="mt-5 flex items-center gap-2 text-xs text-[#64748B]">
              <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading subscription status…
            </div>
          ) : pageState.subscriptionError ? (
            <div role="status" className="mt-4 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-[#7C4A03]">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{pageState.subscriptionError}</span>
            </div>
          ) : (
            <>
              <p className="mt-4 text-lg font-semibold text-[#0B1F3A]">{statusLabel(currentStatus)}</p>
              <p className="mt-1 text-xs text-[#64748B]">
                {pageState.hasSubscriptionRecord
                  ? 'Status returned by the billing service.'
                  : 'No subscription record was returned for this organization.'}
              </p>
              {pageState.subscription && (
                <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-[#E6ECF3] pt-4 text-xs">
                  <div>
                    <dt className="text-[#64748B]">Current period starts</dt>
                    <dd className="mt-1 font-medium text-[#172B4D]">{formatDate(pageState.subscription.current_period_start)}</dd>
                  </div>
                  <div>
                    <dt className="text-[#64748B]">Current period ends</dt>
                    <dd className="mt-1 font-medium text-[#172B4D]">{formatDate(pageState.subscription.current_period_end)}</dd>
                  </div>
                </dl>
              )}
            </>
          )}
        </section>

        <section aria-labelledby="billing-information-heading" className="rounded-2xl border border-[#DCE4EE] bg-white p-5 shadow-subtle sm:p-6">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-[#1E4D8F]" aria-hidden="true" />
            <h2 id="billing-information-heading" className="text-sm font-semibold text-[#0B1F3A]">Billing information</h2>
          </div>
          <dl className="mt-4 divide-y divide-[#E6ECF3] text-xs">
            <div className="flex justify-between gap-4 py-3">
              <dt className="text-[#64748B]">Organization</dt>
              <dd className="text-right font-medium text-[#172B4D]">{organization?.name || 'Not available'}</dd>
            </div>
            <div className="flex justify-between gap-4 py-3">
              <dt className="text-[#64748B]">Planned billing frequency</dt>
              <dd className="text-right font-medium text-[#172B4D]">Annual recurring</dd>
            </div>
            <div className="flex justify-between gap-4 py-3">
              <dt className="text-[#64748B]">Server catalog</dt>
              <dd className="text-right font-medium text-[#172B4D]">
                {pageState.loading
                  ? 'Loading…'
                  : pageState.planError
                    ? 'Unavailable'
                    : serverAnnualPriceIsConfigured
                      ? '₹9,999/year configured'
                      : `${pageState.plan?.billingInterval || 'Unknown'} draft`}
              </dd>
            </div>
          </dl>
          {(pageState.planError || (!pageState.loading && !serverAnnualPriceIsConfigured)) && (
            <div role="status" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] leading-relaxed text-[#7C4A03]">
              {pageState.planError || 'The API does not confirm ₹9,999/year in the Business catalog. The displayed amount remains a proposed price, not a configured charge.'}
            </div>
          )}
        </section>
      </div>

      {pageState.subscription && pageState.subscription.status === 'active' && (
        <section aria-labelledby="cancellation-heading" className="rounded-2xl border border-[#DCE4EE] bg-white p-5 shadow-subtle sm:p-6">
          <h2 id="cancellation-heading" className="text-sm font-semibold text-[#0B1F3A]">Subscription cancellation</h2>
          {pageState.subscription.cancel_at_period_end ? (
            <p className="mt-2 text-sm text-[#172B4D]">Cancellation scheduled for {formatDate(pageState.subscription.cancellation_effective_at || pageState.subscription.current_period_end)}. Paid access continues until that date.</p>
          ) : <><p className="mt-2 text-xs text-[#64748B]">Request cancellation at the end of the current paid period. Access remains active until the period expires.</p>
            <button type="button" onClick={() => void requestPeriodEndCancellation()} disabled={cancellationBusy} className="mt-4 rounded-xl border border-[#B42318] px-4 py-2 text-sm font-semibold text-[#B42318] disabled:opacity-60">{cancellationBusy ? 'Submitting…' : 'Cancel at period end'}</button></>}
          {pageState.cancellationMessage && <p role="status" className="mt-3 text-xs text-[#475569]">{pageState.cancellationMessage}</p>}
        </section>
      )}

      <section aria-labelledby="subscription-history-heading" className="rounded-2xl border border-[#DCE4EE] bg-white p-5 shadow-subtle sm:p-6">
        <h2 id="subscription-history-heading" className="text-sm font-semibold text-[#0B1F3A]">Subscription history</h2>
        {pageState.loading ? <p className="mt-3 text-xs text-[#64748B]">Loading subscription history…</p> : pageState.subscriptionError ? <p className="mt-3 text-xs text-[#64748B]">Subscription history is unavailable.</p> : pageState.subscriptions.length === 0 ? <p className="mt-3 text-xs text-[#64748B]">No subscription records are available.</p> : <ul className="mt-3 divide-y divide-[#E6ECF3]">{pageState.subscriptions.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-xs"><span><span className="block font-medium text-[#172B4D]">{statusLabel(item.status)}{item.is_current ? ' · Current' : ''}</span><span className="mt-1 block text-[#64748B]">Started {formatDate(item.current_period_start || item.created_at)} · Ends {formatDate(item.current_period_end || item.ended_at)}</span></span><span className="font-medium text-[#64748B]">{item.plan_code === 'business' ? 'Business · annual' : item.plan_code || 'Plan'}</span></li>)}</ul>}
      </section>

      <section aria-labelledby="payment-history-heading" className="rounded-2xl border border-[#DCE4EE] bg-white p-5 shadow-subtle sm:p-6">
        <h2 id="payment-history-heading" className="text-sm font-semibold text-[#0B1F3A]">Payment history</h2>
        {pageState.loading ? <p className="mt-3 text-xs text-[#64748B]">Loading payment history…</p> : pageState.subscriptionError ? <p className="mt-3 text-xs text-[#64748B]">Payment history is unavailable.</p> : pageState.payments.length === 0 ? <p className="mt-3 text-xs text-[#64748B]">No payment records are available.</p> : <ul className="mt-3 divide-y divide-[#E6ECF3]">{pageState.payments.map(payment => {
          const draft = refundDrafts[payment.id] || { amount: String(((payment.amount_paise - (payment.amount_refunded_paise || 0)) / 100).toFixed(2)), reason: '', message: null, busy: false };
          const request = pageState.refundRequests.find((item) => item.payment_id === payment.id && ['requested','under_review','approved','processing'].includes(item.status));
          return <li key={payment.id} className="space-y-3 py-3 text-xs"><div className="flex flex-wrap items-center justify-between gap-3"><span><span className="block font-medium capitalize text-[#172B4D]">{payment.status}</span><span className="mt-1 block text-[#64748B]">{formatDate(payment.paid_at || payment.failed_at || payment.created_at)}</span>{Boolean(payment.amount_refunded_paise) && <span className="mt-1 block text-[#64748B]">Refunded {payment.currency} {((payment.amount_refunded_paise || 0) / 100).toLocaleString('en-IN')}</span>}</span><span className="font-semibold text-[#172B4D]">{payment.currency} {(payment.amount_paise / 100).toLocaleString('en-IN')}</span></div>
            {payment.status === 'captured' && (request ? <p className="text-[#64748B]">Refund review status: {request.status.replaceAll('_',' ')}. No refund is confirmed until the provider reports completion.</p> : <div className="grid gap-2 sm:grid-cols-[150px_1fr_auto]"><label className="sr-only" htmlFor={`refund-amount-${payment.id}`}>Refund amount in INR</label><input id={`refund-amount-${payment.id}`} type="number" min="0.01" max={(payment.amount_paise - (payment.amount_refunded_paise || 0)) / 100} step="0.01" value={draft.amount} onChange={(event) => setRefundDrafts((all) => ({ ...all, [payment.id]: { ...draft, amount: event.target.value } }))} className="rounded-lg border border-[#DCE4EE] px-3 py-2" aria-label="Refund amount in INR" /><input value={draft.reason} onChange={(event) => setRefundDrafts((all) => ({ ...all, [payment.id]: { ...draft, reason: event.target.value } }))} placeholder="Reason for refund review" maxLength={1000} className="rounded-lg border border-[#DCE4EE] px-3 py-2" aria-label="Reason for refund review" /><button type="button" onClick={() => void submitRefundRequest(payment.id)} disabled={draft.busy || !draft.reason.trim()} className="rounded-lg border border-[#1E4D8F] px-3 py-2 font-semibold text-[#1E4D8F] disabled:opacity-50">{draft.busy ? 'Submitting…' : 'Request refund review'}</button></div>)}
            {draft.message && <p role="status" className="text-[#475569]">{draft.message}</p>}</li>;
        })}</ul>}
      </section>
    </div>
  );
};

export default OwnerPricingPage;
