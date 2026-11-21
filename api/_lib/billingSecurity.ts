import crypto from 'node:crypto';
import {
  BILLING_PLAN_CODES,
  BILLING_PLAN_DRAFTS,
  type BillingInterval,
  type BillingPlanCode,
} from './billingPlans.js';

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
  if (!keyId || !/^rzp_test_[A-Za-z0-9]+$/.test(keyId) || !isUsableSecret(keyId) || !isUsableSecret(keySecret)) return null;
  if (requireWebhookSecret && !isUsableSecret(webhookSecret)) return null;
  return { keyId, keySecret, ...(isUsableSecret(webhookSecret) ? { webhookSecret } : {}) };
}

export interface ConfiguredBillingPlan {
  code: BillingPlanCode;
  planId: string;
  amountPaise: number;
  currency: 'INR';
  period: BillingInterval;
  interval: number;
  totalCount: number;
}

/**
 * Builds the expected provider configuration without making a plan purchasable.
 * RAZORPAY_SUBSCRIPTION_TOTAL_COUNT counts charges using the plan period; for a
 * yearly plan, each count is one year. There is intentionally no default: the
 * test environment must choose this value deliberately before checkout is enabled.
 */
export function getExpectedRazorpayPlan(
  code: unknown,
  env: NodeJS.ProcessEnv = process.env,
): ConfiguredBillingPlan | null {
  if (typeof code !== 'string' || !BILLING_PLAN_CODES.includes(code as BillingPlanCode)) return null;
  const draft = BILLING_PLAN_DRAFTS[code as BillingPlanCode];
  const planId = env[`RAZORPAY_PLAN_${code.toUpperCase()}`];
  const configuredTotalCount = env.RAZORPAY_SUBSCRIPTION_TOTAL_COUNT?.trim();
  const totalCount = configuredTotalCount && /^[1-9]\d*$/.test(configuredTotalCount)
    ? Number(configuredTotalCount)
    : NaN;
  if (
    draft.priceInr === null ||
    !Number.isSafeInteger(draft.priceInr) ||
    draft.priceInr <= 0 ||
    draft.currency !== 'INR' ||
    !planId ||
    !/^plan_[A-Za-z0-9]+$/.test(planId) ||
    !isUsableSecret(planId) ||
    !Number.isSafeInteger(totalCount) ||
    totalCount < 1
  ) return null;

  const amountPaise = Math.round(draft.priceInr * 100);
  if (
    !Number.isSafeInteger(amountPaise) ||
    amountPaise <= 0 ||
    !Number.isSafeInteger(draft.billingIntervalCount) ||
    draft.billingIntervalCount < 1
  ) return null;
  return {
    code: draft.code,
    planId,
    amountPaise,
    currency: draft.currency,
    period: draft.billingInterval,
    interval: draft.billingIntervalCount,
    totalCount,
  };
}

export function getConfiguredBillingPlan(
  code: unknown,
  env: NodeJS.ProcessEnv = process.env,
): ConfiguredBillingPlan | null {
  if (typeof code !== 'string' || !BILLING_PLAN_CODES.includes(code as BillingPlanCode)) return null;
  const draft = BILLING_PLAN_DRAFTS[code as BillingPlanCode];
  if (draft.availability !== 'available' || !draft.checkoutEnabled) return null;
  return getExpectedRazorpayPlan(code, env);
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
  expected: Pick<ConfiguredBillingPlan, 'planId' | 'amountPaise' | 'currency' | 'period' | 'interval'>,
): boolean {
  const item = providerPlan?.item;
  const providerAmounts = [item?.amount, item?.unit_amount].filter((amount) => amount !== undefined);
  return Boolean(
    /^plan_[A-Za-z0-9]+$/.test(expected.planId) &&
    isUsableSecret(expected.planId) &&
    Number.isSafeInteger(expected.amountPaise) &&
    expected.amountPaise > 0 &&
    expected.currency === 'INR' &&
    (expected.period === 'monthly' || expected.period === 'yearly') &&
    Number.isSafeInteger(expected.interval) &&
    expected.interval > 0 &&
    providerPlan?.id === expected.planId &&
    providerPlan?.period === expected.period &&
    providerPlan?.interval === expected.interval &&
    providerAmounts.length > 0 &&
    providerAmounts.every((amount) => amount === expected.amountPaise) &&
    item?.currency === expected.currency,
  );
}

/**
 * Validates provider payment state progression mirroring protect_billing_payment_identity().
 * Permitted transitions:
 *   created -> authorized | captured | failed
 *   authorized -> captured | failed
 *   failed -> captured
 *   captured -> refunded
 * All other transitions and reversals (e.g. captured -> failed, refunded -> captured) are rejected.
 */
export function isValidPaymentStatusTransition(oldStatus: string, newStatus: string): boolean {
  if (oldStatus === newStatus) return true;
  return (
    (oldStatus === 'created' && ['authorized', 'captured', 'failed'].includes(newStatus)) ||
    (oldStatus === 'authorized' && ['captured', 'failed'].includes(newStatus)) ||
    (oldStatus === 'failed' && newStatus === 'captured') ||
    (oldStatus === 'captured' && newStatus === 'refunded')
  );
}

/**
 * Validates payment identity immutability mirroring protect_billing_payment_identity().
 * - organization_id and subscription_id cannot be changed.
 * - razorpay_payment_id may transition once from NULL to a valid non-empty string.
 * - Once set, razorpay_payment_id is strictly immutable (cannot change or clear to NULL).
 */
export function isValidPaymentIdentityUpdate(
  oldPayment: { organizationId: string; subscriptionId: string; razorpayPaymentId: string | null },
  newPayment: { organizationId: string; subscriptionId: string; razorpayPaymentId: string | null },
): boolean {
  if (oldPayment.organizationId !== newPayment.organizationId || oldPayment.subscriptionId !== newPayment.subscriptionId) {
    return false;
  }
  if (newPayment.razorpayPaymentId !== null && newPayment.razorpayPaymentId.trim() === '') {
    return false;
  }
  if (oldPayment.razorpayPaymentId !== null && oldPayment.razorpayPaymentId !== newPayment.razorpayPaymentId) {
    return false;
  }
  return true;
}
