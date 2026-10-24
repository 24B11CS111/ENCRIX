import crypto from 'node:crypto';
import { BILLING_PLAN_CODES, BILLING_PLAN_DRAFTS, type BillingPlanCode } from './billingPlans.js';

const PLACEHOLDER_MARKERS = ['placeholder', 'your-', 'replace-me', 'changeme'];

function isUsableSecret(value: string | undefined): value is string {
  return Boolean(value && !PLACEHOLDER_MARKERS.some((marker) => value.toLowerCase().includes(marker)));
}

export interface RazorpayTestConfiguration {
  keyId: string;
  keySecret: string;
  webhookSecret?: string;
}

export function getRazorpayTestConfiguration(
  env: NodeJS.ProcessEnv = process.env,
  requireWebhookSecret = false,
): RazorpayTestConfiguration | null {
  const keyId = env.RAZORPAY_KEY_ID;
  const keySecret = env.RAZORPAY_KEY_SECRET;
  const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET;
  if (!keyId?.startsWith('rzp_test_') || !isUsableSecret(keySecret)) return null;
  if (requireWebhookSecret && !isUsableSecret(webhookSecret)) return null;
  return { keyId, keySecret, ...(isUsableSecret(webhookSecret) ? { webhookSecret } : {}) };
}

export interface ConfiguredBillingPlan {
  code: BillingPlanCode;
  planId: string;
  amountPaise: number;
  totalCount: number;
}

export function getConfiguredBillingPlan(
  code: unknown,
  env: NodeJS.ProcessEnv = process.env,
): ConfiguredBillingPlan | null {
  if (typeof code !== 'string' || !BILLING_PLAN_CODES.includes(code as BillingPlanCode)) return null;
  const draft = BILLING_PLAN_DRAFTS[code as BillingPlanCode];
  const planId = env[`RAZORPAY_PLAN_${code.toUpperCase()}`];
  const totalCount = Number(env.RAZORPAY_SUBSCRIPTION_TOTAL_COUNT);
  if (
    !draft.checkoutEnabled ||
    draft.priceInr === null ||
    !Number.isFinite(draft.priceInr) ||
    draft.priceInr <= 0 ||
    !planId?.startsWith('plan_') ||
    !Number.isInteger(totalCount) ||
    totalCount < 1
  ) return null;

  const amountPaise = Math.round(draft.priceInr * 100);
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) return null;
  return { code: draft.code, planId, amountPaise, totalCount };
}

function timingSafeHexEqual(expectedHex: string, actualHex: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(actualHex) || !/^[0-9a-f]{64}$/i.test(expectedHex)) return false;
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = Buffer.from(actualHex, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export function verifySubscriptionCheckoutSignature(
  subscriptionId: string,
  paymentId: string,
  signature: string,
  keySecret: string,
): boolean {
  if (!subscriptionId || !paymentId || !signature || !keySecret) return false;
  const expected = crypto
    .createHmac('sha256', keySecret)
    .update(`${paymentId}|${subscriptionId}`, 'utf8')
    .digest('hex');
  return timingSafeHexEqual(expected, signature);
}

export function verifyRazorpayWebhookSignature(
  rawBody: Buffer | string,
  signature: string,
  webhookSecret: string,
): boolean {
  if (!signature || !webhookSecret) return false;
  const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
  return timingSafeHexEqual(expected, signature);
}

export function sha256Hex(rawBody: Buffer | string): string {
  return crypto.createHash('sha256').update(rawBody).digest('hex');
}

export type WebhookClaimState = 'claimed' | 'duplicate' | 'in_flight' | 'conflict';
export type WebhookProcessState = 'received' | 'processing' | 'processed' | 'ignored' | 'failed';

export interface WebhookEventStore {
  insert(event: { eventId: string; eventType: string; payloadHash: string; processingStartedAt: string }): Promise<boolean>;
  get(eventId: string): Promise<{
    id: string;
    state: WebhookProcessState;
    processingStartedAt: string | null;
    eventType: string;
    payloadHash: string;
  } | null>;
  claim(
    id: string,
    currentState: WebhookProcessState,
    staleBefore: string,
    processingStartedAt: string,
  ): Promise<boolean>;
}

/** Claims one webhook delivery, safely allowing retry after a stale/failed claim. */
export async function claimWebhookDelivery(
  event: { eventId: string; eventType: string; payloadHash: string },
  store: WebhookEventStore,
  now = Date.now(),
): Promise<WebhookClaimState> {
  const startedAt = new Date(now).toISOString();
  if (await store.insert({ ...event, processingStartedAt: startedAt })) return 'claimed';

  const existing = await store.get(event.eventId);
  if (!existing) throw new Error('webhook_receipt_lookup_failed');
  if (existing.eventType !== event.eventType || existing.payloadHash !== event.payloadHash) {
    return 'conflict';
  }
  if (existing.state === 'processed' || existing.state === 'ignored') return 'duplicate';

  const staleBefore = new Date(now - 5 * 60 * 1000).toISOString();
  const staleProcessing = existing.state === 'processing' &&
    existing.processingStartedAt !== null && existing.processingStartedAt < staleBefore;
  const retryable = existing.state === 'received' || existing.state === 'failed' || staleProcessing;
  if (!retryable) return 'in_flight';

  return await store.claim(existing.id, existing.state, staleBefore, startedAt)
    ? 'claimed'
    : 'in_flight';
}

export function providerSubscriptionStatus(
  status: unknown,
  hasVerifiedCapturedPayment: boolean,
): 'pending_payment' | 'active' | 'past_due' | 'cancelled' | 'expired' {
  if (status === 'active') return hasVerifiedCapturedPayment ? 'active' : 'pending_payment';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'completed' || status === 'expired') return 'expired';
  if (status === 'pending' || status === 'halted' || status === 'paused') return 'past_due';
  return 'pending_payment';
}

/** Terminal local states require an explicit new subscription to become active again. */
export function resolveSubscriptionStatus(
  currentStatus: unknown,
  providerStatus: unknown,
  hasVerifiedCapturedPayment: boolean,
): 'pending_payment' | 'active' | 'past_due' | 'cancelled' | 'expired' {
  if (currentStatus === 'cancelled' || currentStatus === 'expired') return currentStatus;
  return providerSubscriptionStatus(providerStatus, hasVerifiedCapturedPayment);
}

export function paymentMatchesSubscription(
  payment: any,
  expected: { subscriptionId: string; amountPaise: number },
  requiredStatus: 'captured' | 'failed' = 'captured',
): boolean {
  return Boolean(
    payment &&
    typeof payment.id === 'string' &&
    payment.status === requiredStatus &&
    payment.subscription_id === expected.subscriptionId &&
    payment.amount === expected.amountPaise &&
    payment.currency === 'INR',
  );
}

export function razorpayPlanMatchesConfiguration(
  providerPlan: any,
  expected: { planId: string; amountPaise: number },
): boolean {
  const amount = providerPlan?.item?.amount ?? providerPlan?.item?.unit_amount;
  return Boolean(
    providerPlan?.id === expected.planId &&
    providerPlan?.period === 'monthly' &&
    providerPlan?.interval === 1 &&
    amount === expected.amountPaise &&
    providerPlan?.item?.currency === 'INR',
  );
}
