import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveBillingAction } from '../../api/_lib/billingRouting.js';
import { resolveLeadAction } from '../../api/_lib/leadRouting.js';
import { getSubscriptionForOrganization } from '../../api/_lib/billingRepository.js';
import { parseBillingJsonObject, readRawBillingBody } from '../../api/_lib/billingRequest.js';
import {
  claimWebhookDelivery,
  getConfiguredBillingPlan,
  paymentMatchesSubscription,
  providerSubscriptionStatus,
  razorpayPlanMatchesConfiguration,
  resolveSubscriptionStatus,
  verifyRazorpayWebhookSignature,
  verifySubscriptionCheckoutSignature,
  type WebhookEventStore,
  type WebhookProcessState,
} from '../../api/_lib/billingSecurity.js';

describe('Razorpay billing API foundation', () => {
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

  it('rejects provider plans whose cadence, currency, ID, or amount differs from server configuration', () => {
    const expected = { planId: 'plan_test_1', amountPaise: 12500 };
    const valid = {
      id: 'plan_test_1', period: 'monthly', interval: 1,
      item: { amount: 12500, currency: 'INR' },
    };
    expect(razorpayPlanMatchesConfiguration(valid, expected)).toBe(true);
    expect(razorpayPlanMatchesConfiguration({ ...valid, item: { amount: 12501, currency: 'INR' } }, expected)).toBe(false);
    expect(razorpayPlanMatchesConfiguration({ ...valid, period: 'yearly' }, expected)).toBe(false);
    expect(razorpayPlanMatchesConfiguration({ ...valid, interval: 2 }, expected)).toBe(false);
    expect(razorpayPlanMatchesConfiguration({ ...valid, item: { amount: 12500, currency: 'USD' } }, expected)).toBe(false);
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
    for (const action of ['plans', 'checkout', 'verify', 'webhook', 'subscription']) {
      expect(resolveBillingAction(action)).toBe(action);
    }
    expect(resolveBillingAction('admin')).toBeNull();

    const rewrites = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8')).rewrites;
    for (const path of ['/api/leads/detail', '/api/leads/distribute', '/api/leads/distribution-config']) {
      expect(rewrites.some((route: any) => route.source === path && route.destination.startsWith('/api/leads?'))).toBe(true);
    }
    expect(rewrites.findIndex((route: any) => route.source === '/api/(.*)'))
      .toBeGreaterThan(rewrites.findIndex((route: any) => route.source === '/api/billing/webhook'));
  });
});
