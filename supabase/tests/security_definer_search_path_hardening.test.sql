-- Catalog regression for 20261031140000. No fixtures are created; all checks
-- run inside a transaction that is rolled back at the end.
BEGIN;

DO $test$
DECLARE
  v_signature regprocedure;
  v_owner name;
  v_is_security_definer boolean;
  v_grant record;
BEGIN
  FOR v_signature IN
    SELECT unnest(ARRAY[
      'public.begin_caller_phone_enrollment(uuid,uuid,text,text)'::regprocedure,
      'public.complete_caller_phone_enrollment(uuid,uuid,boolean)'::regprocedure,
      'public.can_access_call_recording(uuid,uuid)'::regprocedure,
      'public.can_access_call_recording(uuid)'::regprocedure,
      'public.can_access_call_recording_path(text)'::regprocedure,
      'public.get_telecaller_student_detail_legacy(uuid)'::regprocedure,
      'public.is_caller_active()'::regprocedure,
      'public.restrict_telecaller_lead_update_columns()'::regprocedure
    ]::regprocedure[])
  LOOP
    SELECT pg_catalog.pg_get_userbyid(p.proowner)::name, p.prosecdef
      INTO v_owner, v_is_security_definer
      FROM pg_catalog.pg_proc AS p
     WHERE p.oid = v_signature::oid
       AND p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp'];

    IF NOT FOUND THEN
      RAISE EXCEPTION 'FAIL: % is missing or lacks the exact hardened search_path', v_signature;
    END IF;
    IF v_owner <> 'postgres' OR NOT v_is_security_definer THEN
      RAISE EXCEPTION 'FAIL: % owner/security-definer status changed (owner %, definer %)',
        v_signature, v_owner, v_is_security_definer;
    END IF;
    RAISE NOTICE 'PASS: % retains postgres ownership and SECURITY DEFINER with hardened search_path',
      v_signature;
  END LOOP;

  -- Preserve the EXECUTE matrix observed before this path-only migration.
  FOR v_grant IN
    SELECT * FROM (VALUES
      ('public.begin_caller_phone_enrollment(uuid,uuid,text,text)'::regprocedure, 'anon', false),
      ('public.begin_caller_phone_enrollment(uuid,uuid,text,text)'::regprocedure, 'authenticated', false),
      ('public.begin_caller_phone_enrollment(uuid,uuid,text,text)'::regprocedure, 'service_role', true),
      ('public.complete_caller_phone_enrollment(uuid,uuid,boolean)'::regprocedure, 'anon', false),
      ('public.complete_caller_phone_enrollment(uuid,uuid,boolean)'::regprocedure, 'authenticated', false),
      ('public.complete_caller_phone_enrollment(uuid,uuid,boolean)'::regprocedure, 'service_role', true),
      ('public.can_access_call_recording(uuid,uuid)'::regprocedure, 'anon', false),
      ('public.can_access_call_recording(uuid,uuid)'::regprocedure, 'authenticated', false),
      ('public.can_access_call_recording(uuid,uuid)'::regprocedure, 'service_role', true),
      ('public.can_access_call_recording(uuid)'::regprocedure, 'anon', false),
      ('public.can_access_call_recording(uuid)'::regprocedure, 'authenticated', true),
      ('public.can_access_call_recording(uuid)'::regprocedure, 'service_role', true),
      ('public.can_access_call_recording_path(text)'::regprocedure, 'anon', false),
      ('public.can_access_call_recording_path(text)'::regprocedure, 'authenticated', true),
      ('public.can_access_call_recording_path(text)'::regprocedure, 'service_role', true),
      ('public.get_telecaller_student_detail_legacy(uuid)'::regprocedure, 'anon', false),
      ('public.get_telecaller_student_detail_legacy(uuid)'::regprocedure, 'authenticated', false),
      ('public.get_telecaller_student_detail_legacy(uuid)'::regprocedure, 'service_role', false),
      ('public.is_caller_active()'::regprocedure, 'anon', false),
      ('public.is_caller_active()'::regprocedure, 'authenticated', true),
      ('public.is_caller_active()'::regprocedure, 'service_role', true),
      ('public.restrict_telecaller_lead_update_columns()'::regprocedure, 'anon', false),
      ('public.restrict_telecaller_lead_update_columns()'::regprocedure, 'authenticated', false),
      ('public.restrict_telecaller_lead_update_columns()'::regprocedure, 'service_role', true)
    ) AS expected(function_signature, role_name, expected_execute)
  LOOP
    IF pg_catalog.has_function_privilege(
      v_grant.role_name,
      v_grant.function_signature,
      'EXECUTE'
    ) IS DISTINCT FROM v_grant.expected_execute THEN
      RAISE EXCEPTION 'FAIL: EXECUTE changed for % and role % (expected %, actual %)',
        v_grant.function_signature,
        v_grant.role_name,
        v_grant.expected_execute,
        pg_catalog.has_function_privilege(
          v_grant.role_name,
          v_grant.function_signature,
          'EXECUTE'
        );
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS: all 24 existing API-role EXECUTE permissions are unchanged';
END;
$test$;

ROLLBACK;
