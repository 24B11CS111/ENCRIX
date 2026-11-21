-- Run with psql against a disposable database after the billing foundation,
-- payment lifecycle, paid-entitlement, provider-identity, and refund workflow migrations.
-- All fixtures are transaction-scoped and rolled back.
\set ON_ERROR_STOP on
BEGIN;
DO $test$
DECLARE
  v_org UUID := extensions.uuid_generate_v4();
  v_expired_org UUID := extensions.uuid_generate_v4();
  v_unpaid_org UUID := extensions.uuid_generate_v4();
  v_refunded_org UUID := extensions.uuid_generate_v4();
  v_partial_refund_org UUID := extensions.uuid_generate_v4();
  v_other_org UUID := extensions.uuid_generate_v4();
  v_cross_tenant_org UUID := extensions.uuid_generate_v4();
  v_wrong_plan_org UUID := extensions.uuid_generate_v4();
  v_wrong_price_org UUID := extensions.uuid_generate_v4();
  v_invalid_identity_org UUID := extensions.uuid_generate_v4();
  v_owner UUID := extensions.uuid_generate_v4();
  v_admin UUID := extensions.uuid_generate_v4();
  v_sub UUID := extensions.uuid_generate_v4();
  v_expired_sub UUID := extensions.uuid_generate_v4();
  v_unpaid_sub UUID := extensions.uuid_generate_v4();
  v_refunded_sub UUID := extensions.uuid_generate_v4();
  v_partial_sub UUID := extensions.uuid_generate_v4();
  v_wrong_org_sub UUID := extensions.uuid_generate_v4();
  v_cross_tenant_sub UUID := extensions.uuid_generate_v4();
  v_wrong_plan_sub UUID := extensions.uuid_generate_v4();
  v_wrong_price_sub UUID := extensions.uuid_generate_v4();
  v_invalid_identity_sub UUID := extensions.uuid_generate_v4();
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_function REGPROCEDURE := 'public.organization_has_active_paid_entitlement(uuid)'::regprocedure;
BEGIN
  IF current_setting('server_version_num')::INTEGER < 150000 THEN
    RAISE EXCEPTION 'PostgreSQL 15 or newer is required';
  END IF;
  IF NOT (SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']
          FROM pg_catalog.pg_proc p WHERE p.oid = v_function) THEN
    RAISE EXCEPTION 'Entitlement RPC must be SECURITY DEFINER with restricted search_path';
  END IF;
  IF has_function_privilege('anon', v_function, 'EXECUTE')
     OR has_function_privilege('authenticated', v_function, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_function, 'EXECUTE')
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc p,
         LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
       WHERE p.oid = v_function AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Entitlement RPC execution must be service_role-only';
  END IF;

  INSERT INTO public.organizations(id, name, slug, owner_id) VALUES
    (v_org, 'Entitlement active test', 'entitlement-' || v_org::text, v_owner),
    (v_expired_org, 'Entitlement expired test', 'entitlement-' || v_expired_org::text, extensions.uuid_generate_v4()),
    (v_unpaid_org, 'Entitlement unpaid test', 'entitlement-' || v_unpaid_org::text, extensions.uuid_generate_v4()),
    (v_refunded_org, 'Entitlement refunded test', 'entitlement-' || v_refunded_org::text, extensions.uuid_generate_v4()),
    (v_partial_refund_org, 'Entitlement partial refund test', 'entitlement-' || v_partial_refund_org::text, extensions.uuid_generate_v4()),
    (v_cross_tenant_org, 'Entitlement cross tenant test', 'entitlement-' || v_cross_tenant_org::text, extensions.uuid_generate_v4()),
    (v_wrong_plan_org, 'Entitlement wrong plan test', 'entitlement-' || v_wrong_plan_org::text, extensions.uuid_generate_v4()),
    (v_wrong_price_org, 'Entitlement wrong price test', 'entitlement-' || v_wrong_price_org::text, extensions.uuid_generate_v4()),
    (v_invalid_identity_org, 'Entitlement invalid identity test', 'entitlement-' || v_invalid_identity_org::text, extensions.uuid_generate_v4()),
    (v_other_org, 'Entitlement other organization test', 'entitlement-' || v_other_org::text, extensions.uuid_generate_v4());

  INSERT INTO public.profiles(id, user_id, organization_id, full_name, role, status) VALUES
    (v_owner, extensions.uuid_generate_v4(), v_partial_refund_org, 'Refund request owner', 'OWNER', 'ACTIVE'),
    (v_admin, extensions.uuid_generate_v4(), NULL, 'Refund reviewer', 'OWNER', 'ACTIVE');
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', TRUE);
  PERFORM public.grant_platform_admin(v_admin);
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'authenticated', TRUE);

  INSERT INTO public.organization_subscriptions(
    id, organization_id, plan_code, status, entitlement_source, is_current,
    checkout_idempotency_key, checkout_creation_status, amount_paise,
    razorpay_plan_id, razorpay_total_count, razorpay_subscription_id,
    current_period_start, current_period_end
  ) VALUES
    (v_sub, v_org, 'business', 'active', 'razorpay', TRUE, extensions.uuid_generate_v4(), 'created', 999900, 'plan_test_9999', 2, 'sub_' || replace(v_sub::text, '-', ''), v_now - interval '1 day', v_now + interval '364 days'),
    (v_expired_sub, v_expired_org, 'business', 'active', 'razorpay', TRUE, extensions.uuid_generate_v4(), 'created', 999900, 'plan_test_9999', 2, 'sub_' || replace(v_expired_sub::text, '-', ''), v_now - interval '370 days', v_now - interval '1 day'),
    (v_unpaid_sub, v_unpaid_org, 'business', 'pending_payment', 'razorpay', TRUE, extensions.uuid_generate_v4(), 'created', 999900, 'plan_test_9999', 2, 'sub_' || replace(v_unpaid_sub::text, '-', ''), v_now - interval '1 day', v_now + interval '364 days'),
    (v_refunded_sub, v_refunded_org, 'business', 'past_due', 'razorpay', TRUE, extensions.uuid_generate_v4(), 'created', 999900, 'plan_test_9999', 2, 'sub_' || replace(v_refunded_sub::text, '-', ''), v_now - interval '1 day', v_now + interval '364 days'),
    (v_partial_sub, v_partial_refund_org, 'business', 'active', 'razorpay', TRUE, extensions.uuid_generate_v4(), 'created', 999900, 'plan_test_9999', 2, 'sub_' || replace(v_partial_sub::text, '-', ''), v_now - interval '1 day', v_now + interval '364 days'),
    (v_wrong_org_sub, v_other_org, 'business', 'active', 'razorpay', TRUE, extensions.uuid_generate_v4(), 'created', 999900, 'plan_test_9999', 2, 'sub_' || replace(v_wrong_org_sub::text, '-', ''), v_now - interval '1 day', v_now + interval '364 days'),
    (v_cross_tenant_sub, v_cross_tenant_org, 'business', 'active', 'razorpay', TRUE, extensions.uuid_generate_v4(), 'created', 999900, 'plan_test_9999', 2, 'sub_' || replace(v_cross_tenant_sub::text, '-', ''), v_now - interval '1 day', v_now + interval '364 days'),
    (v_wrong_plan_sub, v_wrong_plan_org, 'starter', 'active', 'razorpay', TRUE, extensions.uuid_generate_v4(), 'created', 999900, 'plan_test_9999', 2, 'sub_' || replace(v_wrong_plan_sub::text, '-', ''), v_now - interval '1 day', v_now + interval '364 days'),
    (v_wrong_price_sub, v_wrong_price_org, 'business', 'active', 'razorpay', TRUE, extensions.uuid_generate_v4(), 'created', 999899, 'plan_test_9999', 2, 'sub_' || replace(v_wrong_price_sub::text, '-', ''), v_now - interval '1 day', v_now + interval '364 days'),
    (v_invalid_identity_sub, v_invalid_identity_org, 'business', 'active', 'razorpay', TRUE, extensions.uuid_generate_v4(), 'created', 999900, 'plan_test_9999', 2, 'invalid_subscription_id', v_now - interval '1 day', v_now + interval '364 days');

  INSERT INTO public.billing_payments(
    organization_id, subscription_id, provider, idempotency_key,
    razorpay_payment_id, amount_paise, amount_refunded_paise, currency,
    status, signature_verified_at, paid_at, failed_at
  ) VALUES
    (v_org, v_sub, 'razorpay', 'entitlement-' || v_sub::text, 'pay_' || replace(v_sub::text, '-', ''), 999900, 0, 'INR', 'captured', v_now, v_now, NULL),
    (v_unpaid_org, v_unpaid_sub, 'razorpay', 'entitlement-' || v_unpaid_sub::text, 'pay_' || replace(v_unpaid_sub::text, '-', ''), 999900, 0, 'INR', 'failed', NULL, NULL, v_now),
    (v_refunded_org, v_refunded_sub, 'razorpay', 'entitlement-' || v_refunded_sub::text, 'pay_' || replace(v_refunded_sub::text, '-', ''), 999900, 999900, 'INR', 'refunded', v_now, v_now, NULL),
    (v_partial_refund_org, v_partial_sub, 'razorpay', 'entitlement-' || v_partial_sub::text, 'pay_' || replace(v_partial_sub::text, '-', ''), 999900, 100, 'INR', 'captured', v_now, v_now, NULL),
    (v_other_org, v_wrong_org_sub, 'razorpay', 'entitlement-' || v_wrong_org_sub::text, 'pay_' || replace(v_wrong_org_sub::text, '-', ''), 999900, 0, 'INR', 'captured', v_now, v_now, NULL),
    (v_wrong_plan_org, v_wrong_plan_sub, 'razorpay', 'entitlement-' || v_wrong_plan_sub::text, 'pay_' || replace(v_wrong_plan_sub::text, '-', ''), 999900, 0, 'INR', 'captured', v_now, v_now, NULL),
    (v_wrong_price_org, v_wrong_price_sub, 'razorpay', 'entitlement-' || v_wrong_price_sub::text, 'pay_' || replace(v_wrong_price_sub::text, '-', ''), 999899, 0, 'INR', 'captured', v_now, v_now, NULL),
    (v_invalid_identity_org, v_invalid_identity_sub, 'razorpay', 'entitlement-' || v_invalid_identity_sub::text, 'pay_' || replace(v_invalid_identity_sub::text, '-', ''), 999900, 0, 'INR', 'captured', v_now, v_now, NULL);

  INSERT INTO public.billing_refund_requests(
    organization_id, subscription_id, payment_id, requested_by, request_idempotency_key,
    requested_amount_paise, approved_amount_paise, reason, status, entitlement_action,
    reviewed_by, reviewed_at
  )
  SELECT v_partial_refund_org, v_partial_sub, p.id, v_owner, extensions.uuid_generate_v4(),
         100, 100, 'Approved partial refund', 'partially_refunded', 'retain', v_admin, v_now
  FROM public.billing_payments AS p
  WHERE p.organization_id = v_partial_refund_org AND p.subscription_id = v_partial_sub;

  IF public.organization_has_active_paid_entitlement(v_org) IS NOT TRUE THEN RAISE EXCEPTION 'Verified active Business subscription was denied'; END IF;
  IF public.organization_has_active_paid_entitlement(v_expired_org) IS NOT FALSE THEN RAISE EXCEPTION 'Expired period was entitled'; END IF;
  IF public.organization_has_active_paid_entitlement(v_unpaid_org) IS NOT FALSE THEN RAISE EXCEPTION 'Unpaid subscription was entitled'; END IF;
  IF public.organization_has_active_paid_entitlement(v_refunded_org) IS NOT FALSE THEN RAISE EXCEPTION 'Fully refunded subscription was entitled'; END IF;
  IF public.organization_has_active_paid_entitlement(v_partial_refund_org) IS NOT TRUE THEN RAISE EXCEPTION 'Partial refund incorrectly removed otherwise-valid access'; END IF;
  IF public.organization_has_active_paid_entitlement(v_cross_tenant_org) IS NOT FALSE THEN RAISE EXCEPTION 'A different organization payment was used to grant entitlement'; END IF;
  IF public.organization_has_active_paid_entitlement(v_wrong_plan_org) IS NOT FALSE THEN RAISE EXCEPTION 'Non-Business plan was entitled'; END IF;
  IF public.organization_has_active_paid_entitlement(v_wrong_price_org) IS NOT FALSE THEN RAISE EXCEPTION 'Non-9999 annual amount was entitled'; END IF;
  IF public.organization_has_active_paid_entitlement(v_invalid_identity_org) IS NOT FALSE THEN RAISE EXCEPTION 'Malformed Razorpay subscription identity was entitled'; END IF;
  IF public.organization_has_active_paid_entitlement(extensions.uuid_generate_v4()) IS NOT FALSE THEN RAISE EXCEPTION 'Unknown organization was entitled'; END IF;

  -- An expired organization regains entitlement only after its old period is
  -- replaced by a valid renewal period and a matching verified capture exists.
  UPDATE public.organization_subscriptions
  SET current_period_start = v_now - interval '1 minute',
      current_period_end = v_now + interval '364 days'
  WHERE id = v_expired_sub AND organization_id = v_expired_org;
  INSERT INTO public.billing_payments(
    organization_id, subscription_id, provider, idempotency_key,
    razorpay_payment_id, amount_paise, amount_refunded_paise, currency,
    status, signature_verified_at, paid_at
  ) VALUES (
    v_expired_org, v_expired_sub, 'razorpay', 'entitlement-renewal-' || v_expired_sub::text,
    'pay_' || replace(v_expired_sub::text, '-', ''),
    999900, 0, 'INR', 'captured', v_now, v_now
  );
  UPDATE public.organization_subscriptions SET status = 'active'
  WHERE id = v_expired_sub AND organization_id = v_expired_org;
  IF public.organization_has_active_paid_entitlement(v_expired_org) IS NOT TRUE THEN
    RAISE EXCEPTION 'A valid verified renewal did not restore entitlement';
  END IF;
END;
$test$;
ROLLBACK;
