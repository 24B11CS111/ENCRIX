import { authenticateServerRequest, getSupabaseServerClient, isRealSupabaseServerConfigured } from './supabaseServer.js';
import { getSubscriptionForOrganization } from './billingRepository.js';
import { parseBillingJsonObject, readRawBillingBody } from './billingRequest.js';
import { BILLING_PLAN_CODES, BILLING_PLAN_DRAFTS, type BillingPlanCode } from './billingPlans.js';
import {
  claimWebhookDelivery,
  getConfiguredBillingPlan,
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
  'id, organization_id, plan_code, status, entitlement_source, is_current, checkout_idempotency_key, checkout_creation_status, amount_paise, razorpay_plan_id, razorpay_subscription_id, razorpay_short_url, current_period_start, current_period_end, cancel_at_period_end, cancelled_at, ended_at, last_payment_at';

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
): Promise<any> {
  const authorization = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  const response = await fetch(`https://api.razorpay.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Basic ${authorization}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error('razorpay_request_failed');
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
  return BILLING_PLAN_CODES.map((code) => {
    const plan = BILLING_PLAN_DRAFTS[code];
    return {
      code,
      displayName: plan.displayName,
      billingInterval: plan.billingInterval,
      currency: plan.currency,
      priceInr: plan.priceInr,
      telecallerSeatLimit: plan.telecallerSeatLimit,
      leadLimit: plan.leadLimit,
      followUpAutomationLimit: plan.followUpAutomationLimit,
      featureEntitlements: plan.featureEntitlements,
      checkoutAvailable: false,
    };
  });
}

async function createSubscription(req: any, res: any) {
  const profile = await authenticatedOwner(req);
  if (!profile) return fail(res, 403, 'OWNER_AUTHENTICATION_REQUIRED');

  const body = await parseBillingJsonObject(req);
  if (!body) return fail(res, 400, 'INVALID_REQUEST_BODY');
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
    if (typeof created.id !== 'string' || created.plan_id !== configuredPlan.planId) {
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
      !paymentMatchesSubscription(payment, {
        subscriptionId: local.data.razorpay_subscription_id,
        amountPaise: local.data.amount_paise,
      }) ||
      remoteSubscription.id !== local.data.razorpay_subscription_id ||
      remoteSubscription.plan_id !== local.data.razorpay_plan_id
    ) return fail(res, 400, 'PAYMENT_DETAILS_NOT_VERIFIED');

    const timestamp = new Date().toISOString();
    const recorded = await supabase.from('billing_payments').upsert({
      organization_id: profile.organization_id,
      subscription_id: local.data.id,
      provider: 'razorpay',
      idempotency_key: `razorpay-payment:${payment.id}`,
      razorpay_payment_id: payment.id,
      razorpay_invoice_id: payment.invoice_id || null,
      amount_paise: payment.amount,
      currency: payment.currency,
      status: 'captured',
      signature_verified_at: timestamp,
      paid_at: unixTimestampToIso(payment.created_at) || timestamp,
    }, { onConflict: 'razorpay_payment_id' });
    if (recorded.error) return fail(res, 503, 'BILLING_DATABASE_UNAVAILABLE');

    const status = resolveSubscriptionStatus(local.data.status, remoteSubscription.status, true);
    const updated = await supabase.from('organization_subscriptions').update({
      status,
      current_period_start: unixTimestampToIso(remoteSubscription.current_start),
      current_period_end: unixTimestampToIso(remoteSubscription.current_end),
      last_payment_at: timestamp,
      updated_at: timestamp,
    }).eq('id', local.data.id).eq('organization_id', profile.organization_id).eq('is_current', true)
      .neq('status', 'cancelled')
      .neq('status', 'expired')
      .select('id').maybeSingle();
    if (updated.error) return fail(res, 503, 'BILLING_DATABASE_UNAVAILABLE');
    if (!updated.data) return fail(res, 409, 'SUBSCRIPTION_STATE_CHANGED_RETRY');
    return res.status(200).json({ verified: true, subscriptionStatus: status });
  } catch {
    return fail(res, 502, 'PAYMENT_VERIFICATION_UNAVAILABLE');
  }
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
  if (remoteSubscription.id !== subscriptionId || remoteSubscription.plan_id !== local.data.razorpay_plan_id) {
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
    if (
      payment.id !== paymentId ||
      (!paymentMatchesSubscription(payment, {
        subscriptionId,
        amountPaise: local.data.amount_paise,
      }) && !paymentMatchesSubscription(payment, {
        subscriptionId,
        amountPaise: local.data.amount_paise,
      }, 'failed'))
    ) throw new Error('billing_provider_payment_mismatch');
    if (payment.status === 'captured') {
      const timestamp = new Date().toISOString();
      const { error } = await supabase.from('billing_payments').upsert({
        organization_id: local.data.organization_id,
        subscription_id: local.data.id,
        provider: 'razorpay',
        idempotency_key: `razorpay-payment:${payment.id}`,
        razorpay_payment_id: payment.id,
        razorpay_invoice_id: payment.invoice_id || null,
        amount_paise: payment.amount,
        currency: payment.currency,
        status: 'captured',
        signature_verified_at: timestamp,
        paid_at: unixTimestampToIso(payment.created_at) || timestamp,
      }, { onConflict: 'razorpay_payment_id' });
      if (error) throw new Error('billing_payment_persist_failed');
    } else if (payment.status === 'failed') {
      const { error } = await supabase.from('billing_payments').upsert({
        organization_id: local.data.organization_id,
        subscription_id: local.data.id,
        provider: 'razorpay',
        idempotency_key: `razorpay-payment:${payment.id}`,
        razorpay_payment_id: payment.id,
        amount_paise: payment.amount,
        currency: payment.currency,
        status: 'failed',
        failed_at: unixTimestampToIso(payment.created_at) || new Date().toISOString(),
      }, { onConflict: 'razorpay_payment_id' });
      if (error) throw new Error('billing_payment_persist_failed');
    }
  }

  const captured = await supabase.from('billing_payments').select('id')
    .eq('subscription_id', local.data.id)
    .eq('status', 'captured')
    .not('signature_verified_at', 'is', null)
    .limit(1)
    .maybeSingle();
  if (captured.error) throw new Error('billing_payment_lookup_failed');

  const status = resolveSubscriptionStatus(local.data.status, remoteSubscription.status, Boolean(captured.data));
  const { error } = await supabase.from('organization_subscriptions').update({
    status,
    current_period_start: unixTimestampToIso(remoteSubscription.current_start),
    current_period_end: unixTimestampToIso(remoteSubscription.current_end),
    cancelled_at: remoteSubscription.status === 'cancelled'
      ? unixTimestampToIso(remoteSubscription.ended_at) || local.data.cancelled_at || new Date().toISOString()
      : local.data.status === 'cancelled' ? local.data.cancelled_at : null,
    ended_at: local.data.status === 'expired' || local.data.status === 'cancelled'
      ? local.data.ended_at
      : unixTimestampToIso(remoteSubscription.ended_at),
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

export async function handleBillingAction(action: unknown, req: any, res: any) {
  if (action === 'plans' && req.method === 'GET') {
    return res.status(200).json({ plans: publicPlans() });
  }
  if (action === 'checkout' && req.method === 'POST') return createSubscription(req, res);
  if (action === 'verify' && req.method === 'POST') return verifyCheckout(req, res);
  if (action === 'webhook' && req.method === 'POST') return handleWebhook(req, res);
  if (action === 'subscription' && req.method === 'GET') {
    const profile = await authenticatedOwner(req);
    if (!profile) return fail(res, 403, 'OWNER_AUTHENTICATION_REQUIRED');
    if (!isRealSupabaseServerConfigured()) return fail(res, 503, 'BILLING_DATABASE_CONFIGURATION_MISSING');
    const supabase = getSupabaseServerClient();
    const { data, error } = await getSubscriptionForOrganization(supabase, profile.organization_id);
    if (error) return fail(res, 503, 'BILLING_DATABASE_UNAVAILABLE');
    return res.status(200).json({ subscription: data || null });
  }
  return fail(res, 404, 'BILLING_ROUTE_NOT_FOUND');
}

