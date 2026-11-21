-- Run with psql against a disposable PostgreSQL database after migrations
-- 20261023000000, 20261031000000, 20261031170000, 20261105130000, and 20261105150000.
-- All fixtures are inside this transaction and must be rolled back.
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  v_org UUID := extensions.uuid_generate_v4();
  v_other_org UUID := extensions.uuid_generate_v4();
  v_owner UUID := extensions.uuid_generate_v4();
  v_other_owner UUID := extensions.uuid_generate_v4();
  v_sub UUID := extensions.uuid_generate_v4();
  v_other_sub UUID := extensions.uuid_generate_v4();
  v_other_org_sub UUID := extensions.uuid_generate_v4();
  v_payment_id TEXT := 'pay_' || replace(extensions.uuid_generate_v4()::text, '-', '');
  v_failed_refund_id TEXT := 'pay_' || replace(extensions.uuid_generate_v4()::text, '-', '');
  v_early_refund_id TEXT := 'pay_' || replace(extensions.uuid_generate_v4()::text, '-', '');
  v_provider_sub TEXT := 'sub_' || replace(extensions.uuid_generate_v4()::text, '-', '');
  v_other_provider_sub TEXT := 'sub_' || replace(extensions.uuid_generate_v4()::text, '-', '');
  v_now TIMESTAMPTZ := clock_timestamp();
  v_result JSONB;
  v_count INTEGER;
  v_status TEXT;
  v_signature TIMESTAMPTZ := clock_timestamp();
  v_function REGPROCEDURE := 'public.apply_verified_razorpay_payment(uuid,uuid,text,text,text,bigint,text,text,timestamp with time zone,bigint,integer,text,timestamp with time zone,timestamp with time zone,timestamp with time zone)'::regprocedure;
BEGIN
  IF current_database() = '' OR current_setting('server_version_num')::int < 150000 THEN
    RAISE EXCEPTION 'A supported local PostgreSQL database is required';
  END IF;

  IF NOT has_function_privilege('service_role', v_function, 'EXECUTE')
     OR has_function_privilege('anon', v_function, 'EXECUTE')
     OR has_function_privilege('authenticated', v_function, 'EXECUTE')
     OR EXISTS (
       SELECT 1 FROM pg_proc p, LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
       WHERE p.oid = v_function AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Payment lifecycle RPC execution privileges are not service-role-only';
  END IF;
  IF NOT (SELECT prosecdef AND proconfig @> ARRAY['search_path=pg_catalog, pg_temp']
          FROM pg_proc WHERE oid = v_function) THEN
    RAISE EXCEPTION 'Payment lifecycle RPC is not SECURITY DEFINER with restricted search_path';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.billing_payments'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.organization_subscriptions'::regclass) THEN
    RAISE EXCEPTION 'Billing table RLS was not preserved';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.billing_payments'::regclass AND conname = 'billing_payments_refund_amount_valid' AND convalidated)
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.billing_payments'::regclass AND conname = 'billing_payments_refund_status_valid' AND convalidated)
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.organization_subscriptions'::regclass AND conname = 'organization_subscriptions_total_count_positive' AND convalidated) THEN
    RAISE EXCEPTION 'Payment refund/cycle database constraints are missing or unvalidated';
  END IF;

  INSERT INTO public.organizations(id, name, slug, owner_id) VALUES
    (v_org, 'Lifecycle test', 'lifecycle-' || v_org::text, v_owner),
    (v_other_org, 'Lifecycle other', 'lifecycle-other-' || v_other_org::text, v_other_owner);
  INSERT INTO public.organization_subscriptions(
    id, organization_id, plan_code, status, entitlement_source, is_current,
    checkout_idempotency_key, amount_paise, razorpay_plan_id, razorpay_total_count, razorpay_subscription_id
  ) VALUES
    (v_sub, v_org, 'business', 'pending_payment', 'razorpay', TRUE, extensions.uuid_generate_v4(), 999900, 'plan_test_9999', 2, v_provider_sub),
    (v_other_sub, v_org, 'business', 'pending_payment', 'razorpay', FALSE, extensions.uuid_generate_v4(), 999900, 'plan_test_9999', 2, v_other_provider_sub),
    (v_other_org_sub, v_other_org, 'business', 'pending_payment', 'razorpay', TRUE, extensions.uuid_generate_v4(), 999900, 'plan_test_9999', 2, 'sub_' || replace(v_other_org::text, '-', ''));

  -- Failed charge is stored but cannot activate an unpaid subscription.
  v_result := public.apply_verified_razorpay_payment(
    v_org, v_sub, v_provider_sub, v_payment_id, NULL, 999900, 'INR', 'failed', v_now, 0, 2,
    'pending', v_now - interval '1 minute', v_now + interval '1 year', v_signature
  );
  IF v_result->>'status' <> 'pending_payment' OR v_result->>'paymentStatus' <> 'failed' THEN
    RAISE EXCEPTION 'Failed payment activated or corrupted the subscription';
  END IF;

  -- A verified captured payment advances failed -> captured and activates in one RPC transaction.
  v_result := public.apply_verified_razorpay_payment(
    v_org, v_sub, v_provider_sub, v_payment_id, 'inv_test_1', 999900, 'INR', 'captured', v_now, 0, 2,
    'active', v_now - interval '1 minute', v_now + interval '1 year', v_signature
  );
  IF v_result->>'status' <> 'active' OR v_result->>'paymentStatus' <> 'captured' THEN
    RAISE EXCEPTION 'Verified captured payment did not activate the subscription';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.billing_payments
    WHERE razorpay_payment_id = v_payment_id AND organization_id = v_org
      AND subscription_id = v_sub AND status = 'captured'
      AND amount_paise = 999900 AND currency = 'INR'
      AND signature_verified_at IS NOT NULL AND paid_at IS NOT NULL
  ) OR NOT EXISTS (
    SELECT 1 FROM public.organization_subscriptions
    WHERE id = v_sub AND organization_id = v_org AND status = 'active'
      AND current_period_end > clock_timestamp()
  ) THEN
    RAISE EXCEPTION 'Payment and subscription activation were not persisted together';
  END IF;

  -- A captured payment cannot activate a subscription while Razorpay reports
  -- that subscription as pending.
  v_result := public.apply_verified_razorpay_payment(
    v_org, v_sub, v_provider_sub, v_payment_id, 'inv_test_1', 999900, 'INR', 'captured', v_now, 0, 2,
    'pending', v_now - interval '1 minute', v_now + interval '1 year', v_signature
  );
  IF v_result->>'status' <> 'pending_payment'
     OR (SELECT status FROM public.organization_subscriptions WHERE id = v_sub) <> 'pending_payment' THEN
    RAISE EXCEPTION 'A captured payment activated a non-active provider subscription';
  END IF;

  -- A subsequent active provider state with the same verified current-period
  -- capture may activate the local subscription.
  v_result := public.apply_verified_razorpay_payment(
    v_org, v_sub, v_provider_sub, v_payment_id, 'inv_test_1', 999900, 'INR', 'captured', v_now, 0, 2,
    'active', v_now - interval '1 minute', v_now + interval '1 year', v_signature
  );
  IF v_result->>'status' <> 'active' THEN
    RAISE EXCEPTION 'An active provider subscription with a verified capture did not activate';
  END IF;

  -- Duplicate and delayed failure events cannot duplicate or downgrade a capture.
  PERFORM public.apply_verified_razorpay_payment(
    v_org, v_sub, v_provider_sub, v_payment_id, 'inv_test_1', 999900, 'INR', 'captured', v_now, 0, 2,
    'active', v_now - interval '1 minute', v_now + interval '1 year', v_signature
  );
  PERFORM public.apply_verified_razorpay_payment(
    v_org, v_sub, v_provider_sub, v_payment_id, 'inv_test_1', 999900, 'INR', 'failed', v_now, 0, 2,
    'active', v_now - interval '1 minute', v_now + interval '1 year', v_signature
  );
  SELECT count(*), min(status) INTO v_count, v_status FROM public.billing_payments WHERE razorpay_payment_id = v_payment_id;
  IF v_count <> 1 OR v_status <> 'captured'
     OR (SELECT status FROM public.organization_subscriptions WHERE id = v_sub) <> 'active' THEN
    RAISE EXCEPTION 'Duplicate or out-of-order payment event changed captured state';
  END IF;

  -- Partial refund is recorded without removing an otherwise valid capture.
  v_result := public.apply_verified_razorpay_payment(
    v_org, v_sub, v_provider_sub, v_payment_id, 'inv_test_1', 999900, 'INR', 'captured', v_now, 10000, 2,
    'active', v_now - interval '1 minute', v_now + interval '1 year', v_signature
  );
  IF v_result->>'status' <> 'active'
     OR (SELECT amount_refunded_paise FROM public.billing_payments WHERE razorpay_payment_id = v_payment_id) <> 10000 THEN
    RAISE EXCEPTION 'Partial refund handling is incorrect';
  END IF;

  -- Full refund removes current-period paid status and moves the subscription to past_due.
  v_result := public.apply_verified_razorpay_payment(
    v_org, v_sub, v_provider_sub, v_payment_id, 'inv_test_1', 999900, 'INR', 'refunded', v_now, 999900, 2,
    'active', v_now - interval '1 minute', v_now + interval '1 year', v_signature
  );
  IF v_result->>'status' <> 'past_due' OR v_result->>'paymentStatus' <> 'refunded'
     OR (SELECT status FROM public.billing_payments WHERE razorpay_payment_id = v_payment_id) <> 'refunded' THEN
    RAISE EXCEPTION 'Full refund did not remove active billing status';
  END IF;

  -- A full-refund notification may precede the capture notification. A later
  -- stale capture event must not restore paid state.
  PERFORM public.apply_verified_razorpay_payment(
    v_org, v_sub, v_provider_sub, v_early_refund_id, NULL, 999900, 'INR', 'refunded', v_now, 999900, 2,
    'active', v_now - interval '1 minute', v_now + interval '1 year', v_signature
  );
  v_result := public.apply_verified_razorpay_payment(
    v_org, v_sub, v_provider_sub, v_early_refund_id, NULL, 999900, 'INR', 'captured', v_now, 0, 2,
    'active', v_now - interval '1 minute', v_now + interval '1 year', v_signature
  );
  IF v_result->>'status' <> 'past_due'
     OR v_result->>'paymentStatus' <> 'refunded'
     OR (SELECT status FROM public.billing_payments WHERE razorpay_payment_id = v_early_refund_id) <> 'refunded' THEN
    RAISE EXCEPTION 'Out-of-order capture event restored a fully refunded payment';
  END IF;

  -- A delayed failure followed by a full refund is accepted only with verified
  -- capture evidence; duplicate refund delivery remains idempotent.
  PERFORM public.apply_verified_razorpay_payment(
    v_org, v_sub, v_provider_sub, v_failed_refund_id, NULL, 999900, 'INR', 'failed', v_now, 0, 2,
    'pending', v_now - interval '1 minute', v_now + interval '1 year', v_signature
  );
  BEGIN
    UPDATE public.billing_payments
    SET status = 'refunded', amount_refunded_paise = amount_paise
    WHERE razorpay_payment_id = v_failed_refund_id;
    RAISE EXCEPTION 'Unverified failed-to-refunded transition unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '23514' THEN
    NULL;
  END;
  v_result := public.apply_verified_razorpay_payment(
    v_org, v_sub, v_provider_sub, v_failed_refund_id, NULL, 999900, 'INR', 'refunded', v_now, 999900, 2,
    'active', v_now - interval '1 minute', v_now + interval '1 year', v_signature
  );
  IF v_result->>'paymentStatus' <> 'refunded'
     OR (SELECT status FROM public.billing_payments WHERE razorpay_payment_id = v_failed_refund_id) <> 'refunded'
     OR NOT EXISTS (
       SELECT 1 FROM public.billing_payments
       WHERE razorpay_payment_id = v_failed_refund_id
         AND amount_refunded_paise = amount_paise
         AND signature_verified_at IS NOT NULL
         AND paid_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'Verified full refund after a failed event was not persisted';
  END IF;
  PERFORM public.apply_verified_razorpay_payment(
    v_org, v_sub, v_provider_sub, v_failed_refund_id, NULL, 999900, 'INR', 'refunded', v_now, 999900, 2,
    'active', v_now - interval '1 minute', v_now + interval '1 year', v_signature
  );
  IF (SELECT count(*) FROM public.billing_payments WHERE razorpay_payment_id = v_failed_refund_id) <> 1
     OR (SELECT status FROM public.billing_payments WHERE razorpay_payment_id = v_failed_refund_id) <> 'refunded' THEN
    RAISE EXCEPTION 'Duplicate full-refund delivery was not idempotent';
  END IF;

  -- The same provider payment cannot cross subscription or organization boundaries.
  BEGIN
    PERFORM public.apply_verified_razorpay_payment(
      v_org, v_other_sub, v_other_provider_sub, v_payment_id, NULL, 999900, 'INR', 'captured', v_now, 0, 2,
      'active', v_now - interval '1 minute', v_now + interval '1 year', v_signature
    );
    RAISE EXCEPTION 'Payment ID was attached to a different subscription';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.apply_verified_razorpay_payment(
      v_other_org, v_other_org_sub, 'sub_' || replace(v_other_org::text, '-', ''), v_payment_id, NULL,
      999900, 'INR', 'captured', v_now, 0, 2, 'active', v_now - interval '1 minute',
      v_now + interval '1 year', v_signature
    );
    RAISE EXCEPTION 'Payment ID was attached to a different organization';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Bad amounts/currency and invalid refund totals fail closed without another payment row.
  BEGIN
    PERFORM public.apply_verified_razorpay_payment(
      v_org, v_sub, v_provider_sub, 'pay_badamount', NULL, 999899, 'INR', 'captured', v_now, 0, 2,
      'active', v_now - interval '1 minute', v_now + interval '1 year', v_signature
    );
    RAISE EXCEPTION 'Wrong amount was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.apply_verified_razorpay_payment(
      v_org, v_sub, v_provider_sub, 'pay_badcurrency', NULL, 999900, 'USD', 'captured', v_now, 0, 2,
      'active', v_now - interval '1 minute', v_now + interval '1 year', v_signature
    );
    RAISE EXCEPTION 'Wrong currency was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.apply_verified_razorpay_payment(
      v_org, v_sub, v_provider_sub, 'pay_badrefund', NULL, 999900, 'INR', 'refunded', v_now, 999899, 2,
      'active', v_now - interval '1 minute', v_now + interval '1 year', v_signature
    );
    RAISE EXCEPTION 'Incomplete refund was accepted as fully refunded';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  IF EXISTS (SELECT 1 FROM public.billing_payments WHERE razorpay_payment_id IN ('pay_badamount', 'pay_badcurrency', 'pay_badrefund')) THEN
    RAISE EXCEPTION 'Invalid payment data left a payment row';
  END IF;
END;
$$;
ROLLBACK;
