-- ENCRIX billing foundation. Apply only after reviewing the pending production
-- migration history and confirming that the organizations table is present.
-- This migration creates records only; it does not grant CRM entitlements,
-- backfill grandfather status, create provider subscriptions, or charge users.

CREATE TABLE public.organization_subscriptions (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    plan_code TEXT NOT NULL CHECK (plan_code IN ('starter', 'professional', 'business')),
    status TEXT NOT NULL CHECK (
        status IN ('pending_payment', 'active', 'past_due', 'cancelled', 'expired')
    ),
    entitlement_source TEXT NOT NULL CHECK (
        entitlement_source IN ('razorpay', 'grandfathered', 'manual')
    ),
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    checkout_idempotency_key UUID NOT NULL UNIQUE,
    checkout_creation_status TEXT NOT NULL DEFAULT 'creating' CHECK (
        checkout_creation_status IN ('creating', 'created', 'reconciliation_required')
    ),
    amount_paise BIGINT CHECK (amount_paise IS NULL OR amount_paise > 0),
    razorpay_customer_id TEXT,
    razorpay_plan_id TEXT,
    razorpay_subscription_id TEXT UNIQUE,
    razorpay_short_url TEXT,
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    cancelled_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    last_payment_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT organization_subscriptions_period_order
        CHECK (current_period_end IS NULL OR current_period_start IS NULL OR current_period_end >= current_period_start),
    CONSTRAINT organization_subscriptions_id_organization_unique
        UNIQUE (id, organization_id)
);

CREATE UNIQUE INDEX organization_subscriptions_one_current_per_org
    ON public.organization_subscriptions(organization_id)
    WHERE is_current;
CREATE INDEX organization_subscriptions_status_period_end
    ON public.organization_subscriptions(status, current_period_end);

CREATE TABLE public.billing_payments (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    subscription_id UUID,
    provider TEXT NOT NULL DEFAULT 'razorpay' CHECK (provider = 'razorpay'),
    idempotency_key TEXT NOT NULL UNIQUE,
    razorpay_order_id TEXT,
    razorpay_payment_id TEXT UNIQUE,
    razorpay_invoice_id TEXT,
    amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
    currency TEXT NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
    status TEXT NOT NULL CHECK (
        status IN ('created', 'authorized', 'captured', 'failed', 'refunded')
    ),
    signature_verified_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT billing_payments_subscription_organization_fkey
        FOREIGN KEY (subscription_id, organization_id)
        REFERENCES public.organization_subscriptions(id, organization_id)
        ON DELETE RESTRICT
);

CREATE INDEX billing_payments_org_created
    ON public.billing_payments(organization_id, created_at DESC);
CREATE INDEX billing_payments_subscription_created
    ON public.billing_payments(subscription_id, created_at DESC);

CREATE TABLE public.billing_webhook_events (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    provider TEXT NOT NULL DEFAULT 'razorpay' CHECK (provider = 'razorpay'),
    provider_event_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload_sha256 CHAR(64) NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
    processing_status TEXT NOT NULL DEFAULT 'received' CHECK (
        processing_status IN ('received', 'processing', 'processed', 'ignored', 'failed')
    ),
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processing_started_at TIMESTAMPTZ,
    processed_at TIMESTAMPTZ,
    CONSTRAINT billing_webhook_events_provider_event_unique UNIQUE (provider, provider_event_id)
);

ALTER TABLE public.organization_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_webhook_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.organization_subscriptions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.billing_payments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.billing_webhook_events FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.organization_subscriptions TO service_role;
GRANT ALL ON TABLE public.billing_payments TO service_role;
GRANT ALL ON TABLE public.billing_webhook_events TO service_role;

CREATE POLICY "Service role manages organization subscriptions"
    ON public.organization_subscriptions FOR ALL TO service_role
    USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "Service role manages billing payments"
    ON public.billing_payments FOR ALL TO service_role
    USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "Service role manages billing webhook events"
    ON public.billing_webhook_events FOR ALL TO service_role
    USING (TRUE) WITH CHECK (TRUE);

