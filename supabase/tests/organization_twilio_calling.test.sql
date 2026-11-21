BEGIN;

DO $test$
DECLARE
  v_proc regprocedure;
  v_table regclass;
  v_def text;
  v_acl text[];
  v_grantable boolean;
  v_passed integer := 0;
BEGIN
  v_table := pg_catalog.to_regclass('public.organization_twilio_credentials');
  IF v_table IS NULL THEN RAISE EXCEPTION 'FAIL: organization Twilio credential table is missing'; END IF;
  IF (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = v_table) IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'FAIL: organization Twilio credential RLS is not enabled';
  END IF;
  v_passed := v_passed + 1;

  IF pg_catalog.has_table_privilege('anon', v_table, 'SELECT')
     OR pg_catalog.has_table_privilege('anon', v_table, 'INSERT')
     OR pg_catalog.has_table_privilege('anon', v_table, 'UPDATE')
     OR pg_catalog.has_table_privilege('anon', v_table, 'DELETE')
     OR pg_catalog.has_table_privilege('anon', v_table, 'TRUNCATE')
     OR pg_catalog.has_table_privilege('anon', v_table, 'REFERENCES')
     OR pg_catalog.has_table_privilege('anon', v_table, 'TRIGGER')
     OR pg_catalog.has_table_privilege('anon', v_table, 'MAINTAIN')
     OR pg_catalog.has_table_privilege('authenticated', v_table, 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', v_table, 'INSERT')
     OR pg_catalog.has_table_privilege('authenticated', v_table, 'UPDATE')
     OR pg_catalog.has_table_privilege('authenticated', v_table, 'DELETE')
     OR pg_catalog.has_table_privilege('authenticated', v_table, 'TRUNCATE')
     OR pg_catalog.has_table_privilege('authenticated', v_table, 'REFERENCES')
     OR pg_catalog.has_table_privilege('authenticated', v_table, 'TRIGGER')
     OR pg_catalog.has_table_privilege('authenticated', v_table, 'MAINTAIN') THEN
    RAISE EXCEPTION 'FAIL: browser roles can access encrypted organization credentials';
  END IF;
  IF NOT pg_catalog.has_table_privilege('service_role', v_table, 'SELECT')
     OR pg_catalog.has_table_privilege('service_role', v_table, 'INSERT')
     OR pg_catalog.has_table_privilege('service_role', v_table, 'UPDATE')
     OR pg_catalog.has_table_privilege('service_role', v_table, 'DELETE')
     OR pg_catalog.has_table_privilege('service_role', v_table, 'TRUNCATE')
     OR pg_catalog.has_table_privilege('service_role', v_table, 'REFERENCES')
     OR pg_catalog.has_table_privilege('service_role', v_table, 'TRIGGER')
     OR pg_catalog.has_table_privilege('service_role', v_table, 'MAINTAIN') THEN
    RAISE EXCEPTION 'FAIL: service_role lacks required encrypted credential access';
  END IF;
  SELECT COALESCE(pg_catalog.array_agg(a.privilege_type ORDER BY a.privilege_type), ARRAY[]::TEXT[]),
         COALESCE(pg_catalog.bool_or(a.is_grantable), FALSE)
    INTO v_acl, v_grantable
    FROM pg_catalog.pg_class c
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
   WHERE c.oid = v_table
     AND a.grantee = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'service_role');
  IF v_acl IS DISTINCT FROM ARRAY['SELECT']::TEXT[] OR v_grantable THEN
    RAISE EXCEPTION 'FAIL: service_role credential table ACL is %, expected non-grantable SELECT only', v_acl;
  END IF;
  v_passed := v_passed + 1;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
     WHERE attrelid = v_table AND attname IN ('auth_token', 'twilio_auth_token') AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'FAIL: credential table contains a plaintext token column';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = v_table AND attname = 'ciphertext' AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = v_table AND attname = 'auth_tag' AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = v_table AND attname = 'key_id' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'FAIL: encrypted credential envelope columns are incomplete';
  END IF;
  v_passed := v_passed + 1;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
     WHERE i.indrelid = v_table AND c.relname = 'organization_twilio_active_phone_uidx' AND i.indisunique
  ) THEN RAISE EXCEPTION 'FAIL: active Twilio phone uniqueness is not enforced'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_policy p ON p.polrelid = c.oid
     WHERE c.oid = v_table AND p.polname = 'organization_twilio_service_role_only'
       AND p.polroles @> ARRAY[(SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'service_role')::oid]
  ) THEN RAISE EXCEPTION 'FAIL: service-role-only credential policy is missing'; END IF;
  v_passed := v_passed + 1;

  FOREACH v_proc IN ARRAY ARRAY[
    'public.prepare_twilio_outbound_call(uuid,uuid,uuid,uuid,timestamp with time zone)'::regprocedure,
    'public.claim_twilio_customer_leg(uuid)'::regprocedure,
    'public.attach_twilio_leg_sid(uuid,text,text)'::regprocedure,
    'public.record_twilio_inbound_attempt(uuid,text,text)'::regprocedure,
    'public.prepare_twilio_inbound_call(uuid,text,text,text,timestamp with time zone)'::regprocedure,
    'public.save_organization_twilio_credentials(uuid,text,text,text,text,text,uuid)'::regprocedure,
    'public.revoke_organization_twilio_credentials(uuid,uuid)'::regprocedure
  ] LOOP
    IF NOT (SELECT prosecdef AND proconfig @> ARRAY['search_path=pg_catalog, pg_temp']
              FROM pg_catalog.pg_proc WHERE oid = v_proc) THEN
      RAISE EXCEPTION 'FAIL: RPC % is not SECURITY DEFINER with a restricted search_path', v_proc;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', v_proc, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', v_proc, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_proc, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: RPC % privileges are incorrect', v_proc;
    END IF;
    v_passed := v_passed + 1;
  END LOOP;

  v_def := pg_catalog.pg_get_functiondef('public.prepare_twilio_outbound_call(uuid,uuid,uuid,uuid,timestamp with time zone)'::regprocedure);
  IF position('pg_advisory_xact_lock' IN v_def) = 0
     OR position('l.assigned_to = p_telecaller_id' IN v_def) = 0
     OR position('p.phone_verified IS TRUE' IN v_def) = 0
     OR position('DO_NOT_CONTACT' IN v_def) = 0 THEN
    RAISE EXCEPTION 'FAIL: outbound preparation lacks atomic idempotency or assignment/status checks';
  END IF;
  v_passed := v_passed + 1;

  v_def := pg_catalog.pg_get_functiondef('public.prepare_twilio_inbound_call(uuid,text,text,text,timestamp with time zone)'::regprocedure);
  IF position('pg_advisory_xact_lock' IN v_def) = 0
     OR position('AMBIGUOUS_LEAD' IN v_def) = 0
     OR position('NO_ELIGIBLE_TELECALLER' IN v_def) = 0
     OR position('p.phone_verified IS TRUE' IN v_def) = 0 THEN
    RAISE EXCEPTION 'FAIL: inbound resolution is not serialized and fail-closed';
  END IF;
  v_passed := v_passed + 1;

  v_def := pg_catalog.pg_get_functiondef('public.save_organization_twilio_credentials(uuid,text,text,text,text,text,uuid)'::regprocedure);
  IF position('FOR UPDATE' IN v_def) = 0
     OR position('c.status IN' IN v_def) = 0
     OR position('RETURN FALSE' IN v_def) = 0 THEN
    RAISE EXCEPTION 'FAIL: credential rotation does not serialize and refuse changes during active calls';
  END IF;
  v_def := pg_catalog.pg_get_functiondef('public.revoke_organization_twilio_credentials(uuid,uuid)'::regprocedure);
  IF position('FOR UPDATE' IN v_def) = 0
     OR position('c.status IN' IN v_def) = 0
     OR position('RETURN FALSE' IN v_def) = 0 THEN
    RAISE EXCEPTION 'FAIL: credential revocation does not preserve active call callbacks';
  END IF;
  v_passed := v_passed + 1;

  v_def := pg_catalog.pg_get_functiondef('public.attach_twilio_leg_sid(uuid,text,text)'::regprocedure);
  IF position('RETURNING b.flow INTO v_flow' IN v_def) = 0
     OR position('IF v_updated AND v_flow = ''OUTBOUND'' THEN' IN v_def) = 0 THEN
    RAISE EXCEPTION 'FAIL: inbound telecaller child SID can overwrite the parent call identity';
  END IF;
  v_passed := v_passed + 1;

  v_def := pg_catalog.pg_get_functiondef('public.claim_twilio_customer_leg(uuid)'::regprocedure);
  IF position('b.status IN' IN v_def) = 0
     OR position('c.status IN' IN v_def) = 0
     OR position('b.flow = ''OUTBOUND''' IN v_def) = 0 THEN
    RAISE EXCEPTION 'FAIL: a terminal or inbound call can claim an outbound customer leg';
  END IF;
  v_passed := v_passed + 1;

  v_table := pg_catalog.to_regclass('public.telephony_inbound_attempts');
  IF v_table IS NULL OR (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = v_table) IS DISTINCT FROM TRUE
     OR pg_catalog.has_table_privilege('anon', v_table, 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', v_table, 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: inbound attempts are missing or browser-readable';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
     WHERE attrelid = v_table AND attname IN ('from_phone', 'caller_phone', 'customer_phone') AND NOT attisdropped
  ) THEN RAISE EXCEPTION 'FAIL: inbound attempt log stores raw phone values'; END IF;
  IF pg_catalog.has_table_privilege('service_role', v_table, 'SELECT')
     OR pg_catalog.has_table_privilege('service_role', v_table, 'INSERT')
     OR pg_catalog.has_table_privilege('service_role', v_table, 'UPDATE')
     OR pg_catalog.has_table_privilege('service_role', v_table, 'DELETE')
     OR pg_catalog.has_table_privilege('service_role', v_table, 'TRUNCATE')
     OR pg_catalog.has_table_privilege('service_role', v_table, 'REFERENCES')
     OR pg_catalog.has_table_privilege('service_role', v_table, 'TRIGGER')
     OR pg_catalog.has_table_privilege('service_role', v_table, 'MAINTAIN') THEN
    RAISE EXCEPTION 'FAIL: service_role has direct access to the private inbound-attempt ledger';
  END IF;
  v_passed := v_passed + 1;

  RAISE NOTICE 'PASS: % organization Twilio schema, RLS, grants and call-flow assertions', v_passed;
END;
$test$;

ROLLBACK;
