import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveBillingAction } from '../../api/_lib/billingRouting.js';
import { handleBillingAction } from '../../api/_lib/billingApi.js';
import * as supabaseServer from '../../api/_lib/supabaseServer.js';
import { resolveLeadAction } from '../../api/_lib/leadRouting.js';
import { getSubscriptionForOrganization } from '../../api/_lib/billingRepository.js';
import { BILLING_PLAN_DRAFTS } from '../../api/_lib/billingPlans.js';
import { parseBillingJsonObject, readRawBillingBody } from '../../api/_lib/billingRequest.js';
import {
  claimWebhookDelivery,
  getConfiguredBillingPlan,
  getExpectedRazorpayPlan,
  getRazorpayTestConfiguration,
  isValidPaymentIdentityUpdate,
  isValidPaymentStatusTransition,
  paymentMatchesSubscription,
  providerSubscriptionStatus,
  razorpayPlanMatchesConfiguration,
  resolveSubscriptionStatus,
  sha256Hex,
  verifyRazorpayWebhookSignature,
  verifySubscriptionCheckoutSignature,
  type WebhookEventStore,
  type WebhookProcessState,
} from '../../api/_lib/billingSecurity.js';

describe('Razorpay billing API foundation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const businessTestEnvironment = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
    RAZORPAY_PLAN_BUSINESS: 'plan_testBusiness9999',
    RAZORPAY_SUBSCRIPTION_TOTAL_COUNT: '2',
    ...overrides,
  });

  function setupReconciliation(options: { pages?: any[][]; detail?: any; plan?: any; updateError?: any; timeoutAt?: number; localProviderSubscriptionId?: string } = {}) {
    const originalEnv = {
      id: process.env.RAZORPAY_KEY_ID, secret: process.env.RAZORPAY_KEY_SECRET,
      plan: process.env.RAZORPAY_PLAN_BUSINESS, count: process.env.RAZORPAY_SUBSCRIPTION_TOTAL_COUNT,
    };
    process.env.RAZORPAY_KEY_ID = 'rzp_test_reconcile123';
    process.env.RAZORPAY_KEY_SECRET = 'synthetic-test-secret';
    process.env.RAZORPAY_PLAN_BUSINESS = 'plan_testBusiness9999';
    process.env.RAZORPAY_SUBSCRIPTION_TOTAL_COUNT = '2';
    const local: any = {
      id: 'local-sub-123', organization_id: 'org-owner', plan_code: 'business', status: 'pending_payment',
      entitlement_source: 'razorpay', is_current: true, checkout_idempotency_key: '123e4567-e89b-42d3-a456-426614174000',
      checkout_creation_status: 'reconciliation_required', amount_paise: 999900,
      razorpay_plan_id: 'plan_testBusiness9999', razorpay_subscription_id: options.localProviderSubscriptionId || null, razorpay_short_url: null,
    };
    const query: any = {
      mode: 'read',
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      in: vi.fn(() => query),
      maybeSingle: vi.fn(async () => {
        const wasUpdate = query.mode === 'update';
        query.mode = 'read';
        return { data: wasUpdate && !options.updateError ? { id: local.id } : local, error: wasUpdate ? options.updateError || null : null };
      }),
      update: vi.fn((row: any) => { query.mode = 'update'; if (!options.updateError) Object.assign(local, row); return query; }),
    };
    vi.spyOn(supabaseServer, 'authenticateServerRequest').mockResolvedValue({
      user: { id: 'user-owner' },
      profile: { id: 'profile-owner', user_id: 'user-owner', organization_id: 'org-owner', full_name: 'Owner', role: 'OWNER', status: 'ACTIVE' },
      error: null,
    } as any);
    vi.spyOn(supabaseServer, 'isRealSupabaseServerConfigured').mockReturnValue(true);
    vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue({ from: vi.fn(() => query) } as any);
    const pages = options.pages || [];
    let listIndex = 0;
    const providerFetch = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      const path = String(url).replace('https://api.razorpay.com/v1/', '');
      if (path.startsWith('plans/')) return { ok: true, json: async () => options.plan || ({
        id: 'plan_testBusiness9999', period: 'yearly', interval: 1, item: { amount: 999900, currency: 'INR' },
      }) } as Response;
      if (path.startsWith('subscriptions?')) {
        if (options.timeoutAt === listIndex) throw new Error('provider timeout');
        return { ok: true, json: async () => ({ items: pages[listIndex++] || [] }) } as Response;
      }
      if (path.startsWith('subscriptions/')) return { ok: true, json: async () => options.detail || ({
        id: 'sub_testrecovered', plan_id: 'plan_testBusiness9999', notes: {
          encrix_subscription_record_id: local.id, encrix_organization_id: 'org-owner',
        }, quantity: 1, total_count: 2, status: 'created', short_url: 'https://rzp.io/recovered',
      }) } as Response;
      throw new Error(`Unexpected provider request: ${path}`);
    });
    vi.stubGlobal('fetch', providerFetch);
    const response: any = {
      statusCode: 0, body: null,
      status(code: number) { this.statusCode = code; return this; },
      json(value: any) { this.body = value; return this; },
    };
    const run = () => handleBillingAction('reconcile', {
      method: 'POST', headers: { authorization: 'Bearer test-session' },
      body: { idempotencyKey: local.checkout_idempotency_key },
    }, response);
    const restore = () => {
      for (const [key, value] of Object.entries({ RAZORPAY_KEY_ID: originalEnv.id, RAZORPAY_KEY_SECRET: originalEnv.secret, RAZORPAY_PLAN_BUSINESS: originalEnv.plan, RAZORPAY_SUBSCRIPTION_TOTAL_COUNT: originalEnv.count })) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    };
    return { local, query, providerFetch, response, run, restore };
  }

  it('verifies subscription checkout signatures with payment_id|subscription_id and rejects tampering', () => {
    const keySecret = 'synthetic-test-secret';
    const signature = crypto.createHmac('sha256', keySecret)
      .update('pay_test_123|sub_test_456')
      .digest('hex');

    expect(verifySubscriptionCheckoutSignature('sub_test_456', 'pay_test_123', signature, keySecret)).toBe(true);
    expect(verifySubscriptionCheckoutSignature('sub_test_456', 'pay_test_other', signature, keySecret)).toBe(false);
    expect(verifySubscriptionCheckoutSignature('sub_test_456', 'pay_test_123', 'bad-signature', keySecret)).toBe(false);
  });

  it('verifies webhook signatures against the exact raw bytes', () => {
    const secret = 'synthetic-webhook-secret';
    const rawBody = Buffer.from('{"event":"subscription.activated"}\n');
    const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    expect(verifyRazorpayWebhookSignature(rawBody, signature, secret)).toBe(true);
    expect(verifyRazorpayWebhookSignature(rawBody, 'invalid-signature', secret)).toBe(false);
    expect(verifyRazorpayWebhookSignature(Buffer.from(rawBody.toString().trim()), signature, secret)).toBe(false);
  });

  it('parses checkout JSON when Vercel bodyParser is disabled and preserves webhook bytes', async () => {
    const rawBody = Buffer.from('{"planCode":"starter","idempotencyKey":"key"}');
    const request = {
      async *[Symbol.asyncIterator]() { yield rawBody; },
    };

    expect(await parseBillingJsonObject(request)).toEqual({ planCode: 'starter', idempotencyKey: 'key' });
    expect(await readRawBillingBody({ rawBody })).toEqual(rawBody);
    expect(await parseBillingJsonObject({ rawBody: Buffer.from('[]') })).toBeNull();
  });

  it('fails closed for absent plan price, limits, provider plan ID, or subscription duration', () => {
    const env = {
      RAZORPAY_PLAN_STARTER: 'plan_test_configured',
      RAZORPAY_SUBSCRIPTION_TOTAL_COUNT: '12',
    } as NodeJS.ProcessEnv;
    expect(getConfiguredBillingPlan('starter', env)).toBeNull();
    expect(getConfiguredBillingPlan('unknown', env)).toBeNull();
  });

  it('keeps pilot checkout closed while validating the annual Business Test Mode plan contract', () => {
    const env = businessTestEnvironment();
    expect(getExpectedRazorpayPlan('business', env)).toEqual({
      code: 'business',
      planId: 'plan_testBusiness9999',
      amountPaise: 999900,
      currency: 'INR',
      period: 'yearly',
      interval: 1,
      // A synthetic value demonstrating total_count is billed periods (years here), not months.
      totalCount: 2,
    });
    expect(BILLING_PLAN_DRAFTS.business.checkoutEnabled).toBe(false);
    expect(getConfiguredBillingPlan('business', env)).toBeNull();
    BILLING_PLAN_DRAFTS.business.checkoutEnabled = true;
    expect(getConfiguredBillingPlan('business', env)).toMatchObject({ amountPaise: 999900, currency: 'INR', period: 'yearly', interval: 1 });
    BILLING_PLAN_DRAFTS.business.checkoutEnabled = false;
    expect(getExpectedRazorpayPlan('starter', env)).toBeNull();
    expect(getExpectedRazorpayPlan('professional', env)).toBeNull();
  });

  it('requires an explicit positive integer cycle count and a valid configured plan ID', () => {
    expect(getExpectedRazorpayPlan('business', businessTestEnvironment({
      RAZORPAY_SUBSCRIPTION_TOTAL_COUNT: undefined,
    }))).toBeNull();
    for (const totalCount of ['0', '-1', '1.5', '01', '']) {
      expect(getExpectedRazorpayPlan('business', businessTestEnvironment({
        RAZORPAY_SUBSCRIPTION_TOTAL_COUNT: totalCount,
      }))).toBeNull();
    }
    expect(getExpectedRazorpayPlan('business', businessTestEnvironment({
      RAZORPAY_PLAN_BUSINESS: 'plan_placeholder',
    }))).toBeNull();
    expect(getExpectedRazorpayPlan('business', businessTestEnvironment({
      RAZORPAY_PLAN_BUSINESS: 'rzp_test_not_a_plan',
    }))).toBeNull();
  });

  it('accepts only Razorpay test credentials for this checkout integration', () => {
    expect(getRazorpayTestConfiguration({
      RAZORPAY_KEY_ID: 'rzp_test_key123',
      RAZORPAY_KEY_SECRET: 'synthetic-test-secret',
    } as NodeJS.ProcessEnv)).not.toBeNull();
    expect(getRazorpayTestConfiguration({
      RAZORPAY_KEY_ID: 'rzp_live_key123',
      RAZORPAY_KEY_SECRET: 'synthetic-test-secret',
    } as NodeJS.ProcessEnv)).toBeNull();
  });

  it('rejects payment records that do not match the expected subscription, amount, currency, or state', () => {
    const expected = { subscriptionId: 'sub_test_1', amountPaise: 12500 };
    const valid = {
      id: 'pay_test_1', subscription_id: 'sub_test_1', amount: 12500, currency: 'INR', status: 'captured',
    };
    expect(paymentMatchesSubscription(valid, expected)).toBe(true);
    expect(paymentMatchesSubscription({ ...valid, amount: 12501 }, expected)).toBe(false);
    expect(paymentMatchesSubscription({ ...valid, subscription_id: 'sub_test_other' }, expected)).toBe(false);
    expect(paymentMatchesSubscription({ ...valid, currency: 'USD' }, expected)).toBe(false);
    expect(paymentMatchesSubscription({ ...valid, status: 'authorized' }, expected)).toBe(false);
  });

  it('validates annual Business amount, currency, period, interval, and provider plan ID', () => {
    const expected = {
      planId: 'plan_testBusiness9999',
      amountPaise: 999900,
      currency: 'INR' as const,
      period: 'yearly' as const,
      interval: 1,
    };
    const valid = {
      id: expected.planId,
      period: 'yearly',
      interval: 1,
      item: { amount: 999900, unit_amount: 999900, currency: 'INR' },
    };
    expect(razorpayPlanMatchesConfiguration(valid, expected)).toBe(true);
    expect(razorpayPlanMatchesConfiguration({ ...valid, item: { ...valid.item, amount: 999800 } }, expected)).toBe(false);
    expect(razorpayPlanMatchesConfiguration({ ...valid, item: { ...valid.item, unit_amount: 999800 } }, expected)).toBe(false);
    expect(razorpayPlanMatchesConfiguration({ ...valid, item: { ...valid.item, currency: 'USD' } }, expected)).toBe(false);
    expect(razorpayPlanMatchesConfiguration({ ...valid, period: 'monthly' }, expected)).toBe(false);
    expect(razorpayPlanMatchesConfiguration({ ...valid, interval: 12 }, expected)).toBe(false);
    expect(razorpayPlanMatchesConfiguration({ ...valid, id: 'plan_testAnother' }, expected)).toBe(false);
    expect(razorpayPlanMatchesConfiguration({ ...valid, item: { currency: 'INR' } }, expected)).toBe(false);
  });

  it('publishes only the approved Business subscription without advertising checkout or paid entitlements', async () => {
    const response = {
      statusCode: 0,
      body: null as any,
      status(statusCode: number) { this.statusCode = statusCode; return this; },
      json(body: any) { this.body = body; return body; },
    };

    await handleBillingAction('plans', { method: 'GET' }, response);

    expect(response.statusCode).toBe(200);
    expect(response.body.plans).toHaveLength(1);
    expect(response.body.plans.map((plan: any) => plan.code)).toEqual(['business']);
    const business = response.body.plans.find((plan: any) => plan.code === 'business');
    expect(business).toMatchObject({
      billingInterval: 'yearly',
      billingIntervalCount: 1,
      currency: 'INR',
      priceInr: 9999,
      checkoutAvailable: false,
      featureEntitlements: { calling: null, reporting: null, followUpAutomation: null },
    });
  });

  it('initiates a server-priced Razorpay subscription only after verifying the provider plan', async () => {
    const previous = {
      availability: BILLING_PLAN_DRAFTS.business.availability,
      checkoutEnabled: BILLING_PLAN_DRAFTS.business.checkoutEnabled,
      keyId: process.env.RAZORPAY_KEY_ID,
      keySecret: process.env.RAZORPAY_KEY_SECRET,
      plan: process.env.RAZORPAY_PLAN_BUSINESS,
      totalCount: process.env.RAZORPAY_SUBSCRIPTION_TOTAL_COUNT,
    };
    BILLING_PLAN_DRAFTS.business.availability = 'available';
    BILLING_PLAN_DRAFTS.business.checkoutEnabled = true;
    process.env.RAZORPAY_KEY_ID = 'rzp_test_checkout123';
    process.env.RAZORPAY_KEY_SECRET = 'synthetic-test-secret';
    process.env.RAZORPAY_PLAN_BUSINESS = 'plan_testBusiness9999';
    process.env.RAZORPAY_SUBSCRIPTION_TOTAL_COUNT = '2';

    const operations: string[] = [];
    const query: any = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
      insert: vi.fn(() => { operations.push('insert'); return query; }),
      update: vi.fn(() => { operations.push('update'); return query; }),
      single: vi.fn(async () => ({ data: { id: 'local-subscription-1' }, error: null })),
    };
    vi.spyOn(supabaseServer, 'authenticateServerRequest').mockResolvedValue({
      user: { id: 'user-owner' },
      profile: { id: 'profile-owner', user_id: 'user-owner', organization_id: 'org-owner', full_name: 'Owner', role: 'OWNER', status: 'ACTIVE' },
      error: null,
    } as any);
    vi.spyOn(supabaseServer, 'isRealSupabaseServerConfigured').mockReturnValue(true);
    vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue({ from: vi.fn(() => query) } as any);
    const providerFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return { ok: true, json: async () => ({ id: 'sub_test_created', plan_id: 'plan_testBusiness9999', quantity: 1, total_count: 2, notes: { encrix_subscription_record_id: 'local-subscription-1', encrix_organization_id: 'org-owner' }, short_url: 'https://rzp.io/test-subscription' }) } as Response;
      }
      return { ok: true, json: async () => ({
        id: 'plan_testBusiness9999', period: 'yearly', interval: 1,
        item: { amount: 999900, currency: 'INR' },
      }) } as Response;
    });
    vi.stubGlobal('fetch', providerFetch);
    const response = {
      statusCode: 0,
      body: null as any,
      status(statusCode: number) { this.statusCode = statusCode; return this; },
      json(body: any) { this.body = body; return body; },
    };

    try {
      await handleBillingAction('checkout', {
        method: 'POST',
        headers: { authorization: 'Bearer test-session' },
        body: { planCode: 'business', idempotencyKey: '123e4567-e89b-42d3-a456-426614174000' },
      }, response);
      expect(response.statusCode).toBe(201);
      expect(response.body).toMatchObject({ subscriptionId: 'sub_test_created', keyId: 'rzp_test_checkout123' });
      expect(providerFetch).toHaveBeenCalledTimes(2);
      expect(operations).toEqual(['insert', 'update']);
    expect(query.insert).toHaveBeenCalledWith(expect.objectContaining({ amount_paise: 999900, razorpay_total_count: 2, status: 'pending_payment' }));
    } finally {
      BILLING_PLAN_DRAFTS.business.availability = previous.availability;
      BILLING_PLAN_DRAFTS.business.checkoutEnabled = previous.checkoutEnabled;
      for (const [key, value] of Object.entries({
        RAZORPAY_KEY_ID: previous.keyId,
        RAZORPAY_KEY_SECRET: previous.keySecret,
        RAZORPAY_PLAN_BUSINESS: previous.plan,
        RAZORPAY_SUBSCRIPTION_TOTAL_COUNT: previous.totalCount,
      })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('reconciles by exact notes across provider pages and never creates another subscription', async () => {
    const noise = Array.from({ length: 100 }, (_, i) => ({ id: `sub_noise_${i}`, notes: {} }));
    const match = { id: 'sub_testrecovered', plan_id: 'plan_testBusiness9999', quantity: 1, total_count: 2, status: 'created',
      notes: { encrix_subscription_record_id: 'local-sub-123', encrix_organization_id: 'org-owner' } };
    const h = setupReconciliation({ pages: [noise, [match], []] });
    try {
      await h.run();
      expect(h.response.statusCode).toBe(200);
      expect(h.response.body).toMatchObject({ subscriptionId: 'sub_testrecovered', reconciled: true });
      expect(h.local.razorpay_subscription_id).toBe('sub_testrecovered');
      expect(h.providerFetch.mock.calls.filter(([url]) => String(url).includes('subscriptions?')).map(([url]) => String(url))).toEqual([
        expect.stringContaining('skip=0'), expect.stringContaining('skip=100'),
      ]);
      expect(h.providerFetch.mock.calls.some(([url, init]) => String(url).endsWith('/subscriptions') && init?.method === 'POST')).toBe(false);
      await h.run();
      expect(h.response.statusCode).toBe(200);
      expect(h.providerFetch).toHaveBeenCalledTimes(4); // second call returns the already reconciled local record
    } finally { h.restore(); }
  });

  it.each([
    ['no match', { pages: [[]] }, 409, 'PROVIDER_SUBSCRIPTION_NOT_FOUND_SUPPORT_REQUIRED'],
    ['ambiguous matches', { pages: [[
      { id: 'sub_testa', plan_id: 'plan_testBusiness9999', quantity: 1, total_count: 2, status: 'created', notes: { encrix_subscription_record_id: 'local-sub-123', encrix_organization_id: 'org-owner' } },
      { id: 'sub_testb', plan_id: 'plan_testBusiness9999', quantity: 1, total_count: 2, status: 'created', notes: { encrix_subscription_record_id: 'local-sub-123', encrix_organization_id: 'org-owner' } },
    ]] }, 409, 'MULTIPLE_PROVIDER_SUBSCRIPTIONS_REQUIRE_SUPPORT'],
    ['organization mismatch', { pages: [[{ id: 'sub_testforeign', notes: { encrix_subscription_record_id: 'local-sub-123', encrix_organization_id: 'org-elsewhere' } }]] }, 409, 'PROVIDER_ORGANIZATION_MISMATCH_SUPPORT_REQUIRED'],
    ['provider timeout', { pages: [], timeoutAt: 0 }, 503, 'PROVIDER_RECONCILIATION_UNAVAILABLE'],
    ['database update failure', { pages: [[{ id: 'sub_testrecovered', plan_id: 'plan_testBusiness9999', quantity: 1, total_count: 2, status: 'created', notes: { encrix_subscription_record_id: 'local-sub-123', encrix_organization_id: 'org-owner' } }]], updateError: { code: 'XX000' } }, 503, 'RECONCILIATION_SAVE_FAILED_SUPPORT_REQUIRED'],
    ['plan mismatch', { pages: [[]], plan: { id: 'plan_testBusiness9999', period: 'yearly', interval: 1, item: { amount: 1, currency: 'INR' } } }, 409, 'PROVIDER_PLAN_MISMATCH_SUPPORT_REQUIRED'],
    ['subscription billing details mismatch', { pages: [[{ id: 'sub_testrecovered', plan_id: 'plan_testBusiness9999', quantity: 1, total_count: 3, status: 'created', notes: { encrix_subscription_record_id: 'local-sub-123', encrix_organization_id: 'org-owner' } }]] }, 409, 'PROVIDER_SUBSCRIPTION_DETAILS_MISMATCH_SUPPORT_REQUIRED'],
    ['local provider identifier conflict', { pages: [[{ id: 'sub_testrecovered', plan_id: 'plan_testBusiness9999', quantity: 1, total_count: 2, status: 'created', notes: { encrix_subscription_record_id: 'local-sub-123', encrix_organization_id: 'org-owner' } }]], localProviderSubscriptionId: 'sub_testexisting' }, 409, 'LOCAL_PROVIDER_SUBSCRIPTION_ID_CONFLICT_SUPPORT_REQUIRED'],
  ])('fails closed for %s during reconciliation', async (_label, options: any, status, code) => {
    const h = setupReconciliation(options);
    try {
      await h.run();
      expect(h.response.statusCode).toBe(status);
      expect(h.response.body.error).toBe(code);
      expect(h.providerFetch.mock.calls.some(([url, init]) => String(url).endsWith('/subscriptions') && init?.method === 'POST')).toBe(false);
    } finally { h.restore(); }
  });

  it('does not mark a remote active subscription entitled until a captured payment is verified', () => {
    expect(providerSubscriptionStatus('active', false)).toBe('pending_payment');
    expect(providerSubscriptionStatus('active', true)).toBe('active');
    expect(providerSubscriptionStatus('halted', true)).toBe('past_due');
    expect(providerSubscriptionStatus('cancelled', true)).toBe('cancelled');
  });

  it('does not reactivate locally cancelled or expired subscriptions from a later active event or callback', () => {
    expect(resolveSubscriptionStatus('cancelled', 'active', true)).toBe('cancelled');
    expect(resolveSubscriptionStatus('expired', 'active', true)).toBe('expired');
    expect(resolveSubscriptionStatus('past_due', 'active', true)).toBe('active');
  });

  it('claims webhook event IDs once, reports duplicates, and permits a stale processing retry', async () => {
    const events = new Map<string, {
      id: string;
      state: WebhookProcessState;
      started: string | null;
      eventType: string;
      payloadHash: string;
    }>();
    let nextId = 0;
    const store: WebhookEventStore = {
      async insert(event) {
        if (events.has(event.eventId)) return false;
        events.set(event.eventId, {
          id: String(++nextId),
          state: 'processing',
          started: event.processingStartedAt,
          eventType: event.eventType,
          payloadHash: event.payloadHash,
        });
        return true;
      },
      async get(eventId) {
        const event = events.get(eventId);
        return event ? {
          id: event.id,
          state: event.state,
          processingStartedAt: event.started,
          eventType: event.eventType,
          payloadHash: event.payloadHash,
        } : null;
      },
      async claim(id, currentState, staleBefore, startedAt) {
        const event = [...events.values()].find((candidate) => candidate.id === id);
        if (!event || event.state !== currentState) return false;
        if (currentState === 'processing' && (!event.started || event.started >= staleBefore)) return false;
        event.state = 'processing';
        event.started = startedAt;
        return true;
      },
    };
    const delivery = { eventId: 'evt_test_1', eventType: 'subscription.activated', payloadHash: 'a'.repeat(64) };
    const now = Date.parse('2026-10-22T00:00:00.000Z');

    expect(await claimWebhookDelivery(delivery, store, now)).toBe('claimed');
    expect(await claimWebhookDelivery(delivery, store, now + 1000)).toBe('in_flight');
    const event = events.get(delivery.eventId)!;
    event.state = 'processed';
    expect(await claimWebhookDelivery(delivery, store, now + 2000)).toBe('duplicate');
    expect(await claimWebhookDelivery({ ...delivery, payloadHash: 'b'.repeat(64) }, store, now + 2500))
      .toBe('conflict');
    expect(events.get(delivery.eventId)?.state).toBe('processed');
    event.state = 'processing';
    event.started = new Date(now - 6 * 60 * 1000).toISOString();
    expect(await claimWebhookDelivery(delivery, store, now)).toBe('claimed');
  });

  it('scopes subscription status lookup to the authenticated organization', async () => {
    const filters: Array<[string, unknown]> = [];
    const query = {
      select() { return this; },
      eq(column: string, value: unknown) { filters.push([column, value]); return this; },
      maybeSingle: async () => ({ data: null, error: null }),
    };
    await getSubscriptionForOrganization({ from: () => query }, 'org_test_owner');
    expect(filters).toContainEqual(['organization_id', 'org_test_owner']);
    expect(filters).toContainEqual(['is_current', true]);
  });

  it('preserves the public leads paths and exposes only the named billing actions through dispatchers', () => {
    expect(resolveLeadAction('detail')).toBe('detail');
    expect(resolveLeadAction('distribute')).toBe('distribute');
    expect(resolveLeadAction('distribution-config')).toBe('distribution-config');
    expect(resolveLeadAction('unknown')).toBeNull();
    for (const action of ['plans', 'checkout', 'reconcile', 'verify', 'webhook', 'subscription', 'business-details']) {
      expect(resolveBillingAction(action)).toBe(action);
    }
    expect(resolveBillingAction('admin')).toBeNull();

    const rewrites = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8')).rewrites;
    for (const path of ['/api/leads/detail', '/api/leads/distribute', '/api/leads/distribution-config']) {
      expect(rewrites.some((route: any) => route.source === path && route.destination.startsWith('/api/leads?'))).toBe(true);
    }
    expect(rewrites.findIndex((route: any) => route.source === '/api/(.*)'))
      .toBeGreaterThan(rewrites.findIndex((route: any) => route.source === '/api/billing/webhook'));
    expect(rewrites.some((route: any) => route.source === '/api/billing/business-details' && route.destination === '/api/billing?_route=business-details')).toBe(true);
    expect(rewrites.some((route: any) => route.source === '/api/billing/reconcile' && route.destination === '/api/billing?_route=reconcile')).toBe(true);
    const securityHeaders = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8')).headers;
    const csp = securityHeaders.flatMap((header: any) => header.headers || [])
      .find((header: any) => header.key === 'Content-Security-Policy')?.value;
    expect(csp).toContain('frame-src');
    expect(csp).toContain('https://*.razorpay.com');
  });

  describe('payment lifecycle transitions & identity protection', () => {
    it('permits valid forward payment status progression and rejects invalid reversals', () => {
      // Valid progressions
      expect(isValidPaymentStatusTransition('created', 'authorized')).toBe(true);
      expect(isValidPaymentStatusTransition('created', 'captured')).toBe(true);
      expect(isValidPaymentStatusTransition('created', 'failed')).toBe(true);
      expect(isValidPaymentStatusTransition('authorized', 'captured')).toBe(true);
      expect(isValidPaymentStatusTransition('authorized', 'failed')).toBe(true);
      expect(isValidPaymentStatusTransition('failed', 'captured')).toBe(true);
      expect(isValidPaymentStatusTransition('captured', 'refunded')).toBe(true);

      // Identity transitions (no status change)
      for (const status of ['created', 'authorized', 'captured', 'failed', 'refunded']) {
        expect(isValidPaymentStatusTransition(status, status)).toBe(true);
      }

      // Prohibited reversals & illegal skips
      expect(isValidPaymentStatusTransition('captured', 'failed')).toBe(false);
      expect(isValidPaymentStatusTransition('captured', 'created')).toBe(false);
      expect(isValidPaymentStatusTransition('captured', 'authorized')).toBe(false);
      expect(isValidPaymentStatusTransition('refunded', 'captured')).toBe(false);
      expect(isValidPaymentStatusTransition('refunded', 'failed')).toBe(false);
      expect(isValidPaymentStatusTransition('refunded', 'created')).toBe(false);
      expect(isValidPaymentStatusTransition('refunded', 'authorized')).toBe(false);
      expect(isValidPaymentStatusTransition('failed', 'authorized')).toBe(false);
      expect(isValidPaymentStatusTransition('failed', 'refunded')).toBe(false);
      expect(isValidPaymentStatusTransition('failed', 'created')).toBe(false);
      expect(isValidPaymentStatusTransition('authorized', 'created')).toBe(false);
      expect(isValidPaymentStatusTransition('authorized', 'refunded')).toBe(false);
    });

    it('permits one-time NULL-to-real-payment-ID assignment and prevents subsequent mutation or clearing', () => {
      const org = 'org_test_123';
      const sub = 'sub_local_123';

      // One-time NULL to real ID is permitted
      expect(isValidPaymentIdentityUpdate(
        { organizationId: org, subscriptionId: sub, razorpayPaymentId: null },
        { organizationId: org, subscriptionId: sub, razorpayPaymentId: 'pay_integrity_123' },
      )).toBe(true);

      // Keeping same real ID is permitted
      expect(isValidPaymentIdentityUpdate(
        { organizationId: org, subscriptionId: sub, razorpayPaymentId: 'pay_integrity_123' },
        { organizationId: org, subscriptionId: sub, razorpayPaymentId: 'pay_integrity_123' },
      )).toBe(true);

      // Subsequent change of real ID to a different ID is strictly blocked
      expect(isValidPaymentIdentityUpdate(
        { organizationId: org, subscriptionId: sub, razorpayPaymentId: 'pay_integrity_123' },
        { organizationId: org, subscriptionId: sub, razorpayPaymentId: 'pay_mutated_456' },
      )).toBe(false);

      // Subsequent clearing of real ID back to NULL is strictly blocked
      expect(isValidPaymentIdentityUpdate(
        { organizationId: org, subscriptionId: sub, razorpayPaymentId: 'pay_integrity_123' },
        { organizationId: org, subscriptionId: sub, razorpayPaymentId: null },
      )).toBe(false);

      // Setting empty or whitespace string is blocked
      expect(isValidPaymentIdentityUpdate(
        { organizationId: org, subscriptionId: sub, razorpayPaymentId: null },
        { organizationId: org, subscriptionId: sub, razorpayPaymentId: '' },
      )).toBe(false);
      expect(isValidPaymentIdentityUpdate(
        { organizationId: org, subscriptionId: sub, razorpayPaymentId: null },
        { organizationId: org, subscriptionId: sub, razorpayPaymentId: '   ' },
      )).toBe(false);

      // Changing organizationId or subscriptionId is strictly blocked
      expect(isValidPaymentIdentityUpdate(
        { organizationId: org, subscriptionId: sub, razorpayPaymentId: null },
        { organizationId: 'org_different', subscriptionId: sub, razorpayPaymentId: 'pay_123' },
      )).toBe(false);
      expect(isValidPaymentIdentityUpdate(
        { organizationId: org, subscriptionId: sub, razorpayPaymentId: null },
        { organizationId: org, subscriptionId: 'sub_different', razorpayPaymentId: 'pay_123' },
      )).toBe(false);
    });
  });

  describe('webhook idempotency & duplicate handling', () => {
    it('handles duplicate webhook delivery idempotently returning 200 with duplicate flag', async () => {
      const webhookSecret = 'test_webhook_secret_secure_123';
      process.env.RAZORPAY_KEY_ID = 'rzp_test_webhook123';
      process.env.RAZORPAY_KEY_SECRET = 'synthetic-test-secret';
      process.env.RAZORPAY_WEBHOOK_SECRET = webhookSecret;
      vi.spyOn(supabaseServer, 'isRealSupabaseServerConfigured').mockReturnValue(true);

      const eventPayload = {
        entity: 'event',
        account_id: 'acc_test123',
        event: 'subscription.charged',
        contains: ['subscription', 'payment'],
        payload: {
          subscription: {
            entity: {
              id: 'sub_test_duplicate',
              plan_id: 'plan_testBusiness9999',
              status: 'active',
              current_start: 1700000000,
              current_end: 1731536000,
            },
          },
          payment: {
            entity: {
              id: 'pay_test_duplicate_1',
              subscription_id: 'sub_test_duplicate',
              amount: 999900,
              currency: 'INR',
              status: 'captured',
              created_at: 1700000000,
            },
          },
        },
      };

      const rawBody = Buffer.from(JSON.stringify(eventPayload), 'utf8');
      const signature = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
      const eventId = 'evt_test_duplicate_1';

      // Mock database store for billing_webhook_events and organization_subscriptions
      let storedEvent: any = null;
      const query: any = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        neq: vi.fn(() => query),
        not: vi.fn(() => query),
        limit: vi.fn(() => query),
        then: (resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve),
        maybeSingle: vi.fn(async () => {
          if (query.currentTable === 'billing_webhook_events') {
            return { data: storedEvent, error: null };
          }
          if (query.currentTable === 'organization_subscriptions') {
            return {
              data: {
                id: 'sub-local-1',
                organization_id: 'org-test-1',
                plan_code: 'business',
                status: 'pending_payment',
                razorpay_plan_id: 'plan_testBusiness9999',
                razorpay_total_count: 2,
                amount_paise: 999900,
              },
              error: null,
            };
          }
          if (query.currentTable === 'billing_payments') {
            return { data: { id: 'pay-record-1' }, error: null };
          }
          return { data: null, error: null };
        }),
        insert: vi.fn((row: any) => {
          if (query.currentTable === 'billing_webhook_events') {
            if (storedEvent && storedEvent.provider_event_id === row.provider_event_id) {
              return {
                select: vi.fn(() => ({
                  maybeSingle: async () => ({ data: null, error: { code: '23505', message: 'duplicate key value' } }),
                })),
              };
            }
            storedEvent = {
              id: 'evt-row-1',
              provider: row.provider,
              provider_event_id: row.provider_event_id,
              event_type: row.event_type,
              payload_sha256: row.payload_sha256,
              processing_status: 'processing',
              processing_started_at: row.processing_started_at,
            };
            return {
              select: vi.fn(() => ({
                maybeSingle: async () => ({ data: { id: 'evt-row-1' }, error: null }),
              })),
            };
          }
          return query;
        }),
        update: vi.fn((fields: any) => {
          if (query.currentTable === 'billing_webhook_events' && storedEvent) {
            Object.assign(storedEvent, fields);
          }
          return query;
        }),
        upsert: vi.fn(async () => ({ error: null })),
      };

      const fakeSupabase = {
        from: vi.fn((table: string) => {
          query.currentTable = table;
          return query;
        }),
        rpc: vi.fn(async () => ({ data: { status: 'active', paymentStatus: 'captured' }, error: null })),
      };
      vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue(fakeSupabase as any);

      const providerFetch = vi.fn(async (url: string | URL | Request) => {
        const path = String(url).replace('https://api.razorpay.com/v1/', '');
        if (path.startsWith('subscriptions/')) {
          return {
            ok: true,
            json: async () => ({
              id: 'sub_test_duplicate',
              plan_id: 'plan_testBusiness9999',
              status: 'active',
              current_start: 1700000000,
              current_end: 1731536000,
              total_count: 2,
              quantity: 1,
              notes: { encrix_subscription_record_id: 'sub-local-1', encrix_organization_id: 'org-test-1' },
            }),
          } as Response;
        }
        if (path.startsWith('payments/')) {
          return {
            ok: true,
            json: async () => ({
              id: 'pay_test_duplicate_1',
              subscription_id: 'sub_test_duplicate',
              amount: 999900,
              currency: 'INR',
              status: 'captured',
              created_at: 1700000000,
            }),
          } as Response;
        }
        throw new Error(`Unexpected provider call: ${path}`);
      });
      vi.stubGlobal('fetch', providerFetch);

      // 1. First webhook delivery: succeeds with 200
      const res1 = {
        statusCode: 0,
        body: null as any,
        status(code: number) { this.statusCode = code; return this; },
        json(val: any) { this.body = val; return this; },
      };
      await handleBillingAction('webhook', {
        method: 'POST',
        headers: {
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': eventId,
        },
        body: rawBody,
      }, res1);

      expect(res1.statusCode).toBe(200);
      expect(res1.body).toEqual({ received: true });
      expect(storedEvent.processing_status).toBe('processed');

      // 2. Duplicate webhook delivery with identical event ID & payload: returns 200 { duplicate: true }
      const res2 = {
        statusCode: 0,
        body: null as any,
        status(code: number) { this.statusCode = code; return this; },
        json(val: any) { this.body = val; return this; },
      };
      await handleBillingAction('webhook', {
        method: 'POST',
        headers: {
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': eventId,
        },
        body: rawBody,
      }, res2);

      expect(res2.statusCode).toBe(200);
      expect(res2.body).toEqual({ received: true, duplicate: true });

      // 3. Conflicting delivery with same event ID but altered body: returns 409
      const alteredBody = Buffer.from(JSON.stringify({ ...eventPayload, event: 'subscription.cancelled' }), 'utf8');
      const alteredSig = crypto.createHmac('sha256', webhookSecret).update(alteredBody).digest('hex');
      const res3 = {
        statusCode: 0,
        body: null as any,
        status(code: number) { this.statusCode = code; return this; },
        json(val: any) { this.body = val; return this; },
      };
      await handleBillingAction('webhook', {
        method: 'POST',
        headers: {
          'x-razorpay-signature': alteredSig,
          'x-razorpay-event-id': eventId,
        },
        body: alteredBody,
      }, res3);

      expect(res3.statusCode).toBe(409);
      expect(res3.body).toEqual({ error: 'WEBHOOK_EVENT_ID_CONFLICT' });
    });
  });
});
