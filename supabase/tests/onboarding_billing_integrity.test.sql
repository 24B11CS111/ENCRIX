-- Run after the onboarding/billing migrations in a disposable local database.
-- All fixture rows, test-only triggers and policies are rolled back.
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  v_owner UUID := extensions.uuid_generate_v4();
  v_owner2 UUID := extensions.uuid_generate_v4();
  v_email TEXT := 'integrity-' || extensions.uuid_generate_v4()::text || '@example.test';
  v_existing_owner UUID := extensions.uuid_generate_v4();
  v_existing_org UUID := extensions.uuid_generate_v4();
  v_orphan_org UUID := extensions.uuid_generate_v4();
  v_orphan_owner UUID := extensions.uuid_generate_v4();
  v_org UUID;
  v_subscription UUID := extensions.uuid_generate_v4();
  v_subscription2 UUID := extensions.uuid_generate_v4();
  v_other_org UUID := extensions.uuid_generate_v4();
  v_ticket UUID := extensions.uuid_generate_v4();
  v_expired_ticket UUID := extensions.uuid_generate_v4();
  v_failed_ticket UUID := extensions.uuid_generate_v4();
  v_unverified_ticket UUID := extensions.uuid_generate_v4();
  v_duplicate_email_ticket UUID := extensions.uuid_generate_v4();
  v_missing_ticket UUID := extensions.uuid_generate_v4();
  v_rate_ticket UUID;
  v_rate_email TEXT := 'rate-limit-' || extensions.uuid_generate_v4()::text || '@example.test';
  v_hash TEXT := repeat('a',64);
  v_wrong_hash TEXT := repeat('b',64);
  v_result JSONB;
  v_rate_result JSONB;
  v_count INTEGER;
  v_payment_id UUID;
BEGIN
  INSERT INTO public.organizations(id,name,slug,owner_id)
  VALUES(v_orphan_org,'Preexisting Orphan','preexisting-orphan-' || v_orphan_org::text,v_orphan_owner);

  -- Unknown ticket status/failure checks cannot materialize caller-chosen IDs.
  v_result := public.complete_registration_otp_verification(v_missing_ticket,v_email,FALSE);
  IF (v_result->>'unavailable')::boolean IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'unknown ticket was not rejected';
  END IF;
  BEGIN
    PERFORM public.get_registration_otp_attempts(v_missing_ticket,v_email);
    RAISE EXCEPTION 'status function accepted an unknown ticket';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.registration_otp_attempts WHERE ticket_id=v_missing_ticket) THEN
    RAISE EXCEPTION 'status or failure function created an arbitrary ticket';
  END IF;
  IF to_regprocedure('public.record_registration_otp_failure(uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'legacy OTP failure function remains callable';
  END IF;

  -- Missing ticket cannot create an organization. A newly issued but unverified
  -- ticket cannot register either.
  BEGIN
    PERFORM public.create_owner_registration(v_owner,v_email,'Owner',NULL,'Company','missing-ticket-' || v_owner::text,
      'General','1-10',NULL,NULL,NULL,NULL,NULL,NULL);
    RAISE EXCEPTION 'registration without a ticket unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  PERFORM public.issue_registration_otp_ticket(v_unverified_ticket,v_email,v_hash,
    now()+interval '5 minutes',now()+interval '60 seconds','+919999999991',
    'Integrity One','Owner One','General','1-10',v_email,'+919999999992','Pune',NULL);
  BEGIN
    PERFORM public.create_owner_registration(v_owner,v_email,'Owner',NULL,'Company','unverified-' || v_owner::text,
      'General','1-10',NULL,NULL,NULL,NULL,v_unverified_ticket,now()+interval '5 minutes');
    RAISE EXCEPTION 'unverified OTP ticket unexpectedly registered an owner';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  -- Invalid attempts are atomic, capped, and durable. The ticket must have been
  -- issued first; only its HMAC can verify it.
  PERFORM public.issue_registration_otp_ticket(v_failed_ticket,
    'failed-' || v_email,v_hash,now()+interval '5 minutes',now()+interval '60 seconds',
    NULL,'Failed Co','Failed Owner','General','1-10',NULL,NULL,'Pune',NULL);
  FOR i IN 1..5 LOOP
    v_result := public.complete_registration_otp_verification(v_failed_ticket,'failed-' || v_email,FALSE);
  END LOOP;
  IF (v_result->>'attempts')::int <> 5 OR (v_result->>'locked')::boolean IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'registration OTP did not lock after five incorrect attempts';
  END IF;
  v_result := public.complete_registration_otp_verification(v_failed_ticket,'failed-' || v_email,TRUE);
  IF (v_result->>'locked')::boolean IS DISTINCT FROM TRUE OR
     (SELECT attempts FROM public.registration_otp_attempts WHERE ticket_id=v_failed_ticket) <> 5 THEN
    RAISE EXCEPTION 'locked OTP ticket accepted a later correct code';
  END IF;

  -- Registration send limits are durable and shared across API instances.
  FOR i IN 1..5 LOOP
    v_rate_ticket := extensions.uuid_generate_v4();
    v_rate_result := public.issue_registration_otp_ticket(
      v_rate_ticket, v_rate_email, v_hash, now()+interval '5 minutes',
      now()+interval '60 seconds', NULL, 'Rate Limit Co', 'Rate Limit Owner',
      'General', '1-10', NULL, NULL, 'Pune', NULL
    );
    IF (v_rate_result->>'issued')::boolean IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'registration OTP was rate-limited before five sends';
    END IF;
    UPDATE public.pending_registrations
       SET resend_after = now() - interval '1 second'
     WHERE email = v_rate_email;
  END LOOP;
  v_rate_result := public.issue_registration_otp_ticket(
    extensions.uuid_generate_v4(), v_rate_email, v_hash, now()+interval '5 minutes',
    now()+interval '60 seconds', NULL, 'Rate Limit Co', 'Rate Limit Owner',
    'General', '1-10', NULL, NULL, 'Pune', NULL
  );
  IF (v_rate_result->>'issued')::boolean IS DISTINCT FROM FALSE
     OR (v_rate_result->>'rate_limited')::boolean IS DISTINCT FROM TRUE
     OR (SELECT count(*) FROM public.registration_otp_attempts WHERE email = v_rate_email) <> 5 THEN
    RAISE EXCEPTION 'registration OTP send cap did not block the sixth request';
  END IF;

  -- Expiry is read from durable ticket state, never from caller-supplied expiry.
  PERFORM public.issue_registration_otp_ticket(v_expired_ticket,
    'expired-' || v_email,v_hash,now()+interval '5 minutes',now()+interval '60 seconds',
    NULL,'Expired Co','Expired Owner','General','1-10',NULL,NULL,'Pune',NULL);
  UPDATE public.registration_otp_attempts SET expires_at=now()-interval '1 second' WHERE ticket_id=v_expired_ticket;
  UPDATE public.pending_registrations SET expires_at=now()-interval '1 second' WHERE otp_ticket_id=v_expired_ticket;
  v_result := public.complete_registration_otp_verification(v_expired_ticket,'expired-' || v_email,TRUE);
  IF (v_result->>'expired')::boolean IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'expired OTP ticket was accepted';
  END IF;

  -- Correct code marks the issued ticket verified; account rows and ticket
  -- consumption are committed atomically by the registration RPC.
  v_result := public.complete_registration_otp_verification(v_unverified_ticket,v_email,FALSE);
  IF (v_result->>'attempts')::int <> 1 THEN RAISE EXCEPTION 'incorrect code was not recorded'; END IF;
  v_result := public.complete_registration_otp_verification(v_unverified_ticket,v_email,TRUE);
  IF (v_result->>'verified')::boolean IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'correct code was not verified'; END IF;
  PERFORM public.create_owner_registration(v_owner,v_email,'Ignored Name',NULL,'Ignored Company','integrity-' || v_owner::text,
    'ignored','ignored',NULL,NULL,NULL,NULL,v_unverified_ticket,now()+interval '5 minutes');
  SELECT id INTO v_org FROM public.organizations WHERE owner_id=v_owner;
  IF v_org IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE user_id=v_owner AND organization_id=v_org AND email=v_email AND email_verified
  ) OR NOT EXISTS (
    SELECT 1 FROM public.organizations WHERE id=v_org AND business_email=v_email AND business_phone='+919999999992' AND business_location='Pune'
  ) THEN
    RAISE EXCEPTION 'owner registration did not persist organization/profile/business details';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id=v_orphan_org AND owner_id=v_orphan_owner) THEN
    RAISE EXCEPTION 'preexisting orphan organization was changed or deleted';
  END IF;
  BEGIN
    PERFORM public.create_owner_registration(v_owner2,v_email,'Owner',NULL,'Company','replay-' || v_owner2::text,
      'General','1-10',NULL,NULL,NULL,NULL,v_unverified_ticket,now()+interval '5 minutes');
    RAISE EXCEPTION 'consumed ticket replay unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  -- A duplicate profile failure rolls back the organization insert and leaves
  -- the verified ticket unconsumed so a legitimate retry can be investigated.
  INSERT INTO public.organizations(id,name,slug,owner_id)
  VALUES(v_existing_org,'Existing','existing-' || v_existing_org::text,v_existing_owner);
  INSERT INTO public.profiles(user_id,organization_id,full_name,email,role,status)
  VALUES(v_existing_owner,v_existing_org,'Existing Owner','duplicate-' || v_email,'OWNER','ACTIVE');
  PERFORM public.issue_registration_otp_ticket(v_duplicate_email_ticket,'duplicate-' || v_email,v_hash,
    now()+interval '5 minutes',now()+interval '60 seconds',NULL,'Duplicate Co','Duplicate Owner',
    'General','1-10',NULL,NULL,'Pune',NULL);
  PERFORM public.complete_registration_otp_verification(v_duplicate_email_ticket,'duplicate-' || v_email,TRUE);
  BEGIN
    PERFORM public.create_owner_registration(v_owner2,'duplicate-' || v_email,'Ignored',NULL,'Ignored',
      'duplicate-' || v_owner2::text,'ignored','ignored',NULL,NULL,NULL,NULL,v_duplicate_email_ticket,now()+interval '5 minutes');
    RAISE EXCEPTION 'duplicate owner email unexpectedly registered';
  EXCEPTION WHEN unique_violation THEN
    SELECT count(*) INTO v_count FROM public.organizations WHERE owner_id=v_owner2;
    IF v_count <> 0 THEN RAISE EXCEPTION 'organization survived failed profile insert'; END IF;
    IF (SELECT consumed_at FROM public.registration_otp_attempts WHERE ticket_id=v_duplicate_email_ticket) IS NOT NULL THEN
      RAISE EXCEPTION 'ticket was consumed despite rolled-back registration';
    END IF;
  END;

  -- Payment ID can be assigned once, then immutable. Status only moves forward.
  INSERT INTO public.organizations(id,name,slug,owner_id)
  VALUES(v_other_org,'Payment Other','payment-other-' || v_other_org::text,extensions.uuid_generate_v4());
  INSERT INTO public.organization_subscriptions(id,organization_id,plan_code,status,entitlement_source,
    is_current,checkout_idempotency_key,amount_paise,razorpay_plan_id)
  VALUES(v_subscription,v_org,'business','pending_payment','razorpay',true,extensions.uuid_generate_v4(),999900,'plan_test_integrity');
  INSERT INTO public.organization_subscriptions(id,organization_id,plan_code,status,entitlement_source,
    is_current,checkout_idempotency_key,amount_paise,razorpay_plan_id)
  VALUES(v_subscription2,v_org,'business','pending_payment','razorpay',false,extensions.uuid_generate_v4(),999900,'plan_test_integrity');
  INSERT INTO public.billing_payments(organization_id,subscription_id,idempotency_key,razorpay_payment_id,
    amount_paise,currency,status)
  VALUES(v_org,v_subscription,'integrity-payment-' || v_subscription::text,NULL,999900,'INR','created')
  RETURNING id INTO v_payment_id;
  UPDATE public.billing_payments SET razorpay_payment_id='pay_integrity_' || v_payment_id::text,status='authorized'
    WHERE id=v_payment_id;
  UPDATE public.billing_payments SET status='captured',signature_verified_at=now(),paid_at=now()
    WHERE id=v_payment_id;
  BEGIN
    UPDATE public.billing_payments SET status='failed',failed_at=now() WHERE id=v_payment_id;
    RAISE EXCEPTION 'captured payment was downgraded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.billing_payments SET status='refunded' WHERE id=v_payment_id;
  BEGIN
    UPDATE public.billing_payments SET status='captured' WHERE id=v_payment_id;
    RAISE EXCEPTION 'refunded payment was reversed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.billing_payments SET razorpay_payment_id='pay_reassigned' WHERE id=v_payment_id;
    RAISE EXCEPTION 'payment ID was reassigned';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.billing_payments SET razorpay_payment_id=NULL WHERE id=v_payment_id;
    RAISE EXCEPTION 'payment ID was cleared to NULL';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.billing_payments SET razorpay_payment_id='' WHERE id=v_payment_id;
    RAISE EXCEPTION 'payment ID was set to empty string';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.billing_payments SET organization_id=v_other_org WHERE id=v_payment_id;
    RAISE EXCEPTION 'payment organization was reassigned';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.billing_payments SET subscription_id=v_subscription2 WHERE id=v_payment_id;
    RAISE EXCEPTION 'payment subscription was reassigned';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  INSERT INTO public.billing_webhook_events(provider,provider_event_id,event_type,payload_sha256)
  VALUES('razorpay','integrity-event-' || v_payment_id::text,'payment.captured',repeat('a',64));
  BEGIN
    INSERT INTO public.billing_webhook_events(provider,provider_event_id,event_type,payload_sha256)
    VALUES('razorpay','integrity-event-' || v_payment_id::text,'payment.captured',repeat('a',64));
    RAISE EXCEPTION 'duplicate webhook event was accepted';
  EXCEPTION WHEN unique_violation THEN
    SELECT count(*) INTO v_count FROM public.billing_webhook_events
     WHERE provider='razorpay' AND provider_event_id='integrity-event-' || v_payment_id::text;
    IF v_count <> 1 THEN RAISE EXCEPTION 'duplicate webhook receipt count is not one'; END IF;
  END;

  IF NOT has_function_privilege('service_role','public.create_owner_registration(uuid,text,text,text,text,text,text,text,text,text,text,text,uuid,timestamp with time zone)','EXECUTE') OR
     has_function_privilege('anon','public.create_owner_registration(uuid,text,text,text,text,text,text,text,text,text,text,text,uuid,timestamp with time zone)','EXECUTE') OR
     has_function_privilege('authenticated','public.create_owner_registration(uuid,text,text,text,text,text,text,text,text,text,text,text,uuid,timestamp with time zone)','EXECUTE') OR
     NOT has_function_privilege('service_role','public.complete_registration_otp_verification(uuid,text,boolean)','EXECUTE') OR
     has_function_privilege('anon','public.complete_registration_otp_verification(uuid,text,boolean)','EXECUTE') OR
     NOT has_function_privilege('service_role','public.issue_registration_otp_ticket(uuid,text,text,timestamp with time zone,timestamp with time zone,text,text,text,text,text,text,text,text,text)','EXECUTE') OR
     has_function_privilege('anon','public.issue_registration_otp_ticket(uuid,text,text,timestamp with time zone,timestamp with time zone,text,text,text,text,text,text,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'owner registration RPC permissions are unsafe';
  END IF;
  IF has_table_privilege('anon','public.registration_otp_attempts','SELECT') OR
     has_table_privilege('authenticated','public.registration_otp_attempts','SELECT') OR
     has_table_privilege('service_role','public.registration_otp_attempts','SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'registration OTP storage privileges are unsafe';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.registration_otp_attempts'::regclass) THEN
    RAISE EXCEPTION 'registration OTP RLS is not enabled';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN (
      'issue_registration_otp_ticket','get_registration_otp_attempts','complete_registration_otp_verification',
      'cancel_registration_otp_ticket','create_owner_registration'
    ) AND (NOT p.prosecdef OR NOT (p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']))
  ) THEN
    RAISE EXCEPTION 'registration RPC security definer/search_path configuration is unsafe';
  END IF;
END $$;
ROLLBACK;
