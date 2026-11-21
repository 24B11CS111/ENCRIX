import { authenticateServerRequest, getSupabaseServerClient, isRealSupabaseServerConfigured } from './supabaseServer.js';
import { getSubscriptionForOrganization } from './billingRepository.js';
import { parseBillingJsonObject, readRawBillingBody } from './billingRequest.js';
import { normalizeEmail } from '../../src/lib/emailNormalization.js';
import { normalizePhoneNumber } from '../../src/lib/phoneNormalization.js';
import { BILLING_PLAN_CODES, BILLING_PLAN_DRAFTS } from './billingPlans.js';
import {
  claimWebhookDelivery,
  getConfiguredBillingPlan,
  getExpectedRazorpayPlan,
  getRazorpayTestConfiguration,
  paymentMatchesSubscription,
  resolveSubscriptionStatus,
  razorpayPlanMatchesConfiguration,
  sha256Hex,
  verifyRazorpayWebhookSignature,
  verifySubscriptionCheckoutSignature,
  type WebhookEventStore,
  type WebhookProcessState,
} from './billingSecurity.js';

const PUBLIC_SUBSCRIPTION_FIELDS =
  'id, organization_id, plan_code, status, entitlement_source, is_current, checkout_idempotency_key, checkout_creation_status, amount_paise, razorpay_plan_id, razorpay_total_count, razorpay_subscription_id, razorpay_short_url, current_period_start, current_period_end, cancel_at_period_end, cancelled_at, ended_at, last_payment_at, cancellation_request_status, cancellation_requested_at, cancellation_effective_at, cancellation_provider_status';

function header(req: any, name: string): string | undefined {
  const target = name.toLowerCase();
  const key = Object.keys(req.headers || {}).find((candidate) => candidate.toLowerCase() === target);
  const value = key ? req.headers[key] : undefined;
  return Array.isArray(value) ? value[0] : typeof value === 'string' ? value : undefined;
}

function getBillingConfigurationBlocker(action: 'checkout' | 'verify' | 'webhook'): string | null {
  const razorpay = getRazorpayTestConfiguration(process.env, action === 'webhook');
  if (!razorpay) return action === 'webhook' ? 'RAZORPAY_WEBHOOK_CONFIGURATION_MISSING' : 'RAZORPAY_TEST_CREDENTIALS_MISSING';
  if (!isRealSupabaseServerConfigured()) return 'BILLING_DATABASE_CONFIGURATION_MISSING';
  return null;
}

async function razorpayRequest(
  keyId: string,
  keySecret: string,
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
): Promise<any> {
  const authorization = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  const response = await fetch(`https://api.razorpay.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Basic ${authorization}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...extraHeaders,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) { const failure = new Error('razorpay_request_failed') as Error & { status?: number }; failure.status = response.status; throw failure; }
  return response.json();
}

function fail(res: any, status: number, code: string) {
  return res.status(status).json({ error: code });
}

function requireOwner(profile: any): boolean {
  return profile?.status === 'ACTIVE' && profile?.role === 'OWNER' && typeof profile.organization_id === 'string';
}

async function authenticatedOwner(req: any) {
  const { user, profile, error } = await authenticateServerRequest(req);
  if (error || !user || !profile || !requireOwner(profile)) return null;
  return profile;
}

function publicPlans() {
  // ENCRIX currently offers exactly one subscription. Keep legacy plan codes
  // out of the public catalog even though the database retains them for
  // compatibility with historical rows.
  return BILLING_PLAN_CODES.filter((code) => code === 'business').map((code) => {
    const plan = BILLING_PLAN_DRAFTS[code];
    return {
      code,
      displayName: plan.displayName,
      billingInterval: plan.billingInterval,
      billingIntervalCount: plan.billingIntervalCount,
      currency: plan.currency,
      priceInr: plan.priceInr,
      telecallerSeatLimit: plan.telecallerSeatLimit,
      leadLimit: plan.leadLimit,
      followUpAutomationLimit: plan.followUpAutomationLimit,
      featureEntitlements: plan.featureEntitlements,
      checkoutAvailable: Boolean(
        getConfiguredBillingPlan(code) &&
        getRazorpayTestConfiguration(process.env) &&
        isRealSupabaseServerConfigured()
      ),
    };
  });
}

async function createSubscription(req: any, res: any) {
  const profile = await authenticatedOwner(req);
  if (!profile) return fail(res, 403, 'OWNER_AUTHENTICATION_REQUIRED');

  const body = await parseBillingJsonObject(req);
  if (!body) return fail(res, 400, 'INVALID_REQUEST_BODY');
  if (body.planCode !== 'business') return fail(res, 400, 'UNAVAILABLE_BILLING_PLAN');
  const configuredPlan = getConfiguredBillingPlan(body.planCode);
  if (!configuredPlan) return fail(res, 503, 'BILLING_PLAN_NOT_CONFIGURED');
  const blocker = getBillingConfigurationBlocker('checkout');
  if (blocker) return fail(res, 503, blocker);
  const razorpay = getRazorpayTestConfiguration()!;

  let providerPlan: any;
  try {
    providerPlan = await razorpayRequest(
      razorpay.keyId,
      razorpay.keySecret,
      'GET',
      `plans/${encodeURIComponent(configuredPlan.planId)}`,
    );
  } catch {
    return fail(res, 503, 'BILLING_PLAN_VERIFICATION_UNAVAILABLE');
  }
  if (!razorpayPlanMatchesConfiguration(providerPlan, configuredPlan)) {
    return fail(res, 503, 'BILLING_PLAN_CONFIGURATION_MISMATCH');
  }

  if (typeof body.idempotencyKey !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.idempotencyKey)) {
    return fail(res, 400, 'VALID_IDEMPOTENCY_KEY_REQUIRED');
  }

  const supabase = getSupabaseServerClient();
  const existingRequest = await supabase.from('organization_subscriptions')
    .select(PUBLIC_SUBSCRIPTION_FIELDS)
    .eq('organization_id', profile.organization_id)
    .eq('checkout_idempotency_key', body.idempotencyKey)
    .maybeSingle();
  if (existingRequest.error) return fail(res, 503, 'BILLING_DATABASE_UNAVAILABLE');
  if (existingRequest.data) {
    if (existingRequest.data.checkout_creation_status !== 'created' || !existingRequest.data.razorpay_subscription_id) {
      return fail(res, 409, 'CHECKOUT_REQUIRES_RECONCILIATION');
    }
    return res.status(200).json({
      subscriptionId: existingRequest.data.razorpay_subscription_id,
      checkoutUrl: existingRequest.data.razorpay_short_url || null,
      keyId: razorpay.keyId,
    });
  }

  const current = await supabase.from('organization_subscriptions')
    .select('id, status')
    .eq('organization_id', profile.organization_id)
    .eq('is_current', true)
    .maybeSingle();
  if (current.error) return fail(res, 503, 'BILLING_DATABASE_UNAVAILABLE');
  if (current.data) return fail(res, 409, 'CURRENT_SUBSCRIPTION_REQUIRES_REVIEW');

  const inserted = await supabase.from('organization_subscriptions').insert({
    organization_id: profile.organization_id,
    plan_code: configuredPlan.code,
    status: 'pending_payment',
    entitlement_source: 'razorpay',
    is_current: true,
    checkout_idempotency_key: body.idempotencyKey,
    checkout_creation_status: 'creating',
    amount_paise: configuredPlan.amountPaise,
    razorpay_plan_id: configuredPlan.planId,
    razorpay_total_count: configuredPlan.totalCount,
  }).select('id').single();
  if (inserted.error || !inserted.data) return fail(res, 503, 'BILLING_DATABASE_UNAVAILABLE');

  try {
    const created = await razorpayRequest(razorpay.keyId, razorpay.keySecret, 'POST', 'subscriptions', {
      plan_id: configuredPlan.planId,
      total_count: configuredPlan.totalCount,
      quantity: 1,
      customer_notify: 1,
      notes: {
        encrix_subscription_record_id: inserted.data.id,
        encrix_organization_id: profile.organization_id,
      },
    });
    if (typeof created.id !== 'string' || created.plan_id !== configuredPlan.planId ||
        created.quantity !== 1 || created.total_count !== configuredPlan.totalCount ||
        created.notes?.encrix_subscription_record_id !== inserted.data.id ||
        created.notes?.encrix_organization_id !== profile.organization_id) {
      await supabase.from('organization_subscriptions')
        .update({ checkout_creation_status: 'reconciliation_required' })
        .eq('id', inserted.data.id)
        .eq('organization_id', profile.organization_id);
      return fail(res, 502, 'CHECKOUT_CREATION_REQUIRES_RECONCILIATION');
    }
    const saved = await supabase.from('organization_subscriptions').update({
      razorpay_subscription_id: created.id,
      razorpay_short_url: created.short_url,
      checkout_creation_status: 'created',
    }).eq('id', inserted.data.id).eq('organization_id', profile.organization_id).select('id').single();
    if (saved.error || !saved.data) return fail(res, 503, 'CHECKOUT_CREATION_REQUIRES_RECONCILIATION');
    return res.status(201).json({ subscriptionId: created.id, checkoutUrl: created.short_url || null, keyId: razorpay.keyId });
  } catch {
    await supabase.from('organization_subscriptions')
      .update({ checkout_creation_status: 'reconciliation_required' })
      .eq('id', inserted.data.id)
      .eq('organization_id', profile.organization_id);
    return fail(res, 503, 'CHECKOUT_CREATION_REQUIRES_RECONCILIATION');
  }
}

async function reconcileSubscription(req: any, res: any) {
  const profile = await authenticatedOwner(req);
  if (!profile) return fail(res, 403, 'OWNER_AUTHENTICATION_REQUIRED');
  const blocker = getBillingConfigurationBlocker('checkout');
  if (blocker) return fail(res, 503, blocker);
  const body = await parseBillingJsonObject(req);
  if (!body || typeof body.idempotencyKey !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.idempotencyKey)) return fail(res, 400, 'VALID_IDEMPOTENCY_KEY_REQUIRED');
  const supabase = getSupabaseServerClient();
  const { data: local, error } = await supabase.from('organization_subscriptions')
    .select(PUBLIC_SUBSCRIPTION_FIELDS).eq('organization_id', profile.organization_id)
    .eq('checkout_idempotency_key', body.idempotencyKey).maybeSingle();
  if (error) return fail(res, 503, 'BILLING_DATABASE_UNAVAILABLE');
  if (!local) return fail(res, 404, 'SUBSCRIPTION_NOT_FOUND');
  if (local.checkout_creation_status === 'created' && local.razorpay_subscription_id) {
    return res.status(200).json({ subscriptionId: local.razorpay_subscription_id, checkoutUrl: local.razorpay_short_url || null });
  }
  if (local.checkout_creation_status !== 'reconciliation_required' && local.checkout_creation_status !== 'creating') {
    return fail(res, 409, 'SUBSCRIPTION_NOT_RECONCILABLE');
  }
  const rp = getRazorpayTestConfiguration()!;
  const expectedPlan = getExpectedRazorpayPlan(local.plan_code);
  if (!expectedPlan || expectedPlan.planId !== local.razorpay_plan_id || expectedPlan.amountPaise !== local.amount_paise) {
    return fail(res, 409, 'LOCAL_PLAN_CONFIGURATION_MISMATCH_SUPPORT_REQUIRED');
  }
  try {
    const plan = await razorpayRequest(rp.keyId, rp.keySecret, 'GET', `plans/${encodeURIComponent(expectedPlan.planId)}`);
    if (!razorpayPlanMatchesConfiguration(plan, expectedPlan)) return fail(res, 409, 'PROVIDER_PLAN_MISMATCH_SUPPORT_REQUIRED');
    const matches = new Map<string, any>();
    let skip = 0;
    let pageCount = 0;
    let scanComplete = false;
    while (pageCount < 20) {
      const listed = await razorpayRequest(rp.keyId, rp.keySecret, 'GET', `subscriptions?count=100&skip=${skip}`);
      const items = Array.isArray(listed.items) ? listed.items : [];
      for (const item of items) {
        if (item?.notes?.encrix_subscription_record_id !== local.id) continue;
        if (item?.notes?.encrix_organization_id !== profile.organization_id) {
          return fail(res, 409, 'PROVIDER_ORGANIZATION_MISMATCH_SUPPORT_REQUIRED');
        }
        if (item.plan_id !== expectedPlan.planId || !/^sub_[A-Za-z0-9]+$/.test(item.id || '') ||
            item.quantity !== 1 || item.total_count !== (local.razorpay_total_count ?? expectedPlan.totalCount) ||
            !['created', 'authenticated', 'active', 'pending', 'halted', 'cancelled', 'completed', 'expired'].includes(item.status)) {
          return fail(res, 409, 'PROVIDER_SUBSCRIPTION_DETAILS_MISMATCH_SUPPORT_REQUIRED');
        }
        matches.set(item.id, item);
      }
      pageCount += 1;
      if (items.length < 100) { scanComplete = true; break; }
      skip += items.length;
    }
    if (!scanComplete) return fail(res, 503, 'PROVIDER_RECONCILIATION_SCAN_LIMIT_SUPPORT_REQUIRED');
    if (matches.size !== 1) return fail(res, 409, matches.size ? 'MULTIPLE_PROVIDER_SUBSCRIPTIONS_REQUIRE_SUPPORT' : 'PROVIDER_SUBSCRIPTION_NOT_FOUND_SUPPORT_REQUIRED');
    const listedMatch = [...matches.values()][0];
    if (local.razorpay_subscription_id && local.razorpay_subscription_id !== listedMatch.id) {
      return fail(res, 409, 'LOCAL_PROVIDER_SUBSCRIPTION_ID_CONFLICT_SUPPORT_REQUIRED');
    }
    const match = await razorpayRequest(rp.keyId, rp.keySecret, 'GET', `subscriptions/${encodeURIComponent(listedMatch.id)}`);
    if (match.id !== listedMatch.id || match.plan_id !== expectedPlan.planId ||
        match.notes?.encrix_subscription_record_id !== local.id ||
        match.notes?.encrix_organization_id !== profile.organization_id ||
        match.quantity !== 1 || match.total_count !== (local.razorpay_total_count ?? expectedPlan.totalCount) ||
        match.status !== listedMatch.status ||
        !['created', 'authenticated', 'active', 'pending', 'halted', 'cancelled', 'completed', 'expired'].includes(match.status)) {
      return fail(res, 409, 'PROVIDER_SUBSCRIPTION_DETAILS_MISMATCH_SUPPORT_REQUIRED');
    }
    const { data: saved, error: saveError } = await supabase.from('organization_subscriptions').update({
      razorpay_subscription_id: match.id,
      razorpay_total_count: local.razorpay_total_count ?? expectedPlan.totalCount,
      razorpay_short_url: match.short_url || null,
      checkout_creation_status: 'created',
    }).eq('id', local.id).eq('organization_id', profile.organization_id)
      .in('checkout_creation_status', ['creating', 'reconciliation_required'])
      .select('id').maybeSingle();
    if (saveError) return fail(res, 503, 'RECONCILIATION_SAVE_FAILED_SUPPORT_REQUIRED');
    if (!saved) {
      const retry = await supabase.from('organization_subscriptions').select(PUBLIC_SUBSCRIPTION_FIELDS)
        .eq('id', local.id).eq('organization_id', profile.organization_id).maybeSingle();
      if (retry.error || retry.data?.razorpay_subscription_id !== match.id || retry.data?.checkout_creation_status !== 'created') {
        return fail(res, 503, 'RECONCILIATION_SAVE_FAILED_SUPPORT_REQUIRED');
      }
    }
    return res.status(200).json({ subscriptionId: match.id, checkoutUrl: match.short_url || null, reconciled: true });
  } catch {
    return fail(res, 503, 'PROVIDER_RECONCILIATION_UNAVAILABLE');
  }
}

function unixTimestampToIso(value: unknown): string | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Date(value * 1000).toISOString()
    : null;
}

async function verifyCheckout(req: any, res: any) {
  const profile = await authenticatedOwner(req);
  if (!profile) return fail(res, 403, 'OWNER_AUTHENTICATION_REQUIRED');
  const blocker = getBillingConfigurationBlocker('verify');
  if (blocker) return fail(res, 503, blocker);
  const razorpay = getRazorpayTestConfiguration()!;
  const body = await parseBillingJsonObject(req);
  if (!body) return fail(res, 400, 'INVALID_REQUEST_BODY');
  const subscriptionId = body.razorpay_subscription_id;
  const paymentId = body.razorpay_payment_id;
  const signature = body.razorpay_signature;
  if ([subscriptionId, paymentId, signature].some((value) => typeof value !== 'string' || value.length === 0)) {
    return fail(res, 400, 'INVALID_CHECKOUT_VERIFICATION');
  }

  const supabase = getSupabaseServerClient();
  const local = await supabase.from('organization_subscriptions')
    .select(PUBLIC_SUBSCRIPTION_FIELDS)
    .eq('organization_id', profile.organization_id)
    .eq('razorpay_subscription_id', subscriptionId)
    .eq('is_current', true)
    .maybeSingle();
  if (local.error) return fail(res, 503, 'BILLING_DATABASE_UNAVAILABLE');
  if (!local.data || local.data.checkout_creation_status !== 'created') return fail(res, 404, 'SUBSCRIPTION_NOT_FOUND');
  if (!verifySubscriptionCheckoutSignature(String(subscriptionId), String(paymentId), String(signature), razorpay.keySecret)) {
    return fail(res, 400, 'INVALID_PAYMENT_SIGNATURE');
  }

  try {
    const [payment, remoteSubscription] = await Promise.all([
      razorpayRequest(razorpay.keyId, razorpay.keySecret, 'GET', `payments/${encodeURIComponent(String(paymentId))}`),
      razorpayRequest(razorpay.keyId, razorpay.keySecret, 'GET', `subscriptions/${encodeURIComponent(String(subscriptionId))}`),
    ]);
    if (
      payment.id !== paymentId ||
      !paymentMatchesSubscription(payment, {
        subscriptionId: local.data.razorpay_subscription_id,
        amountPaise: local.data.amount_paise,
      }) ||
      remoteSubscription.id !== local.data.razorpay_subscription_id ||
      remoteSubscription.plan_id !== local.data.razorpay_plan_id ||
      remoteSubscription.notes?.encrix_subscription_record_id !== local.data.id ||
      remoteSubscription.notes?.encrix_organization_id !== profile.organization_id ||
      remoteSubscription.quantity !== 1 ||
      !Number.isSafeInteger(remoteSubscription.total_count) || remoteSubscription.total_count < 1 ||
      (local.data.razorpay_total_count !== undefined && local.data.razorpay_total_count !== null && remoteSubscription.total_count !== local.data.razorpay_total_count) ||
      (Number.isSafeInteger(payment.amount_refunded) && payment.amount_refunded >= payment.amount) ||
      payment.refund_status === 'full'
    ) return fail(res, 400, 'PAYMENT_DETAILS_NOT_VERIFIED');

    const applied = await applyVerifiedProviderPayment(supabase, {
      organizationId: profile.organization_id,
      localSubscriptionId: local.data.id,
      providerSubscriptionId: String(subscriptionId),
      providerPaymentId: String(paymentId),
      invoiceId: typeof payment.invoice_id === 'string' ? payment.invoice_id : null,
      amountPaise: payment.amount,
      currency: payment.currency,
      paymentStatus: 'captured',
      paymentCreatedAt: unixTimestampToIso(payment.created_at),
      amountRefundedPaise: Number.isSafeInteger(payment.amount_refunded) ? payment.amount_refunded : 0,
      providerTotalCount: remoteSubscription.total_count,
      providerSubscriptionStatus: remoteSubscription.status,
      currentPeriodStart: unixTimestampToIso(remoteSubscription.current_start),
      currentPeriodEnd: unixTimestampToIso(remoteSubscription.current_end),
    });
    if (!applied) return fail(res, 503, 'BILLING_DATABASE_UNAVAILABLE');
    if (applied.status !== 'active') {
      return res.status(409).json({ verified: false, subscriptionStatus: applied.status, error: 'SUBSCRIPTION_NOT_ACTIVE' });
    }
    return res.status(200).json({ verified: true, subscriptionStatus: applied.status });
  } catch {
    return fail(res, 502, 'PAYMENT_VERIFICATION_UNAVAILABLE');
  }
}

interface VerifiedProviderPayment {
  organizationId: string;
  localSubscriptionId: string;
  providerSubscriptionId: string;
  providerPaymentId: string;
  invoiceId: string | null;
  amountPaise: number;
  currency: string;
  paymentStatus: 'authorized' | 'captured' | 'failed' | 'refunded';
  paymentCreatedAt: string | null;
  amountRefundedPaise: number;
  providerTotalCount: number;
  providerSubscriptionStatus: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
}

/** Payment persistence and subscription state transition happen in one PostgreSQL transaction. */
async function applyVerifiedProviderPayment(supabase: any, payment: VerifiedProviderPayment): Promise<{ status: string } | null> {
  const { data, error } = await supabase.rpc('apply_verified_razorpay_payment', {
    p_organization_id: payment.organizationId,
    p_local_subscription_id: payment.localSubscriptionId,
    p_provider_subscription_id: payment.providerSubscriptionId,
    p_payment_id: payment.providerPaymentId,
    p_invoice_id: payment.invoiceId,
    p_amount_paise: payment.amountPaise,
    p_currency: payment.currency,
    p_payment_status: payment.paymentStatus,
    p_payment_created_at: payment.paymentCreatedAt,
    p_amount_refunded_paise: payment.amountRefundedPaise,
    p_provider_total_count: payment.providerTotalCount,
    p_provider_subscription_status: payment.providerSubscriptionStatus,
    p_current_period_start: payment.currentPeriodStart,
    p_current_period_end: payment.currentPeriodEnd,
    p_provider_verified_at: new Date().toISOString(),
  });
  if (error || !data || typeof data.status !== 'string') return null;
  return { status: data.status };
}

function makeWebhookStore(supabase: any): WebhookEventStore {
  return {
    async insert(event) {
      const { data, error } = await supabase.from('billing_webhook_events').insert({
        provider: 'razorpay',
        provider_event_id: event.eventId,
        event_type: event.eventType,
        payload_sha256: event.payloadHash,
        processing_status: 'processing',
        processing_started_at: event.processingStartedAt,
      }).select('id').maybeSingle();
      if (error?.code === '23505') return false;
      if (error) throw new Error('webhook_receipt_insert_failed');
      return Boolean(data?.id);
    },
    async get(eventId) {
      const { data, error } = await supabase.from('billing_webhook_events')
        .select('id, processing_status, processing_started_at, event_type, payload_sha256')
        .eq('provider', 'razorpay')
        .eq('provider_event_id', eventId)
        .maybeSingle();
      if (error) throw new Error('webhook_receipt_lookup_failed');
      return data ? {
        id: data.id,
        state: data.processing_status as WebhookProcessState,
        processingStartedAt: data.processing_started_at,
        eventType: data.event_type,
        payloadHash: data.payload_sha256,
      } : null;
    },
    async claim(id, currentState, staleBefore, processingStartedAt) {
      let query = supabase.from('billing_webhook_events')
        .update({ processing_status: 'processing', processing_started_at: processingStartedAt })
        .eq('id', id)
        .eq('processing_status', currentState);
      if (currentState === 'processing') query = query.lt('processing_started_at', staleBefore);
      const { data, error } = await query.select('id').maybeSingle();
      if (error) throw new Error('webhook_receipt_claim_failed');
      return Boolean(data?.id);
    },
  };
}

function getWebhookSubscriptionId(event: any): string | null {
  const subscription = event?.payload?.subscription?.entity;
  if (typeof subscription?.id === 'string') return subscription.id;
  const payment = event?.payload?.payment?.entity;
  return typeof payment?.subscription_id === 'string' ? payment.subscription_id : null;
}

function getWebhookPaymentId(event: any): string | null {
  const payment = event?.payload?.payment?.entity;
  if (typeof payment?.id === 'string') return payment.id;
  const subscriptionPayment = event?.payload?.subscription?.payment?.entity;
  return typeof subscriptionPayment?.id === 'string' ? subscriptionPayment.id : null;
}

async function processWebhookEvent(event: any, supabase: any, razorpay: NonNullable<ReturnType<typeof getRazorpayTestConfiguration>>) {
  if (typeof event?.event === 'string' && event.event.startsWith('refund.')) {
    const refundEntity = event?.payload?.refund?.entity;
    const refundId = typeof refundEntity?.id === 'string' ? refundEntity.id : null;
    const paymentId = typeof refundEntity?.payment_id === 'string' ? refundEntity.payment_id : null;
    if (!refundId || !paymentId) throw new Error('billing_refund_event_invalid');
    const refund = await razorpayRequest(razorpay.keyId, razorpay.keySecret, 'GET', `refunds/${encodeURIComponent(refundId)}`);
    if (refund.id !== refundId || refund.payment_id !== paymentId || !Number.isSafeInteger(refund.amount) ||
        !['pending','processed','failed'].includes(refund.status)) throw new Error('billing_refund_provider_mismatch');
    const providerPayment = await razorpayRequest(razorpay.keyId, razorpay.keySecret, 'GET', `payments/${encodeURIComponent(paymentId)}`);
    if (providerPayment.id !== paymentId || !Number.isSafeInteger(providerPayment.amount_refunded) ||
        providerPayment.amount_refunded < 0 || providerPayment.amount_refunded > providerPayment.amount) throw new Error('billing_refund_payment_mismatch');
    const localPayment = await supabase.from('billing_payments')
      .select('id, organization_id, subscription_id, razorpay_payment_id, amount_paise, currency')
      .eq('razorpay_payment_id', paymentId).maybeSingle();
    if (localPayment.error || !localPayment.data || localPayment.data.razorpay_payment_id !== paymentId ||
        localPayment.data.amount_paise !== providerPayment.amount || localPayment.data.currency !== providerPayment.currency ||
        providerPayment.currency !== 'INR') {
      throw new Error('billing_refund_local_payment_mismatch');
    }
    const localSubscription = await supabase.from('organization_subscriptions')
      .select(PUBLIC_SUBSCRIPTION_FIELDS).eq('id', localPayment.data.subscription_id)
      .eq('organization_id', localPayment.data.organization_id).maybeSingle();
    if (localSubscription.error || !localSubscription.data) throw new Error('billing_refund_subscription_missing');
    const remoteSubscription = await razorpayRequest(razorpay.keyId, razorpay.keySecret, 'GET',
      `subscriptions/${encodeURIComponent(localSubscription.data.razorpay_subscription_id)}`);
    if (remoteSubscription.id !== localSubscription.data.razorpay_subscription_id || providerPayment.subscription_id !== remoteSubscription.id ||
        remoteSubscription.notes?.encrix_subscription_record_id !== localSubscription.data.id ||
        remoteSubscription.notes?.encrix_organization_id !== localSubscription.data.organization_id) throw new Error('billing_refund_subscription_mismatch');
    const totalRefunded = providerPayment.amount_refunded;
    const paymentStatus = totalRefunded === providerPayment.amount ? 'refunded' : providerPayment.status;
    if (!['captured','refunded'].includes(paymentStatus)) throw new Error('billing_refund_payment_not_captured');
    const applied = await applyVerifiedProviderPayment(supabase, {
      organizationId: localPayment.data.organization_id,
      localSubscriptionId: localPayment.data.subscription_id,
      providerSubscriptionId: remoteSubscription.id,
      providerPaymentId: paymentId,
      invoiceId: typeof providerPayment.invoice_id === 'string' ? providerPayment.invoice_id : null,
      amountPaise: providerPayment.amount,
      currency: providerPayment.currency,
      paymentStatus: paymentStatus as VerifiedProviderPayment['paymentStatus'],
      paymentCreatedAt: unixTimestampToIso(providerPayment.created_at),
      amountRefundedPaise: totalRefunded,
      providerTotalCount: remoteSubscription.total_count,
      providerSubscriptionStatus: remoteSubscription.status,
      currentPeriodStart: unixTimestampToIso(remoteSubscription.current_start),
      currentPeriodEnd: unixTimestampToIso(remoteSubscription.current_end),
    });
    if (!applied) throw new Error('billing_refund_payment_update_failed');
    const refundRequestId = typeof refund.notes?.encrix_refund_request_id === 'string' ? refund.notes.encrix_refund_request_id : null;
    const requestQuery = supabase.from('billing_refund_requests')
      .select('id, reviewed_by, provider_refund_id').eq('payment_id', localPayment.data.id);
    const { data: request, error: requestError } = refundRequestId
      ? await requestQuery.eq('id', refundRequestId).maybeSingle()
      : await requestQuery.eq('provider_refund_id', refund.id).maybeSingle();
    if (requestError) throw new Error('billing_refund_review_record_missing');
    if (request) {
      if (!request.provider_refund_id) {
        const recorded = await supabase.rpc('record_billing_refund_webhook_result', {
          p_refund_request_id: request.id, p_provider_refund_id: refund.id,
          p_payment_id: paymentId, p_amount_paise: refund.amount, p_provider_status: refund.status,
        });
        if (recorded.error) throw new Error('billing_refund_review_link_failed');
      } else if (request.provider_refund_id !== refund.id) throw new Error('billing_refund_identity_conflict');
      const reconciled = await supabase.rpc('reconcile_billing_refund_event', {
        p_refund_request_id: request.id, p_provider_refund_id: refund.id, p_payment_id: paymentId,
        p_amount_paise: refund.amount, p_provider_status: refund.status,
        p_payment_amount_refunded_paise: totalRefunded,
      });
      if (reconciled.error) throw new Error('billing_refund_reconciliation_failed');
    }
    return 'processed' as const;
  }
  const subscriptionId = getWebhookSubscriptionId(event);
  if (!subscriptionId) return 'ignored' as const;

  const local = await supabase.from('organization_subscriptions')
    .select(PUBLIC_SUBSCRIPTION_FIELDS)
    .eq('razorpay_subscription_id', subscriptionId)
    .maybeSingle();
  if (local.error) throw new Error('billing_subscription_lookup_failed');
  if (!local.data) return 'ignored' as const;

  const remoteSubscription = await razorpayRequest(
    razorpay.keyId,
    razorpay.keySecret,
    'GET',
    `subscriptions/${encodeURIComponent(subscriptionId)}`,
  );
  if (remoteSubscription.id !== subscriptionId || remoteSubscription.plan_id !== local.data.razorpay_plan_id ||
      remoteSubscription.notes?.encrix_subscription_record_id !== local.data.id ||
      remoteSubscription.notes?.encrix_organization_id !== local.data.organization_id ||
      remoteSubscription.quantity !== 1 || !Number.isSafeInteger(remoteSubscription.total_count) ||
      remoteSubscription.total_count < 1 ||
      (local.data.razorpay_total_count !== undefined && local.data.razorpay_total_count !== null && remoteSubscription.total_count !== local.data.razorpay_total_count)) {
    throw new Error('billing_provider_subscription_mismatch');
  }

  const paymentId = getWebhookPaymentId(event);
  if (paymentId) {
    const payment = await razorpayRequest(
      razorpay.keyId,
      razorpay.keySecret,
      'GET',
      `payments/${encodeURIComponent(paymentId)}`,
    );
    const amountRefunded = Number.isSafeInteger(payment.amount_refunded) ? payment.amount_refunded : 0;
    if (payment.id !== paymentId || payment.subscription_id !== subscriptionId ||
        payment.amount !== local.data.amount_paise || payment.currency !== 'INR' ||
        amountRefunded < 0 || amountRefunded > payment.amount) {
      throw new Error('billing_provider_payment_mismatch');
    }
    const paymentStatus = payment.status === 'refunded' || payment.refund_status === 'full'
      ? 'refunded'
      : payment.status;
    if (!['authorized', 'captured', 'failed', 'refunded'].includes(paymentStatus) ||
        (paymentStatus === 'refunded' && amountRefunded !== payment.amount)) {
      throw new Error('billing_provider_payment_state_invalid');
    }
    const applied = await applyVerifiedProviderPayment(supabase, {
      organizationId: local.data.organization_id,
      localSubscriptionId: local.data.id,
      providerSubscriptionId: subscriptionId,
      providerPaymentId: paymentId,
      invoiceId: typeof payment.invoice_id === 'string' ? payment.invoice_id : null,
      amountPaise: payment.amount,
      currency: payment.currency,
      paymentStatus: paymentStatus as VerifiedProviderPayment['paymentStatus'],
      paymentCreatedAt: unixTimestampToIso(payment.created_at),
      amountRefundedPaise: amountRefunded,
      providerTotalCount: remoteSubscription.total_count,
      providerSubscriptionStatus: remoteSubscription.status,
      currentPeriodStart: unixTimestampToIso(remoteSubscription.current_start),
      currentPeriodEnd: unixTimestampToIso(remoteSubscription.current_end),
    });
    if (!applied) throw new Error('billing_payment_lifecycle_transaction_failed');
    return 'processed' as const;
  }

  const periodStart = unixTimestampToIso(remoteSubscription.current_start) || local.data.current_period_start;
  const periodEnd = unixTimestampToIso(remoteSubscription.current_end) || local.data.current_period_end;
  let captured: { data: any; error: any } = { data: null, error: null };
  if (periodStart && periodEnd) {
    captured = await supabase.from('billing_payments').select('id')
      .eq('subscription_id', local.data.id)
      .eq('status', 'captured')
      .not('signature_verified_at', 'is', null)
      .gte('paid_at', periodStart)
      .lt('paid_at', periodEnd)
      .limit(1)
      .maybeSingle();
  }
  if (captured.error) throw new Error('billing_payment_lookup_failed');

  const periodExpired = Boolean(periodEnd && new Date(periodEnd).getTime() <= Date.now());
  const earlyScheduledCancellation = local.data.cancel_at_period_end === true && Boolean(local.data.current_period_end) &&
    new Date(local.data.current_period_end).getTime() > Date.now() && remoteSubscription.status === 'cancelled';
  const status = periodExpired
    ? 'expired'
    : earlyScheduledCancellation
      ? local.data.status
      : resolveSubscriptionStatus(local.data.status, remoteSubscription.status, Boolean(captured.data));
  const { error } = await supabase.from('organization_subscriptions').update({
    status,
    current_period_start: periodStart,
    current_period_end: periodEnd,
    cancelled_at: status === 'cancelled'
      ? local.data.cancelled_at || unixTimestampToIso(remoteSubscription.ended_at) || new Date().toISOString()
      : local.data.cancelled_at,
    cancellation_request_status: status === 'cancelled' && local.data.cancel_at_period_end ? 'completed' : local.data.cancellation_request_status,
    cancellation_provider_status: remoteSubscription.status,
    cancellation_effective_at: local.data.cancellation_effective_at,
    is_current: ['cancelled', 'expired'].includes(status) ? false : local.data.is_current,
    ended_at: ['cancelled', 'expired'].includes(status)
      ? local.data.ended_at || unixTimestampToIso(remoteSubscription.ended_at) || new Date().toISOString()
      : local.data.ended_at,
    updated_at: new Date().toISOString(),
  }).eq('id', local.data.id).eq('organization_id', local.data.organization_id).eq('is_current', true)
    .neq('status', 'cancelled')
    .neq('status', 'expired');
  if (error) throw new Error('billing_subscription_update_failed');
  // Atomic status filters prevent a concurrent delivery from reactivating a
  // subscription that became terminal after this handler read its row.
  return 'processed' as const;
}

async function handleWebhook(req: any, res: any) {
  const blocker = getBillingConfigurationBlocker('webhook');
  if (blocker) return fail(res, 503, blocker);
  const razorpay = getRazorpayTestConfiguration(process.env, true)!;
  let rawBody: Buffer;
  try {
    rawBody = await readRawBillingBody(req);
  } catch {
    return fail(res, 413, 'INVALID_WEBHOOK_BODY');
  }
  const signature = header(req, 'x-razorpay-signature');
  const eventId = header(req, 'x-razorpay-event-id');
  if (!signature || !eventId || eventId.length > 200 || !verifyRazorpayWebhookSignature(rawBody, signature, razorpay.webhookSecret!)) {
    return fail(res, 400, 'INVALID_WEBHOOK_SIGNATURE');
  }

  let event: any;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return fail(res, 400, 'INVALID_WEBHOOK_BODY');
  }
  if (!event || typeof event.event !== 'string') return fail(res, 400, 'INVALID_WEBHOOK_BODY');

  const supabase = getSupabaseServerClient();
  let claim: Awaited<ReturnType<typeof claimWebhookDelivery>>;
  try {
    claim = await claimWebhookDelivery(
      { eventId, eventType: event.event, payloadHash: sha256Hex(rawBody) },
      makeWebhookStore(supabase),
    );
  } catch {
    return fail(res, 503, 'WEBHOOK_RECEIPT_UNAVAILABLE');
  }
  if (claim === 'duplicate') return res.status(200).json({ received: true, duplicate: true });
  if (claim === 'conflict') return fail(res, 409, 'WEBHOOK_EVENT_ID_CONFLICT');
  if (claim === 'in_flight') return res.status(202).json({ received: true, processing: true });

  try {
    const state = await processWebhookEvent(event, supabase, razorpay);
    const { error } = await supabase.from('billing_webhook_events').update({
      processing_status: state,
      processed_at: new Date().toISOString(),
    }).eq('provider', 'razorpay').eq('provider_event_id', eventId);
    if (error) throw new Error('webhook_receipt_update_failed');
    return res.status(200).json({ received: true });
  } catch {
    await supabase.from('billing_webhook_events').update({ processing_status: 'failed' })
      .eq('provider', 'razorpay').eq('provider_event_id', eventId);
    return fail(res, 503, 'WEBHOOK_PROCESSING_UNAVAILABLE');
  }
}


async function requestSubscriptionCancellation(req: any, res: any) {
  const profile = await authenticatedOwner(req);
  if (!profile) return fail(res, 403, 'OWNER_AUTHENTICATION_REQUIRED');
  if (getBillingConfigurationBlocker('verify')) return fail(res, 503, 'BILLING_PROVIDER_UNAVAILABLE');
  const body = await parseBillingJsonObject(req);
  if (!body || typeof body.idempotencyKey !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.idempotencyKey)) {
    return fail(res, 400, 'VALID_IDEMPOTENCY_KEY_REQUIRED');
  }
  const supabase = getSupabaseServerClient();
  const begun = await supabase.rpc('begin_subscription_cancellation', {
    p_organization_id: profile.organization_id,
    p_owner_id: profile.id,
    p_request_id: body.idempotencyKey,
  });
  if (begun.error || !begun.data || typeof begun.data.status !== 'string') return fail(res, 409, 'SUBSCRIPTION_NOT_CANCELLABLE');
  if (begun.data.status === 'scheduled') {
    return res.status(200).json({ status: 'scheduled', effectiveAt: begun.data.effective_at, duplicate: true });
  }
  const requestId = begun.data.request_id;
  const subscriptionId = begun.data.provider_subscription_id;
  if (typeof requestId !== 'string' || typeof subscriptionId !== 'string' || !/^sub_[A-Za-z0-9]+$/.test(subscriptionId)) {
    return fail(res, 503, 'CANCELLATION_REQUIRES_RECONCILIATION');
  }
  const razorpay = getRazorpayTestConfiguration()!;
  try {
    const provider = await razorpayRequest(razorpay.keyId, razorpay.keySecret, 'POST',
      `subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, { cancel_at_cycle_end: true });
    if (provider?.id !== subscriptionId || provider?.plan_id !== begun.data.provider_plan_id ||
        provider?.notes?.encrix_subscription_record_id !== begun.data.id || provider?.notes?.encrix_organization_id !== profile.organization_id ||
        provider?.status !== 'active' || provider?.has_scheduled_changes !== true ||
        provider?.change_scheduled_at !== provider?.current_end || !Number.isSafeInteger(provider?.current_end)) {
      return fail(res, 503, 'CANCELLATION_REQUIRES_RECONCILIATION');
    }
    const effectiveAt = new Date(provider.current_end * 1000).toISOString();
    const confirmed = await supabase.rpc('confirm_subscription_cancellation', {
      p_organization_id: profile.organization_id,
      p_subscription_id: begun.data.id,
      p_request_id: requestId,
      p_provider_status: provider.status,
      p_effective_at: effectiveAt,
    });
    if (confirmed.error || !confirmed.data) return fail(res, 503, 'CANCELLATION_REQUIRES_RECONCILIATION');
    return res.status(200).json({ status: 'scheduled', effectiveAt: confirmed.data.effective_at });
  } catch (error) {
    const status = (error as { status?: number } | null)?.status;
    if (status && status >= 400 && status < 500) {
      // A retry can receive a client error after the first cancel request was
      // accepted but before our database confirmation committed. Read the
      // provider state before marking the request failed.
      try {
        const current = await razorpayRequest(razorpay.keyId, razorpay.keySecret, 'GET',
          `subscriptions/${encodeURIComponent(subscriptionId)}`);
        const boundToRequest = current?.id === subscriptionId && current?.plan_id === begun.data.provider_plan_id &&
          current?.notes?.encrix_subscription_record_id === begun.data.id &&
          current?.notes?.encrix_organization_id === profile.organization_id && current?.status === 'active' &&
          Number.isSafeInteger(current?.current_end);
        if (boundToRequest && current?.has_scheduled_changes === true &&
            current?.change_scheduled_at === current.current_end) {
          const effectiveAt = new Date(current.current_end * 1000).toISOString();
          const confirmed = await supabase.rpc('confirm_subscription_cancellation', {
            p_organization_id: profile.organization_id,
            p_subscription_id: begun.data.id,
            p_request_id: requestId,
            p_provider_status: current.status,
            p_effective_at: effectiveAt,
          });
          if (!confirmed.error && confirmed.data) {
            return res.status(200).json({ status: 'scheduled', effectiveAt: confirmed.data.effective_at, duplicate: true });
          }
          return fail(res, 503, 'CANCELLATION_REQUIRES_RECONCILIATION');
        }
        if (boundToRequest && current?.has_scheduled_changes === false) {
          await supabase.rpc('fail_subscription_cancellation', {
            p_organization_id: profile.organization_id, p_subscription_id: begun.data.id,
            p_request_id: requestId, p_provider_error_code: `provider_http_${status}`,
          });
          return fail(res, 502, 'CANCELLATION_PROVIDER_REJECTED');
        }
      } catch {
        // If provider state cannot be proven, keep the request pending for
        // reconciliation; never tell the owner it was scheduled or rejected.
      }
      return res.status(202).json({ status: 'pending_reconciliation' });
    }
    // A timeout may mean the provider accepted the request. Keep it pending.
    return res.status(202).json({ status: 'pending_reconciliation' });
  }
}

async function requestRefundReview(req: any, res: any) {
  const profile = await authenticatedOwner(req);
  if (!profile) return fail(res, 403, 'OWNER_AUTHENTICATION_REQUIRED');
  if (!isRealSupabaseServerConfigured()) return fail(res, 503, 'BILLING_DATABASE_CONFIGURATION_MISSING');
  const body = await parseBillingJsonObject(req);
  if (!body || typeof body.paymentId !== 'string' || typeof body.reason !== 'string' ||
      !Number.isSafeInteger(body.amountPaise) || (body.amountPaise as number) <= 0 ||
      typeof body.idempotencyKey !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.idempotencyKey)) {
    return fail(res, 400, 'INVALID_REFUND_REQUEST');
  }
  const { data, error } = await getSupabaseServerClient().rpc('request_billing_refund', {
    p_organization_id: profile.organization_id,
    p_payment_id: body.paymentId,
    p_requester_id: profile.id,
    p_requested_amount_paise: body.amountPaise,
    p_reason: body.reason,
    p_request_idempotency_key: body.idempotencyKey,
  });
  if (error || !data) return fail(res, 409, 'REFUND_REQUEST_REJECTED');
  return res.status(data.duplicate === true ? 200 : 201).json({ refundRequest: data, message: 'Your refund request is awaiting manual administrator review. No refund has been issued.' });
}

async function getRefundReviewQueue(req: any, res: any) {
  const { profile } = await authenticateServerRequest(req);
  if (!profile || profile.status !== 'ACTIVE' || profile.role !== 'ADMIN') return fail(res, 403, 'ADMIN_AUTHENTICATION_REQUIRED');
  if (!isRealSupabaseServerConfigured()) return fail(res, 503, 'BILLING_DATABASE_CONFIGURATION_MISSING');
  const validStatuses = ['all','pending_review','approved','rejected','processing','completed','failed','requested','under_review','partially_refunded','refunded'];
  const requestedStatus = typeof req.query?.status === 'string' ? req.query.status : 'all';
  if (!validStatuses.includes(requestedStatus)) return fail(res, 400, 'INVALID_REFUND_STATUS_FILTER');
  const pageRaw = Number(req.query?.page || 1);
  const pageSizeRaw = Number(req.query?.pageSize || 20);
  const page = Number.isSafeInteger(pageRaw) && pageRaw > 0 ? Math.min(pageRaw, 100_000) : 1;
  const pageSize = Number.isSafeInteger(pageSizeRaw) && pageSizeRaw > 0 ? Math.min(pageSizeRaw, 50) : 20;
  const dateFrom = typeof req.query?.dateFrom === 'string' ? req.query.dateFrom : '';
  const dateTo = typeof req.query?.dateTo === 'string' ? req.query.dateTo : '';
  const validDate = (value: string) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));
  if (!validDate(dateFrom) || !validDate(dateTo) || (dateFrom && dateTo && dateFrom > dateTo)) return fail(res, 400, 'INVALID_REFUND_DATE_RANGE');
  const supabase = getSupabaseServerClient();
  const summaryStatuses = ['requested','under_review','approved','rejected','processing','partially_refunded','refunded','failed'];
  const countResults = await Promise.all(summaryStatuses.map(async (status) => {
    const result = await supabase.from('billing_refund_requests').select('id', { count: 'exact', head: true }).eq('status', status);
    return { status, count: result.count, error: result.error };
  }));
  if (countResults.some((item) => item.error)) return fail(res, 503, 'REFUND_REVIEW_SUMMARY_UNAVAILABLE');
  const counts = Object.fromEntries(countResults.map(({ status, count }) => [status, count || 0]));
  const summary = {
    total: Object.values(counts).reduce((sum, count) => sum + count, 0),
    pendingReview: counts.requested + counts.under_review,
    approved: counts.approved,
    rejected: counts.rejected,
    processing: counts.processing,
    refunded: counts.partially_refunded + counts.refunded,
    failed: counts.failed,
  };
  const search = typeof req.query?.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  let searchPaymentIds: string[] | null = null;
  let searchSubscriptionIds: string[] | null = null;
  let searchOrganizationIds: string[] | null = null;
  let searchRequestId: string | null = null;
  if (search) {
    const normalizedSearch = search.toLowerCase();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(search)) searchRequestId = search;
    else if (/^pay_[A-Za-z0-9]+$/.test(search)) {
      const result = await supabase.from('billing_payments').select('id').eq('razorpay_payment_id', search).maybeSingle();
      if (result.error) return fail(res, 503, 'REFUND_REVIEW_SEARCH_UNAVAILABLE');
      searchPaymentIds = result.data?.id ? [result.data.id] : [];
    } else if (/^sub_[A-Za-z0-9]+$/.test(search)) {
      const result = await supabase.from('organization_subscriptions').select('id').eq('razorpay_subscription_id', search).maybeSingle();
      if (result.error) return fail(res, 503, 'REFUND_REVIEW_SEARCH_UNAVAILABLE');
      searchSubscriptionIds = result.data?.id ? [result.data.id] : [];
    } else {
      const safeName = normalizedSearch.replace(/[,%()]/g, ' ').trim();
      if (!safeName) return res.status(200).json({ summary, requests: [], pagination: { page, pageSize, total: 0, totalPages: 0 } });
      const result = await supabase.from('organizations').select('id').ilike('name', `%${safeName}%`).limit(100);
      if (result.error) return fail(res, 503, 'REFUND_REVIEW_SEARCH_UNAVAILABLE');
      searchOrganizationIds = (result.data || []).map((item: any) => item.id);
    }
  }
  let query = supabase.from('billing_refund_requests')
    .select('id, organization_id, subscription_id, payment_id, requested_amount_paise, approved_amount_paise, reason, status, entitlement_action, reviewed_by, reviewed_at, decision_note, provider_refund_id, provider_refund_status, created_at, updated_at', { count: 'exact' })
    .order('created_at', { ascending: false }).order('id', { ascending: false });
  if (requestedStatus === 'pending_review') query = query.in('status', ['requested','under_review']);
  else if (requestedStatus === 'completed') query = query.in('status', ['partially_refunded','refunded']);
  else if (requestedStatus !== 'all') query = query.eq('status', requestedStatus);
  if (dateFrom) query = query.gte('created_at', `${dateFrom}T00:00:00.000Z`);
  if (dateTo) query = query.lte('created_at', `${dateTo}T23:59:59.999Z`);
  if (searchRequestId) query = query.or(`id.eq.${searchRequestId},organization_id.eq.${searchRequestId},payment_id.eq.${searchRequestId},subscription_id.eq.${searchRequestId}`);
  if (searchPaymentIds) query = searchPaymentIds.length ? query.in('payment_id', searchPaymentIds) : query.eq('id', '00000000-0000-4000-8000-000000000000');
  if (searchSubscriptionIds) query = searchSubscriptionIds.length ? query.in('subscription_id', searchSubscriptionIds) : query.eq('id', '00000000-0000-4000-8000-000000000000');
  if (searchOrganizationIds) query = searchOrganizationIds.length ? query.in('organization_id', searchOrganizationIds) : query.eq('id', '00000000-0000-4000-8000-000000000000');
  const result = await query.range((page - 1) * pageSize, page * pageSize - 1);
  if (result.error) return fail(res, 503, 'REFUND_REVIEW_QUEUE_UNAVAILABLE');
  const requests = await decorateRefundRequests(supabase, result.data || []);
  if (!requests) return fail(res, 503, 'REFUND_REVIEW_QUEUE_UNAVAILABLE');
  const total = result.count || 0;
  return res.status(200).json({ summary, requests, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
}

async function decorateRefundRequests(supabase: any, rows: any[]) {
  if (!rows.length) return [];
  const organizationIds = [...new Set(rows.map((row) => row.organization_id))];
  const paymentIds = [...new Set(rows.map((row) => row.payment_id))];
  const subscriptionIds = [...new Set(rows.map((row) => row.subscription_id))];
  const [organizations, payments, subscriptions, reservedRequests] = await Promise.all([
    supabase.from('organizations').select('id, name').in('id', organizationIds),
    supabase.from('billing_payments').select('id, amount_paise, amount_refunded_paise, status, razorpay_payment_id, currency').in('id', paymentIds),
    supabase.from('organization_subscriptions').select('id, status, current_period_end, razorpay_subscription_id').in('id', subscriptionIds),
    supabase.from('billing_refund_requests').select('id, payment_id, requested_amount_paise, approved_amount_paise, status')
      .in('payment_id', paymentIds).in('status', ['requested','under_review','approved','processing']),
  ]);
  if ([organizations, payments, subscriptions, reservedRequests].some((result) => result.error)) return null;
  const organizationMap = new Map((organizations.data || []).map((item: any) => [item.id, item]));
  const paymentMap = new Map((payments.data || []).map((item: any) => [item.id, item]));
  const subscriptionMap = new Map((subscriptions.data || []).map((item: any) => [item.id, item]));
  const reservations = reservedRequests.data || [];
  return rows.map((row) => {
    const payment = paymentMap.get(row.payment_id) as any;
    const reservedByOthers = reservations.filter((item: any) => item.payment_id === row.payment_id && item.id !== row.id)
      .reduce((sum: number, item: any) => sum + (['approved','processing'].includes(item.status) ? (item.approved_amount_paise || 0) : (item.requested_amount_paise || 0)), 0);
    const refunded = payment?.amount_refunded_paise || 0;
    return {
      ...row,
      organization: organizationMap.get(row.organization_id) || null,
      payment: payment ? {
        id: payment.id,
        reference: `${payment.id.slice(0, 8)}…${payment.id.slice(-4)}`,
        amount_paise: payment.amount_paise,
        amount_refunded_paise: refunded,
        remaining_refundable_paise: Math.max(0, payment.amount_paise - refunded - reservedByOthers),
        currency: payment.currency,
        status: payment.status,
        provider_reference: typeof payment.razorpay_payment_id === 'string' ? `pay_…${payment.razorpay_payment_id.slice(-6)}` : null,
      } : null,
      subscription: subscriptionMap.get(row.subscription_id) || null,
    };
  });
}

async function getRefundRequestDetail(req: any, res: any) {
  const { profile } = await authenticateServerRequest(req);
  if (!profile || profile.status !== 'ACTIVE' || profile.role !== 'ADMIN') return fail(res, 403, 'ADMIN_AUTHENTICATION_REQUIRED');
  if (!isRealSupabaseServerConfigured()) return fail(res, 503, 'BILLING_DATABASE_CONFIGURATION_MISSING');
  const id = typeof req.query?.id === 'string' ? req.query.id : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return fail(res, 400, 'INVALID_REFUND_REQUEST_ID');
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from('billing_refund_requests')
    .select('id, organization_id, subscription_id, payment_id, requested_by, request_idempotency_key, requested_amount_paise, approved_amount_paise, reason, status, entitlement_action, reviewed_by, reviewed_at, decision_note, provider_refund_id, provider_refund_status, created_at, updated_at, completed_at')
    .eq('id', id).maybeSingle();
  if (error) return fail(res, 503, 'REFUND_REVIEW_DETAIL_UNAVAILABLE');
  if (!data) return fail(res, 404, 'REFUND_REQUEST_NOT_FOUND');
  const [decorated, reviewEvents, auditEvents, paymentRequests] = await Promise.all([
    decorateRefundRequests(supabase, [data]),
    supabase.from('billing_refund_review_events').select('id, reviewer_id, decision, approved_amount_paise, entitlement_action, decision_note, created_at')
      .eq('refund_request_id', id).order('created_at', { ascending: true }),
    supabase.from('billing_refund_audit_events').select('id, actor_profile_id, event_type, previous_status, new_status, decision_reason, amount_paise, entitlement_action, provider_refund_id, operation_id, created_at')
      .eq('refund_request_id', id).order('created_at', { ascending: true }),
    supabase.from('billing_refund_requests').select('id, requested_amount_paise, approved_amount_paise, status, entitlement_action, created_at, completed_at')
      .eq('payment_id', data.payment_id).order('created_at', { ascending: false }).limit(50),
  ]);
  if (!decorated || reviewEvents.error || auditEvents.error || paymentRequests.error) return fail(res, 503, 'REFUND_REVIEW_HISTORY_UNAVAILABLE');
  return res.status(200).json({
    request: decorated[0],
    history: [
      ...(reviewEvents.data || []).map((event: any) => ({ ...event, source: 'review' })),
      ...(auditEvents.data || []).map((event: any) => ({ ...event, source: 'audit' })),
    ].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)),
    paymentRefundHistory: paymentRequests.data || [],
  });
}

async function reviewRefundRequest(req: any, res: any) {
  const { profile } = await authenticateServerRequest(req);
  if (!profile || profile.status !== 'ACTIVE' || profile.role !== 'ADMIN') return fail(res, 403, 'ADMIN_AUTHENTICATION_REQUIRED');
  if (!isRealSupabaseServerConfigured()) return fail(res, 503, 'BILLING_DATABASE_CONFIGURATION_MISSING');
  const body = await parseBillingJsonObject(req);
  if (!body || typeof body.refundRequestId !== 'string' || !['under_review','approve','reject'].includes(String(body.decision)) ||
      typeof body.reason !== 'string' || body.reason.trim().length < 5 || body.reason.trim().length > 1000) return fail(res, 400, 'INVALID_REFUND_REVIEW');
  if (body.decision === 'approve' && (typeof body.approvedAmountPaise !== 'number' || !Number.isSafeInteger(body.approvedAmountPaise) || body.approvedAmountPaise <= 0 ||
      !['retain','revoke'].includes(String(body.entitlementAction)))) return fail(res, 400, 'INVALID_REFUND_APPROVAL');
  const razorpay = body.decision === 'approve' ? getRazorpayTestConfiguration() : null;
  if (body.decision === 'approve' && !razorpay) return fail(res, 503, 'RAZORPAY_TEST_CREDENTIALS_MISSING');
  const supabase = getSupabaseServerClient();
  const reviewed = await supabase.rpc('review_billing_refund_request', {
    p_refund_request_id: body.refundRequestId,
    p_reviewer_id: profile.id,
    p_decision: body.decision,
    p_approved_amount_paise: body.decision === 'approve' ? body.approvedAmountPaise : null,
    p_entitlement_action: body.decision === 'approve' ? body.entitlementAction : null,
    p_decision_note: body.reason.trim(),
  });
  if (reviewed.error || !reviewed.data) return fail(res, 409, 'REFUND_REVIEW_REJECTED');
  if (body.decision !== 'approve') return res.status(200).json({ refundRequest: reviewed.data });
  const claim = await supabase.rpc('claim_billing_refund_processing', {
    p_refund_request_id: body.refundRequestId,
    p_reviewer_id: profile.id,
    p_claim_token: globalThis.crypto.randomUUID(),
  });
  if (claim.error || !claim.data || typeof claim.data.payment_id !== 'string' || !Number.isSafeInteger(claim.data.approved_amount_paise)) {
    return fail(res, 503, 'REFUND_PROCESSING_REQUIRES_RECONCILIATION');
  }
  if (claim.data.already_submitted) return res.status(202).json({ status: 'processing', providerRefundReference: typeof claim.data.provider_refund_id === 'string' ? `rfnd_…${claim.data.provider_refund_id.slice(-6)}` : null, message: 'This approved request has already been submitted; provider confirmation is still being reconciled.' });
  if (claim.data.in_progress || !claim.data.should_process) return res.status(202).json({ status: 'processing', message: 'Another request is processing this approved refund. No additional provider request was sent.' });
  const payment = await supabase.from('billing_payments').select('razorpay_payment_id, amount_paise, amount_refunded_paise, currency, status, signature_verified_at')
    .eq('id', claim.data.payment_id).eq('organization_id', claim.data.organization_id).maybeSingle();
  if (payment.error || !payment.data || !/^pay_[A-Za-z0-9]+$/.test(payment.data.razorpay_payment_id || '') ||
      payment.data.status !== 'captured' || !payment.data.signature_verified_at || payment.data.currency !== 'INR' ||
      !Number.isSafeInteger(payment.data.amount_paise) || claim.data.approved_amount_paise > payment.data.amount_paise - (payment.data.amount_refunded_paise || 0)) {
    return fail(res, 503, 'REFUND_PROCESSING_REQUIRES_RECONCILIATION');
  }
  try {
    const provider = await razorpayRequest(razorpay!.keyId, razorpay!.keySecret, 'POST',
      `payments/${encodeURIComponent(payment.data.razorpay_payment_id)}/refund`,
      { amount: claim.data.approved_amount_paise, receipt: body.refundRequestId, notes: { encrix_refund_request_id: body.refundRequestId } },
      { 'X-Refund-Idempotency': body.refundRequestId });
    if (provider?.payment_id !== payment.data.razorpay_payment_id || provider?.amount !== claim.data.approved_amount_paise ||
        typeof provider?.id !== 'string' || !['pending','processed','failed'].includes(provider.status)) {
      return fail(res, 503, 'REFUND_PROCESSING_REQUIRES_RECONCILIATION');
    }
    const recorded = await supabase.rpc('record_billing_refund_provider_result', {
      p_refund_request_id: body.refundRequestId,
      p_reviewer_id: profile.id,
      p_provider_refund_id: provider.id,
      p_provider_status: provider.status,
      p_claim_token: claim.data.claim_token,
    });
    if (recorded.error) return fail(res, 503, 'REFUND_PROCESSING_REQUIRES_RECONCILIATION');
    if (provider.status === 'failed') return res.status(200).json({ refundRequest: recorded.data, message: 'Razorpay confirmed that this refund failed. No completed refund is recorded; reconcile the payment before creating a new request.' });
    return res.status(202).json({ refundRequest: recorded.data, message: 'Approved refund submitted to Razorpay; final state is pending provider confirmation.' });
  } catch {
    return res.status(202).json({ status: 'processing_reconciliation_required', message: 'The provider result is not confirmed. The same approved request must be reconciled before retrying.' });
  }
}

async function updateBusinessDetails(req: any, res: any) {
  const profile = await authenticatedOwner(req);
  if (!profile) return fail(res, 403, 'OWNER_AUTHENTICATION_REQUIRED');
  if (!isRealSupabaseServerConfigured()) return fail(res, 503, 'BILLING_DATABASE_CONFIGURATION_MISSING');
  const body = await parseBillingJsonObject(req);
  if (!body) return fail(res, 400, 'INVALID_REQUEST_BODY');
  const email = normalizeEmail(typeof body.businessEmail === 'string' ? body.businessEmail : '');
  const phone = normalizePhoneNumber(typeof body.businessPhone === 'string' ? body.businessPhone : '');
  const location = typeof body.businessLocation === 'string' ? body.businessLocation.trim() : '';
  let website: string | null = null;
  if (typeof body.websiteUrl === 'string' && body.websiteUrl.trim()) {
    try {
      const parsed = new URL(body.websiteUrl.trim());
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid_url');
      website = parsed.toString();
    } catch {
      return fail(res, 400, 'INVALID_BUSINESS_WEBSITE');
    }
  }
  if (!email.isValid || !phone.isValid || location.length < 2 || location.length > 500) {
    return fail(res, 400, 'INVALID_BUSINESS_DETAILS');
  }
  const { data, error } = await getSupabaseServerClient().from('organizations')
    .update({ business_email: email.normalized, business_phone: phone.normalized, business_location: location, website_url: website })
    .eq('id', profile.organization_id)
    .select('id, business_email, business_phone, business_location, website_url')
    .maybeSingle();
  if (error) return fail(res, 503, 'BUSINESS_DETAILS_UPDATE_FAILED');
  if (!data) return fail(res, 404, 'ORGANIZATION_NOT_FOUND');
  return res.status(200).json({ businessDetails: data });
}

export async function handleBillingAction(action: unknown, req: any, res: any) {
  if (action === 'plans' && req.method === 'GET') {
    return res.status(200).json({ plans: publicPlans() });
  }
  if (action === 'checkout' && req.method === 'POST') return createSubscription(req, res);
  if (action === 'reconcile' && req.method === 'POST') return reconcileSubscription(req, res);
  if (action === 'verify' && req.method === 'POST') return verifyCheckout(req, res);
  if (action === 'webhook' && req.method === 'POST') return handleWebhook(req, res);
  if (action === 'subscription' && req.method === 'GET') {
    const profile = await authenticatedOwner(req);
    if (!profile) return fail(res, 403, 'OWNER_AUTHENTICATION_REQUIRED');
    if (!isRealSupabaseServerConfigured()) return fail(res, 503, 'BILLING_DATABASE_CONFIGURATION_MISSING');
    const supabase = getSupabaseServerClient();
    const { data: currentBeforeExpiry, error: currentError } = await getSubscriptionForOrganization(supabase, profile.organization_id);
    if (currentError) return fail(res, 503, 'BILLING_DATABASE_UNAVAILABLE');
    if (currentBeforeExpiry?.status === 'active' && currentBeforeExpiry.current_period_end &&
        new Date(currentBeforeExpiry.current_period_end).getTime() <= Date.now()) {
      const now = new Date().toISOString();
      const expired = await supabase.from('organization_subscriptions').update({
        status: 'expired', is_current: false, ended_at: now,
        cancellation_request_status: currentBeforeExpiry.cancel_at_period_end ? 'completed' : currentBeforeExpiry.cancellation_request_status,
        updated_at: now,
      }).eq('id', currentBeforeExpiry.id).eq('organization_id', profile.organization_id)
        .eq('is_current', true).eq('status', 'active').lte('current_period_end', now);
      if (expired.error) return fail(res, 503, 'BILLING_DATABASE_UNAVAILABLE');
    }
    const { data, error } = await getSubscriptionForOrganization(supabase, profile.organization_id);
    if (error) return fail(res, 503, 'BILLING_DATABASE_UNAVAILABLE');
    const { data: subscriptions, error: historyError } = await supabase.from('organization_subscriptions')
      .select('id, plan_code, status, entitlement_source, is_current, current_period_start, current_period_end, cancel_at_period_end, cancellation_request_status, cancellation_requested_at, cancellation_effective_at, cancellation_provider_status, cancelled_at, ended_at, last_payment_at, created_at')
      .eq('organization_id', profile.organization_id)
      .order('created_at', { ascending: false })
      .limit(20);
    if (historyError) return fail(res, 503, 'BILLING_DATABASE_UNAVAILABLE');
    const { data: payments, error: paymentsError } = await supabase.from('billing_payments')
      .select('id, amount_paise, amount_refunded_paise, currency, status, paid_at, failed_at, created_at')
      .eq('organization_id', profile.organization_id)
      .order('created_at', { ascending: false })
      .limit(20);
    if (paymentsError) return fail(res, 503, 'BILLING_DATABASE_UNAVAILABLE');
    const { data: refundRequests, error: refundRequestsError } = await supabase.from('billing_refund_requests')
      .select('id, payment_id, requested_amount_paise, approved_amount_paise, status, entitlement_action, created_at, updated_at')
      .eq('organization_id', profile.organization_id)
      .order('created_at', { ascending: false }).limit(50);
    if (refundRequestsError) return fail(res, 503, 'BILLING_DATABASE_UNAVAILABLE');
    return res.status(200).json({ subscription: data || null, subscriptions: subscriptions || [], payments: payments || [], refundRequests: refundRequests || [] });
  }
  if (action === 'refund-detail' && req.method === 'GET') return getRefundRequestDetail(req, res);
  if (action === 'business-details' && req.method === 'PATCH') return updateBusinessDetails(req, res);
  if (action === 'cancel-subscription' && req.method === 'POST') return requestSubscriptionCancellation(req, res);
  if (action === 'refund-request' && req.method === 'POST') return requestRefundReview(req, res);
  if (action === 'refund-requests' && req.method === 'GET') return getRefundReviewQueue(req, res);
  if (action === 'refund-review' && req.method === 'POST') return reviewRefundRequest(req, res);
  return fail(res, 404, 'BILLING_ROUTE_NOT_FOUND');
}

