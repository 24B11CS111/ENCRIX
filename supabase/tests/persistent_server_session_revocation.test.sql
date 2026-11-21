BEGIN;

DO $checks$
BEGIN
  IF NOT has_function_privilege('service_role', 'public.is_server_session_revoked(text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.is_server_session_revoked(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.is_server_session_revoked(text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.revoke_server_session(text,timestamp with time zone)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.revoke_server_session(text,timestamp with time zone)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.revoke_server_session(text,timestamp with time zone)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Session revocation RPC grants are not restricted to service_role.';
  END IF;

  IF has_table_privilege('service_role', 'public.server_session_revocations', 'SELECT')
     OR has_table_privilege('service_role', 'public.server_session_revocations', 'INSERT') THEN
    RAISE EXCEPTION 'Session revocation records must only be mutated through the RPC.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = 'public.revoke_server_session(text,timestamp with time zone)'::regprocedure
      AND p.prosecdef
      AND p.proconfig @> ARRAY['search_path=pg_catalog, public']
  ) THEN
    RAISE EXCEPTION 'Session revocation RPC must be SECURITY DEFINER with a fixed search_path.';
  END IF;
END;
$checks$;

SET LOCAL ROLE service_role;
SELECT public.revoke_server_session(
  'sess_regression_session_001',
  pg_catalog.clock_timestamp() + INTERVAL '1 hour'
);
DO $behavior$
BEGIN
  IF NOT public.is_server_session_revoked('sess_regression_session_001') THEN
    RAISE EXCEPTION 'A revoked session was not recognized.';
  END IF;

  BEGIN
    PERFORM public.revoke_server_session(
      'sess_regression_expired_001',
      pg_catalog.clock_timestamp() - INTERVAL '1 second'
    );
    RAISE EXCEPTION 'Expired session revocation was unexpectedly accepted.';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;
END;
$behavior$;

ROLLBACK;
