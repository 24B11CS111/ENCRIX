BEGIN;

DO $$
DECLARE
  v_state JSONB;
  v_ticket UUID := 'f6d2a05e-c470-4bd3-9a16-b13d086cfad1';
  v_expired UUID := 'a5f81a71-2f2b-4cde-9c14-35bafca019e2';
  v_cancelled UUID := 'f3f7d84d-8076-49de-9509-d5d0853b4aa8';
  v_missing UUID := 'c11b5f39-2b21-49a5-a29a-c6eac6f32ab7';
  v_issued UUID := 'f8f63db0-70a9-424f-b15c-c17970de1007';
  v_attempt INTEGER;
  v_issue_proc OID := 'public.issue_email_otp_ticket(uuid,text,text,text,timestamp with time zone,timestamp with time zone)'::pg_catalog.regprocedure;
  v_verify_proc OID := 'public.complete_email_otp_verification(uuid,text,text,boolean)'::pg_catalog.regprocedure;
BEGIN
  IF pg_catalog.to_regclass('public.email_otps') IS NULL THEN
    RAISE EXCEPTION 'FAIL: public.email_otps is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
     WHERE attrelid = 'public.email_otps'::pg_catalog.regclass
       AND attname = 'ticket_id' AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
     WHERE attrelid = 'public.email_otps'::pg_catalog.regclass
       AND attname = 'verified_at' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'FAIL: durable ticket columns are missing';
  END IF;

  IF NOT pg_catalog.has_function_privilege('service_role',
       'public.issue_email_otp_ticket(uuid,text,text,text,timestamp with time zone,timestamp with time zone)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role',
       'public.complete_email_otp_verification(uuid,text,text,boolean)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role',
       'public.cancel_email_otp_ticket(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: service_role cannot execute OTP RPCs';
  END IF;
  IF pg_catalog.has_function_privilege('anon',
       'public.issue_email_otp_ticket(uuid,text,text,text,timestamp with time zone,timestamp with time zone)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated',
       'public.issue_email_otp_ticket(uuid,text,text,text,timestamp with time zone,timestamp with time zone)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon',
       'public.complete_email_otp_verification(uuid,text,text,boolean)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated',
       'public.complete_email_otp_verification(uuid,text,text,boolean)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon',
       'public.cancel_email_otp_ticket(uuid,text,text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated',
       'public.cancel_email_otp_ticket(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: API roles can execute OTP RPCs directly';
  END IF;
  IF NOT (SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']
            FROM pg_catalog.pg_proc AS p WHERE p.oid = v_issue_proc)
     OR NOT (SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']
            FROM pg_catalog.pg_proc AS p WHERE p.oid = v_verify_proc) THEN
    RAISE EXCEPTION 'FAIL: OTP RPC security-definer/search_path settings are incorrect';
  END IF;
  IF pg_catalog.strpos(pg_catalog.pg_get_functiondef(v_issue_proc), 'pg_advisory_xact_lock') = 0
     OR pg_catalog.strpos(pg_catalog.pg_get_functiondef(v_verify_proc), 'FOR UPDATE') = 0 THEN
    RAISE EXCEPTION 'FAIL: OTP issuance/verification does not serialize concurrent state changes';
  END IF;

  INSERT INTO public.email_otps (ticket_id, email, purpose, otp_hash, attempts, resend_after, expires_at, used)
  VALUES
    (v_ticket, 'otp-login@example.test', 'LOGIN', repeat('a', 64), 0,
      pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp() + INTERVAL '5 minutes', FALSE),
    (v_expired, 'otp-expired@example.test', 'LOGIN', repeat('b', 64), 0,
      pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp() - INTERVAL '1 second', FALSE),
    (v_cancelled, 'otp-cancelled@example.test', 'INVITATION', repeat('c', 64), 0,
      pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp() + INTERVAL '5 minutes', FALSE);

  FOR v_attempt IN 1..5 LOOP
    v_state := public.complete_email_otp_verification(v_ticket, 'OTP-LOGIN@example.test', 'LOGIN', FALSE);
    IF (v_state->>'attempts')::INTEGER <> v_attempt THEN
      RAISE EXCEPTION 'FAIL: incorrect attempt % was not stored atomically', v_attempt;
    END IF;
    IF v_attempt < 5 AND v_state->>'reason' <> 'invalid' THEN
      RAISE EXCEPTION 'FAIL: attempt % returned unexpected state %', v_attempt, v_state;
    END IF;
  END LOOP;

  v_state := public.complete_email_otp_verification(v_ticket, 'otp-login@example.test', 'LOGIN', TRUE);
  IF v_state->>'reason' <> 'consumed' THEN
    RAISE EXCEPTION 'FAIL: correct OTP succeeded after five failures: %', v_state;
  END IF;

  -- A fresh ticket verifies once, and a second successful attempt is replay.
  INSERT INTO public.email_otps (ticket_id, email, purpose, otp_hash, attempts, resend_after, expires_at, used)
  VALUES (v_issued, 'otp-success@example.test', 'LOGIN', repeat('d', 64), 0,
    pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp() + INTERVAL '5 minutes', FALSE);
  v_state := public.complete_email_otp_verification(v_issued, 'otp-success@example.test', 'LOGIN', TRUE);
  IF v_state->>'verified' <> 'true' THEN
    RAISE EXCEPTION 'FAIL: valid OTP did not verify: %', v_state;
  END IF;
  v_state := public.complete_email_otp_verification(v_issued, 'otp-success@example.test', 'LOGIN', TRUE);
  IF v_state->>'reason' <> 'consumed' THEN
    RAISE EXCEPTION 'FAIL: replay was not rejected: %', v_state;
  END IF;

  v_state := public.complete_email_otp_verification(v_expired, 'otp-expired@example.test', 'LOGIN', TRUE);
  IF v_state->>'reason' <> 'expired' THEN
    RAISE EXCEPTION 'FAIL: expired ticket was not rejected: %', v_state;
  END IF;
  IF NOT public.cancel_email_otp_ticket(v_cancelled, 'otp-cancelled@example.test', 'INVITATION') THEN
    RAISE EXCEPTION 'FAIL: cancellation RPC did not consume the issued ticket';
  END IF;
  v_state := public.complete_email_otp_verification(v_cancelled, 'otp-cancelled@example.test', 'INVITATION', TRUE);
  IF v_state->>'reason' <> 'consumed' THEN
    RAISE EXCEPTION 'FAIL: cancelled ticket was not rejected: %', v_state;
  END IF;
  v_state := public.complete_email_otp_verification(v_missing, 'otp-missing@example.test', 'LOGIN', TRUE);
  IF v_state->>'reason' <> 'unavailable' THEN
    RAISE EXCEPTION 'FAIL: missing ticket state was not rejected: %', v_state;
  END IF;

  v_state := public.issue_email_otp_ticket(
    'ed0041db-b323-47f8-a529-f2a81c878d97', 'otp-issue@example.test', 'INVITATION',
    repeat('e', 64), pg_catalog.clock_timestamp() + INTERVAL '1 minute',
    pg_catalog.clock_timestamp() + INTERVAL '5 minutes'
  );
  IF v_state->>'issued' <> 'true' THEN
    RAISE EXCEPTION 'FAIL: durable ticket issue failed: %', v_state;
  END IF;
  v_state := public.issue_email_otp_ticket(
    'b8b879ad-58f0-4400-aad7-a38ca971c0db', 'otp-issue@example.test', 'INVITATION',
    repeat('f', 64), pg_catalog.clock_timestamp() + INTERVAL '1 minute',
    pg_catalog.clock_timestamp() + INTERVAL '5 minutes'
  );
  IF v_state->>'reason' <> 'cooldown' THEN
    RAISE EXCEPTION 'FAIL: resend cooldown was not enforced atomically: %', v_state;
  END IF;

  RAISE NOTICE 'PASS: durable OTP schema, permissions, attempt limit, expiry, replay, cancellation, missing-row fail-closed and issue cooldown';
END;
$$;

ROLLBACK;
