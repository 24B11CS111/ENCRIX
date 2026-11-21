import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, CreditCard, RefreshCw, Search, ShieldCheck, XCircle } from 'lucide-react';
import { Pagination } from '@/components/common/Pagination';
import { EmptyState } from '@/components/common/EmptyState';
import { authService } from '@/services/auth/authService';

type RefundSummary = { total: number; pendingReview: number; approved: number; rejected: number; processing: number; refunded: number; failed: number };
type RefundRequest = {
  id: string; organization_id: string; subscription_id: string; payment_id: string; requested_amount_paise: number;
  approved_amount_paise?: number | null; reason: string; status: string; entitlement_action?: string | null;
  decision_note?: string | null; reviewed_by?: string | null; reviewed_at?: string | null; provider_refund_status?: string | null; created_at: string;
  organization?: { id: string; name: string } | null;
  payment?: { id: string; reference: string; amount_paise: number; amount_refunded_paise: number; remaining_refundable_paise: number; currency: string; status: string; provider_reference?: string | null } | null;
  subscription?: { id: string; status: string; current_period_end?: string | null; razorpay_subscription_id?: string | null } | null;
};
type RefundHistoryEvent = {
  id: string; source: 'review' | 'audit'; event_type?: string; decision?: string;
  previous_status?: string | null; new_status?: string; decision_reason?: string | null;
  decision_note?: string | null; amount_paise?: number | null; approved_amount_paise?: number | null;
  entitlement_action?: string | null; provider_refund_id?: string | null;
  actor_profile_id?: string | null; reviewer_id?: string | null; created_at: string;
};
type RefundDetail = { request: RefundRequest; history: RefundHistoryEvent[]; paymentRefundHistory: Array<{ id: string; requested_amount_paise: number; approved_amount_paise?: number | null; status: string; entitlement_action?: string | null; created_at: string; completed_at?: string | null }> };
type PageState = 'loading' | 'ready' | 'error';

const PAGE_SIZE = 20;
const STATUSES = ['all', 'pending_review', 'approved', 'rejected', 'processing', 'completed', 'failed'];
const statusLabel = (status: string) => status.replaceAll('_', ' ');
const money = (paise?: number | null, currency = 'INR') => `${currency} ${((paise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateTime = (value?: string | null) => value ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const compactId = (value?: string | null) => value ? `${value.slice(0, 8)}…${value.slice(-4)}` : '—';

async function adminFetch(path: string, init: RequestInit = {}) {
  const token = authService.getSessionToken();
  if (!token) throw new Error('Your secure session has expired. Sign in again.');
  const response = await fetch(path, {
    ...init,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...init.headers },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || 'The refund service is unavailable. Try again.');
  return { payload, status: response.status };
}

function StatusBadge({ status }: { status: string }) {
  const style = status === 'refunded' || status === 'partially_refunded' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : status === 'failed' || status === 'rejected' ? 'bg-rose-50 text-rose-700 border-rose-200'
      : status === 'processing' || status === 'approved' ? 'bg-blue-50 text-blue-700 border-blue-200'
        : 'bg-amber-50 text-amber-800 border-amber-200';
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold capitalize ${style}`}>{statusLabel(status)}</span>;
}

export const AdminRefundsPage: React.FC = () => {
  const [summary, setSummary] = useState<RefundSummary>({ total: 0, pendingReview: 0, approved: 0, rejected: 0, processing: 0, refunded: 0, failed: 0 });
  const [requests, setRequests] = useState<RefundRequest[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [state, setState] = useState<PageState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RefundDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [decision, setDecision] = useState<'approve' | 'reject'>('approve');
  const [amountInr, setAmountInr] = useState('');
  const [decisionReason, setDecisionReason] = useState('');
  const [entitlementAction, setEntitlementAction] = useState<'retain' | 'revoke' | ''>('');
  const [submitting, setSubmitting] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const queuePath = useMemo(() => {
    const params = new URLSearchParams({ status: statusFilter, page: String(page), pageSize: String(PAGE_SIZE) });
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (search) params.set('q', search);
    return `/api/billing/refund-requests?${params.toString()}`;
  }, [dateFrom, dateTo, page, search, statusFilter]);

  const loadQueue = useCallback(async () => {
    try {
      const { payload } = await adminFetch(queuePath);
      setSummary(payload.summary);
      setRequests(Array.isArray(payload.requests) ? payload.requests : []);
      setTotal(Number(payload.pagination?.total) || 0);
      setState('ready');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Refund requests could not be loaded.');
      setState('error');
    }
  }, [queuePath]);

  const markQueueLoading = () => {
    setState('loading');
    setError(null);
  };

  useEffect(() => {
    let active = true;
    adminFetch(queuePath).then(({ payload }) => {
      if (!active) return;
      setSummary(payload.summary);
      setRequests(Array.isArray(payload.requests) ? payload.requests : []);
      setTotal(Number(payload.pagination?.total) || 0);
      setState('ready');
    }).catch((caught: unknown) => {
      if (!active) return;
      setError(caught instanceof Error ? caught.message : 'Refund requests could not be loaded.');
      setState('error');
    });
    return () => { active = false; };
  }, [queuePath]);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const { payload } = await adminFetch(`/api/billing/refund-detail?id=${encodeURIComponent(id)}`);
      setDetail(payload as RefundDetail);
      const request = payload.request as RefundRequest;
      setAmountInr(String((Math.min(request.requested_amount_paise, request.payment?.remaining_refundable_paise || 0) / 100).toFixed(2)));
      setEntitlementAction(''); setDecisionReason(''); setDecision('approve');
    } catch (caught) {
      setDetailError(caught instanceof Error ? caught.message : 'Refund details could not be loaded.');
    } finally { setDetailLoading(false); }
  }, []);

  const fullRefund = useMemo(() => {
    const payment = detail?.request.payment;
    const amountPaise = Math.round(Number(amountInr) * 100);
    return Boolean(payment && Number.isSafeInteger(amountPaise) && amountPaise > 0 && amountPaise >= payment.amount_paise - payment.amount_refunded_paise);
  }, [amountInr, detail]);

  const submitDecision = async () => {
    const request = detail?.request;
    if (!request || submitting) return;
    const reason = decisionReason.trim();
    const amountPaise = Math.round(Number(amountInr) * 100);
    if (reason.length < 5 || reason.length > 1000) { setActionMessage('Enter a decision reason between 5 and 1,000 characters.'); return; }
    if (decision === 'approve' && (!Number.isSafeInteger(amountPaise) || amountPaise <= 0 || amountPaise > request.requested_amount_paise ||
      amountPaise > (request.payment?.remaining_refundable_paise || 0) || (!fullRefund && !entitlementAction))) {
      setActionMessage('Check the approved amount and select the partial-refund entitlement decision.'); return;
    }
    const confirmation = decision === 'reject'
      ? 'Reject this refund request? This will be recorded in the audit history.'
      : `Approve ${money(amountPaise)}? Razorpay will be called after the backend rechecks the captured payment and remaining balance.`;
    if (!window.confirm(confirmation)) return;
    setSubmitting(true); setActionMessage(null);
    try {
      const { payload, status: responseStatus } = await adminFetch('/api/billing/refund-review', {
        method: 'POST', body: JSON.stringify({
          refundRequestId: request.id, decision, approvedAmountPaise: decision === 'approve' ? amountPaise : undefined,
          entitlementAction: decision === 'approve' ? (fullRefund ? 'revoke' : entitlementAction) : undefined,
          reason,
        }),
      });
      const resultMessage = payload.refundRequest?.status === 'failed'
        ? 'Razorpay confirmed the refund failed. No completed refund is recorded; reconcile the payment before opening a new request.'
        : responseStatus === 202 || payload.status === 'processing'
          ? 'The review was recorded. Refund processing or provider confirmation is still pending; it is not marked completed.'
          : decision === 'reject' ? 'Refund request rejected and recorded.' : 'Refund approval was recorded and submitted; completion awaits provider confirmation.';
      markQueueLoading();
      setDetailLoading(true); setDetailError(null); setDetail(null);
      await Promise.all([loadQueue(), loadDetail(request.id)]);
      setActionMessage(resultMessage);
    } catch (caught) {
      setActionMessage(caught instanceof Error ? caught.message : 'The review could not be completed.');
    } finally { setSubmitting(false); }
  };

  const resumeApprovedRefund = async () => {
    const request = detail?.request;
    if (!request || submitting || !['approved', 'processing'].includes(request.status) ||
        !request.approved_amount_paise || !request.entitlement_action) return;
    const reason = request.decision_note?.trim() || '';
    if (reason.length < 5 || reason.length > 1000) {
      setActionMessage('The saved decision reason is unavailable. Reconcile this request before retrying.');
      return;
    }
    if (!window.confirm('Resume or reconcile this approved refund using its original amount, entitlement decision, and Razorpay idempotency key?')) return;
    setSubmitting(true); setActionMessage(null);
    try {
      const { payload, status: responseStatus } = await adminFetch('/api/billing/refund-review', {
        method: 'POST',
        body: JSON.stringify({
          refundRequestId: request.id,
          decision: 'approve',
          approvedAmountPaise: request.approved_amount_paise,
          entitlementAction: request.entitlement_action,
          reason,
        }),
      });
      const resultMessage = payload.refundRequest?.status === 'failed'
        ? 'Razorpay confirmed the refund failed. Reconcile the payment before opening a new request.'
        : responseStatus === 202 || payload.status === 'processing'
          ? 'Refund processing is still pending provider confirmation; it is not marked completed.'
          : 'The approved refund was reconciled with the backend. Check the recorded provider status before taking further action.';
      markQueueLoading();
      setDetailLoading(true); setDetailError(null); setDetail(null);
      await Promise.all([loadQueue(), loadDetail(request.id)]);
      setActionMessage(resultMessage);
    } catch (caught) {
      setActionMessage(caught instanceof Error ? caught.message : 'The approved refund could not be resumed.');
    } finally { setSubmitting(false); }
  };

  const summaryCards = [
    { label: 'All requests', value: summary.total, icon: CreditCard, color: 'text-slate-700 bg-slate-100' },
    { label: 'Pending review', value: summary.pendingReview, icon: Clock3, color: 'text-amber-700 bg-amber-50' },
    { label: 'Approved', value: summary.approved, icon: CheckCircle2, color: 'text-blue-700 bg-blue-50' },
    { label: 'Rejected', value: summary.rejected, icon: XCircle, color: 'text-rose-700 bg-rose-50' },
    { label: 'Processing', value: summary.processing, icon: RefreshCw, color: 'text-indigo-700 bg-indigo-50' },
    { label: 'Refunded', value: summary.refunded, icon: CheckCircle2, color: 'text-emerald-700 bg-emerald-50' },
    { label: 'Failed', value: summary.failed, icon: AlertTriangle, color: 'text-orange-700 bg-orange-50' },
  ];

  return <div className="space-y-6">
    <header className="flex flex-col gap-2 border-b border-[#DCE4EE] pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div><div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#1E4D8F]"><ShieldCheck className="h-4 w-4" /> Platform administration</div>
        <h1 className="text-xl font-bold tracking-tight text-[#0B1F3A]">Refund management</h1>
        <p className="mt-1 text-xs text-[#64748B]">Review refund requests, record decisions, and reconcile Razorpay outcomes.</p></div>
      <button onClick={() => { markQueueLoading(); void loadQueue(); }} disabled={state === 'loading'} className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#DCE4EE] bg-white px-3 py-2 text-xs font-semibold text-[#172B4D] disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${state === 'loading' ? 'animate-spin' : ''}`} />Refresh</button>
    </header>

    <section aria-label="Refund totals" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
      {summaryCards.map((item) => <div key={item.label} className="rounded-xl border border-[#DCE4EE] bg-white p-4 shadow-sm"><div className={`mb-3 flex h-8 w-8 items-center justify-center rounded-lg ${item.color}`}><item.icon className="h-4 w-4" /></div><p className="text-[11px] text-[#64748B]">{item.label}</p><p className="mt-1 text-xl font-bold text-[#0B1F3A]">{item.value}</p></div>)}
    </section>

    <section className="rounded-xl border border-[#DCE4EE] bg-white p-4 shadow-sm">
      <form className="grid gap-3 md:grid-cols-5" onSubmit={(event) => { event.preventDefault(); markQueueLoading(); setPage(1); setSearch(searchDraft.trim()); }}>
        <label className="relative md:col-span-2"><span className="sr-only">Search request, organization, payment, or subscription</span><Search className="absolute left-3 top-2.5 h-4 w-4 text-[#64748B]" /><input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Search request, business, payment…" className="w-full rounded-lg border border-[#DCE4EE] py-2 pl-9 pr-3 text-xs" /></label>
        <label className="text-[11px] text-[#64748B]">Status<select aria-label="Refund status" value={statusFilter} onChange={(event) => { markQueueLoading(); setStatusFilter(event.target.value); setPage(1); }} className="mt-1 block w-full rounded-lg border border-[#DCE4EE] bg-white px-3 py-2 text-xs text-[#172B4D]">{STATUSES.map((status) => <option key={status} value={status}>{status === 'pending_review' ? 'Pending review' : statusLabel(status)}</option>)}</select></label>
        <label className="text-[11px] text-[#64748B]">From<input aria-label="Refunds from date" type="date" value={dateFrom} onChange={(event) => { markQueueLoading(); setDateFrom(event.target.value); setPage(1); }} className="mt-1 block w-full rounded-lg border border-[#DCE4EE] px-3 py-2 text-xs text-[#172B4D]" /></label>
        <label className="text-[11px] text-[#64748B]">To<input aria-label="Refunds to date" type="date" value={dateTo} onChange={(event) => { markQueueLoading(); setDateTo(event.target.value); setPage(1); }} className="mt-1 block w-full rounded-lg border border-[#DCE4EE] px-3 py-2 text-xs text-[#172B4D]" /></label>
      </form>
    </section>

    {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}<button className="ml-3 underline" onClick={() => { markQueueLoading(); void loadQueue(); }}>Try again</button></div>}
    <section className="overflow-hidden rounded-xl border border-[#DCE4EE] bg-white shadow-sm">
      <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-xs">
        <thead className="border-b border-[#DCE4EE] bg-[#F6F8FB] text-[10px] uppercase tracking-wider text-[#64748B]"><tr><th className="px-4 py-3">Request / business</th><th className="px-3 py-3">Payment / subscription</th><th className="px-3 py-3">Requested</th><th className="px-3 py-3">Captured / refunded / remaining</th><th className="px-3 py-3">Date</th><th className="px-3 py-3">Payment status</th><th className="px-3 py-3">Review status</th><th className="px-4 py-3">Details</th></tr></thead>
        <tbody className="divide-y divide-[#E6ECF3]">
          {state === 'loading' && <tr><td colSpan={8} className="py-14 text-center text-[#64748B]"><RefreshCw className="mx-auto mb-2 h-5 w-5 animate-spin" />Loading refund requests…</td></tr>}
          {state === 'ready' && !requests.length && <tr><td colSpan={8} className="p-6"><EmptyState icon={CreditCard} title="No refund requests" description="No requests match this status and date range." /></td></tr>}
          {state === 'ready' && requests.map((item) => <tr key={item.id} className="align-top hover:bg-[#F8FAFC]"><td className="px-4 py-3"><p className="font-mono font-semibold text-[#172B4D]">{compactId(item.id)}</p><p className="mt-1 max-w-48 truncate text-[#64748B]">{item.organization?.name || 'Organization unavailable'}</p></td>
            <td className="px-3 py-3 font-mono text-[11px] text-[#475569]">Payment {item.payment?.reference || compactId(item.payment_id)}<br />Subscription {compactId(item.subscription?.razorpay_subscription_id || item.subscription_id)}</td>
            <td className="px-3 py-3 font-semibold text-[#172B4D]">{money(item.requested_amount_paise, item.payment?.currency)}</td>
            <td className="px-3 py-3 text-[#475569]">{money(item.payment?.amount_paise, item.payment?.currency)}<br />Refunded {money(item.payment?.amount_refunded_paise, item.payment?.currency)}<br />Remaining {money(item.payment?.remaining_refundable_paise, item.payment?.currency)}</td>
            <td className="whitespace-nowrap px-3 py-3 text-[#64748B]">{dateTime(item.created_at)}</td><td className="px-3 py-3 capitalize text-[#475569]">{statusLabel(item.payment?.status || 'unknown')}</td><td className="px-3 py-3"><StatusBadge status={item.status} /></td>
            <td className="px-4 py-3"><button onClick={() => { setDetailLoading(true); setDetailError(null); setDetail(null); setActionMessage(null); setSelectedId(item.id); void loadDetail(item.id); }} className="rounded-lg border border-[#1E4D8F] px-3 py-1.5 font-semibold text-[#1E4D8F] hover:bg-blue-50">Review</button></td></tr>)}
        </tbody></table></div>
      <Pagination currentPage={page} totalPages={Math.ceil(total / PAGE_SIZE)} totalItems={total} pageSize={PAGE_SIZE} onPageChange={(nextPage) => { markQueueLoading(); setPage(nextPage); }} />
    </section>

    {selectedId && <section aria-labelledby="refund-detail-heading" className="rounded-xl border border-[#CBD5E1] bg-white p-5 shadow-md">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E6ECF3] pb-4"><div><h2 id="refund-detail-heading" className="text-lg font-bold text-[#0B1F3A]">Refund request details</h2><p className="mt-1 font-mono text-xs text-[#64748B]">{compactId(selectedId)}</p></div><button onClick={() => { setSelectedId(null); setDetail(null); setDetailLoading(false); }} className="rounded-lg border border-[#DCE4EE] px-3 py-2 text-xs font-semibold">Close</button></div>
      {detailLoading && <p role="status" className="py-8 text-sm text-[#64748B]">Loading refund history…</p>}
      {detailError && <p role="alert" className="py-4 text-sm text-rose-700">{detailError}</p>}
      {detail && <div className="mt-4 grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-lg bg-[#F6F8FB] p-3"><p className="text-[10px] uppercase text-[#64748B]">Business / organization</p><p className="mt-1 font-semibold text-[#172B4D]">{detail.request.organization?.name || 'Organization unavailable'}</p><p className="mt-1 font-mono text-[10px] text-[#64748B]">{detail.request.organization_id}</p></div><div className="rounded-lg bg-[#F6F8FB] p-3"><p className="text-[10px] uppercase text-[#64748B]">Status</p><div className="mt-2"><StatusBadge status={detail.request.status} /></div><p className="mt-2 text-[11px] text-[#64748B]">Requested {dateTime(detail.request.created_at)}</p></div></div>
          <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-lg border border-[#E6ECF3] p-3"><p className="text-[10px] uppercase text-[#64748B]">Payment</p><p className="mt-1 font-semibold">{money(detail.request.payment?.amount_paise, detail.request.payment?.currency)} captured</p><p className="mt-1 text-xs text-[#64748B]">Previously refunded {money(detail.request.payment?.amount_refunded_paise, detail.request.payment?.currency)}</p><p className="mt-1 text-xs text-[#64748B]">Remaining refundable {money(detail.request.payment?.remaining_refundable_paise, detail.request.payment?.currency)}</p><p className="mt-2 font-mono text-[10px] text-[#64748B]">{detail.request.payment?.provider_reference || detail.request.payment_id}</p><p className="mt-1 text-xs capitalize">Payment status: {statusLabel(detail.request.payment?.status || 'unknown')}</p></div><div className="rounded-lg border border-[#E6ECF3] p-3"><p className="text-[10px] uppercase text-[#64748B]">Subscription</p><p className="mt-1 font-semibold capitalize">{statusLabel(detail.request.subscription?.status || 'unknown')}</p><p className="mt-1 font-mono text-[10px] text-[#64748B]">{compactId(detail.request.subscription?.razorpay_subscription_id || detail.request.subscription_id)}</p><p className="mt-1 text-xs text-[#64748B]">Period ends {dateTime(detail.request.subscription?.current_period_end)}</p></div></div>
          <div className="rounded-lg border border-[#E6ECF3] p-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">Owner’s reason</p><p className="mt-2 whitespace-pre-wrap text-sm text-[#172B4D]">{detail.request.reason}</p><p className="mt-3 text-xs text-[#64748B]">Requested amount: <strong className="text-[#172B4D]">{money(detail.request.requested_amount_paise, detail.request.payment?.currency)}</strong></p></div>
          <div><h3 className="mb-2 text-sm font-semibold text-[#172B4D]">Refund history for this payment</h3><div className="divide-y divide-[#E6ECF3] rounded-lg border border-[#E6ECF3]">{detail.paymentRefundHistory.map((event) => <div key={event.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-xs"><span><StatusBadge status={event.status} /> <span className="ml-2">{money(event.approved_amount_paise || event.requested_amount_paise)}</span></span><span className="text-[#64748B]">{dateTime(event.completed_at || event.created_at)}</span></div>)}</div></div>
          <div><h3 className="mb-2 text-sm font-semibold text-[#172B4D]">Administrator and provider audit history</h3>{!detail.history.length ? <p className="rounded-lg border border-dashed border-[#DCE4EE] p-4 text-xs text-[#64748B]">No review events have been recorded.</p> : <ol className="space-y-2">{detail.history.map((event) => <li key={`${event.source}-${event.id}`} className="rounded-lg border border-[#E6ECF3] p-3 text-xs"><div className="flex flex-wrap justify-between gap-2"><span className="font-semibold capitalize text-[#172B4D]">{statusLabel(event.event_type || event.decision || 'review')}</span><time className="text-[#64748B]">{dateTime(event.created_at)}</time></div><p className="mt-1 text-[#64748B]">{event.previous_status ? `${statusLabel(event.previous_status)} → ${statusLabel(event.new_status || '')}` : statusLabel(event.new_status || '')}{event.actor_profile_id || event.reviewer_id ? ` · Actor ${compactId(event.actor_profile_id || event.reviewer_id)}` : ' · Provider event'}</p>{event.decision_reason || event.decision_note ? <p className="mt-2 text-[#334155]">{event.decision_reason || event.decision_note}</p> : null}{event.amount_paise || event.approved_amount_paise ? <p className="mt-1">Amount {money(event.amount_paise || event.approved_amount_paise)}</p> : null}{event.entitlement_action ? <p className="mt-1">Entitlement decision: {event.entitlement_action}</p> : null}{event.provider_refund_id ? <p className="mt-1 font-mono">Provider refund {compactId(event.provider_refund_id)}</p> : null}</li>)}</ol>}</div>
        </div>
        <aside className="h-fit rounded-xl border border-[#DCE4EE] bg-[#FAFBFD] p-4">
          <h3 className="text-sm font-bold text-[#0B1F3A]">Record administrator decision</h3>
          {['requested','under_review'].includes(detail.request.status) ? <>
            <label className="mt-4 block text-xs font-medium text-[#475569]">Decision<select value={decision} onChange={(event) => setDecision(event.target.value as 'approve' | 'reject')} className="mt-1 block w-full rounded-lg border border-[#DCE4EE] bg-white px-3 py-2"><option value="approve">Approve refund</option><option value="reject">Reject request</option></select></label>
            {decision === 'approve' && <label className="mt-3 block text-xs font-medium text-[#475569]">Approved amount (INR)<input type="number" min="0.01" max={detail.request.payment?.remaining_refundable_paise ? detail.request.payment.remaining_refundable_paise / 100 : undefined} step="0.01" value={amountInr} onChange={(event) => setAmountInr(event.target.value)} className="mt-1 block w-full rounded-lg border border-[#DCE4EE] bg-white px-3 py-2" /></label>}
            {decision === 'approve' && <div className="mt-4 rounded-lg border border-[#DCE4EE] bg-white p-3"><p className="text-xs font-semibold text-[#172B4D]">Paid entitlement outcome</p>{fullRefund ? <p className="mt-2 text-xs text-rose-700">This completes the refundable balance. Entitlement will be revoked; full refunds cannot retain access.</p> : <fieldset className="mt-2 space-y-2 text-xs"><legend className="text-[#64748B]">For this partial refund, choose explicitly:</legend><label className="flex gap-2"><input type="radio" name="entitlement" checked={entitlementAction === 'retain'} onChange={() => setEntitlementAction('retain')} />Retain paid access if provider reconciliation matches</label><label className="flex gap-2"><input type="radio" name="entitlement" checked={entitlementAction === 'revoke'} onChange={() => setEntitlementAction('revoke')} />Revoke paid access after provider reconciliation</label></fieldset>}</div>}
            <label className="mt-3 block text-xs font-medium text-[#475569]">Mandatory decision reason<textarea required minLength={5} maxLength={1000} value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} rows={4} className="mt-1 block w-full rounded-lg border border-[#DCE4EE] bg-white px-3 py-2" placeholder="Record the review basis for this decision" /></label>
            {actionMessage && <p role="status" className="mt-3 rounded-lg bg-blue-50 p-3 text-xs text-blue-800">{actionMessage}</p>}
            <button onClick={() => void submitDecision()} disabled={submitting || decisionReason.trim().length < 5 || (decision === 'approve' && !fullRefund && !entitlementAction)} className="mt-4 w-full rounded-lg bg-[#0B1F3A] px-4 py-2.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{submitting ? 'Saving decision…' : decision === 'approve' ? 'Approve and process refund' : 'Reject refund request'}</button>
            <p className="mt-3 text-[11px] leading-relaxed text-[#64748B]">The database rechecks administrator authority and refundable balance. Refund status remains processing until Razorpay confirms it.</p>
          </> : ['approved','processing'].includes(detail.request.status) ? <>
            <p className="mt-3 text-xs text-[#64748B]">The saved decision and amount are immutable. Resuming uses the same Razorpay idempotency key and does not create a second refund.</p>
            <button type="button" onClick={() => void resumeApprovedRefund()} disabled={submitting} className="mt-4 w-full rounded-lg bg-[#1E4D8F] px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50">
              {submitting ? 'Checking provider status…' : 'Resume / reconcile approved refund'}
            </button>
          </> : <div className="mt-4 rounded-lg border border-[#DCE4EE] bg-white p-3 text-xs text-[#64748B]">This request is <strong className="capitalize text-[#172B4D]">{statusLabel(detail.request.status)}</strong> and cannot be reviewed again. Reconciliation is required before a new request.</div>}
          {actionMessage && !['requested','under_review'].includes(detail.request.status) && <p role="status" className="mt-3 rounded-lg bg-blue-50 p-3 text-xs text-blue-800">{actionMessage}</p>}
        </aside>
      </div>}
    </section>}
  </div>;
};
