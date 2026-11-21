import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as supabaseServer from '../../api/_lib/supabaseServer.js';
import { handleBillingAction } from '../../api/_lib/billingApi.js';

const secret = 'razorpay-test-secret-only';
const localSubscription = {
  id: 'local-sub-1', organization_id: 'org-owner', plan_code: 'business', status: 'pending_payment',
  entitlement_source: 'razorpay', is_current: true, checkout_creation_status: 'created', amount_paise: 999900,
  razorpay_plan_id: 'plan_test_annual', razorpay_total_count: 2, razorpay_subscription_id: 'sub_test_annual',
};

function signedResult(subscriptionId = 'sub_test_annual', paymentId = 'pay_test_annual') {
  return {
    razorpay_subscription_id: subscriptionId,
    razorpay_payment_id: paymentId,
    razorpay_signature: crypto.createHmac('sha256', secret).update(`${paymentId}|${subscriptionId}`).digest('hex'),
  };
}

function setup(options: { local?: any; payment?: any; remoteSubscription?: any; rpcError?: any; rpcData?: any } = {}) {
  const row = options.local === undefined ? localSubscription : options.local;
  const query: any = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({ data: row, error: null })),
  };
  const rpc = vi.fn(async () => options.rpcError
    ? ({ data: null, error: options.rpcError })
    : ({ data: options.rpcData || { status: 'active', paymentStatus: 'captured' }, error: null }));
  vi.spyOn(supabaseServer, 'authenticateServerRequest').mockResolvedValue({
    user: { id: 'user-owner' },
    profile: { id: 'profile-owner', user_id: 'user-owner', organization_id: 'org-owner', role: 'OWNER', status: 'ACTIVE' },
    error: null,
  } as any);
  vi.spyOn(supabaseServer, 'isRealSupabaseServerConfigured').mockReturnValue(true);
  vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue({ from: vi.fn(() => query), rpc } as any);
  const payment = {
    id: 'pay_test_annual', subscription_id: 'sub_test_annual', amount: 999900, currency: 'INR',
    status: 'captured', created_at: 1700000000, amount_refunded: 0, refund_status: null,
    ...options.payment,
  };
  const remoteSubscription = {
    id: 'sub_test_annual', plan_id: 'plan_test_annual', status: 'active', quantity: 1, total_count: 2,
    notes: { encrix_subscription_record_id: 'local-sub-1', encrix_organization_id: 'org-owner' },
    current_start: 1700000000, current_end: 1731536000,
    ...options.remoteSubscription,
  };
  const providerFetch = vi.fn(async (url: string | URL | Request) => {
    const path = String(url);
    if (path.endsWith('/payments/pay_test_annual')) return { ok: true, json: async () => payment } as Response;
    if (path.endsWith('/subscriptions/sub_test_annual')) return { ok: true, json: async () => remoteSubscription } as Response;
    throw new Error(`Unexpected Razorpay request: ${path}`);
  });
  vi.stubGlobal('fetch', providerFetch);
  const response: any = {
    statusCode: 0,
    body: null,
    status(code: number) { this.statusCode = code; return this; },
    json(body: any) { this.body = body; return this; },
  };
  const run = (body: any = signedResult()) => handleBillingAction('verify', {
    method: 'POST', headers: { authorization: 'Bearer owner-session' }, body,
  }, response);
  return { query, rpc, providerFetch, response, run };
}

describe('Razorpay subscription payment verification boundary', () => {
  beforeEach(() => {
    vi.stubEnv('RAZORPAY_KEY_ID', 'rzp_test_lifecycle123');
    vi.stubEnv('RAZORPAY_KEY_SECRET', secret);
    vi.stubEnv('SUPABASE_URL', 'https://db.example.test');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-test-service-role');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('records a verified payment and activates through one transactional RPC using server-derived identity and amount', async () => {
    const h = setup();
    await h.run({ ...signedResult(), amount: 1, currency: 'USD', organization_id: 'org-forged', status: 'captured' });
    expect(h.response.statusCode).toBe(200);
    expect(h.response.body).toEqual({ verified: true, subscriptionStatus: 'active' });
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith('apply_verified_razorpay_payment', expect.objectContaining({
      p_organization_id: 'org-owner', p_local_subscription_id: 'local-sub-1',
      p_provider_subscription_id: 'sub_test_annual', p_payment_id: 'pay_test_annual',
      p_amount_paise: 999900, p_currency: 'INR', p_payment_status: 'captured', p_provider_total_count: 2,
    }));
  });

  it('rejects forged browser success and invalid checkout signatures before provider or database access', async () => {
    const h = setup();
    await h.run({ ...signedResult(), razorpay_signature: 'forged', verified: true, status: 'captured', amount: 999900 });
    expect(h.response.statusCode).toBe(400);
    expect(h.response.body).toEqual({ error: 'INVALID_PAYMENT_SIGNATURE' });
    expect(h.providerFetch).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('rejects invalid raw-body webhook signatures before claiming an event', async () => {
    vi.stubEnv('RAZORPAY_WEBHOOK_SECRET', 'webhook-test-secret');
    vi.spyOn(supabaseServer, 'isRealSupabaseServerConfigured').mockReturnValue(true);
    const rawBody = Buffer.from('{"event":"payment.captured"}');
    const response: any = { statusCode: 0, body: null, status(code: number) { this.statusCode = code; return this; }, json(body: any) { this.body = body; return this; } };
    await handleBillingAction('webhook', {
      method: 'POST', headers: { 'x-razorpay-signature': 'invalid', 'x-razorpay-event-id': 'evt_invalid' }, rawBody,
    }, response);
    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ error: 'INVALID_WEBHOOK_SIGNATURE' });
  });

  it.each([
    ['wrong amount', { amount: 999899 }],
    ['wrong currency', { currency: 'USD' }],
    ['wrong subscription', { subscription_id: 'sub_other' }],
    ['full refund before browser verification', { amount_refunded: 999900, refund_status: 'full' }],
  ])('rejects provider payment with %s without activating', async (_label, payment) => {
    const h = setup({ payment });
    await h.run();
    expect(h.response.statusCode).toBe(400);
    expect(h.response.body).toEqual({ error: 'PAYMENT_DETAILS_NOT_VERIFIED' });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('rejects a subscription whose provider notes identify another organization', async () => {
    const h = setup({ remoteSubscription: { notes: { encrix_subscription_record_id: 'local-sub-1', encrix_organization_id: 'org-other' } } });
    await h.run();
    expect(h.response.statusCode).toBe(400);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('does not find a subscription through another organization profile', async () => {
    const h = setup({ local: null });
    await h.run();
    expect(h.response.statusCode).toBe(404);
    expect(h.query.eq).toHaveBeenCalledWith('organization_id', 'org-owner');
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.providerFetch).not.toHaveBeenCalled();
  });

  it('fails closed when the atomic database transaction fails', async () => {
    const h = setup({ rpcError: { code: '08006' } });
    await h.run();
    expect(h.response.statusCode).toBe(503);
    expect(h.response.body).toEqual({ error: 'BILLING_DATABASE_UNAVAILABLE' });
  });

  it('does not report successful checkout while provider subscription remains pending', async () => {
    const h = setup({ rpcData: { status: 'pending_payment', paymentStatus: 'captured' } });
    await h.run();
    expect(h.response.statusCode).toBe(409);
    expect(h.response.body).toEqual({ verified: false, subscriptionStatus: 'pending_payment', error: 'SUBSCRIPTION_NOT_ACTIVE' });
  });

  it('returns a retryable verification failure when Razorpay is unavailable', async () => {
    const h = setup();
    h.providerFetch.mockRejectedValue(new Error('provider timeout'));
    await h.run();
    expect(h.response.statusCode).toBe(502);
    expect(h.response.body).toEqual({ error: 'PAYMENT_VERIFICATION_UNAVAILABLE' });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('sends simultaneous verified callbacks through the same database-idempotent transaction', async () => {
    const h = setup();
    const secondResponse: any = { ...h.response, status(code: number) { this.statusCode = code; return this; }, json(body: any) { this.body = body; return this; } };
    await Promise.all([
      h.run(),
      handleBillingAction('verify', { method: 'POST', headers: { authorization: 'Bearer owner-session' }, body: signedResult() }, secondResponse),
    ]);
    expect(h.rpc).toHaveBeenCalledTimes(2);
    expect(h.response.body).toEqual({ verified: true, subscriptionStatus: 'active' });
    expect(secondResponse.body).toEqual({ verified: true, subscriptionStatus: 'active' });
  });
});
