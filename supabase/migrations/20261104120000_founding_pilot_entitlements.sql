-- Auditable, organization-scoped, time-limited founding-pilot access.
-- This is an alternative verified entitlement source, not a client bypass:
-- the existing paid gate remains the sole server-side decision point.
BEGIN;

CREATE TABLE public.organization_pilot_entitlements (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  granted_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  grant_reason TEXT NOT NULL,
  revoked_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT,
  CONSTRAINT organization_pilot_entitlements_expiry_check
    CHECK (expires_at > granted_at AND expires_at <= granted_at + INTERVAL '365 days'),
  CONSTRAINT organization_pilot_entitlements_revocation_check
    CHECK ((revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL)
        OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revoke_reason IS NOT NULL))
);

CREATE INDEX organization_pilot_entitlements_active_org_idx
  ON public.organization_pilot_entitlements (organization_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE public.organization_pilot_entitlement_events (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  entitlement_id UUID NOT NULL REFERENCES public.organization_pilot_entitlements(id) ON DELETE RESTRICT,
  actor_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('GRANTED', 'REVOKED')),
  reason TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.statement_timestamp()
);

ALTER TABLE public.organization_pilot_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_pilot_entitlement_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.organization_pilot_entitlements FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.organization_pilot_entitlement_events FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.grant_founding_pilot_entitlement(
  p_organization_id UUID,
  p_granted_by UUID,
  p_expires_at TIMESTAMPTZ,
  p_reason TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_entitlement_id UUID;
  v_now TIMESTAMPTZ := pg_catalog.statement_timestamp();
  v_reason TEXT := pg_catalog.btrim(p_reason);
BEGIN
  IF p_organization_id IS NULL OR p_granted_by IS NULL OR p_expires_at IS NULL
     OR v_reason IS NULL OR pg_catalog.char_length(v_reason) < 6
     OR pg_catalog.char_length(v_reason) > 500
     OR p_expires_at <= v_now OR p_expires_at > v_now + INTERVAL '365 days' THEN
    RAISE EXCEPTION 'invalid_founding_pilot_entitlement' USING ERRCODE = '22023';
  END IF;

  -- Serialize all grants so both the three-organization pilot cap and the
  -- one-active-entitlement-per-organization rule hold under concurrency.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('encrix:founding-pilot-cap', 421202611));

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles AS p
     WHERE p.id = p_granted_by AND p.role = 'ADMIN' AND p.status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'founding_pilot_admin_required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations AS o WHERE o.id = p_organization_id) THEN
    RAISE EXCEPTION 'founding_pilot_organization_missing' USING ERRCODE = '23503';
  END IF;
  IF (SELECT pg_catalog.count(DISTINCT e.organization_id)
        FROM public.organization_pilot_entitlements AS e
       WHERE e.revoked_at IS NULL AND e.expires_at > v_now) >= 3 THEN
    RAISE EXCEPTION 'founding_pilot_capacity_reached' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.organization_pilot_entitlements AS e
     WHERE e.organization_id = p_organization_id
       AND e.revoked_at IS NULL AND e.expires_at > v_now
  ) THEN
    RAISE EXCEPTION 'founding_pilot_already_active' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.organization_pilot_entitlements (
    organization_id, granted_by, expires_at, grant_reason
  ) VALUES (p_organization_id, p_granted_by, p_expires_at, v_reason)
  RETURNING id INTO v_entitlement_id;

  INSERT INTO public.organization_pilot_entitlement_events (
    organization_id, entitlement_id, actor_profile_id, action, reason, expires_at
  ) VALUES (p_organization_id, v_entitlement_id, p_granted_by, 'GRANTED', v_reason, p_expires_at);

  RETURN v_entitlement_id;
END;
$function$;

CREATE FUNCTION public.revoke_founding_pilot_entitlement(
  p_organization_id UUID,
  p_entitlement_id UUID,
  p_revoked_by UUID,
  p_reason TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_reason TEXT := pg_catalog.btrim(p_reason);
  v_expires_at TIMESTAMPTZ;
BEGIN
  IF p_organization_id IS NULL OR p_entitlement_id IS NULL OR p_revoked_by IS NULL
     OR v_reason IS NULL OR pg_catalog.char_length(v_reason) < 6
     OR pg_catalog.char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'invalid_founding_pilot_revocation' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles AS p
     WHERE p.id = p_revoked_by AND p.role = 'ADMIN' AND p.status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'founding_pilot_admin_required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.organization_pilot_entitlements AS e
     SET revoked_by = p_revoked_by,
         revoked_at = pg_catalog.statement_timestamp(),
         revoke_reason = v_reason
   WHERE e.id = p_entitlement_id
     AND e.organization_id = p_organization_id
     AND e.revoked_at IS NULL
  RETURNING e.expires_at INTO v_expires_at;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.organization_pilot_entitlement_events (
    organization_id, entitlement_id, actor_profile_id, action, reason, expires_at
  ) VALUES (p_organization_id, p_entitlement_id, p_revoked_by, 'REVOKED', v_reason, v_expires_at);
  RETURN TRUE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.organization_has_active_paid_entitlement(p_organization_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT COALESCE(
    EXISTS (
      SELECT 1
      FROM public.organization_subscriptions AS s
      JOIN public.billing_payments AS p
        ON p.subscription_id = s.id
       AND p.organization_id = s.organization_id
      WHERE s.organization_id = p_organization_id
        AND s.plan_code = 'business'
        AND s.amount_paise = 999900
        AND s.entitlement_source = 'razorpay'
        AND s.status = 'active'
        AND s.is_current IS TRUE
        AND s.checkout_creation_status = 'created'
        AND s.razorpay_subscription_id IS NOT NULL
        AND s.current_period_start IS NOT NULL
        AND s.current_period_end IS NOT NULL
        AND s.current_period_start <= pg_catalog.statement_timestamp()
        AND s.current_period_end > pg_catalog.statement_timestamp()
        AND p.provider = 'razorpay'
        AND p.status = 'captured'
        AND p.currency = 'INR'
        AND p.amount_paise = s.amount_paise
        AND p.amount_refunded_paise < p.amount_paise
        AND p.signature_verified_at IS NOT NULL
        AND p.paid_at IS NOT NULL
        AND p.paid_at >= s.current_period_start
        AND p.paid_at < s.current_period_end
    ) OR EXISTS (
      SELECT 1
      FROM public.organization_pilot_entitlements AS e
      WHERE e.organization_id = p_organization_id
        AND e.revoked_at IS NULL
        AND e.expires_at > pg_catalog.statement_timestamp()
    ), FALSE);
$function$;

REVOKE ALL ON FUNCTION public.grant_founding_pilot_entitlement(UUID, UUID, TIMESTAMPTZ, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_founding_pilot_entitlement(UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.organization_has_active_paid_entitlement(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_founding_pilot_entitlement(UUID, UUID, TIMESTAMPTZ, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_founding_pilot_entitlement(UUID, UUID, UUID, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.organization_has_active_paid_entitlement(UUID)
  TO service_role;

COMMIT;
