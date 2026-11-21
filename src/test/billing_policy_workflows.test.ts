import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleBillingAction } from '../../api/_lib/billingApi.js';
import * as supabaseServer from '../../api/_lib/supabaseServer.js';
import { BILLING_PLAN_DRAFTS } from '../../api/_lib/billingPlans.js';
import { claimWebhookDelivery } from '../../api/_lib/billingSecurity.js';
import { readFileSync } from 'node:fs';

const OWNER = { id: 'owner-profile', user_id: 'owner-user', organization_id: 'org-one', full_name: 'Owner', role: 'OWNER' as const, status: 'ACTIVE' as const };
const ADMIN = { id: 'admin-profile', user_id: 'admin-user', organization_id: '', full_name: 'Admin', role: 'ADMIN' as const, status: 'ACTIVE' as const };
const UUID = '123e4567-e89b-42d3-a456-426614174000';
function response() {
  return { statusCode: 0, body: null as any, status(code: number) { this.statusCode = code; return this; }, json(body: any) { this.body = body; return this; } };
}
function query(data: any, error: any = null) {
  const q: any = { select: vi.fn(() => q), eq: vi.fn(() => q), maybeSingle: vi.fn(async () => ({ data, error })) };
  return q;
}
function baseSetup(profile: typeof OWNER | typeof ADMIN | (Omit<typeof OWNER, 'role'> & { role: 'TELECALLER' }), rpc: (name: string, args: any) => Promise<any>, from = vi.fn()) {
  vi.spyOn(supabaseServer, 'authenticateServerRequest').mockResolvedValue({ user: { id: profile.user_id }, profile, error: null } as any);
  vi.spyOn(supabaseServer, 'isRealSupabaseServerConfigured').mockReturnValue(true);
  vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue({ rpc: vi.fn(rpc), from } as any);
}

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('approved billing policy workflows', () => {
  it('keeps the annual subscription at ₹9,999 and defers the onboarding fee', () => {
    expect(BILLING_PLAN_DRAFTS.business.priceInr).toBe(9999);
    expect(BILLING_PLAN_DRAFTS.business.checkoutEnabled).toBe(false);
    expect(readFileSync('src/pages/owner/OwnerCheckoutPage.tsx', 'utf8')).toContain('one-time onboarding fee is deferred');
    expect(readFileSync('api/_lib/billingApi.ts', 'utf8')).not.toMatch(/onboardingFee|onboarding_amount|onboarding_payment/i);
  });

  it('schedules cancellation at the provider period end and persists only after provider confirmation', async () => {
    vi.stubEnv('RAZORPAY_KEY_ID', 'rzp_test_policy123');
    vi.stubEnv('RAZORPAY_KEY_SECRET', 'test-policy-secret');
    let authCalls = 0;
    const rpc = vi.fn(async (name: string) => {
      authCalls += 1;
      return name === 'begin_subscription_cancellation'
        ? { data: { id: 'local-sub', provider_subscription_id: 'sub_test123', provider_plan_id: 'plan_test9999', request_id: UUID, status: 'pending' }, error: null }
        : { data: { status: 'scheduled', effective_at: '2027-01-01T00:00:00.000Z' }, error: null };
    });
    baseSetup(OWNER, rpc);
    const fetch = vi.fn(async (_url: any, init: RequestInit) => {
      expect(JSON.parse(String(init.body))).toEqual({ cancel_at_cycle_end: true });
      return { ok: true, json: async () => ({ id: 'sub_test123', plan_id: 'plan_test9999', notes: { encrix_subscription_record_id: 'local-sub', encrix_organization_id: 'org-one' }, status: 'active', current_end: 1798761600, has_scheduled_changes: true, change_scheduled_at: 1798761600 }) } as Response;
    });
    vi.stubGlobal('fetch', fetch);
    const res = response();
    await handleBillingAction('cancel-subscription', { method: 'POST', headers: { authorization: 'Bearer owner' }, body: { idempotencyKey: UUID } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('scheduled');
    expect(rpc).toHaveBeenNthCalledWith(1, 'begin_subscription_cancellation', expect.objectContaining({ p_owner_id: OWNER.id, p_organization_id: OWNER.organization_id }));
    expect(rpc).toHaveBeenNthCalledWith(2, 'confirm_subscription_cancellation', expect.objectContaining({ p_request_id: UUID }));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(authCalls).toBe(2);
  });

  it('does not claim cancellation succeeded when Razorpay rejects it and confirms no scheduled change', async () => {
    vi.stubEnv('RAZORPAY_KEY_ID', 'rzp_test_policy123');
    vi.stubEnv('RAZORPAY_KEY_SECRET', 'test-policy-secret');
    const rpc = vi.fn(async (name: string) => ({ data: name === 'begin_subscription_cancellation'
      ? { id: 'local-sub', provider_subscription_id: 'sub_test123', provider_plan_id: 'plan_test9999', request_id: UUID, status: 'pending' } : { status: 'failed' }, error: null }));
    baseSetup(OWNER, rpc);
    vi.stubGlobal('fetch', vi.fn(async (url: any, init?: RequestInit) => init?.method === 'GET'
      ? ({ ok: true, json: async () => ({ id: 'sub_test123', plan_id: 'plan_test9999', notes: { encrix_subscription_record_id: 'local-sub', encrix_organization_id: 'org-one' }, status: 'active', current_end: 1798761600, has_scheduled_changes: false }) } as Response)
      : ({ ok: false, status: 422, json: async () => ({}) } as Response)));
    const res = response();
    await handleBillingAction('cancel-subscription', { method: 'POST', headers: { authorization: 'Bearer owner' }, body: { idempotencyKey: UUID } }, res);
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toBe('CANCELLATION_PROVIDER_REJECTED');
    expect(rpc).toHaveBeenCalledWith('fail_subscription_cancellation', expect.objectContaining({ p_request_id: UUID }));
    expect(rpc).not.toHaveBeenCalledWith('confirm_subscription_cancellation', expect.anything());
  });

  it('recovers a cancellation accepted by Razorpay before a retry returned a client error', async () => {
    vi.stubEnv('RAZORPAY_KEY_ID', 'rzp_test_policy123');
    vi.stubEnv('RAZORPAY_KEY_SECRET', 'test-policy-secret');
    const rpc = vi.fn(async (name: string) => name === 'begin_subscription_cancellation'
      ? { data: { id: 'local-sub', provider_subscription_id: 'sub_test123', provider_plan_id: 'plan_test9999', request_id: UUID, status: 'pending' }, error: null }
      : { data: { status: 'scheduled', effective_at: '2027-01-01T00:00:00.000Z' }, error: null });
    baseSetup(OWNER, rpc);
    const fetch = vi.fn(async (_url: any, init?: RequestInit) => init?.method === 'GET'
      ? ({ ok: true, json: async () => ({ id: 'sub_test123', plan_id: 'plan_test9999', notes: { encrix_subscription_record_id: 'local-sub', encrix_organization_id: 'org-one' }, status: 'active', current_end: 1798761600, has_scheduled_changes: true, change_scheduled_at: 1798761600 }) } as Response)
      : ({ ok: false, status: 422, json: async () => ({}) } as Response));
    vi.stubGlobal('fetch', fetch);
    const res = response();
    await handleBillingAction('cancel-subscription', { method: 'POST', headers: { authorization: 'Bearer owner' }, body: { idempotencyKey: UUID } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('scheduled');
    expect(rpc).toHaveBeenCalledWith('confirm_subscription_cancellation', expect.objectContaining({ p_request_id: UUID }));
    expect(rpc).not.toHaveBeenCalledWith('fail_subscription_cancellation', expect.anything());
  });

  it('rejects a cross-tenant or non-owner cancellation before any database/provider action', async () => {
    const caller = { ...OWNER, role: 'TELECALLER' as const };
    const rpc = vi.fn();
    baseSetup(caller, rpc);
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const res = response();
    await handleBillingAction('cancel-subscription', { method: 'POST', headers: { authorization: 'Bearer caller' }, body: { idempotencyKey: UUID } }, res);
    expect(res.statusCode).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('creates only a manual refund request and does not call Razorpay', async () => {
    const rpc = vi.fn(async () => ({ data: { id: UUID, status: 'requested' }, error: null }));
    baseSetup(OWNER, rpc);
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const res = response();
    await handleBillingAction('refund-request', { method: 'POST', headers: { authorization: 'Bearer owner' }, body: {
      paymentId: 'payment-row', amountPaise: 400000, reason: 'Service issue review', idempotencyKey: UUID,
    } }, res);
    expect(res.statusCode).toBe(201);
    expect(res.body.message).toContain('No refund has been issued');
    expect(rpc).toHaveBeenCalledWith('request_billing_refund', expect.objectContaining({ p_organization_id: OWNER.organization_id, p_requester_id: OWNER.id }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns an idempotent duplicate refund request without contacting the provider', async () => {
    const rpc = vi.fn(async () => ({ data: { id: UUID, status: 'requested', duplicate: true }, error: null }));
    baseSetup(OWNER, rpc);
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const res = response();
    await handleBillingAction('refund-request', { method: 'POST', headers: { authorization: 'Bearer owner' }, body: {
      paymentId: 'payment-row', amountPaise: 400000, reason: 'Service issue review', idempotencyKey: UUID,
    } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.refundRequest.duplicate).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not let an owner approve their own refund request', async () => {
    const rpc = vi.fn(); baseSetup(OWNER, rpc);
    const res = response();
    await handleBillingAction('refund-review', { method: 'POST', headers: { authorization: 'Bearer owner' }, body: {
      refundRequestId: UUID, decision: 'approve', approvedAmountPaise: 1000, entitlementAction: 'retain', reason: 'Forged role should not grant access', role: 'ADMIN',
    } }, res);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('ADMIN_AUTHENTICATION_REQUIRED');
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(['OWNER', 'TELECALLER'] as const)('denies %s access to the global refund queue and detail', async (role) => {
    const caller = role === 'OWNER' ? OWNER : { ...OWNER, role: 'TELECALLER' as const };
    const rpc = vi.fn(); baseSetup(caller, rpc);
    for (const action of ['refund-requests', 'refund-detail']) {
      const res = response();
      await handleBillingAction(action, { method: 'GET', headers: { authorization: 'Bearer caller' }, query: { id: UUID } }, res);
      expect(res.statusCode).toBe(403);
      expect(res.body.error).toBe('ADMIN_AUTHENTICATION_REQUIRED');
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it('denies a telecaller from submitting an administrator refund decision', async () => {
    const caller = { ...OWNER, role: 'TELECALLER' as const };
    const rpc = vi.fn();
    baseSetup(caller, rpc);
    const res = response();
    await handleBillingAction('refund-review', {
      method: 'POST', headers: {}, body: {
        refundRequestId: UUID, decision: 'approve', approvedAmountPaise: 1000,
        entitlementAction: 'retain', reason: 'Forged administrator decision',
      },
    }, res);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('ADMIN_AUTHENTICATION_REQUIRED');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('denies unauthenticated callers before loading refund data or invoking RPCs', async () => {
    const authenticate = vi.spyOn(supabaseServer, 'authenticateServerRequest')
      .mockResolvedValue({ user: null, profile: null, error: 'Invalid auth token' });
    const configured = vi.spyOn(supabaseServer, 'isRealSupabaseServerConfigured').mockReturnValue(true);
    const getClient = vi.spyOn(supabaseServer, 'getSupabaseServerClient');
    for (const action of ['refund-requests', 'refund-detail', 'refund-review']) {
      const res = response();
      await handleBillingAction(action, {
        method: action === 'refund-review' ? 'POST' : 'GET',
        headers: {}, query: { id: UUID }, body: {},
      }, res);
      expect(res.statusCode).toBe(403);
    }
    expect(authenticate).toHaveBeenCalledTimes(3);
    expect(configured).not.toHaveBeenCalled();
    expect(getClient).not.toHaveBeenCalled();
  });

  it('records a refund rejection without contacting Razorpay', async () => {
    const rpc = vi.fn(async () => ({ data: { id: UUID, status: 'rejected' }, error: null }));
    baseSetup(ADMIN, rpc);
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const res = response();
    await handleBillingAction('refund-review', { method: 'POST', headers: { authorization: 'Bearer admin' }, body: {
      refundRequestId: UUID, decision: 'reject', reason: 'Policy review declined',
    } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.refundRequest.status).toBe('rejected');
    expect(rpc).toHaveBeenCalledWith('review_billing_refund_request', expect.objectContaining({ p_decision: 'reject', p_reviewer_id: ADMIN.id }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('processes admin approval through the approved amount and stable Razorpay idempotency key', async () => {
    vi.stubEnv('RAZORPAY_KEY_ID', 'rzp_test_policy123');
    vi.stubEnv('RAZORPAY_KEY_SECRET', 'test-policy-secret');
    const rpc = vi.fn(async (name: string) => {
      if (name === 'review_billing_refund_request') return { data: { id: UUID, status: 'approved' }, error: null };
      if (name === 'claim_billing_refund_processing') return { data: { id: UUID, payment_id: 'payrow', organization_id: 'org-one', approved_amount_paise: 250000, should_process: true, claim_token: 'claim-token' }, error: null };
      if (name === 'record_billing_refund_provider_result') return { data: { id: UUID, status: 'processing' }, error: null };
      return { data: null, error: null };
    });
    const from = vi.fn(() => query({ razorpay_payment_id: 'pay_test123', amount_paise: 999900, amount_refunded_paise: 0, currency: 'INR', status: 'captured', signature_verified_at: '2026-01-01T00:00:00Z' }));
    baseSetup(ADMIN, rpc, from);
    const fetch = vi.fn(async (url: any, init: RequestInit) => {
      expect(String(url)).toContain('/payments/pay_test123/refund');
      expect(init.headers).toMatchObject({ 'X-Refund-Idempotency': UUID });
      expect(JSON.parse(String(init.body))).toMatchObject({ amount: 250000, receipt: UUID });
      return { ok: true, json: async () => ({ id: 'rfnd_test123', payment_id: 'pay_test123', amount: 250000, status: 'pending' }) } as Response;
    });
    vi.stubGlobal('fetch', fetch);
    const res = response();
    await handleBillingAction('refund-review', { method: 'POST', headers: { authorization: 'Bearer admin' }, body: {
      refundRequestId: UUID, decision: 'approve', approvedAmountPaise: 250000, entitlementAction: 'retain', reason: 'Reviewed against support case',
    } }, res);
    expect(res.statusCode).toBe(202);
    expect(rpc).toHaveBeenCalledWith('review_billing_refund_request', expect.objectContaining({ p_reviewer_id: ADMIN.id, p_entitlement_action: 'retain' }));
    expect(rpc).toHaveBeenCalledWith('claim_billing_refund_processing', expect.objectContaining({ p_reviewer_id: ADMIN.id }));
    expect(rpc).toHaveBeenCalledWith('record_billing_refund_provider_result', expect.objectContaining({ p_provider_refund_id: 'rfnd_test123', p_claim_token: 'claim-token' }));
  });

  it('retries an ambiguous provider call using the exact same idempotency key and payload', async () => {
    vi.stubEnv('RAZORPAY_KEY_ID', 'rzp_test_policy123');
    vi.stubEnv('RAZORPAY_KEY_SECRET', 'test-policy-secret');
    let providerAttempts = 0;
    const rpc = vi.fn(async (name: string) => {
      if (name === 'review_billing_refund_request') return { data: { id: UUID, status: 'processing', duplicate: true }, error: null };
      if (name === 'claim_billing_refund_processing') return {
        data: { id: UUID, payment_id: 'payrow', organization_id: OWNER.organization_id, approved_amount_paise: 250000, should_process: true, claim_token: `claim-${providerAttempts}` },
        error: null,
      };
      if (name === 'record_billing_refund_provider_result') return { data: { id: UUID, status: 'processing' }, error: null };
      return { data: null, error: null };
    });
    const from = vi.fn(() => query({ razorpay_payment_id: 'pay_test123', amount_paise: 999900, amount_refunded_paise: 0, currency: 'INR', status: 'captured', signature_verified_at: '2026-01-01T00:00:00Z' }));
    baseSetup({ ...ADMIN, id: 'recovery-admin-profile' }, rpc, from);
    const fetch = vi.fn(async (_url: any, init: RequestInit) => {
      providerAttempts += 1;
      expect(init.headers).toMatchObject({ 'X-Refund-Idempotency': UUID });
      expect(JSON.parse(String(init.body))).toEqual({
        amount: 250000, receipt: UUID, notes: { encrix_refund_request_id: UUID },
      });
      if (providerAttempts === 1) throw new Error('provider response timed out after submission');
      return { ok: true, json: async () => ({ id: 'rfnd_test123', payment_id: 'pay_test123', amount: 250000, status: 'pending' }) } as Response;
    });
    vi.stubGlobal('fetch', fetch);
    const body = {
      refundRequestId: UUID, decision: 'approve', approvedAmountPaise: 250000,
      entitlementAction: 'retain', reason: 'Reviewed against support case',
    };
    const first = response();
    await handleBillingAction('refund-review', { method: 'POST', headers: {}, body }, first);
    expect(first.statusCode).toBe(202);
    expect(first.body.status).toBe('processing_reconciliation_required');
    const retry = response();
    await handleBillingAction('refund-review', { method: 'POST', headers: {}, body }, retry);
    expect(retry.statusCode).toBe(202);
    expect(retry.body.refundRequest.status).toBe('processing');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenNthCalledWith(1, 'review_billing_refund_request', expect.objectContaining({ p_reviewer_id: 'recovery-admin-profile' }));
    expect(rpc).toHaveBeenNthCalledWith(2, 'claim_billing_refund_processing', expect.objectContaining({ p_reviewer_id: 'recovery-admin-profile' }));
  });


  it('returns an existing period-end schedule idempotently without another provider call', async () => {
    vi.stubEnv('RAZORPAY_KEY_ID', 'rzp_test_policy123');
    vi.stubEnv('RAZORPAY_KEY_SECRET', 'test-policy-secret');
    const rpc = vi.fn(async () => ({ data: { id: 'local-sub', status: 'scheduled', effective_at: '2027-01-01T00:00:00Z' }, error: null }));
    baseSetup(OWNER, rpc);
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const res = response();
    await handleBillingAction('cancel-subscription', { method: 'POST', headers: { authorization: 'Bearer owner' }, body: { idempotencyKey: UUID } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ status: 'scheduled', duplicate: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects invalid refund amounts before creating a request', async () => {
    const rpc = vi.fn(); baseSetup(OWNER, rpc);
    const res = response();
    await handleBillingAction('refund-request', { method: 'POST', headers: { authorization: 'Bearer owner' }, body: {
      paymentId: 'payment-row', amountPaise: 0, reason: 'Service issue review', idempotencyKey: UUID,
    } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('INVALID_REFUND_REQUEST');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects refund decisions without the mandatory decision reason', async () => {
    const rpc = vi.fn(); baseSetup(ADMIN, rpc);
    const res = response();
    await handleBillingAction('refund-review', { method: 'POST', headers: { authorization: 'Bearer admin' }, body: {
      refundRequestId: UUID, decision: 'reject',
    } }, res);
    expect(res.statusCode).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects partial approvals without an explicit entitlement decision', async () => {
    vi.stubEnv('RAZORPAY_KEY_ID', 'rzp_test_policy123');
    vi.stubEnv('RAZORPAY_KEY_SECRET', 'test-policy-secret');
    const rpc = vi.fn(); baseSetup(ADMIN, rpc);
    const res = response();
    await handleBillingAction('refund-review', { method: 'POST', headers: { authorization: 'Bearer admin' }, body: {
      refundRequestId: UUID, decision: 'approve', approvedAmountPaise: 250000, reason: 'Reviewed against support case',
    } }, res);
    expect(res.statusCode).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('treats duplicate refund webhook deliveries as idempotent receipts', async () => {
    let inserted = false;
    const store = {
      async insert() { if (!inserted) { inserted = true; return true; } return false; },
      async get() { return { id: 'receipt-1', state: 'processed' as const, processingStartedAt: null, eventType: 'refund.processed', payloadHash: 'a'.repeat(64) }; },
      async claim() { return false; },
    };
    const event = { eventId: 'evt_refund_same', eventType: 'refund.processed', payloadHash: 'a'.repeat(64) };
    expect(await claimWebhookDelivery(event, store)).toBe('claimed');
    expect(await claimWebhookDelivery(event, store)).toBe('duplicate');
  });

  it('documents manual-review gates, expiry-based cancellation and safe grants in the candidate', () => {
    const migration = readFileSync('docs/sql/validated_candidate_migrations/20261105170000_billing_refund_cancellation_workflows_candidate.sql', 'utf8');
    expect(migration).toBe(readFileSync('supabase/migrations/20261105170000_billing_refund_cancellation_workflows.sql', 'utf8'));
    expect(migration).toContain('request_billing_refund');
    expect(migration).toContain('review_billing_refund_request');
    expect(migration).toContain("role='ADMIN'");
    expect(migration).toContain('refund_amount_exceeds_remaining_balance');
    expect(migration).toContain('refund_approval_exceeds_remaining_balance');
    expect(migration).toContain('billing_refund_requests_approved_state_consistency');
    expect(migration).toContain(`v_request.status IN ('approved','processing')`);
    expect(migration).toContain("p_decision='reject'");
    expect(migration).toContain("p_decision='under_review'");
    expect(migration).toContain("p_entitlement_action='retain'");
    expect(migration).toContain('full_refund_cannot_retain_entitlement');
    expect(migration).toContain('p_approved_amount_paise > v_payment.amount_paise-v_payment.amount_refunded_paise-v_reserved');
    expect(migration).toContain('v_existing.payment_id <> p_payment_id');
    expect(migration).toContain("p.status='captured'");
    expect(migration).toContain("r.status='partially_refunded' AND r.entitlement_action='retain'");
    expect(migration).toContain("v_subscription.status IN ('cancelled', 'expired')");
    expect(migration).toContain("AND v_paid_at >= v_subscription.cancellation_effective_at");
    expect(migration).toContain("r.entitlement_action='retain'");
    expect(migration).toContain('cancel_at_period_end=TRUE');
    expect(migration).toContain("v_subscription.cancel_at_period_end IS TRUE AND v_period_end > v_now");
    expect(migration).toContain('v_paid_at >= v_subscription.cancellation_effective_at');
    expect(migration).toContain("THEN 'completed'");
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON TABLE public.billing_refund_requests, public.billing_refund_review_events FROM PUBLIC, anon, authenticated, service_role;');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.review_billing_refund_request');
  });

  it('documents the forward-only admin audit and provider claim migration', () => {
    const migration = readFileSync('supabase/migrations/20261106100000_admin_refund_management.sql', 'utf8');
    expect(migration).toBe(readFileSync('docs/sql/candidate_migrations/20261106100000_admin_refund_management_candidate.sql', 'utf8'));
    expect(migration).toContain('billing_refund_audit_events');
    expect(migration).toContain('provider_claim_token');
    expect(migration).toContain('refund_processing_claim_token_required');
    expect(migration).toContain('provider_claimed_at < pg_catalog.clock_timestamp()-INTERVAL \'2 minutes\'');
    expect(migration).toContain('p_claim_token UUID');
    expect(migration).toContain('GRANT SELECT, INSERT ON TABLE public.billing_refund_audit_events TO service_role');
    expect(migration).not.toContain("v_event := CASE p_provider_status WHEN 'processed' THEN 'provider_completed'");
    expect(migration).toContain("v_event := CASE p_provider_status WHEN 'processed' THEN 'provider_submitted'");
    expect(migration).toContain("IF NOT FOUND OR v_request.status NOT IN ('approved','processing') THEN RAISE EXCEPTION 'refund_not_approved_for_processing'");
    expect(migration).toContain("IF v_request.status NOT IN ('approved','processing') THEN");
  });

  it('links refund management from guarded desktop/mobile admin navigation', () => {
    const routes = readFileSync('src/App.tsx', 'utf8');
    const sidebar = readFileSync('src/components/layout/Sidebar.tsx', 'utf8');
    const mobileNav = readFileSync('src/components/layout/MobileNav.tsx', 'utf8');
    const page = readFileSync('src/pages/admin/AdminRefundsPage.tsx', 'utf8');
    expect(routes).toContain('<Route path="refunds" element={<AdminRefundsPage />} />');
    expect(sidebar).toContain("{ to: '/admin/refunds', label: 'Refund Management'");
    expect(mobileNav).toContain("{ to: '/admin/refunds', label: 'Refunds'");
    expect(page).toContain('Resume / reconcile approved refund');
    expect(page).toContain('request.approved_amount_paise');
    expect(page).toContain('request.entitlement_action');
    expect(page).toContain('request.decision_note');
  });

  it('relies on the existing service-only administrator grant path', () => {
    const migration = readFileSync('supabase/migrations/20261021000000_phase23_7_production_blocker_remediation.sql', 'utf8');
    expect(migration).toContain("IF auth.role() IS DISTINCT FROM 'service_role' THEN");
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.grant_platform_admin(UUID) TO service_role');
    expect(migration).toContain('Only the platform administration flow can grant global administrator access.');
  });
});
